// backend/controllers/users.controller.js
import pool from "../db/pool.js";
import redisClient from "../redisClient.js";

export const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, username, role
      FROM users
      ORDER BY username
      `
    );

    res.json(result.rows);
  } catch (err) {
    console.error("FETCH USERS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!["ADMIN", "STUDENT"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE users
      SET role = $1
      WHERE id = $2
      RETURNING id, username, role
      `,
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("ROLE UPDATE ERROR:", err.message);
    res.status(500).json({ error: "Failed to update role" });
  }
};

export const getUserJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    // read query param
    const activeOnly = req.query.active === "true";
    // 2️⃣ choose SQL
    const query = activeOnly
      ? `
        SELECT
          id,
          status,
          priority,
          deadline,
          created_at
        FROM print_jobs
        WHERE user_id = $1
          AND status NOT IN ('COLLECTED')
        ORDER BY created_at DESC
      `
      : `
        SELECT
          id,
          status,
          priority,
          deadline,
          created_at
        FROM print_jobs
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;

    // 3️⃣ EXECUTE query
    const result = await pool.query(query, [userId]);
    // 4️⃣ return data
    res.json({ jobs: result.rows });
  } catch (err) {
    console.error("FETCH USER JOBS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch job history" });
  }
};

export const getActiveJob = async (req, res) => {
  const jobId = await redisClient.get(`user:${req.user.id}:activeJob`);
  res.json({ jobId });
};