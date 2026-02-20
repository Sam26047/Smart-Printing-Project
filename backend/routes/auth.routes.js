// backend/routes/auth.routes.js
import express from "express";
import * as authController from "../controllers/auth.controller.js";

const router = express.Router();
//the Router class of express allows you to define a mini app with its own routes,think of it as a slice of your app that gets plugged in to index.js itself via app.use()

router.post("/login", authController.login);
router.post("/register", authController.register);

export default router;