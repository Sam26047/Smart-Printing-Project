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

const router = express.Router();

router.use(authenticate, requireAdmin);

router.post("/", createPrinter);
router.get("/", listPrinters);
// Agent-reported spooler names (dropdown options) — before the /:id routes
router.get("/discovered", listDiscoveredPrinters);
router.patch("/:id", updatePrinter);   // status→ONLINE re-queues waiting jobs
router.delete("/:id", deletePrinter);  // 409 if bound to a PRINTING job

export default router;
