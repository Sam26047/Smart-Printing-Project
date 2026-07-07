// backend/worker.js
// This worker's only job: pick the next QUEUED job (priority-sorted) and try to
// dispatch it. Dispatch now runs per-file printer routing (utils/routing.js):
// every file gets an eligible ONLINE printer bound → job flips to PRINTING and
// the shop's agent picks it up; if ANY file is unroutable the job flips to
// WAITING_FOR_PRINTER instead. Because a blocked job LEAVES the QUEUED state,
// it can never head-of-line-block routable jobs behind it — the next cycle
// simply selects the next QUEUED job.

import pool from "./db/pool.js";
import { attemptDispatch } from "./utils/routing.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function printerWorker() {
  console.log("🖨️  Printer worker started (dispatch + per-file routing mode)");

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

      // 2. Route + bind + claim (all-or-nothing inside attemptDispatch; the
      //    status guard there also protects against a second worker instance)
      const outcome = await attemptDispatch(jobId);

      if (outcome.dispatched) {
        console.log(`📤 Job ${jobId} dispatched → PRINTING (waiting for print agent)`);
      } else if (outcome.reason === "unroutable") {
        console.log(`⏸  Job ${jobId} → WAITING_FOR_PRINTER (no eligible ONLINE printer for ≥1 file)`);
        // Job left QUEUED, so loop immediately — the next QUEUED job isn't blocked
        continue;
      } else {
        // Race (another dispatcher claimed it) or job vanished — just move on
        continue;
      }

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