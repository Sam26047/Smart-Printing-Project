// backend/routes/printers.routes.js
// Shopkeeper printer management — JWT admin routes, scoped to the admin's own
// shop inside the controller. Printer status here is what the routing engine
// (utils/routing.js) reads to decide dispatch vs WAITING_FOR_PRINTER.

import express from "express";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import {
  createPrinter,
  listPrinters,
  listDiscoveredPrinters,
  updatePrinter,
  deletePrinter,
} from "../controllers/printers.controller.js";
import {
  assignPrinterTier,
  unassignPrinterTier,
} from "../controllers/tiers.controller.js";

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post("/", createPrinter);
router.get("/", listPrinters);
// Agent-reported spooler names (dropdown options) — before the /:id routes
router.get("/discovered", listDiscoveredPrinters);
router.patch("/:id", updatePrinter);   // status→ONLINE re-queues waiting jobs
router.delete("/:id", deletePrinter);  // 409 if bound to a PRINTING job

// Tier assignment (hardware-validated; assignment re-queues waiting jobs —
// this is the admin recovery path when a tier's hardware is down)
router.post("/:id/tiers", assignPrinterTier);
router.delete("/:id/tiers/:tierId", unassignPrinterTier);

export default router;
