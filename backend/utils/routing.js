// backend/utils/routing.js
// Per-file printer routing. Shared by the worker dispatch loop and the
// reassign-file re-dispatch so the rules can never drift apart.
//
// CAPABILITY TIERS: a printer is ELIGIBLE for a file iff ALL of:
//   • same shop as the job
//   • status = 'ONLINE'  (manual shopkeeper toggle)
//   • ASSIGNED to the file's tier (printer_tiers — hardware-validated at
//     assignment time, so capability flags need no re-check here)
//   • file.paper_size ∈ printer.paper_sizes
//
// The old strict colour rule is preserved by a stronger invariant: a file's
// print settings (colour/duplex) derive from its TIER, never from the device
// picked — so a B&W-tier job prints monochrome at the B&W price on whatever
// tier-assigned device takes it, and a colour tier can only contain
// colour-capable hardware.
//
// Dispatch is all-or-nothing per job: every file resolves → bind printer_id on
// each file + flip job to PRINTING in one transaction; ANY file unroutable →
// flip to WAITING_FOR_PRINTER and bind nothing.
//
// Manual pins (job_files.printer_id set by reassign-file) are kept: auto-
// routing only touches files with printer_id IS NULL, and re-validates that a
// pinned printer is still ONLINE AND still assigned to the file's tier.

import pool from "../db/pool.js";

// Oldest-created eligible printer wins — deterministic; load balancing later.
async function findEligiblePrinter(shopId, file) {
  if (!file.tier_id) return null; // tier deleted (FK SET NULL) → unroutable
  const result = await pool.query(
    `SELECT p.id, p.device_name
     FROM printers p
     JOIN printer_tiers pt ON pt.printer_id = p.id
     WHERE p.shop_id = $1
       AND pt.tier_id = $2
       AND p.status = 'ONLINE'
       AND $3 = ANY(p.paper_sizes)
     ORDER BY p.created_at ASC
     LIMIT 1`,
    [shopId, file.tier_id, file.paper_size]
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
    `SELECT f.id, f.tier_id, f.paper_size, f.printer_id,
            p.status AS pinned_printer_status,
            EXISTS (
              SELECT 1 FROM printer_tiers pt
              WHERE pt.printer_id = f.printer_id AND pt.tier_id = f.tier_id
            ) AS pinned_in_tier
     FROM job_files f
     LEFT JOIN printers p ON p.id = f.printer_id
     WHERE f.job_id = $1`,
    [jobId]
  );

  const assignments = []; // { fileId, printerId } for files routed this pass
  let unroutable = false;

  for (const file of filesRes.rows) {
    if (file.printer_id) {
      // Manual pin from reassign-file — keep it, but its printer must be
      // ONLINE and still assigned to the file's tier
      if (file.pinned_printer_status !== "ONLINE" || !file.pinned_in_tier) {
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
