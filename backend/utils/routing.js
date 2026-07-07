// backend/utils/routing.js
// Per-file printer routing. Shared by the worker dispatch loop and the
// reassign-file re-dispatch so the rules can never drift apart.
//
// A printer is ELIGIBLE for a file iff ALL of:
//   • same shop as the job
//   • status = 'ONLINE'  (manual shopkeeper toggle)
//   • file.paper_size ∈ printer.paper_sizes
//   • file.double_sided = false OR printer.supports_duplex
//   • color tier, STRICT — no fallback:
//       color file → supports_color = TRUE
//       B&W file   → supports_color = FALSE  (never route B&W to the inkjet,
//                    even if it's the only printer online — by design)
//
// Dispatch is all-or-nothing per job: every file resolves → bind printer_id on
// each file + flip job to PRINTING in one transaction; ANY file unroutable →
// flip to WAITING_FOR_PRINTER and bind nothing.
//
// Manual pins (job_files.printer_id already set by reassign-file) are kept:
// auto-routing only touches files with printer_id IS NULL, and re-validates
// that a pinned file's printer is still ONLINE (if not, the job is unroutable).

import pool from "../db/pool.js";

// Oldest-created eligible printer wins — deterministic; load balancing later.
async function findEligiblePrinter(shopId, file) {
  const result = await pool.query(
    `SELECT id, device_name
     FROM printers
     WHERE shop_id = $1
       AND status = 'ONLINE'
       AND supports_color = $2
       AND $3 = ANY(paper_sizes)
       AND ($4 = FALSE OR supports_duplex = TRUE)
     ORDER BY created_at ASC
     LIMIT 1`,
    [shopId, file.color, file.paper_size, file.double_sided]
  );
  return result.rows[0] || null;
}

// Attempt to dispatch one QUEUED job. Returns:
//   { dispatched: true }                        → job is now PRINTING, files bound
//   { dispatched: false, reason: "unroutable" } → job is now WAITING_FOR_PRINTER
//   { dispatched: false, reason: <other> }      → nothing changed (not QUEUED, gone, race)
export async function attemptDispatch(jobId) {
  const jobRes = await pool.query(
    `SELECT id, shop_id, status FROM print_jobs WHERE id = $1`,
    [jobId]
  );
  if (jobRes.rows.length === 0) return { dispatched: false, reason: "job not found" };

  const job = jobRes.rows[0];
  if (job.status !== "QUEUED") {
    return { dispatched: false, reason: `job is ${job.status}, not QUEUED` };
  }

  const filesRes = await pool.query(
    `SELECT f.id, f.color, f.double_sided, f.paper_size, f.printer_id,
            p.status AS pinned_printer_status
     FROM job_files f
     LEFT JOIN printers p ON p.id = f.printer_id
     WHERE f.job_id = $1`,
    [jobId]
  );

  const assignments = []; // { fileId, printerId } for files routed this pass
  let unroutable = false;

  for (const file of filesRes.rows) {
    if (file.printer_id) {
      // Manual pin from reassign-file — keep it, but its printer must be ONLINE
      if (file.pinned_printer_status !== "ONLINE") {
        unroutable = true;
        break;
      }
      continue;
    }
    const printer = await findEligiblePrinter(job.shop_id, file);
    if (!printer) {
      unroutable = true;
      break;
    }
    assignments.push({ fileId: file.id, printerId: printer.id });
  }

  if (unroutable) {
    // Bind nothing (manual pins stay — they were set outside this pass)
    await pool.query(
      `UPDATE print_jobs SET status = 'WAITING_FOR_PRINTER'
       WHERE id = $1 AND status = 'QUEUED'`,
      [jobId]
    );
    return { dispatched: false, reason: "unroutable" };
  }

  // Bind + claim atomically. The status guard on the UPDATE keeps this safe
  // if two dispatchers ever race.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const claimed = await client.query(
      `UPDATE print_jobs SET status = 'PRINTING'
       WHERE id = $1 AND status = 'QUEUED'
       RETURNING id`,
      [jobId]
    );
    if (claimed.rows.length === 0) {
      await client.query("ROLLBACK");
      return { dispatched: false, reason: "claim lost to another dispatcher" };
    }

    for (const a of assignments) {
      await client.query(
        `UPDATE job_files SET printer_id = $1 WHERE id = $2`,
        [a.printerId, a.fileId]
      );
    }

    await client.query("COMMIT");
    return { dispatched: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
