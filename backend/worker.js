// backend/worker.js
// This worker's only job: pick the next QUEUED job (priority-sorted) and mark it PRINTING.
// The local Windows print agent on the shop PC picks it up, prints it, then calls
// POST /print-jobs/:id/agent-complete to generate the OTP and flip status to READY.

import pool from "./db/pool.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function printerWorker() {
  console.log("🖨️  Printer worker started (dispatch-only mode)");

  while (true) {
    try {
      // 1. Find the next QUEUED job using priority → deadline → FIFO ordering
      const result = await pool.query(
        `SELECT id
         FROM print_jobs
         WHERE status = 'QUEUED'
         ORDER BY
           priority DESC,
           CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
           deadline ASC,
           created_at ASC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        await sleep(3000);
        continue;
      }

      const jobId = result.rows[0].id;

      // 2. Atomically claim the job: only update if it's still QUEUED
      //    (guards against a race if two worker instances ever run)
      const claimed = await pool.query(
        `UPDATE print_jobs
         SET status = 'PRINTING'
         WHERE id = $1 AND status = 'QUEUED'
         RETURNING id`,
        [jobId]
      );

      if (claimed.rows.length === 0) {
        // Another process beat us to it — loop immediately
        continue;
      }

      console.log(`📤 Job ${jobId} dispatched → PRINTING (waiting for print agent)`);

      // 3. Small pause before checking for the next job so we don't spin tightly
      //    while the agent is printing.  The agent itself drives the READY transition.
      await sleep(3000);

    } catch (err) {
      console.error("❌ Worker error:", err.message);
      await sleep(5000);
    }
  }
}

printerWorker();