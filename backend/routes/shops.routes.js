// backend/routes/shops.routes.js
// Shop-scoped admin routes (agent token management).
// These are browser routes → JWT auth. The handlers additionally verify the
// admin's users.shop_id matches :shopId, so one shop's admin can't mint or
// revoke another shop's tokens.

import express from "express";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import {
  issueAgentToken,
  revokeAgentToken,
} from "../controllers/agentTokens.controller.js";

const router = express.Router();

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
