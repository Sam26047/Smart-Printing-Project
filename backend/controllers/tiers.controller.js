// backend/controllers/tiers.controller.js
// Capability tiers: the student-facing availability catalog and the minimal
// admin management (price/name edits, printer↔tier assignment) needed to run
// the system without psql until the dedicated admin UI prompt.
//
// INVARIANT (see CLAUDE.md): a file's print settings derive from its TIER,
// never from the device that prints it. Assignment is hardware-validated here
// so a tier can never contain a printer that can't produce its output.

import pool from "../db/pool.js";
import { getAdminShopId } from "../utils/adminShop.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /shops/tiers ──────────────────────────────────────────────────────────
// Student path: ?shop_id=<id> (explicit, like estimate/submit) → lean catalog
// with per-tier availability so the UI can disable unavailable tiers BEFORE
// submission. Admin path: no shop_id → resolved via getAdminShopId, response
// additionally includes each tier's assigned printers.
export const listTiers = async (req, res) => {
  try {
    let shopId = null;
    let adminView = false;

    if (req.query.shop_id) {
      if (!UUID_RE.test(req.query.shop_id)) {
        return res.status(400).json({ error: "Invalid shop_id" });
      }
      shopId = req.query.shop_id;
    } else {
      shopId = await getAdminShopId(req.user.id);
      adminView = Boolean(shopId);
      if (!shopId) {
        return res.status(400).json({ error: "shop_id is required" });
      }
    }

    const result = await pool.query(
      `SELECT t.id, t.name, t.color, t.duplex, t.price_per_page,
              (SELECT count(*) FROM printer_tiers pt JOIN printers p ON p.id = pt.printer_id
                 WHERE pt.tier_id = t.id)::int AS assigned_count,
              (SELECT count(*) FROM printer_tiers pt JOIN printers p ON p.id = pt.printer_id
                 WHERE pt.tier_id = t.id AND p.status = 'ONLINE')::int AS online_count
       FROM capability_tiers t
       WHERE t.shop_id = $1
       ORDER BY t.color, t.duplex`,
      [shopId]
    );

    // available = ≥1 assigned printer ONLINE. reason distinguishes the two
    // unavailable cases WITHOUT leaking any device name/model/status:
    //   • a printer serves this option but is offline → temporary
    //   • no printer serves this option at all       → not offered here
    let tiers = result.rows.map((t) => {
      const available = t.online_count > 0;
      const reason = available
        ? null
        : t.assigned_count > 0
          ? "The printer for this option is offline right now — try again shortly."
          : "This shop doesn't currently offer this option.";
      // strip internal counts from the response
      const { assigned_count, online_count, ...rest } = t; // eslint-disable-line no-unused-vars
      return { ...rest, available, reason };
    });
    if (adminView) {
      const printers = await pool.query(
        `SELECT pt.tier_id, p.id, p.label, p.status
         FROM printer_tiers pt
         JOIN printers p ON p.id = pt.printer_id
         WHERE p.shop_id = $1
         ORDER BY p.created_at`,
        [shopId]
      );
      tiers = tiers.map((t) => ({
        ...t,
        printers: printers.rows
          .filter((p) => p.tier_id === t.id)
          .map(({ id, label, status }) => ({ id, label, status })),
      }));
    }

    res.json({ tiers });
  } catch (err) {
    console.error("LIST TIERS ERROR:", err.message);
    res.status(500).json({ error: "Failed to list tiers" });
  }
};

