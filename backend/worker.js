// backend/worker.js
import pool from "./db/pool.js";
import redisClient from "./redisClient.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateOTP(jobId) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await redisClient.setEx(`job:${jobId}:otp`, 600, otp);
  return otp;
}

async function printerWorker() {
  console.log("🖨️ Printer worker started");

  while (true) {
    try {
        //1. Find next job to print

        //first sort by priority then assign 1 to the jobs with deadline not null so they get higher priority
        //then sort by smallest deadline then sort by fifo for fairness using created_at

      const result = await pool.query(
        `
        SELECT id
        FROM print_jobs
        WHERE status = 'QUEUED'
        ORDER BY
          priority DESC,
          CASE
            WHEN deadline IS NULL THEN 1
            ELSE 0
          END,
          deadline ASC,
          created_at ASC
        LIMIT 1
        `
      );

      if (result.rows.length === 0) {
        //No jobs-> wait and retry
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
        `
        UPDATE print_jobs
        SET status = 'READY'
        WHERE id = $1
        `,
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
