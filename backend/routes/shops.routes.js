// backend/routes/shops.routes.js
// Shop-scoped admin routes (agent token management).
// These are browser routes → JWT auth. The handlers additionally verify the
// admin's users.shop_id matches :shopId, so one shop's admin can't mint or
// revoke another shop's tokens.

import express from "express";
import pool from "../db/pool.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import {
  issueAgentToken,
  revokeAgentToken,
} from "../controllers/agentTokens.controller.js";
import {
  getShopPricing,
  putShopPricing,
} from "../controllers/shopPricing.controller.js";

const router = express.Router();

// Public shop directory (id/name/slug only) — the submit form's shop selector
// needs this once more than one shop exists. Read-only, no sensitive fields.
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug FROM shops ORDER BY created_at ASC`
    );
    res.json({ shops: result.rows });
  } catch (err) {
    console.error("LIST SHOPS ERROR:", err.message);
    res.status(500).json({ error: "Failed to list shops" });
  }
});

// Per-shop pricing (admin's own shop, resolved in the controller — no :shopId)
router.get("/pricing", authenticate, requireAdmin, getShopPricing);
router.put("/pricing", authenticate, requireAdmin, putShopPricing);

// Issue a new agent device token for this shop (plaintext returned once)
router.post("/:shopId/agent-tokens", authenticate, requireAdmin, issueAgentToken);

// Revoke an existing token (sets revoked_at; middleware rejects it thereafter)
router.post(
  "/:shopId/agent-tokens/:tokenId/revoke",
  authenticate,
  requireAdmin,
  revokeAgentToken
);

export default router;
