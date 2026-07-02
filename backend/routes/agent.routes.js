// backend/routes/agent.routes.js
//cloud backend doesnt have accesst to local files and windows printer and spooler, so this program acts as bridge btw backend and local print agent.
// Routes consumed only by the local Windows print agent — not browser clients.
// All routes require the x-agent-secret header.

//These routes are intentionally separate from /print-jobs routes. They use a different auth mechanism (shared secret header instead of JWT) because the agent is a background process, not a logged-in user.

import express from "express";
import {
  requireAgentSecret,
  getPrintingJobs,
  downloadJobFile,
  agentComplete,
  agentFail,
} from "../controllers/agent.controller.js";

const router = express.Router();

// Apply agent-secret guard to every route in this file
router.use(requireAgentSecret);

// Poll for jobs currently in PRINTING state
router.get("/jobs/printing", getPrintingJobs);

// Download the actual PDF bytes for a specific file
router.get("/jobs/printing/:jobId/files/:fileId", downloadJobFile);

// Mark a job as successfully printed → triggers OTP + READY
router.post("/jobs/:jobId/complete", agentComplete);

// Mark a job as failed → re-queues it
router.post("/jobs/:jobId/fail", agentFail);

export default router;