// backend/index.js
import express from "express";
import cors from "cors";
import config from "./config/config.js";
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import printJobsRoutes from "./routes/printJobs.routes.js";
import agentRoutes from "./routes/agent.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

// Mount routes
app.use("/", authRoutes);              // /login, /register
app.use("/users", usersRoutes);        // /users, /users/me/jobs, etc. i.e mounts router paths on /users prefix path
app.use("/print-jobs", printJobsRoutes);
app.use("/agent", agentRoutes);        // /agent/* — local print agent only

app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

// Start server
app.listen(config.port, () => {
  console.log(`Backend running on port ${config.port}`);
});

// Start printer worker (dispatches QUEUED → PRINTING)
import("./worker.js");