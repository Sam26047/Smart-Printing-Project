// backend/index.js
import express from "express";
import cors from "cors";
import config from "./config/config.js";
import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import printJobsRoutes from "./routes/printJobs.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

// Mount routes
app.use("/", authRoutes);           // /login, /register
app.use("/users", usersRoutes);     // /users, /users/me/jobs, etc. i.e mounts router paths on /users prefix path
app.use("/print-jobs", printJobsRoutes);

app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

// Start server
app.listen(config.port, () => {
  console.log(`Backend running on port ${config.port}`);
});

// Start printer worker
import("./worker.js"); //dynamically import worker to avoid circular dependencies with controllers
//starts polling as soon as app starts listening