// ── PATCH /shops/tiers/:tierId — edit name / price (admin's own shop) ────────
export const updateTier = async (req, res) => {
  const { tierId } = req.params;
  const { name, price_per_page } = req.body || {};
  if (!UUID_RE.test(tierId)) {
    return res.status(404).json({ error: "Tier not found" });
  }
  if (name === undefined && price_per_page === undefined) {
    return res.status(400).json({ error: "Nothing to update — send name and/or price_per_page" });
  }
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  const price = price_per_page !== undefined ? Number(price_per_page) : undefined;
  if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
    return res.status(400).json({ error: "price_per_page must be a number ≥ 0" });
  }

  try {
    const shopId = await getAdminShopId(req.user.id);
    if (!shopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `UPDATE capability_tiers
       SET name = COALESCE($1, name),
           price_per_page = COALESCE($2, price_per_page)
       WHERE id = $3 AND shop_id = $4
       RETURNING id, name, color, duplex, price_per_page`,
      [name?.trim() ?? null, price ?? null, tierId, shopId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tier not found" });
    }
    // NOTE: changes affect FUTURE submissions only — estimated_cost is locked
    res.json({ tier: result.rows[0] });
  } catch (err) {
    console.error("UPDATE TIER ERROR:", err.message);
    res.status(500).json({ error: "Failed to update tier" });
  }
};

// ── POST /printers/:id/tiers — assign a printer to a tier ────────────────────
// Hardware-validated: a colour tier only accepts colour-capable printers, a
// duplex tier only duplex-capable ones. This is the admin RECOVERY path when a
// tier's hardware dies (assign another capable machine); it re-queues the
// shop's WAITING_FOR_PRINTER jobs like the ONLINE toggle does.
export const assignPrinterTier = async (req, res) => {
  const { id: printerId } = req.params;
  const { tier_id } = req.body || {};
  if (!UUID_RE.test(printerId) || !tier_id || !UUID_RE.test(tier_id)) {
    return res.status(400).json({ error: "printer id and tier_id (UUIDs) are required" });
  }

  try {
    const shopId = await getAdminShopId(req.user.id);
    if (!shopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const rows = await pool.query(
      `SELECT p.supports_color, p.supports_duplex, p.label,
              t.color AS tier_color, t.duplex AS tier_duplex, t.name AS tier_name
       FROM printers p, capability_tiers t
       WHERE p.id = $1 AND p.shop_id = $3 AND t.id = $2 AND t.shop_id = $3`,
      [printerId, tier_id, shopId]
    );
    if (rows.rows.length === 0) {
      return res.status(404).json({ error: "Printer or tier not found" });
    }
    const r = rows.rows[0];
    if (r.tier_color && !r.supports_color) {
      return res.status(400).json({ error: `'${r.label}' cannot serve '${r.tier_name}' — no colour support` });
    }
    if (r.tier_duplex && !r.supports_duplex) {
      return res.status(400).json({ error: `'${r.label}' cannot serve '${r.tier_name}' — no duplex support` });
    }

    await pool.query(
      `INSERT INTO printer_tiers (printer_id, tier_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [printerId, tier_id]
    );

    // New capacity may unblock parked jobs — re-queue for re-evaluation
    const requeue = await pool.query(
      `UPDATE print_jobs SET status = 'QUEUED'
       WHERE shop_id = $1 AND status = 'WAITING_FOR_PRINTER'
       RETURNING id`,
      [shopId]
    );

    res.json({
      message: `'${r.label}' assigned to '${r.tier_name}'`,
      requeued_jobs: requeue.rows.length,
    });
  } catch (err) {
    console.error("ASSIGN PRINTER TIER ERROR:", err.message);
    res.status(500).json({ error: "Failed to assign printer to tier" });
  }
};

// ── DELETE /printers/:id/tiers/:tierId — unassign ────────────────────────────
export const unassignPrinterTier = async (req, res) => {
  const { id: printerId, tierId } = req.params;
  if (!UUID_RE.test(printerId) || !UUID_RE.test(tierId)) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const shopId = await getAdminShopId(req.user.id);
    if (!shopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `DELETE FROM printer_tiers pt
       USING printers p
       WHERE pt.printer_id = p.id AND pt.printer_id = $1 AND pt.tier_id = $2
         AND p.shop_id = $3
       RETURNING pt.printer_id`,
      [printerId, tierId, shopId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Assignment not found" });
    }
    res.json({ message: "Printer unassigned from tier" });
  } catch (err) {
    console.error("UNASSIGN PRINTER TIER ERROR:", err.message);
    res.status(500).json({ error: "Failed to unassign printer from tier" });
  }
};
