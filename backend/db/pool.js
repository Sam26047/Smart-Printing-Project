// backend/db/pool.js
import pg from "pg";
import config from "../config/config.js";

const { Pool } = pg;

const pool = new Pool(config.db);

export default pool; 