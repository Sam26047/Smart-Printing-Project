// backend/routes/agent.routes.js
//cloud backend doesnt have accesst to local files and windows printer and spooler, so this program acts as bridge btw backend and local print agent.
// Routes consumed only by print agents (or the demo shop's cloud virtual-printer
// worker) — not browser clients. All routes require the x-agent-token header:
// a per-shop device token (pfa_<id>.<secret>) that scopes every query to the
// calling shop.

//These routes are intentionally separate from /print-jobs routes. They use a different auth mechanism (per-shop device token header instead of JWT) because the agent is a background process, not a logged-in user.

import express from "express";
import { requireAgentToken } from "../middleware/agentAuth.js";
import {
  getPrintingJobs,
  downloadJobFile,
  uploadPrintedOutput,
  agentComplete,
  agentFail,
} from "../controllers/agent.controller.js";

const router = express.Router();

// Apply per-shop token guard to every route in this file — attaches req.shop
router.use(requireAgentToken);

// Poll for jobs currently in PRINTING state
router.get("/jobs/printing", getPrintingJobs);

// Download the actual PDF bytes for a specific file
router.get("/jobs/printing/:jobId/files/:fileId", downloadJobFile);

// Store the "printed output" artifact for one file (virtual/demo printing) —
// raw PDF body, so this route gets its own express.raw parser
router.post(
  "/jobs/:jobId/files/:fileId/output",
  express.raw({ type: "application/pdf", limit: "25mb" }),
  uploadPrintedOutput
);

// Mark a job as successfully printed → triggers OTP + READY
router.post("/jobs/:jobId/complete", agentComplete);

// Mark a job as failed → re-queues it
router.post("/jobs/:jobId/fail", agentFail);

export default router;