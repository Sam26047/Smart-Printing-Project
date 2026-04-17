// backend/controllers/auth.controller.js
import bcrypt from "bcrypt";
import pool from "../db/pool.js";
import { generateToken } from "../middleware/auth.js";

export const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);

    if (!passwordOk) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user);

    res.json({
      token,
      role: user.role,
      username: user.username,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
};

export const register = async (req, res) => {
  const { username, password, email } = req.body; // added email

  if (!username || !password || !email) {
    return res.status(400).json({ error: "username, password and email required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "password too short" });
  }

  // basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid email address" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (username, password_hash, email, role)
      VALUES ($1, $2, $3, 'STUDENT')
      RETURNING id, username, email, role
      `,
      [username, passwordHash, email]
    );

    res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      // unique violation — could be username or email
      const detail = err.detail || "";
      if (detail.includes("email")) {
        return res.status(400).json({ error: "email already registered" });
      }
      return res.status(400).json({ error: "username already exists" });
    }

    console.error("REGISTER ERROR:", err.message);
    res.status(500).json({ error: "registration failed" });
  }
};