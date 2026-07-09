// backend/index.js
import express from "express";
import cors from "cors";
import config from "./config/config.js";
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import printJobsRoutes from "./routes/printJobs.routes.js";
import agentRoutes from "./routes/agent.routes.js";
import shopsRoutes from "./routes/shops.routes.js";
import printersRoutes from "./routes/printers.routes.js";

const app = express();

app.use(cors());
// verify hook: retain the exact wire bytes on req.rawBody — the Razorpay
// webhook signature is HMAC'd over the raw body, and re-serializing req.body
// would not be byte-identical. Never remove this without moving the webhook
// route to its own express.raw() parser.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Mount routes
app.use("/", authRoutes);              // /login, /register
app.use("/users", usersRoutes);        // /users, /users/me/jobs, etc. i.e mounts router paths on /users prefix path
app.use("/print-jobs", printJobsRoutes);
app.use("/agent", agentRoutes);        // /agent/* — print agents only (per-shop token)
app.use("/shops", shopsRoutes);        // /shops/pricing + /shops/:shopId/agent-tokens — admin
app.use("/printers", printersRoutes);  // shopkeeper printer CRUD + status toggle

app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

// Start server
app.listen(config.port, () => {
  console.log(`Backend running on port ${config.port}`);
});

// Start printer worker (dispatches QUEUED → PRINTING)
import("./worker.js");