// backend/worker.js
import pool        from "./db/pool.js";
import redisClient from "./redisClient.js";
import { sendOTPEmail }         from "./services/emailService.js";
import { sendFileToPrinter, pollPrinterJob } from "./services/printer.service.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── identical to your current generateOTP ──────────────────────────────────
async function generateOTP(jobId) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await redisClient.setEx(`job:${jobId}:otp`, 600, otp);

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
      console.log(`🔐 OTP for job ${jobId}: ${otp} (no email on file)`);
    }
  } catch (emailErr) {
    console.error("EMAIL SEND ERROR:", emailErr.message);
    console.log(`🔐 OTP for job ${jobId}: ${otp} (email failed, logged here)`);
  }

  return otp;
}

// ── NEW: send every file in a job to the printer ───────────────────────────
async function printAllFiles(jobId) {
  const { rows: files } = await pool.query(
    `SELECT id, file_path, copies, color, double_sided, orientation, paper_size
     FROM job_files
     WHERE job_id = $1`,
    [jobId]
  );

  if (files.length === 0) throw new Error(`No files found for job ${jobId}`);

  // Send all files concurrently and collect { fileId, ippJobId } pairs
  const ippJobs = await Promise.all(
    files.map(async (file) => {
      const ippJobId = await sendFileToPrinter(file.file_path, {
        copies:       file.copies,
        color:        file.color,
        double_sided: file.double_sided,
        orientation:  file.orientation,
        paper_size:   file.paper_size,
      });
      return { fileId: file.id, ippJobId };
    })
  );

  return ippJobs;
}

// ── NEW: poll all IPP jobs until every file is done ────────────────────────
async function waitForAllFilesToPrint(ippJobs) {
  const results = await Promise.all(
    ippJobs.map(({ ippJobId }) => pollPrinterJob(ippJobId))
  );

  // If any file failed, treat the whole job as failed
  return results.every((r) => r === "completed") ? "completed" : "failed";
}

// ── Main worker loop ───────────────────────────────────────────────────────
async function printerWorker() {
  console.log("🖨️  Printer worker started");

  while (true) {
    try {
      // 1. Find next QUEUED job (same priority/deadline sort as before)
      const result = await pool.query(`
        SELECT id
        FROM print_jobs
        WHERE status = 'QUEUED'
        ORDER BY
          priority DESC,
          CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
          deadline ASC,
          created_at ASC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        await sleep(3000);
        continue;
      }

      const jobId = result.rows[0].id;

      // 2. Mark as PRINTING
      await pool.query(
        "UPDATE print_jobs SET status = 'PRINTING' WHERE id = $1",
        [jobId]
      );
      console.log(`🖨️  Printing job ${jobId}…`);

      // 3. Send all files to the printer
      let ippJobs;
      try {
        ippJobs = await printAllFiles(jobId);
      } catch (err) {
        // Couldn't send — put back to QUEUED and wait before retrying
        console.error(`❌ Could not send job ${jobId} to printer:`, err.message);
        await pool.query(
          "UPDATE print_jobs SET status = 'QUEUED' WHERE id = $1",
          [jobId]
        );
        await sleep(10000);
        continue;
      }

      // 4. Poll until all files finish
      const outcome = await waitForAllFilesToPrint(ippJobs);

      if (outcome === "failed") {
        console.error(`❌ Printing failed for job ${jobId} — returning to QUEUED`);
        await pool.query(
          "UPDATE print_jobs SET status = 'QUEUED' WHERE id = $1",
          [jobId]
        );
        await sleep(10000);
        continue;
      }

      // 5. Mark READY + generate + email OTP  (same as before)
      const otp = await generateOTP(jobId);
      await pool.query(
        "UPDATE print_jobs SET status = 'READY' WHERE id = $1",
        [jobId]
      );
      console.log(`✅ Job ${jobId} is READY. OTP: ${otp}`);

    } catch (err) {
      console.error("❌ Printer worker error:", err.message);
      await sleep(5000);
    }
  }
}

printerWorker();