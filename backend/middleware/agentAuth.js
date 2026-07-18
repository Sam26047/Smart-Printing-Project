// backend/middleware/agentAuth.js
// Per-shop device-token auth for the /agent/* routes.
// Replaces the old global AGENT_SECRET (hard cutover — no legacy fallback).
//
// Token format:  pfa_<agent_tokens.id>.<secret>
// The row id is embedded so verification is a single PK lookup; the secret half
// is compared as sha256 hashes (plaintext is never stored). sha256 instead of
// bcrypt is deliberate: the secret is 32 random bytes, so slow hashing buys
// nothing, and this runs on the agent's ~5s poll loop.
//
// Keep this separate from JWT auth — the agent is a background device, not a
// logged-in user. Never route /agent/* through `authenticate`.

import crypto from "crypto";
import pool from "../db/pool.js";

const TOKEN_PREFIX = "pfa_";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Secret half of a new token. The issuance handler stores sha256Hex(secret)
// and composes the full plaintext token with the new row id.
export function generateTokenSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function requireAgentToken(req, res, next) {
  const raw = req.headers["x-agent-token"];

  // One generic 401 for every failure mode — don't leak which part was wrong
  const reject = () => res.status(401).json({ error: "Invalid agent token" });

  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return reject();

  const dot = raw.indexOf(".");
  if (dot === -1) return reject();

  const tokenId = raw.slice(TOKEN_PREFIX.length, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_RE.test(tokenId) || !secret) return reject();

  try {
    const result = await pool.query(
      `SELECT t.token_hash, t.revoked_at, s.id AS shop_id, s.fulfillment
       FROM agent_tokens t
       JOIN shops s ON s.id = t.shop_id
       WHERE t.id = $1`,
      [tokenId]
    );

    if (result.rows.length === 0) return reject();

    const { token_hash, revoked_at, shop_id, fulfillment } = result.rows[0];

    const given = Buffer.from(sha256Hex(secret), "hex");
    const stored = Buffer.from(token_hash, "hex");
    if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
      return reject();
    }
    if (revoked_at) return reject();

    // Everything downstream scopes queries to req.shop.id — the shop identity
    // comes only from the verified token, never from a URL/body param.
    req.shop = { id: shop_id, fulfillment };
    // Which agent (machine) is calling — printer discovery records provenance
    // per token so multi-device shops don't merge their printer sets.
    req.agentTokenId = tokenId;

    // Fire-and-forget usage tracking. NOTE: this is a DB write on the ~5s poll
    // hot path — fine at current scale; throttle to at-most-every-few-minutes
    // (e.g. skip if last_used_at is recent) when shop count grows.
    pool
      .query(`UPDATE agent_tokens SET last_used_at = NOW() WHERE id = $1`, [
        tokenId,
      ])
      .catch(() => {});

    next();
  } catch (err) {
    console.error("AGENT AUTH ERROR:", err.message);
    res.status(500).json({ error: "Agent auth failed" });
  }
}
