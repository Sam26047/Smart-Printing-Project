import express from "express";
import pg from "pg";
const app = express();

async function testDB(retries = 5) {   //new client creation for retrying connection
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();
    const res = await client.query("SELECT 1");
    console.log("Database connected:", res.rows);
    await client.end();
  } catch (err) {
    console.error("Database connection failed. Retrying...", err.code);  //keep retrying until conn successful as postgres might still be booting
    if (retries > 0) {
      setTimeout(() => testDB(retries - 1), 2000);
    } else {
      console.error("Could not connect to database after retries");
    }
  }
}

testDB();

app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

app.listen(5000, () => {
  console.log("Backend running on port 5000");
});
