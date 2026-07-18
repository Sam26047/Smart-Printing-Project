// backend/controllers/printers.controller.js
// Shopkeeper CRUD for the shop's physical printers. All endpoints are JWT
// admin routes scoped to the admin's own shop (getAdminShopId) — one shop's
// admin can never see or toggle another shop's printers.
//
// status is a MANUAL toggle (ONLINE / OFFLINE / OUT_OF_SERVICE) — there is no
// agent-reported health. device_name is the exact Windows printer name the
// agent hands to pdf-to-printer, entered manually by the shopkeeper.

import pool from "../db/pool.js";
import { getAdminShopId } from "../utils/adminShop.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ["ONLINE", "OFFLINE", "OUT_OF_SERVICE"];

function validPaperSizes(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((s) => typeof s === "string" && s.length > 0)
  );
}

// ── POST /printers ────────────────────────────────────────────────────────────
export const createPrinter = async (req, res) => {
  const {
    label,
    device_name,
    supports_color,
    supports_duplex = true,
    paper_sizes = ["A4"],
    status = "ONLINE",
  } = req.body || {};

  if (!label || !device_name) {
    return res.status(400).json({ error: "label and device_name are required" });
  }
  if (typeof supports_color !== "boolean") {
    return res.status(400).json({ error: "supports_color (boolean) is required" });
  }
  if (typeof supports_duplex !== "boolean") {
    return res.status(400).json({ error: "supports_duplex must be a boolean" });
  }
  if (!validPaperSizes(paper_sizes)) {
    return res.status(400).json({ error: "paper_sizes must be a non-empty array of strings" });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` });
  }

  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `INSERT INTO printers (shop_id, label, device_name, supports_color, supports_duplex, paper_sizes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [adminShopId, label, device_name, supports_color, supports_duplex, paper_sizes, status]
    );

    res.status(201).json({ printer: result.rows[0] });
  } catch (err) {
    console.error("CREATE PRINTER ERROR:", err.message);
    res.status(500).json({ error: "Failed to create printer" });
  }
};

// ── GET /printers ─────────────────────────────────────────────────────────────
// `discovered` = at least one of this shop's agents currently reports this
// device_name. EXISTS (semi-join), NOT a LEFT JOIN: two agents reporting the
// same name must not duplicate the configured row. Free-text device_names
// that were never reported stay fully allowed — this flag just lets the UI
// mark them unverified.
export const listPrinters = async (req, res) => {
  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `SELECT p.*,
              EXISTS (
                SELECT 1 FROM discovered_printers d
                WHERE d.shop_id = p.shop_id AND d.device_name = p.device_name
              ) AS discovered
       FROM printers p
       WHERE p.shop_id = $1
       ORDER BY p.created_at ASC`,
      [adminShopId]
    );
    res.json({ printers: result.rows });
  } catch (err) {
    console.error("LIST PRINTERS ERROR:", err.message);
    res.status(500).json({ error: "Failed to list printers" });
  }
};

// ── GET /printers/discovered ──────────────────────────────────────────────────
// Agent-reported printer names for the admin's shop — dropdown options for
// configuring printers.device_name without hand-typing spooler names. Flat
// list with per-token provenance (a multi-device shop reports one set per
// machine; UIs may dedupe by name for display). Rows are never pruned; treat
// last_seen_at older than stale_after_minutes as stale.
const STALE_AFTER_MINUTES = 30; // agent heartbeat is ~10 min → 3× margin

export const listDiscoveredPrinters = async (req, res) => {
  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `SELECT d.device_name, d.first_seen_at, d.last_seen_at,
              d.agent_token_id, t.label AS agent_label
       FROM discovered_printers d
       JOIN agent_tokens t ON t.id = d.agent_token_id
       WHERE d.shop_id = $1
       ORDER BY d.last_seen_at DESC, d.device_name ASC`,
      [adminShopId]
    );

    res.json({ discovered: result.rows, stale_after_minutes: STALE_AFTER_MINUTES });
  } catch (err) {
    console.error("LIST DISCOVERED PRINTERS ERROR:", err.message);
    res.status(500).json({ error: "Failed to list discovered printers" });
  }
};

