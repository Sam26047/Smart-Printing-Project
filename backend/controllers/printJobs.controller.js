// backend/controllers/printJobs.controller.js
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

// ─── Helper: get current QUEUED job count (used for dynamic pricing + peak check) ───
async function getQueueSize() {
  const result = await pool.query(
    "SELECT COUNT(*) AS count FROM print_jobs WHERE status = 'QUEUED'"
  );
  return parseInt(result.rows[0].count) || 0;
}

export const getAllJobs = async (req, res) => {
  try {
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
      GROUP BY j.id
      ORDER BY
        j.priority DESC,
        CASE WHEN j.deadline IS NULL THEN 1 ELSE 0 END,
        j.deadline ASC,
        j.created_at ASC`
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
    const queueSize = await getQueueSize();
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
    const { deadline, fileSettings, urgency_level = "NORMAL" } = req.body;
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

    // ─── Current queue size — needed for dynamic pricing + peak check ─────────
    const queueSize = await getQueueSize();

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
    // Multiplier depends on urgency level AND how busy the queue is
    const multiplier = getUrgencyMultiplier(urgency_level, queueSize);
    const pricing    = calculateJobCost(settings, multiplier);

    // 1️⃣ Create job — urgency_level stored alongside deadline for worker sorting
    // ❗ copies/color/double_sided moved to per-file level (job_files table)
    const jobResult = await pool.query(
      `INSERT INTO print_jobs (user_id, status, deadline, urgency_level)
       VALUES ($1, 'PENDING', $2, $3)
       RETURNING id`,
      [userId, deadline || null, urgency_level]
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
          (job_id, file_name, file_path, copies, color, double_sided, orientation, paper_size)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [jobId, file.originalname, file.path, copies, color, double_sided, orientation, paper_size]
      );
    });

    await Promise.all(insertFilesPromises); // wait until all these promises finish
    // i.e if all inserts succeed -> continue
    // else throw error

    // 3️⃣ Response — include full pricing breakdown so frontend can display it
    res.status(201).json({
      job_id:      jobId,
      file_count:  req.files.length,
      urgency_level,
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
    QUEUED: ["PRINTING"],
    PRINTING: ["READY"],
    READY: ["COLLECTED"],
  };

  try {
    // 1. Get current status + user email in one query
    const current = await pool.query(
      `SELECT j.status, u.email
       FROM print_jobs j
       JOIN users u ON j.user_id = u.id
       WHERE j.id = $1`,
      [id]
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
    const current = await pool.query(
      "SELECT status FROM print_jobs WHERE id = $1",
      [id]
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
    //check job exists and is READY
    const result = await pool.query(
      `SELECT id, status
       FROM print_jobs
       WHERE id = $1 AND status = 'READY'`,
      [id]
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