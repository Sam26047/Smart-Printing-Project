// backend/worker.js
import pool from "./db/pool.js";
import redisClient from "./redisClient.js";
import { sendOTPEmail } from "./services/emailService.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function printerWorker() {
  console.log("🖨️ Printer worker started");

  while (true) {
    try {
      // ─── Find next job to print ──────────────────────────────────────────
      // Priority score formula:
      //   urgency_weight  — URGENT=100, SOON=50, NORMAL=0
      //   + priority      — admin manual override (integer, higher = sooner)
      //   + waiting_bonus — 1 point per minute in queue (rewards patience,
      //                     so old NORMAL jobs eventually catch up to new URGENT ones)
      //
      // Replaces the old ORDER BY priority/deadline approach with a single
      // unified score so all three factors compete on the same scale.
      const result = await pool.query(
        `SELECT id
         FROM print_jobs
         WHERE status = 'QUEUED'
         ORDER BY (
           -- Urgency weight (from priority level chosen by user)
           CASE urgency_level
             WHEN 'URGENT' THEN 100
             WHEN 'SOON'   THEN 50
             ELSE               0
           END
           -- Admin manual priority (drag-and-drop in AdminJobRow)
           + priority
           -- Waiting time bonus: 1 point per minute queued
           -- Prevents starvation — a NORMAL job waiting long enough will
           -- eventually overtake a freshly submitted SOON job
           + EXTRACT(EPOCH FROM (NOW() - created_at)) / 60.0
         ) DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        //No jobs → wait and retry
        await sleep(3000);
        continue;
      }

      const jobId = result.rows[0].id;

      //2. Mark job as PRINTING
      await pool.query("UPDATE print_jobs SET status = 'PRINTING' WHERE id=$1", [
        jobId,
      ]);

      console.log(`🖨️ Printing job ${jobId}...`);

      //3. Simulate printing time
      await sleep(5000);

      //4. Mark job as READY and generate OTP
      const otp = await generateOTP(jobId);

      await pool.query(
        `UPDATE print_jobs
         SET status = 'READY'
         WHERE id = $1`,
        [jobId]
      );

      console.log(`✅ Job ${jobId} is READY`);
      console.log(`🔐 OTP for job ${jobId}: ${otp}`);
    } catch (err) {
      console.error("❌ Printer worker error:", err.message);
      await sleep(5000);
    }
  }
}

printerWorker();