// ── PATCH /printers/:id ───────────────────────────────────────────────────────
// Partial update of label / device_name / capabilities / status.
// Flipping status to ONLINE re-queues this shop's WAITING_FOR_PRINTER jobs so
// the worker re-evaluates them against the newly available printer.
export const updatePrinter = async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: "Printer not found" });
  }

  const allowed = ["label", "device_name", "supports_color", "supports_duplex", "paper_sizes", "status"];
  const body = req.body || {};
  const updates = Object.keys(body).filter((k) => allowed.includes(k));
  if (updates.length === 0) {
    return res.status(400).json({ error: `Nothing to update — allowed fields: ${allowed.join(", ")}` });
  }

  // Field validation
  if ("status" in body && !VALID_STATUSES.includes(body.status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(", ")}` });
  }
  if ("supports_color" in body && typeof body.supports_color !== "boolean") {
    return res.status(400).json({ error: "supports_color must be a boolean" });
  }
  if ("supports_duplex" in body && typeof body.supports_duplex !== "boolean") {
    return res.status(400).json({ error: "supports_duplex must be a boolean" });
  }
  if ("paper_sizes" in body && !validPaperSizes(body.paper_sizes)) {
    return res.status(400).json({ error: "paper_sizes must be a non-empty array of strings" });
  }
  if (("label" in body && !body.label) || ("device_name" in body && !body.device_name)) {
    return res.status(400).json({ error: "label and device_name cannot be empty" });
  }

  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    // Fetch current row (shop-scoped) so we know the previous status
    const existing = await pool.query(
      `SELECT status FROM printers WHERE id = $1 AND shop_id = $2`,
      [id, adminShopId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Printer not found" });
    }
    const previousStatus = existing.rows[0].status;

    const setClauses = updates.map((k, i) => `${k} = $${i + 1}`);
    const values = updates.map((k) => body[k]);
    const result = await pool.query(
      `UPDATE printers SET ${setClauses.join(", ")}
       WHERE id = $${updates.length + 1} AND shop_id = $${updates.length + 2}
       RETURNING *`,
      [...values, id, adminShopId]
    );
    const printer = result.rows[0];

    // Printer just came ONLINE → unblock this shop's waiting jobs. The worker
    // re-runs routing on them; anything still unroutable flows back to
    // WAITING_FOR_PRINTER on the next cycle.
    let requeued = 0;
    if (body.status === "ONLINE" && previousStatus !== "ONLINE") {
      const requeue = await pool.query(
        `UPDATE print_jobs SET status = 'QUEUED'
         WHERE shop_id = $1 AND status = 'WAITING_FOR_PRINTER'
         RETURNING id`,
        [adminShopId]
      );
      requeued = requeue.rows.length;
      if (requeued > 0) {
        console.log(`🔓 Printer ${printer.label} ONLINE → re-queued ${requeued} waiting job(s)`);
      }
    }

    res.json({ printer, requeued_jobs: requeued });
  } catch (err) {
    console.error("UPDATE PRINTER ERROR:", err.message);
    res.status(500).json({ error: "Failed to update printer" });
  }
};

// ── DELETE /printers/:id ──────────────────────────────────────────────────────
// Refuses to delete a printer that a currently-PRINTING job's file is bound
// to (the agent may be mid-print against its device_name). For non-printing
// bindings, job_files.printer_id is ON DELETE SET NULL so history survives.
export const deletePrinter = async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: "Printer not found" });
  }

  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const inFlight = await pool.query(
      `SELECT 1
       FROM job_files f
       JOIN print_jobs j ON j.id = f.job_id
       WHERE f.printer_id = $1 AND j.status = 'PRINTING'
       LIMIT 1`,
      [id]
    );
    if (inFlight.rows.length > 0) {
      return res.status(409).json({
        error: "Printer has files on a job currently PRINTING — wait for it to finish or fail it first",
      });
    }

    const result = await pool.query(
      `DELETE FROM printers WHERE id = $1 AND shop_id = $2 RETURNING id, label`,
      [id, adminShopId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Printer not found" });
    }

    res.json({ message: "Printer deleted", printer_id: id });
  } catch (err) {
    console.error("DELETE PRINTER ERROR:", err.message);
    res.status(500).json({ error: "Failed to delete printer" });
  }
};
