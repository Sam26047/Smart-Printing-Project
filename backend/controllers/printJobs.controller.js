// backend/controllers/printJobs.controller.js
import pool from "../db/pool.js";
import redisClient from "../redisClient.js";

// Helper function for OTP generation
async function generateOTP(jobId) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await redisClient.setEx(`job:${jobId}:otp`, 600, otp);
  return otp;
}

export const getAllJobs = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        j.id,
        j.status,
        j.priority,
        j.deadline,
        j.created_at,
        f.file_name
      FROM print_jobs j
      LEFT JOIN job_files f ON j.id = f.job_id
      ORDER BY
        j.priority DESC,
        CASE WHEN j.deadline IS NULL THEN 1 ELSE 0 END,
        j.deadline ASC,
        j.created_at ASC
      `
    );

    res.json({ jobs: result.rows });
  } catch (err) {
    console.error("FETCH JOBS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
};

export const createPrintJob = async (req, res) => {
  try {
    const { copies, color, double_sided, deadline } = req.body;
    const userId = req.user.id;
    // ✅ validation
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "At least one PDF is required" });
    }

    if (!copies) {
      return res.status(400).json({ error: "Copies are required" });
    }

    // 1️⃣ create job (NO file columns anymore)
    const jobResult = await pool.query(
      `
      INSERT INTO print_jobs
        (user_id, copies, color, double_sided, status, deadline)
      VALUES
        ($1, $2, $3, $4, 'PENDING', $5)
      RETURNING id
      `,
      [userId, copies, color, double_sided, deadline || null]
    );

    const jobId = jobResult.rows[0].id;

    await redisClient.set(`user:${userId}:activeJob`,  //key
      jobId       //value
    );

    // Insert all files
    const insertFilesPromises = req.files.map((file) =>
      pool.query(
        `
        INSERT INTO job_files
          (job_id, file_name, file_path)
        VALUES
          ($1, $2, $3)
        `,
        [jobId, file.originalname, file.path]
      )
    );

    await Promise.all(insertFilesPromises);//wait until all these promises finish,
      // i.e if all inserts succeed ->continue
      //else throw error

    // 3️⃣ response
    res.status(201).json({
      job_id: jobId,
      file_count: req.files.length,
      message: "Files uploaded and job created",
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.message);
    res.status(500).json({ error: "Upload failed" });
  }
};

export const getJobById = async (req, res) => {
  const { id } = req.params;

  // UUID validation would go here if you want it

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        copies,
        color,
        double_sided,
        status,
        created_at
      FROM print_jobs
      WHERE id = $1
      `,
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
    //1. Get current status
    const current = await pool.query(
      "SELECT status FROM print_jobs WHERE id = $1",
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }
     //2. Validate transition
    const currentStatus = current.rows[0].status;
    const allowedNext = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowedNext.includes(status)) {
      return res.status(400).json({
        error: `Invalid transition from ${currentStatus} to ${status}`,
      });
    }

    //3. Update status
    await pool.query("UPDATE print_jobs SET status = $1 WHERE id = $2", [
      status,
      id,
    ]);

    res.json({ message: "Status updated successfully" });
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
      `
      SELECT id, status
      FROM print_jobs
      WHERE id = $1 AND status = 'READY'
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found or not READY" });
    }
    // Generate new OTP
    const otp = await generateOTP(id);

    console.log(`🔄 OTP regenerated for job ${id}: ${otp}`);

    res.json({
      message: "OTP regenerated",
      otp,
    });
  } catch (err) {
    console.error("REGENERATE OTP ERROR:", err.message);
    res.status(500).json({ error: "Failed to regenerate OTP" });
  }
};

export const collectPrintJob = async (req, res) => {
  const { otp } = req.body;
  const jobId = req.params.id;

  if (!otp) {
    return res.status(400).json({ error: "OTP is required" });
  }

  const redisOtp = await redisClient.get(`job:${jobId}:otp`);

  if (!redisOtp || redisOtp !== otp) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE print_jobs
      SET status = 'COLLECTED'
      WHERE id = $1 AND status = 'READY'
      RETURNING *
      `,
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid OTP or job not ready" });
    }

    res.json({ message: "Print job collected successfully" });

    await redisClient.del(`job:${jobId}:otp`);
    await redisClient.del(`user:${req.user.id}:activeJob`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to collect print job" });
  }
};