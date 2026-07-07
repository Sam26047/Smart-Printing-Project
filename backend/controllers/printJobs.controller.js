// backend/controllers/printJobs.controller.js
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import pool from "../db/pool.js";
import redisClient from "../redisClient.js";
import { sendOTPEmail, sendStatusEmail } from "../services/emailService.js";
import {
  getUrgencyMultiplier,
  isUrgentDisabled,
  calculateJobCost,
  URGENT_DAILY_LIMIT,
  URGENT_COOLDOWN_MS,
} from "../utils/pricing.js";
import { getAdminShopId } from "../utils/adminShop.js";
import { attemptDispatch } from "../utils/routing.js";

// Helper function for OTP generation — now also emails the user
async function generateOTP(jobId) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await redisClient.setEx(`job:${jobId}:otp`, 600, otp);

  // Look up the user's email from the job and send OTP
  try {
    const result = await pool.query(
      `SELECT u.email FROM print_jobs j
       JOIN users u ON j.user_id = u.id
       WHERE j.id = $1`,
      [jobId]
    );
    if (result.rows.length > 0 && result.rows[0].email) {
      await sendOTPEmail(result.rows[0].email, otp, jobId);
      console.log(`📧 OTP emailed to ${result.rows[0].email} for job ${jobId}`);
    } else {
      // fallback: still log to terminal if no email on file
      console.log(`🔐 OTP for job ${jobId}: ${otp} (no email on file)`);
    }
  } catch (emailErr) {
    // Don't fail the whole flow if email fails — log and move on
    console.error("EMAIL SEND ERROR:", emailErr.message);
    console.log(`🔐 OTP for job ${jobId}: ${otp} (email failed, logged here)`);
  }

  return otp;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Helper: get current QUEUED job count (used for dynamic pricing + peak check) ───
// Scoped per shop when shopId is given — one shop being slammed shouldn't
// raise prices or disable URGENT at another shop.
async function getQueueSize(shopId = null) {
  const result = shopId
    ? await pool.query(
        "SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'QUEUED' AND shop_id = $1",
        [shopId]
      )
    : await pool.query(
        "SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'QUEUED'"
      );
  return parseInt(result.rows[0].count) || 0;
}

// (getAdminShopId moved to utils/adminShop.js — now shared with the printers
// and shop-pricing controllers)

export const getAllJobs = async (req, res) => {
  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `SELECT
        j.id,
        j.status,
        j.priority,
        j.deadline,
        j.urgency_level,
        j.created_at,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'file_name', f.file_name,
            'copies', f.copies,
            'color', f.color,
            'double_sided', f.double_sided
          ) ORDER BY f.file_name
        ) FILTER (WHERE f.file_name IS NOT NULL) AS files
      FROM print_jobs j
      LEFT JOIN job_files f ON j.id = f.job_id
      WHERE j.shop_id = $1
      GROUP BY j.id
      ORDER BY
        j.priority DESC,
        CASE WHEN j.deadline IS NULL THEN 1 ELSE 0 END,
        j.deadline ASC,
        j.created_at ASC`,
      [adminShopId]
    );
    res.json({ jobs: result.rows });
  } catch (err) {
    console.error("FETCH JOBS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
};

// ─── GET /queue/status — public endpoint ─────────────────────────────────────
// Returns queue size and whether urgent is currently available.
// Frontend uses this to show "You are #N in queue" and grey-out urgent if needed.
export const getQueueStatus = async (req, res) => {
  try {
    // Optional ?shop_id=... scopes the numbers to one shop; without it the
    // count stays global so the current frontend keeps working unchanged.
    const { shop_id } = req.query;
    const shopId = shop_id && UUID_RE.test(shop_id) ? shop_id : null;
    const queueSize = await getQueueSize(shopId);
    res.json({
      queue_size: queueSize,
      urgent_disabled: isUrgentDisabled(queueSize),
    });
  } catch (err) {
    console.error("QUEUE STATUS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch queue status" });
  }
};

