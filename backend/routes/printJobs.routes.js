// backend/routes/printJobs.routes.js
import express from "express";
import multer from "multer";
import fs from "fs";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import * as printJobsController from "../controllers/printJobs.controller.js";
import { createPaymentOrder, paymentWebhook } from "../controllers/payments.controller.js";

const router = express.Router();

// Setup multer
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({ //format of each file object stord in disk
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDFs allowed"));
    }
    cb(null, true);
  },
});

// Routes
router.get("/", authenticate, requireAdmin, printJobsController.getAllJobs);

// ─── Queue status — no auth needed ───────────────────────────────────────────
// Returns { queue_size, urgent_disabled } so the frontend can:
//   • show "You are #N in queue"
//   • grey-out the Urgent option if peak load is active
router.get("/queue/status", printJobsController.getQueueStatus);

// Read-only cost preview — same pricing path as createPrintJob, creates
// nothing. Used by the live estimate on the submit form.
router.post("/estimate", authenticate, printJobsController.estimatePrintJob);

// ─── Payments (Razorpay, test mode) ──────────────────────────────────────────
// Webhook has NO JWT — Razorpay calls it; the HMAC signature is the auth.
// Registered before the /:id/* routes for clarity.
router.post("/payment/webhook", paymentWebhook);
// Order creation: student pays for their own PENDING+UNPAID job
router.post("/:id/payment/order", authenticate, createPaymentOrder);

router.post(  //only logged in users can create jobs now 
  "/",
  authenticate,
  upload.array("files", 10),
  printJobsController.createPrintJob
);
// Authed + owner-scoped (returns payment_status/estimated_cost — see controller)
router.get("/:id", authenticate, printJobsController.getJobById);
// Stamped "printed output" artifact (demo virtual printing) — owner-scoped
router.get("/:id/files/:fileId/output", authenticate, printJobsController.getPrintedOutput);
router.patch(
  "/:id/status",
  authenticate,
  requireAdmin,
  printJobsController.updateJobStatus
);
router.patch(
  "/:id/priority",
  authenticate,
  requireAdmin,
  printJobsController.updateJobPriority
);
router.post(
  "/:id/regenerate-otp",
  authenticate,
  printJobsController.regenerateOtp
);
// Shopkeeper override: pin one file of a WAITING_FOR_PRINTER job to a printer
// of a different color tier (recomputes + re-locks the price; needs confirm)
router.post(
  "/:id/reassign-file",
  authenticate,
  requireAdmin,
  printJobsController.reassignFile
);
router.post("/:id/collect", authenticate, printJobsController.collectPrintJob);

export default router;