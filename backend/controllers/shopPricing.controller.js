// backend/controllers/shopPricing.controller.js
// LEGACY-COMPAT layer over capability tiers. Pricing truth lives in
// capability_tiers now; the shop_pricing table is FROZEN pre-migration audit
// data and is neither read nor written here.
//
// GET derives the legacy (bw, colour, discount) triple from the four tier
// prices and returns `diverged: true` when no exact triple can represent
// them (i.e. an admin has edited a tier independently). When diverged, PUT is
// REJECTED with a clear error — fail loudly rather than silently clobber
// per-tier prices with a lossy three-number model. The legacy pricing card is
// replaced properly in the admin-UI prompt.

import pool from "../db/pool.js";
import { getAdminShopId } from "../utils/adminShop.js";

const cents = (x) => Math.round(Number(x) * 100);
const round2 = (x) => Math.round(x * 100) / 100;

// Fetch the 4 combo tiers; returns null if the shop doesn't have all four.
async function getComboTiers(shopId) {
  const result = await pool.query(
    `SELECT id, color, duplex, price_per_page
     FROM capability_tiers WHERE shop_id = $1`,
    [shopId]
  );
  const combo = {};
  for (const t of result.rows) combo[`${t.color}|${t.duplex}`] = t;
  const bw = combo["false|false"], bwD = combo["false|true"];
  const col = combo["true|false"], colD = combo["true|true"];
  if (!bw || !bwD || !col || !colD) return null;
  return { bw, bwD, col, colD };
}

// Derive (bw, colour, discount) + diverged from the four tier prices.
function deriveLegacy(t) {
  const bw = Number(t.bw.price_per_page);
  const col = Number(t.col.price_per_page);
  const bwD = Number(t.bwD.price_per_page);
  const colD = Number(t.colD.price_per_page);

  // Candidate discount from whichever base rate is nonzero
  let d = 0;
  if (bw > 0) d = (1 - bwD / bw) * 100;
  else if (col > 0) d = (1 - colD / col) * 100;

  const representable =
    d >= 0 && d <= 100 &&
    cents(round2(bw * (1 - d / 100))) === cents(bwD) &&
    cents(round2(col * (1 - d / 100))) === cents(colD);

  return {
    bw_price_per_page: bw.toFixed(2),
    color_price_per_page: col.toFixed(2),
    duplex_discount_pct: round2(Math.max(0, d)).toFixed(2),
    diverged: !representable,
  };
}

// ── GET /shops/pricing ────────────────────────────────────────────────────────
export const getShopPricing = async (req, res) => {
  try {
    const adminShopId = await getAdminShopId(req.user.id);
    if (!adminShopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const tiers = await getComboTiers(adminShopId);
    if (!tiers) {
      return res.status(404).json({ error: "Pricing not configured for this shop" });
    }

    res.json({ pricing: { shop_id: adminShopId, ...deriveLegacy(tiers) } });
  } catch (err) {
    console.error("GET PRICING ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch pricing" });
  }
};

// ── PUT /shops/pricing ────────────────────────────────────────────────────────
// Writes the FOUR tier prices derived from (bw, colour, discount) — but only
// while the current tier prices still fit that model. Once they've diverged,
// this endpoint refuses; per-tier pricing (PATCH /shops/tiers/:id) is the
// only writer that never loses information.
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

    const tiers = await getComboTiers(adminShopId);
    if (!tiers) {
      return res.status(404).json({ error: "Pricing not configured for this shop" });
    }

    // Fail loudly instead of clobbering independently-edited tier prices
    if (deriveLegacy(tiers).diverged) {
      return res.status(409).json({
        error:
          "Tier prices have diverged from the simple B&W/colour/discount model — edit per-tier pricing instead (PATCH /shops/tiers/:tierId).",
        diverged: true,
      });
    }

    const updates = [
      { id: tiers.bw.id,   price: round2(bw) },
      { id: tiers.bwD.id,  price: round2(bw * (1 - discount / 100)) },
      { id: tiers.col.id,  price: round2(color) },
      { id: tiers.colD.id, price: round2(color * (1 - discount / 100)) },
    ];
    for (const u of updates) {
      await pool.query(
        `UPDATE capability_tiers SET price_per_page = $1 WHERE id = $2 AND shop_id = $3`,
        [u.price, u.id, adminShopId]
      );
    }

    res.json({
      message: "Pricing updated",
      pricing: {
        shop_id: adminShopId,
        bw_price_per_page: round2(bw).toFixed(2),
        color_price_per_page: round2(color).toFixed(2),
        duplex_discount_pct: round2(discount).toFixed(2),
        diverged: false,
      },
    });
  } catch (err) {
    console.error("PUT PRICING ERROR:", err.message);
    res.status(500).json({ error: "Failed to update pricing" });
  }
};
