// backend/controllers/auth.controller.js
import bcrypt from "bcrypt";
import pool from "../db/pool.js";
import { generateToken } from "../middleware/auth.js";

export const login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1", //simple user lookup
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash); //password check authentication

    if (!passwordOk) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user);//generate token if authenticated

    res.json({ //return token
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
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "password too short" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (username, password_hash, role)
      VALUES ($1, $2, 'STUDENT')
      RETURNING id, username, role
      `,
      [username, passwordHash]
    );

    res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "username already exists" });
    }

    console.error("REGISTER ERROR:", err.message);
    res.status(500).json({ error: "registration failed" });
  }
};