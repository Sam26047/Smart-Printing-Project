import express from "express";
import pg from "pg";
import multer from "multer";
import path from "path";
import fs from "fs";
import cors from "cors";
import { validate as isUUID } from "uuid"; //validate is the function name ,we are aliasing it as isUUID
import bcrypt from "bcrypt";
import { authenticate, generateToken, requireAdmin } from "./auth.js";
import redisClient from "./redisClient.js";

const uploadDir = "./uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({  //format of each file object stord in disk
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDFs allowed"));
    }else{
      cb(null, true);
    }
  },
});


//6-digit OTP for collection verification
async function generateOTP(jobId) {
  const otp= Math.floor(100000 + Math.random() * 900000).toString();

  await redisClient.setEx(
    `job:${jobId}:otp`,600,
    otp
  );
  return otp;
}

//This simulates printing time
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));   

const ALLOWED_STATUS_TRANSITIONS = {
  PENDING: ["QUEUED"],
  QUEUED: ["PRINTING"],
  PRINTING: ["READY"],
  READY: ["COLLECTED"],
};

const app = express();

app.use(cors());
app.use(express.json());

const {Pool} = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

app.post("/login", async (req,res)=>{
  const { username,password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE username = $1",   //simple user lookup
    [username]
  );

  if(result.rows.length === 0){
    return res.status(401).json({error: "Invalid credentials"});
  }

  const user = result.rows[0];
  const passwordOk = await bcrypt.compare(password,user.password_hash); //password check authentication

  if(!passwordOk){
    return res.status(401).json({error: "Invalid credentials"});
  }

  const token = generateToken(user); //generate token if authenticated

  res.json({  //return token
    token,
    role: user.role,
    username: user.username, 
  });
});

app.post("/register", async (req, res) => {
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
});

app.get("/users", authenticate, requireAdmin, async (req, res) => {
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
});

app.patch("/users/:id/role", authenticate, requireAdmin, async (req, res) => {
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
});

