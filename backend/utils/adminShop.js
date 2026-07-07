// backend/utils/adminShop.js
// The shop this admin runs (users.shop_id). Admin endpoints are scoped to this
// shop so one shop's admin can never see or touch another shop's data.
// Looked up fresh from the DB — the JWT payload doesn't carry shop_id, so a
// shop reassignment takes effect immediately instead of at token expiry.

import pool from "../db/pool.js";

export async function getAdminShopId(userId) {
  const result = await pool.query(
    "SELECT shop_id FROM users WHERE id = $1",
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].shop_id : null;
}
