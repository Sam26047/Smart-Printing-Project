import express from "express";
import pg from "pg";

//6-digit OTP for collection verification
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
app.use(express.json());

const {Pool} = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

app.post("/print-jobs",async(req,res)=>{
  const {file_name,file_path,copies,color,double_sided} = req.body;

  //Basic Validation
  if(!file_name || !file_path || !copies){
    return res.status(400).json({error:"Missing required fields"});
  }

  try{
    const result = await pool.query(
      `
        INSERT INTO print_jobs
          (file_name,file_path,copies,color,double_sided,status)
        VALUES
          ($1,$2,$3,$4,$5,'PENDING')
          RETURNING id
      `,
      [file_name,file_path,copies,color,double_sided]
    );
    res.status(201).json({
      job_id:result.rows[0].id,  //sets resource succesfully created(201) as status and returns job id to client
    });
  }catch(err){
    console.error(err);
    res.status(500).json({error:"Failed to create print job"});
  }
});

app.get("/print-jobs",async(req,res)=>{
  try{
    const result = await pool.query(
      `
      SELECT
        id,
        file_name,
        copies,
        color,
        double_sided,
        status,
        created_at,
        priority,
        deadline
      FROM print_jobs
      ORDER BY priority DESC, created_at ASC
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

app.patch("/print-jobs/:id/status",async(req,res)=>{
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
        file_name,
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

app.patch("/print-jobs/:id/priority",async(req,res)=>{
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

app.post("/print-jobs/collect",async (req,res)=>{
  const { otp } = req.body;

  if(!otp){
    return res.status(400).json({error:"OTP is required"});
  }

  try{
    const result = await pool.query(
      `
      SELECT id,status, otp_used
      FROM print_jobs
      WHERE otp = $1
      `,
      [otp]
    );

    if(result.rows.length === 0){
      return res.status(400).json({error: "Invalid OTP"});
    }

    const job = result.rows[0];

    if(job.otp_used){
      return res.status(400).json({error: "OTP already used"});
    }

    if(job.status !== "READY"){
      return res.status(400).json({error: "Job not ready for collection"});
    }

    await pool.query(
      `
      UPDATE print_jobs
      SET status = 'COLLECTED',
          otp_used = TRUE
      WHERE id = $1
      `,
      [job.id]
    );

    res.json({message: "Print collected successfully"});
  }catch(err){
    console.error("OTP ERROR:",err.message);
    res.status(500).json({error: "Failed to collect print job"});
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

      const otp = generateOTP();

      await pool.query(
        `
        UPDATE print_jobs 
         SET status = 'READY',
            otp = $1,
            otp_used = FALSE
         WHERE id=$2
        `,
        [otp,jobId]
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