export const createPrintJob = async (req, res) => {
  try {
    // urgency_level replaces free-form deadline as the user-facing priority control
    const { deadline, fileSettings, urgency_level = "NORMAL", shop_id } = req.body;
    const userId = req.user.id;

    // ✅ validation
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "At least one PDF is required" });
    }

    // Validate urgency_level value
    if (!["NORMAL", "SOON", "URGENT"].includes(urgency_level)) {
      return res.status(400).json({ error: "Invalid urgency level" });
    }

    // fileSettings is sent as a JSON string: [{ copies, color, double_sided }, ...]
    let settings = [];
    try {
      settings = fileSettings ? JSON.parse(fileSettings) : [];
    } catch {
      return res.status(400).json({ error: "Invalid fileSettings format" });
    }

    // ─── Resolve target shop ──────────────────────────────────────────────────
    // Students pick a shop per job. When exactly one shop exists (current
    // single-campus case) it's auto-selected so the frontend needs no selector.
    let shopId = shop_id || null;
    if (shopId) {
      if (!UUID_RE.test(shopId)) {
        return res.status(400).json({ error: "Invalid shop_id" });
      }
      const shopCheck = await pool.query(
        "SELECT id FROM shops WHERE id = $1",
        [shopId]
      );
      if (shopCheck.rows.length === 0) {
        return res.status(400).json({ error: "Shop not found" });
      }
    } else {
      const shopsResult = await pool.query("SELECT id FROM shops");
      if (shopsResult.rows.length === 1) {
        shopId = shopsResult.rows[0].id;
      } else {
        return res
          .status(400)
          .json({ error: "shop_id is required when multiple shops exist" });
      }
    }

    // ─── Shop pricing (per-shop rates; server is the source of truth) ─────────
    const pricingRes = await pool.query(
      `SELECT bw_price_per_page, color_price_per_page, duplex_discount_pct
       FROM shop_pricing WHERE shop_id = $1`,
      [shopId]
    );
    if (pricingRes.rows.length === 0) {
      return res.status(400).json({ error: "Shop pricing not configured" });
    }
    const shopPricing = pricingRes.rows[0];

    // ─── Server-authoritative page counts (pdf-lib) ───────────────────────────
    // Done BEFORE the urgency checks so a corrupt upload can't burn an URGENT
    // quota slot. A PDF we can't parse is a hard 400 and the uploads are
    // removed — we never guess a page count.
    const pageCounts = [];
    for (const file of req.files) {
      try {
        const bytes = fs.readFileSync(file.path);
        // ignoreEncryption: password-protected PDFs still have a readable page
        // tree and usually print fine; truly corrupt files still throw.
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        pageCounts.push(doc.getPageCount());
      } catch {
        for (const f of req.files) {
          try { fs.unlinkSync(f.path); } catch { /* already gone */ }
        }
        return res.status(400).json({
          error: `Could not read "${file.originalname}" as a PDF — file may be corrupt`,
        });
      }
    }

    // One settings entry per uploaded file (files beyond the provided settings
    // get defaults), each carrying its real page count for pricing.
    settings = req.files.map((_, i) => ({
      ...(settings[i] || {}),
      page_count: pageCounts[i],
    }));

    // ─── Current queue size — needed for dynamic pricing + peak check ─────────
    // Scoped to the target shop: pricing pressure at one shop shouldn't leak
    // into another.
    const queueSize = await getQueueSize(shopId);

    // ─── Abuse protection (URGENT only) ──────────────────────────────────────
    if (urgency_level === "URGENT") {
      // Block if peak load — too many jobs in queue
      if (isUrgentDisabled(queueSize)) {
        return res.status(429).json({
          error: "Urgent unavailable due to high load. Please choose Normal or Soon.",
        });
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Rule 1: max URGENT_DAILY_LIMIT urgent jobs per 24 hours
      const dailyResult = await pool.query(
        `SELECT COUNT(*) AS count
         FROM urgency_usage
         WHERE user_id = $1 AND used_at > $2`,
        [userId, oneDayAgo]
      );
      const dailyCount = parseInt(dailyResult.rows[0].count) || 0;

      if (dailyCount >= URGENT_DAILY_LIMIT) {
        return res.status(429).json({
          error: `Daily urgent limit reached (${URGENT_DAILY_LIMIT} per day). Try again tomorrow.`,
        });
      }

      // Rule 2: cooldown — cannot use urgent again within URGENT_COOLDOWN_MS
      const cooldownResult = await pool.query(
        `SELECT used_at
         FROM urgency_usage
         WHERE user_id = $1
         ORDER BY used_at DESC
         LIMIT 1`,
        [userId]
      );

      if (cooldownResult.rows.length > 0) {
        const lastUsed    = new Date(cooldownResult.rows[0].used_at);
        const msSinceLast = Date.now() - lastUsed.getTime();

        if (msSinceLast < URGENT_COOLDOWN_MS) {
          const minutesLeft = Math.ceil((URGENT_COOLDOWN_MS - msSinceLast) / 60000);
          return res.status(429).json({
            error: `Cooldown active. You can use Urgent again in ${minutesLeft} minute(s).`,
            cooldown_minutes_left: minutesLeft,
          });
        }
      }

      // Passes all checks → record this urgent usage
      await pool.query(
        "INSERT INTO urgency_usage (user_id) VALUES ($1)",
        [userId]
      );
    }

    // ─── Pricing calculation ─────────────────────────────────────────────────
    // Multiplier depends on urgency level AND how busy the queue is.
    // Both the multiplier and the resulting cost are LOCKED onto the job row:
    // the multiplier is queue-size-dependent so it can't be re-derived later,
    // and reassign-file needs it to recompute the price exactly.
    const multiplier = getUrgencyMultiplier(urgency_level, queueSize);
    const pricing    = calculateJobCost(settings, multiplier, shopPricing);

    // 1️⃣ Create job — urgency_level stored alongside deadline for worker sorting
    // ❗ copies/color/double_sided moved to per-file level (job_files table)
    const jobResult = await pool.query(
      `INSERT INTO print_jobs
         (user_id, shop_id, status, deadline, urgency_level, urgency_multiplier, estimated_cost)
       VALUES ($1, $2, 'PENDING', $3, $4, $5, $6)
       RETURNING id`,
      [userId, shopId, deadline || null, urgency_level, multiplier, pricing.grandTotal]
    );

    const jobId = jobResult.rows[0].id;

    // ✅ Use a Redis Set so multiple jobs can be active at once
    // sAdd adds jobId into the set — if set doesn't exist, Redis creates it
    await redisClient.sAdd(`user:${userId}:activeJobs`, jobId); // key, value

    // 2️⃣ Insert all files (with per-file settings now)
    const insertFilesPromises = req.files.map((file, index) => {
      const s = settings[index] || {};

      const copies       = parseInt(s.copies) || 1;
      const color        = s.color === true || s.color === "true";
      const double_sided = s.double_sided === true || s.double_sided === "true";
      const orientation  = ["portrait", "landscape"].includes(s.orientation)
                            ? s.orientation
                            : "portrait";
      const paper_size   = ["A4", "Letter", "A3"].includes(s.paper_size)
                            ? s.paper_size
                            : "A4";

      return pool.query(
        `INSERT INTO job_files
          (job_id, file_name, file_path, copies, color, double_sided, orientation, paper_size, page_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [jobId, file.originalname, file.path, copies, color, double_sided, orientation, paper_size, s.page_count]
      );
    });

    await Promise.all(insertFilesPromises); // wait until all these promises finish
    // i.e if all inserts succeed -> continue
    // else throw error

    // 3️⃣ Response — include full pricing breakdown so frontend can display it
    res.status(201).json({
      job_id:         jobId,
      file_count:     req.files.length,
      urgency_level,
      estimated_cost: pricing.grandTotal, // locked server-side; authoritative
      pricing: {
        base_total:        pricing.baseTotal,
        urgency_extra:     pricing.urgencyExtra,
        grand_total:       pricing.grandTotal,
        urgency_multiplier: multiplier,
        breakdown:         pricing.breakdown,
      },
      message: "Files uploaded and job created",
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.message);
    res.status(500).json({ error: "Upload failed" });
  }
};

export const getJobById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, status, urgency_level, created_at
       FROM print_jobs
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Print job not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("DB ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch print job" });
  }
};

// Replace updateJobStatus with this:
export const updateJobStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const ALLOWED_STATUS_TRANSITIONS = {
    PENDING: ["QUEUED"],
    QUEUED: ["PRINTING", "WAITING_FOR_PRINTER"],
    // WAITING_FOR_PRINTER: no eligible ONLINE printer for ≥1 file. Leaves
    // QUEUED so it can't head-of-line-block routable jobs behind it.
    WAITING_FOR_PRINTER: ["QUEUED", "PRINTING"],
    PRINTING: ["READY"],
    READY: ["COLLECTED"],
  };

  try {
    // Admins may only manage their own shop's jobs
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    // 1. Get current status + user email in one query (scoped to admin's shop —
    //    another shop's job looks like a plain 404)
    const current = await pool.query(
      `SELECT j.status, u.email
       FROM print_jobs j
       JOIN users u ON j.user_id = u.id
       WHERE j.id = $1 AND j.shop_id = $2`,
      [id, adminShopId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    // 2. Validate transition
    const { status: currentStatus, email } = current.rows[0];
    const allowedNext = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowedNext.includes(status)) {
      return res.status(400).json({
        error: `Invalid transition from ${currentStatus} to ${status}`,
      });
    }

    // 3. Update status
    await pool.query("UPDATE print_jobs SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);

    res.json({ message: "Status updated successfully" });

    // 4. Fire status email (non-blocking — after response sent)
    if (email && (status === "QUEUED" || status === "READY")) {
      sendStatusEmail(email, id, status).catch((err) =>
        console.error("STATUS EMAIL ERROR:", err.message)
      );
    }
  } catch (err) {
    console.error("DB ERROR:", err.message);
    res.status(500).json({ error: "Failed to update status" });
  }
};

export const updateJobPriority = async (req, res) => {
  const { id } = req.params;
  const { priority } = req.body;

  if (priority === undefined) {
    return res.status(400).json({ error: "Priority is required" });
  }

  try {
    // Admins may only reorder their own shop's queue
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const current = await pool.query(
      "SELECT status FROM print_jobs WHERE id = $1 AND shop_id = $2",
      [id, adminShopId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (current.rows[0].status !== "QUEUED") {
      return res.status(400).json({
        error: "Only QUEUED jobs can be reordered",
      });
    }

    await pool.query("UPDATE print_jobs SET priority = $1 WHERE id = $2", [
      priority,
      id,
    ]);

    res.json({ message: "Priority updated successfully" });
  } catch (err) {
    console.log("DB ERROR:", err.message);
    res.status(500).json({ error: "Failed to update priority" });
  }
};

export const regenerateOtp = async (req, res) => {
  const { id } = req.params;

  try {
    //check job exists, is READY, and belongs to the requesting user.
    //NOTE: this is a student endpoint (frontend "Resend OTP"), not admin —
    //so it's scoped by job ownership, not by shop.
    const result = await pool.query(
      `SELECT id, status
       FROM print_jobs
       WHERE id = $1 AND status = 'READY' AND user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found or not READY" });
    }

    // Generate new OTP — emails user automatically now
    await generateOTP(id);

    res.json({ message: "OTP regenerated and sent to your email" });
  } catch (err) {
    console.error("REGENERATE OTP ERROR:", err.message);
    res.status(500).json({ error: "Failed to regenerate OTP" });
  }
};

// ─── POST /print-jobs/:id/reassign-file — shopkeeper override ────────────────
// Reassigns ONE file of a WAITING_FOR_PRINTER job to a printer of a different
// color tier (e.g. force a B&W file onto the color inkjet when the laser is
// down). Paper size and duplex must still be satisfied — only the color-tier
// rule is relaxed. The overridden file is re-priced at the PINNED PRINTER'S
// tier (B&W file on the inkjet charges the color rate — that's why this needs
// an explicit confirm), estimated_cost is recomputed with the job's stored
// urgency_multiplier and re-locked, then dispatch is re-attempted immediately.
export const reassignFile = async (req, res) => {
  const { id: jobId } = req.params;
  const { file_id, printer_id, confirm } = req.body || {};

  if (!file_id || !printer_id || !UUID_RE.test(file_id) || !UUID_RE.test(printer_id)) {
    return res.status(400).json({ error: "file_id and printer_id (UUIDs) are required" });
  }

  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    // Job must be in this admin's shop and actually blocked
    const jobRes = await pool.query(
      `SELECT id, status, urgency_level, urgency_multiplier, estimated_cost
       FROM print_jobs WHERE id = $1 AND shop_id = $2`,
      [jobId, adminShopId]
    );
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }
    const job = jobRes.rows[0];
    if (job.status !== "WAITING_FOR_PRINTER") {
      return res.status(400).json({
        error: `Only WAITING_FOR_PRINTER jobs can be reassigned (job is ${job.status})`,
      });
    }

    // File must belong to the job
    const fileRes = await pool.query(
      `SELECT id, color, double_sided, paper_size
       FROM job_files WHERE id = $1 AND job_id = $2`,
      [file_id, jobId]
    );
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: "File not found on this job" });
    }
    const file = fileRes.rows[0];

    // Target printer: same shop, ONLINE, and satisfies paper + duplex.
    // Color tier is deliberately NOT checked — this override exists precisely
    // to cross tiers.
    const printerRes = await pool.query(
      `SELECT id, label, status, supports_color, supports_duplex, paper_sizes
       FROM printers WHERE id = $1 AND shop_id = $2`,
      [printer_id, adminShopId]
    );
    if (printerRes.rows.length === 0) {
      return res.status(404).json({ error: "Printer not found" });
    }
    const printer = printerRes.rows[0];
    if (printer.status !== "ONLINE") {
      return res.status(400).json({ error: `Printer is ${printer.status}, not ONLINE` });
    }
    if (!printer.paper_sizes.includes(file.paper_size)) {
      return res.status(400).json({ error: `Printer does not support ${file.paper_size}` });
    }
    if (file.double_sided && !printer.supports_duplex) {
      return res.status(400).json({ error: "Printer does not support duplex" });
    }

    // ─── Recompute the locked price ──────────────────────────────────────────
    // Pinned files price at their printer's tier; unpinned files by file.color.
    const shopPricingRes = await pool.query(
      `SELECT bw_price_per_page, color_price_per_page, duplex_discount_pct
       FROM shop_pricing WHERE shop_id = $1`,
      [adminShopId]
    );
    if (shopPricingRes.rows.length === 0) {
      return res.status(400).json({ error: "Shop pricing not configured" });
    }
    const shopPricing = shopPricingRes.rows[0];

    const allFilesRes = await pool.query(
      `SELECT f.id, f.copies, f.color, f.double_sided, f.page_count,
              p.supports_color AS pinned_supports_color
       FROM job_files f
       LEFT JOIN printers p ON p.id = f.printer_id
       WHERE f.job_id = $1`,
      [jobId]
    );

    const settings = allFilesRes.rows.map((f) => ({
      copies: f.copies,
      // effective tier: the file being reassigned → target printer's tier;
      // an already-pinned file → its pinned printer's tier; else file.color
      color:
        f.id === file_id
          ? printer.supports_color
          : f.pinned_supports_color !== null
            ? f.pinned_supports_color
            : f.color,
      double_sided: f.double_sided,
      page_count: f.page_count,
    }));

    // Stored multiplier keeps the price exact (it was queue-size-dependent at
    // submission). Fallback for pre-migration jobs without one.
    const multiplier =
      job.urgency_multiplier !== null
        ? Number(job.urgency_multiplier)
        : getUrgencyMultiplier(job.urgency_level, 0);

    const pricing = calculateJobCost(settings, multiplier, shopPricing);

    // Price changes tiers → require explicit confirmation, echoing the new
    // price so the dashboard can show a confirm dialog.
    if (confirm !== true) {
      return res.status(400).json({
        error: "Confirmation required — this reassignment changes the price",
        current_estimated_cost: Number(job.estimated_cost),
        new_estimated_cost: pricing.grandTotal,
        confirm_required: true,
      });
    }

    // Pin the file, re-lock the cost, put the job back in the queue…
    await pool.query(`UPDATE job_files SET printer_id = $1 WHERE id = $2`, [
      printer_id,
      file_id,
    ]);
    await pool.query(
      `UPDATE print_jobs SET estimated_cost = $1, status = 'QUEUED'
       WHERE id = $2 AND status = 'WAITING_FOR_PRINTER'`,
      [pricing.grandTotal, jobId]
    );

    // …and re-attempt dispatch right away (other files may still block, in
    // which case the job returns to WAITING_FOR_PRINTER with the pin kept).
    const dispatch = await attemptDispatch(jobId);

    res.json({
      message: "File reassigned",
      job_id: jobId,
      file_id,
      pinned_printer: printer.label,
      new_estimated_cost: pricing.grandTotal,
      dispatched: dispatch.dispatched,
      job_status: dispatch.dispatched ? "PRINTING" : "WAITING_FOR_PRINTER",
    });
  } catch (err) {
    console.error("REASSIGN FILE ERROR:", err.message);
    res.status(500).json({ error: "Failed to reassign file" });
  }
};

export const collectPrintJob = async (req, res) => {
  const { otp } = req.body;
  const jobId   = req.params.id;

  if (!otp) {
    return res.status(400).json({ error: "OTP is required" });
  }

  try {
    // 1. Check job is READY and belongs to user
    const jobResult = await pool.query(
      `SELECT id, status, user_id
       FROM print_jobs
       WHERE id = $1 AND status = 'READY'`,
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: "Job not found or not ready for collection" });
    }

    // 2. Verify OTP from Redis
    const storedOtp = await redisClient.get(`job:${jobId}:otp`);

    if (!storedOtp || storedOtp !== otp) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const job = jobResult.rows[0];

    // 3. Mark as COLLECTED
    await pool.query(
      "UPDATE print_jobs SET status = 'COLLECTED' WHERE id = $1",
      [jobId]
    );

    // 4. Delete OTP from Redis — one-time use
    await redisClient.del(`job:${jobId}:otp`);

    // 5. Remove from user's active jobs set in Redis
    await redisClient.sRem(`user:${job.user_id}:activeJobs`, jobId);

    res.json({ message: "Job collected successfully" });
  } catch (err) {
    console.error("COLLECT ERROR:", err.message);
    res.status(500).json({ error: "Failed to collect job" });
  }
};