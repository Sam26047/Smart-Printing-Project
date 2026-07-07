// backend/controllers/shopPricing.controller.js
// Per-shop pricing config: a B&W per-page rate, a color per-page rate, and an
// optional duplex discount percentage. Paper size is intentionally not priced.
// JWT admin routes scoped to the admin's own shop.
//
// NOTE: changing pricing only affects FUTURE submissions — every job's
// estimated_cost is locked at submission time (see createPrintJob).

import pool from "../db/pool.js";
import { getAdminShopId } from "../utils/adminShop.js";

// ── GET /shops/pricing ────────────────────────────────────────────────────────
export const getShopPricing = async (req, res) => {
  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `SELECT shop_id, bw_price_per_page, color_price_per_page, duplex_discount_pct
       FROM shop_pricing WHERE shop_id = $1`,
      [adminShopId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pricing not configured for this shop" });
    }
    res.json({ pricing: result.rows[0] });
  } catch (err) {
    console.error("GET PRICING ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch pricing" });
  }
};

// ── PUT /shops/pricing ────────────────────────────────────────────────────────
// Upsert — creates the row on first save, updates thereafter.
export const putShopPricing = async (req, res) => {
  const {
    bw_price_per_page,
    color_price_per_page,
    duplex_discount_pct = 0,
  } = req.body || {};

  const bw = Number(bw_price_per_page);
  const color = Number(color_price_per_page);
  const discount = Number(duplex_discount_pct);

  if (!Number.isFinite(bw) || bw < 0 || !Number.isFinite(color) || color < 0) {
    return res.status(400).json({
      error: "bw_price_per_page and color_price_per_page must be numbers ≥ 0",
    });
  }
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return res.status(400).json({ error: "duplex_discount_pct must be between 0 and 100" });
  }

  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `INSERT INTO shop_pricing (shop_id, bw_price_per_page, color_price_per_page, duplex_discount_pct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (shop_id) DO UPDATE SET
         bw_price_per_page   = EXCLUDED.bw_price_per_page,
         color_price_per_page = EXCLUDED.color_price_per_page,
         duplex_discount_pct  = EXCLUDED.duplex_discount_pct
       RETURNING shop_id, bw_price_per_page, color_price_per_page, duplex_discount_pct`,
      [adminShopId, bw, color, discount]
    );

    res.json({ message: "Pricing updated", pricing: result.rows[0] });
  } catch (err) {
    console.error("PUT PRICING ERROR:", err.message);
    res.status(500).json({ error: "Failed to update pricing" });
  }
};
