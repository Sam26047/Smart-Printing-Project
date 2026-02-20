// backend/routes/users.routes.js
import express from "express";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import * as usersController from "../controllers/users.controller.js";

const router = express.Router();

// Admin only
router.get("/", authenticate, requireAdmin, usersController.getAllUsers);
router.patch("/:id/role", authenticate, requireAdmin, usersController.updateUserRole);

// Current user
router.get("/me/jobs", authenticate, usersController.getUserJobs);
router.get("/me/active-job", authenticate, usersController.getActiveJob);

export default router;