app.get( "/users/me/jobs", authenticate,async (req, res) => { 
    try {
      const userId = req.user.id;

      // 1️⃣ read query param
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
  }
);

app.get("/users/me/active-job", authenticate,async (req, res) => { 
    const jobId = await redisClient.get(
      `user:${req.user.id}:activeJob`
    );

    res.json({ jobId });
  }
);

app.post("/print-jobs", authenticate, upload.array("files", 10),async (req, res) => { //only logged in users can create jobs now  
    try {
      const { copies, color, double_sided, deadline } = req.body;
      const userId = req.user.id;
      // ✅ validation
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "At least one PDF is required" });
      }

      if (!copies) {
        return res.status(400).json({ error: "Copies are required" });
      }

      // 1️⃣ create job (NO file columns anymore)
      const jobResult = await pool.query(
        `
        INSERT INTO print_jobs
          (user_id,copies, color, double_sided, status, deadline)
        VALUES
          ($1, $2, $3, $4, 'PENDING', $5)
        RETURNING id
        `,
        [userId, copies, color, double_sided, deadline || null]
      );

      const jobId = jobResult.rows[0].id;

      await redisClient.set(
        `user:${userId}:activeJob`,  //key
        jobId                        //value
      );


      // 2️⃣ insert all files
      const insertFilesPromises = req.files.map((file) =>
        pool.query(
          `
          INSERT INTO job_files
            (job_id, file_name, file_path)
          VALUES
            ($1, $2, $3)
          `,
          [jobId, file.originalname, file.path]
        )
      );

      await Promise.all(insertFilesPromises);  //wait until all these promises finish,
      // i.e if all inserts succeed ->continue
      //else throw error

      // 3️⃣ response
      res.status(201).json({
        job_id: jobId,
        file_count: req.files.length,
        message: "Files uploaded and job created",
      });
    } catch (err) {
      console.error("UPLOAD ERROR:", err.message);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

app.post("/print-jobs/:id/regenerate-otp",authenticate,async (req,res)=>{
  const {id} = req.params;

  try{
    //check job exists and is READY
    const result = await pool.query(
      `
      SELECT id,status
      FROM print_jobs
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0){
      return res.status(404).json({error: "Job not found"});
    }

    if(result.rows[0].status != "READY"){
      return res
        .status(400)
        .json({error: "OTP can only be regenerated for READY jobs"});
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random()*900000).toString();

    await redisClient.setEx(`job:${id}:otp`,600,otp);

    console.log(`Regenerated OTP for job ${id}: ${otp}`);

    res.json({ message: "OTP regenerated successfully"});
  }catch(err){
    console.error("OTP REGEN ERROR: ",err.message);
    res.status(500).json({ error: "Failed to regenerate OTP"});
  }
});


app.get("/print-jobs",authenticate,requireAdmin,async(req,res)=>{
  try{
    const result = await pool.query(
      `
      SELECT
        id,
        copies,
        color,
        double_sided,
        status,
        created_at,
        priority,
        deadline
      FROM print_jobs
      ORDER BY status,priority DESC, created_at ASC
      `
    );

    res.json({
      jobs:result.rows,
    });
  }catch(err){
    console.error("DB ERROR:",err.message);
    res.status(500).json({error:"Failed to fetch print jobs"});
  }
});

app.patch("/print-jobs/:id/status",authenticate,requireAdmin,async(req,res)=>{
  const {id} =req.params;
  const {status} = req.body;

  if(!status){
    return res.status(400).json({error:"Status is Required"});
  }
  try {
    //1. Get current status
    const current = await pool.query(
      "SELECT status FROM print_jobs WHERE id = $1",
      [id]
    );
    if(current.rows.length === 0){
      return res.status(404).json({error: "Job not found"});
    }

    const currentStatus = current.rows[0].status;

    //2. Validate transition

    const allowedNext = ALLOWED_STATUS_TRANSITIONS[currentStatus]||[];

    if(!allowedNext.includes(status)){
      return res.status(400).json({
        error: `Invalid transition from ${currentStatus} to ${status}`,
      });
    }

    //3. Update status
    await pool.query(
      "UPDATE print_jobs SET status= $1 WHERE id = $2",
      [status,id]
    );

    res.json({message: "Status updated successfully"});
  }catch(err){
    console.error("DB ERROR: ",err.message);
    res.status(500).json({error: "Failed to update status"});
  }
});

app.get("/print-jobs/:id",async (req,res)=>{
  const {id} = req.params;

  // ✅ UUID format validation
  if (!isUUID(id)) {
    return res.status(400).json({ error: "Invalid print job ID format" });
  }

  try{
    const result = await pool.query(
      `
      SELECT
        id,
        copies,
        color,
        double_sided,
        status,
        created_at
      FROM print_jobs
      WHERE id = $1
      `,
      [id]
    );

    if(result.rows.length===0){
      return res.status(404).json({error: "Print job not found"});
    }

    res.json(result.rows[0]);
  }catch(err){
    console.error("DB ERROR:",err.message);
    res.status(500).json({error:"Failed to fetch print job"});
  }
});

app.patch("/print-jobs/:id/priority",authenticate,requireAdmin,async(req,res)=>{ //add token authentication and admin check middleware 
  const {id} = req.params;
  const {priority} = req.body;

  if(priority===undefined){
    return res.status(400).json({error: "Priority is required"});
  }

  try{
    //Ensure job is QUEUED
    const current = await pool.query(
      "SELECT status FROM print_jobs WHERE id = $1",[id]
    );

    if(current.rows.length===0){
      return res.status(404).json({error: "Job not found"});
    }

    if(current.rows[0].status !=="QUEUED"){
      return res.status(400).json({
        error: "Only QUEUED jobs can be reordered",
      });
    }

    await pool.query(
      "UPDATE print_jobs SET priority = $1 WHERE id = $2",
      [priority,id]
    );

    res.json({message: "Priority updated successfully"});
  }catch(err){
    console.log("DB ERROR:", err.message);
    res.status(500).json({error: "Failed to update priority"});
  }
});

app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

app.post("/print-jobs/:id/collect", authenticate,async (req, res) => {

  const { otp } = req.body;
  const jobId = req.params.id;

  if (!otp) {
    return res.status(400).json({ error: "OTP is required" });
  }

  const redisOtp = await redisClient.get(`job:${jobId}:otp`);
  await redisClient.del(`user:${req.user.id}:activeJob`);

  if(!redisOtp || redisOtp !== otp){
    return res.status(400).json({ error: "Invalid or expired OTP"});
  }

  try {
    const result = await pool.query(
      `
      UPDATE print_jobs
      SET status = 'COLLECTED'
      WHERE id = $1 AND status = 'READY'
      RETURNING *
      `,
      [jobId]
    );


    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid OTP or job not ready" });
    }

    res.json({ message: "Print job collected successfully" });

    await redisClient.del(`job:${jobId}:otp`);
    await redisClient.del(`user:${req.user.id}:activeJob`);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to collect print job" });
  }
});

async function printerWorker(){
  console.log("🖨️ Printer worker started");

  while(true){ 
    try{
      //1. Find nest job to print

      //first sort by priority then assign 1 to the jobs with deadline not null so they get higher priority
      //then sort by smallest deadline then sort by fifo for fairness using created_at
      const result = await pool.query(  
        `
        SELECT id
        FROM print_jobs
        WHERE status = 'QUEUED'
        ORDER BY
          priority DESC,
          CASE
            WHEN deadline IS NULL THEN 1  
            ELSE 0
          END,
          deadline ASC,
          created_at ASC
        LIMIT 1
        `
      );

      if(result.rows.length===0){
        //No jobs-> wait and retry
        await sleep(3000);
        continue;
      }
      
      const jobId = result.rows[0].id;

      //2. Mark job as PRINTING
      await pool.query(
        "UPDATE print_jobs SET status = 'PRINTING' WHERE id=$1",
        [jobId]
      );

      console.log(`🖨️ Printing job ${jobId}...`);

      //3. Simulate printing time
      await sleep(5000);

      //4. Mark job as READY and generate OTP

      const otp = generateOTP(jobId);

      await pool.query(
        `
        UPDATE print_jobs
        SET status = 'READY'
        WHERE id = $1
        `,
        [jobId]
      );

      console.log(`✅ Job ${jobId} is READY`);
      console.log(`🔐 OTP for job ${jobId}: ${otp}`);

    }catch(err){
      console.error("❌ Printer worker error:", err.message);
      await sleep(5000);
    }
  }
}

printerWorker();

app.listen(5000, () => {
  console.log("Backend running on port 5000");
});
