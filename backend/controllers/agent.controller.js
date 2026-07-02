// backend/controllers/agent.controller.js
// These endpoints are called by the local Windows print agent running on the shop PC.
// They are NOT for browser clients — they use a shared AGENT_SECRET header for auth.

import pool from "../db/pool.js";
import redisClient from "../redisClient.js";
import { sendOTPEmail } from "../services/emailService.js";
import config from "../config/config.js";
import path from "path";
import fs from "fs";

// ── Shared-secret middleware ──────────────────────────────────────────────────
export function requireAgentSecret(req, res, next) {
  const secret = req.headers["x-agent-secret"];
  if (!secret || secret !== config.agentSecret) {
    return res.status(401).json({ error: "Invalid agent secret" });
  }
  next();
}

// ── GET /agent/jobs/printing ──────────────────────────────────────────────────
// Returns all jobs currently in PRINTING status with their files.
// The agent polls this to know what it should be printing.
export const getPrintingJobs = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         j.id,
         j.status,
         j.priority,
         j.deadline,
         j.created_at,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'file_id',     f.id,
             'file_name',   f.file_name,
             'file_path',   f.file_path,
             'copies',      f.copies,
             'color',       f.color,
             'double_sided',f.double_sided,
             'orientation', f.orientation,
             'paper_size',  f.paper_size
           ) ORDER BY f.created_at
         ) FILTER (WHERE f.id IS NOT NULL) AS files
       FROM print_jobs j
       LEFT JOIN job_files f ON j.id = f.job_id
       WHERE j.status = 'PRINTING'
       GROUP BY j.id
       ORDER BY j.created_at ASC`
    );
    res.json({ jobs: result.rows });
  } catch (err) {
    console.error("AGENT GET PRINTING JOBS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch printing jobs" });
  }
};

// ── GET /agent/jobs/printing/:jobId/files/:fileId ─────────────────────────────
// Streams the actual PDF bytes to the agent so it can download and print locally.
export const downloadJobFile = async (req, res) => {
  const { jobId, fileId } = req.params;

  try {
    const result = await pool.query(
      `SELECT f.file_path, f.file_name
       FROM job_files f
       JOIN print_jobs j ON j.id = f.job_id
       WHERE f.id = $1 AND j.id = $2 AND j.status = 'PRINTING'`,
      [fileId, jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "File not found or job not in PRINTING state" });
    }

    const { file_path, file_name } = result.rows[0];
    const absolutePath = path.resolve(file_path);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: "File missing from disk" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${file_name}"`);
    fs.createReadStream(absolutePath).pipe(res);

  } catch (err) {
    console.error("AGENT DOWNLOAD FILE ERROR:", err.message);
    res.status(500).json({ error: "Failed to stream file" });
  }
};

// ── POST /agent/jobs/:jobId/complete ─────────────────────────────────────────
// Called by the print agent after it successfully sends a job to the Windows
// Print Spooler. Generates the OTP and flips the job to READY.
export const agentComplete = async (req, res) => {
  const { jobId } = req.params;

  try {
    // Only complete jobs that are actually in PRINTING state
    const check = await pool.query(
      `SELECT id FROM print_jobs WHERE id = $1 AND status = 'PRINTING'`,
      [jobId]
    );

    if (check.rows.length === 0) {
      return res.status(400).json({
        error: "Job not found or not in PRINTING state",
      });
    }

    // Generate OTP and store in Redis (10-minute TTL)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await redisClient.setEx(`job:${jobId}:otp`, 600, otp);

    // Flip to READY
    await pool.query(
      `UPDATE print_jobs SET status = 'READY' WHERE id = $1`,
      [jobId]
    );

    // Email the OTP to the user
    try {
      const userResult = await pool.query(
        `SELECT u.email FROM print_jobs j
         JOIN users u ON j.user_id = u.id
         WHERE j.id = $1`,
        [jobId]
      );
      if (userResult.rows.length > 0 && userResult.rows[0].email) {
        await sendOTPEmail(userResult.rows[0].email, otp, jobId);
        console.log(`📧 OTP emailed for job ${jobId}`);
      } else {
        console.log(`🔐 OTP for job ${jobId}: ${otp} (no email on file)`);
      }
    } catch (emailErr) {
      console.error("EMAIL ERROR:", emailErr.message);
      console.log(`🔐 OTP for job ${jobId}: ${otp} (email failed)`);
    }

    console.log(`✅ Job ${jobId} marked READY by print agent`);
    res.json({ message: "Job marked as READY", jobId });

  } catch (err) {
    console.error("AGENT COMPLETE ERROR:", err.message);
    res.status(500).json({ error: "Failed to complete job" });
  }
};

// ── POST /agent/jobs/:jobId/fail ──────────────────────────────────────────────
// Called by the print agent if printing fails (paper jam, spooler error, etc.)
// Reverts the job back to QUEUED so it can be retried.
export const agentFail = async (req, res) => {
  const { jobId } = req.params;
  const { reason } = req.body; // optional error string from agent

  try {
    const result = await pool.query(
      `UPDATE print_jobs
       SET status = 'QUEUED'
       WHERE id = $1 AND status = 'PRINTING'
       RETURNING id`,
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Job not found or not in PRINTING state" });
    }

    console.warn(`⚠️  Job ${jobId} failed to print — requeueed. Reason: ${reason || "unknown"}`);
    res.json({ message: "Job re-queued", jobId });

  } catch (err) {
    console.error("AGENT FAIL ERROR:", err.message);
    res.status(500).json({ error: "Failed to requeue job" });
  }
};