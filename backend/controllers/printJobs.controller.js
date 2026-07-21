// backend/controllers/printJobs.controller.js
import fs from "fs";
import path from "path";
import { PDFDocument, degrees } from "pdf-lib";
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

// ─── Helper: resolve the target shop for a submission/estimate ───────────────
// Students pick a shop per job; when exactly one shop exists (current
// single-campus case) it's auto-selected so the frontend needs no selector.
async function resolveShopId(rawShopId) {
  if (rawShopId) {
    if (!UUID_RE.test(rawShopId)) return { error: "Invalid shop_id" };
    const check = await pool.query("SELECT id FROM shops WHERE id = $1", [rawShopId]);
    if (check.rows.length === 0) return { error: "Shop not found" };
    return { shopId: rawShopId };
  }
  const all = await pool.query("SELECT id FROM shops");
  if (all.rows.length === 1) return { shopId: all.rows[0].id };
  return { error: "shop_id is required when multiple shops exist" };
}

// ─── Helper: a shop's capability tiers, indexed by id ────────────────────────
async function getShopTiers(shopId) {
  const result = await pool.query(
    `SELECT id, color, duplex, name, price_per_page
     FROM capability_tiers WHERE shop_id = $1`,
    [shopId]
  );
  const byId = {};
  for (const t of result.rows) byId[t.id] = t;
  return { list: result.rows, byId };
}

// ─── Helper: which of these tiers have ≥1 ONLINE printer assigned ────────────
async function availableTierIds(tierIds) {
  if (tierIds.length === 0) return new Set();
  const result = await pool.query(
    `SELECT DISTINCT pt.tier_id
     FROM printer_tiers pt
     JOIN printers p ON p.id = pt.printer_id
     WHERE pt.tier_id = ANY($1) AND p.status = 'ONLINE'`,
    [tierIds]
  );
  return new Set(result.rows.map((r) => r.tier_id));
}

// ─── Helper: resolve one file's tier from its explicit tier_id ───────────────
// The legacy color/double_sided input path was REMOVED in the E7 hard cutover
// once the student UI began sending tier_id — no fallback, same as AGENT_SECRET.
function resolveTier(tiers, s) {
  if (!s?.tier_id) return { error: "Each file must specify a print tier" };
  const tier = tiers.byId[s.tier_id];
  return tier ? { tier } : { error: "Unknown tier for this shop" };
}

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
        j.estimated_cost,
        j.created_at,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'file_id', f.id,
            'file_name', f.file_name,
            'copies', f.copies,
            'color', f.color,
            'double_sided', f.double_sided,
            'paper_size', f.paper_size,
            'printer_id', f.printer_id,
            'printer_label', p.label
          ) ORDER BY f.file_name
        ) FILTER (WHERE f.file_name IS NOT NULL) AS files
      FROM print_jobs j
      LEFT JOIN job_files f ON j.id = f.job_id
      LEFT JOIN printers p ON p.id = f.printer_id
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

