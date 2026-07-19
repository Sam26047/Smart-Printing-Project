// backend/controllers/agentTokens.controller.js
// Admin endpoints for issuing/revoking per-shop agent device tokens.
// Browser/admin routes → JWT auth (authenticate + requireAdmin in the router),
// NOT the agent token scheme.
//
// The plaintext token is returned ONCE at issuance and never stored — only its
// sha256 hash lives in agent_tokens. Rotation = issue new, swap agent .env,
// revoke old (both stay valid during the swap).

import pool from "../db/pool.js";
import { generateTokenSecret, sha256Hex } from "../middleware/agentAuth.js";
import { getAdminShopId } from "../utils/adminShop.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admins may only manage tokens for their own shop (users.shop_id).
// Looked up fresh from the DB — the JWT payload doesn't carry shop_id, so a
// shop reassignment takes effect immediately instead of at token expiry.
async function adminOwnsShop(userId, shopId) {
  const result = await pool.query(`SELECT shop_id FROM users WHERE id = $1`, [
    userId,
  ]);
  return result.rows.length > 0 && result.rows[0].shop_id === shopId;
}

// ─── Shop-less variants (the admin UI's path) ────────────────────────────────
// The shop is resolved server-side from the caller via getAdminShopId() —
// no shop id ever appears in a client request, matching /shops/pricing.
// The :shopId variants below are kept for curl workflows; they enforce the
// same ownership via adminOwnsShop().

// ── GET /shops/agent-tokens — list own shop's tokens ─────────────────────────
// No hashes, no secrets: the plaintext exists only in the mint response.
export const listAgentTokens = async (req, res) => {
  try {
    const shopId = await getAdminShopId(req.user.id);
    if (!shopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }
    const result = await pool.query(
      `SELECT id, label, created_at, last_used_at, revoked_at
       FROM agent_tokens WHERE shop_id = $1
       ORDER BY created_at DESC`,
      [shopId]
    );
    res.json({ tokens: result.rows });
  } catch (err) {
    console.error("LIST AGENT TOKENS ERROR:", err.message);
    res.status(500).json({ error: "Failed to list agent tokens" });
  }
};

// ── POST /shops/agent-tokens — mint for own shop ─────────────────────────────
export const issueAgentTokenForOwnShop = async (req, res) => {
  const { label } = req.body || {};
  try {
    const shopId = await getAdminShopId(req.user.id);
    if (!shopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const secret = generateTokenSecret();
    const result = await pool.query(
      `INSERT INTO agent_tokens (shop_id, token_hash, label)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [shopId, sha256Hex(secret), label || null]
    );
    const { id, created_at } = result.rows[0];

    res.status(201).json({
      token_id: id,
      label: label || null,
      created_at,
      token: `pfa_${id}.${secret}`,
      warning:
        "Store this token now — it is shown only once and cannot be retrieved later.",
    });
  } catch (err) {
    console.error("ISSUE AGENT TOKEN (own shop) ERROR:", err.message);
    res.status(500).json({ error: "Failed to issue agent token" });
  }
};

// ── POST /shops/agent-tokens/:tokenId/revoke — revoke own shop's token ───────
export const revokeAgentTokenForOwnShop = async (req, res) => {
  const { tokenId } = req.params;
  if (!UUID_RE.test(tokenId)) {
    return res.status(404).json({ error: "Token not found" });
  }
  try {
    const shopId = await getAdminShopId(req.user.id);
    if (!shopId) {
      return res.status(403).json({ error: "Admin is not assigned to a shop" });
    }

    const result = await pool.query(
      `UPDATE agent_tokens SET revoked_at = NOW()
       WHERE id = $1 AND shop_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [tokenId, shopId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Token not found or already revoked" });
    }
    res.json({ message: "Token revoked", token_id: tokenId });
  } catch (err) {
    console.error("REVOKE AGENT TOKEN (own shop) ERROR:", err.message);
    res.status(500).json({ error: "Failed to revoke agent token" });
  }
};

// ── POST /shops/:shopId/agent-tokens ─────────────────────────────────────────
export const issueAgentToken = async (req, res) => {
  const { shopId } = req.params;
  const { label } = req.body || {};

  if (!UUID_RE.test(shopId)) {
    return res.status(404).json({ error: "Shop not found" });
  }

  try {
    if (!(await adminOwnsShop(req.user.id, shopId))) {
      return res.status(403).json({ error: "Not an admin of this shop" });
    }

    const secret = generateTokenSecret();
    const result = await pool.query(
      `INSERT INTO agent_tokens (shop_id, token_hash, label)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [shopId, sha256Hex(secret), label || null]
    );

    const { id, created_at } = result.rows[0];

    res.status(201).json({
      token_id: id,
      label: label || null,
      created_at,
      token: `pfa_${id}.${secret}`,
      warning:
        "Store this token now — it is shown only once and cannot be retrieved later.",
    });
  } catch (err) {
    console.error("ISSUE AGENT TOKEN ERROR:", err.message);
    res.status(500).json({ error: "Failed to issue agent token" });
  }
};

// ── POST /shops/:shopId/agent-tokens/:tokenId/revoke ─────────────────────────
export const revokeAgentToken = async (req, res) => {
  const { shopId, tokenId } = req.params;

  if (!UUID_RE.test(shopId) || !UUID_RE.test(tokenId)) {
    return res.status(404).json({ error: "Token not found" });
  }

  try {
    if (!(await adminOwnsShop(req.user.id, shopId))) {
      return res.status(403).json({ error: "Not an admin of this shop" });
    }

    const result = await pool.query(
      `UPDATE agent_tokens
       SET revoked_at = NOW()
       WHERE id = $1 AND shop_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [tokenId, shopId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Token not found or already revoked" });
    }

    res.json({ message: "Token revoked", token_id: tokenId });
  } catch (err) {
    console.error("REVOKE AGENT TOKEN ERROR:", err.message);
    res.status(500).json({ error: "Failed to revoke agent token" });
  }
};
