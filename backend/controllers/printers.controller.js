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
export const listPrinters = async (req, res) => {
  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `SELECT * FROM printers WHERE shop_id = $1 ORDER BY created_at ASC`,
      [adminShopId]
    );
    res.json({ printers: result.rows });
  } catch (err) {
    console.error("LIST PRINTERS ERROR:", err.message);
    res.status(500).json({ error: "Failed to list printers" });
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