// ─── POST /print-jobs/estimate — read-only cost preview ──────────────────────
// Runs the exact same pricing path as createPrintJob (same shop resolution,
// same shop_pricing row, same queue-dependent urgency multiplier, same
// calculateJobCost) but creates nothing and never touches uploads. Page counts
// aren't known before the files are uploaded, so each file prices at 1 page —
// the REAL total (with pdf-lib page counts) is locked and returned by
// createPrintJob at submission.
export const estimatePrintJob = async (req, res) => {
  try {
    const { fileSettings, urgency_level = "NORMAL", shop_id } = req.body || {};

    if (!["NORMAL", "SOON", "URGENT"].includes(urgency_level)) {
      return res.status(400).json({ error: "Invalid urgency level" });
    }

    let settings = fileSettings;
    if (typeof settings === "string") {
      try {
        settings = JSON.parse(settings);
      } catch {
        return res.status(400).json({ error: "Invalid fileSettings format" });
      }
    }
    if (!Array.isArray(settings) || settings.length === 0) {
      return res.status(400).json({ error: "fileSettings array is required" });
    }

    const shopResolution = await resolveShopId(shop_id);
    if (shopResolution.error) {
      return res.status(400).json({ error: shopResolution.error });
    }
    const shopId = shopResolution.shopId;

    // Tier resolution by explicit tier_id (legacy flag path removed — E7).
    // Estimates stay permissive on availability — they're a read-only preview;
    // submission enforces it.
    const tiers = await getShopTiers(shopId);
    if (tiers.list.length === 0) {
      return res.status(400).json({ error: "Shop pricing not configured" });
    }

    const queueSize  = await getQueueSize(shopId);
    const multiplier = getUrgencyMultiplier(urgency_level, queueSize);

    // Strip any client-sent page_count — estimates always price at 1 page/file
    // (calculateJobCost's default); the server never trusts client page counts.
    const clean = [];
    for (const s of settings) {
      const r = resolveTier(tiers, s);
      if (r.error) return res.status(400).json({ error: r.error });
      clean.push({
        copies: s.copies,
        color: r.tier.color,
        double_sided: r.tier.duplex,
        rate: Number(r.tier.price_per_page),
      });
    }

    const pricing = calculateJobCost(clean, multiplier);

    res.json({
      estimate: true, // page counts assumed 1/file — final total locked at submission
      shop_id: shopId,
      urgency_level,
      queue_size: queueSize,
      urgent_disabled: isUrgentDisabled(queueSize),
      pricing: {
        base_total:         pricing.baseTotal,
        urgency_extra:      pricing.urgencyExtra,
        grand_total:        pricing.grandTotal,
        urgency_multiplier: multiplier,
        breakdown:          pricing.breakdown,
      },
    });
  } catch (err) {
    console.error("ESTIMATE ERROR:", err.message);
    res.status(500).json({ error: "Failed to estimate cost" });
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

    // ─── Resolve target shop (shared with the estimate endpoint) ─────────────
    const shopResolution = await resolveShopId(shop_id);
    if (shopResolution.error) {
      return res.status(400).json({ error: shopResolution.error });
    }
    const shopId = shopResolution.shopId;

    // ─── Capability tiers: resolve each file's tier + enforce availability ───
    // (server is the pricing source of truth; the tier also DICTATES the
    // file's print settings — invariant: settings derive from the tier, never
    // from the device that eventually prints it)
    const tiers = await getShopTiers(shopId);
    if (tiers.list.length === 0) {
      for (const f of req.files) { try { fs.unlinkSync(f.path); } catch { /* gone */ } }
      return res.status(400).json({ error: "Shop pricing not configured" });
    }

    const fileTiers = [];
    for (let i = 0; i < req.files.length; i++) {
      const r = resolveTier(tiers, settings[i]);
      if (r.error) {
        for (const f of req.files) { try { fs.unlinkSync(f.path); } catch { /* gone */ } }
        return res.status(400).json({ error: r.error });
      }
      fileTiers.push(r.tier);
    }

    // A tier is submittable only while ≥1 ONLINE printer serves it — the
    // capability mismatch stops here instead of surprising the admin later.
    // (Printers going offline AFTER submission still park the job in
    // WAITING_FOR_PRINTER, unchanged.)
    const usedTierIds = [...new Set(fileTiers.map((t) => t.id))];
    const availSet = await availableTierIds(usedTierIds);
    const unavailable = fileTiers.find((t) => !availSet.has(t.id));
    if (unavailable) {
      for (const f of req.files) { try { fs.unlinkSync(f.path); } catch { /* gone */ } }
      return res.status(400).json({
        error: `'${unavailable.name}' is currently unavailable at this shop — no online printer supports it`,
      });
    }

    // ─── Server-authoritative page counts + landscape rotation (pdf-lib) ─────
    // Done BEFORE the urgency checks so a corrupt upload can't burn an URGENT
    // quota slot. A PDF we can't parse is a hard 400 and the uploads are
    // removed — we never guess a page count.
    //
    // Orientation is applied HERE, at submission, by page rotation — never by
    // spooler flags (driver-dependent) and never by the agent. Rule:
    //   • "portrait" (the unconscious default) is INERT — zero behavior change
    //   • "landscape" rotates only pages whose EFFECTIVE visual orientation is
    //     portrait. Effective = MediaBox dims combined with any existing
    //     /Rotate — MediaBox alone would send an already-/Rotate-90 page to
    //     180 (upside down). This also makes the operation idempotent: a page
    //     that is effectively landscape (rotated by us or by the source) is
    //     never touched again.
    // The stored upload is OVERWRITTEN with the rotated bytes — the stored
    // file IS the job file; original bytes are not retained (see CLAUDE.md).
    const pageCounts = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      try {
        const bytes = fs.readFileSync(file.path);
        // ignoreEncryption: password-protected PDFs still have a readable page
        // tree and usually print fine; truly corrupt files still throw.
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        pageCounts.push(doc.getPageCount());

        if (settings[i]?.orientation === "landscape") {
          let rotatedAny = false;
          for (const page of doc.getPages()) {
            const { width, height } = page.getSize(); // MediaBox — ignores /Rotate
            const rot = ((page.getRotation().angle % 360) + 360) % 360;
            const sideways = rot === 90 || rot === 270;
            const effectivelyLandscape = sideways ? height > width : width > height;
            if (!effectivelyLandscape && width !== height) { // square pages: nothing to do
              page.setRotation(degrees(rot + 90));
              rotatedAny = true;
            }
          }
          if (rotatedAny) {
            fs.writeFileSync(file.path, await doc.save());
          }
        }
      } catch {
        for (const f of req.files) {
          try { fs.unlinkSync(f.path); } catch { /* already gone */ }
        }
        return res.status(400).json({
          error: `Could not read "${file.originalname}" as a PDF — file may be corrupt`,
        });
      }
    }

    // One settings entry per uploaded file, carrying its real page count and
    // its TIER-derived print settings + rate. color/double_sided come from the
    // tier — never from the client, never from the device (the invariant).
    settings = req.files.map((_, i) => ({
      ...(settings[i] || {}),
      page_count: pageCounts[i],
      color: fileTiers[i].color,
      double_sided: fileTiers[i].duplex,
      rate: Number(fileTiers[i].price_per_page),
      tier_id: fileTiers[i].id,
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
    const pricing    = calculateJobCost(settings, multiplier);

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
          (job_id, file_name, file_path, copies, color, double_sided, orientation, paper_size, page_count, tier_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [jobId, file.originalname, file.path, copies, color, double_sided, orientation, paper_size, s.page_count, s.tier_id]
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

// Authed + owner-scoped: payment_status/estimated_cost ride on this endpoint
// (the checkout UI polls it), so it's no longer open-by-UUID. Only caller is
// the logged-in JobStatus card, which always sends the bearer token.
export const getJobById = async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: "Print job not found" });
  }

  try {
    const result = await pool.query(
      `SELECT
         j.id, j.status, j.urgency_level, j.payment_status, j.estimated_cost, j.created_at,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'file_id',   f.id,
             'file_name', f.file_name,
             'printed_ready', f.printed_file_path IS NOT NULL
           ) ORDER BY f.created_at
         ) FILTER (WHERE f.id IS NOT NULL) AS files
       FROM print_jobs j
       LEFT JOIN job_files f ON f.job_id = j.id
       WHERE j.id = $1 AND j.user_id = $2
       GROUP BY j.id`,
      [id, req.user.id]
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

// ─── GET /print-jobs/:id/files/:fileId/output — stamped "printed output" ─────
// Owner-scoped. Streams the artifact the virtual worker produced for demo-shop
// jobs (404 for physical-print jobs, which have no artifact).
export const getPrintedOutput = async (req, res) => {
  const { id, fileId } = req.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(fileId)) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await pool.query(
      `SELECT f.printed_file_path, f.file_name
       FROM job_files f
       JOIN print_jobs j ON j.id = f.job_id
       WHERE f.id = $1 AND j.id = $2 AND j.user_id = $3`,
      [fileId, id, req.user.id]
    );
    if (result.rows.length === 0 || !result.rows[0].printed_file_path) {
      return res.status(404).json({ error: "No printed output available" });
    }

    const { printed_file_path, file_name } = result.rows[0];
    const absolutePath = path.resolve(printed_file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "Printed output missing from disk" });
    }

    res.setHeader("Content-Type", "application/pdf");
    // inline: browsers display it instead of downloading — the demo payoff
    res.setHeader("Content-Disposition", `inline; filename="printed-${file_name}"`);
    fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    console.error("PRINTED OUTPUT ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch printed output" });
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

// ─── POST /print-jobs/:id/reassign-file — same-tier device pinning ───────────
// Under capability tiers the price is locked to the TIER and can never change
// with device choice, so the old cross-tier reassign (which re-priced a paid
// job) is GONE. This endpoint now pins one file of a WAITING_FOR_PRINTER job
// to a specific ONLINE printer WITHIN the file's tier — no price change, no
// confirm step (the server never returns confirm_required anymore; the old
// price-confirm UI in AdminJobRow is dead code for the admin prompt to
// remove). Recovery when a whole tier's hardware is down: assign another
// capable printer to the tier (validated endpoint), which auto-requeues.
export const reassignFile = async (req, res) => {
  const { id: jobId } = req.params;
  const { file_id, printer_id } = req.body || {};

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
      `SELECT id, status FROM print_jobs WHERE id = $1 AND shop_id = $2`,
      [jobId, adminShopId]
    );
    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (jobRes.rows[0].status !== "WAITING_FOR_PRINTER") {
      return res.status(400).json({
        error: `Only WAITING_FOR_PRINTER jobs can be reassigned (job is ${jobRes.rows[0].status})`,
      });
    }

    // File must belong to the job and carry a tier
    const fileRes = await pool.query(
      `SELECT id, tier_id, paper_size FROM job_files WHERE id = $1 AND job_id = $2`,
      [file_id, jobId]
    );
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: "File not found on this job" });
    }
    const file = fileRes.rows[0];
    if (!file.tier_id) {
      return res.status(400).json({ error: "File has no tier (tier was deleted) — reassign the tier's printers instead" });
    }

    // Target printer: same shop, ONLINE, assigned to the FILE'S TIER, paper ok
    const printerRes = await pool.query(
      `SELECT p.id, p.label, p.status, p.paper_sizes,
              EXISTS (SELECT 1 FROM printer_tiers pt
                      WHERE pt.printer_id = p.id AND pt.tier_id = $3) AS in_tier
       FROM printers p WHERE p.id = $1 AND p.shop_id = $2`,
      [printer_id, adminShopId, file.tier_id]
    );
    if (printerRes.rows.length === 0) {
      return res.status(404).json({ error: "Printer not found" });
    }
    const printer = printerRes.rows[0];
    if (!printer.in_tier) {
      return res.status(400).json({
        error: "Printer is not assigned to this file's tier — assign it to the tier first",
      });
    }
    if (printer.status !== "ONLINE") {
      return res.status(400).json({ error: `Printer is ${printer.status}, not ONLINE` });
    }
    if (!printer.paper_sizes.includes(file.paper_size)) {
      return res.status(400).json({ error: `Printer does not support ${file.paper_size}` });
    }

    // Pin, requeue, re-attempt dispatch. estimated_cost is untouched — that's
    // the whole point of tiers.
    await pool.query(`UPDATE job_files SET printer_id = $1 WHERE id = $2`, [printer_id, file_id]);
    await pool.query(
      `UPDATE print_jobs SET status = 'QUEUED'
       WHERE id = $1 AND status = 'WAITING_FOR_PRINTER'`,
      [jobId]
    );
    const dispatch = await attemptDispatch(jobId);

    res.json({
      message: "File pinned within its tier",
      job_id: jobId,
      file_id,
      pinned_printer: printer.label,
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