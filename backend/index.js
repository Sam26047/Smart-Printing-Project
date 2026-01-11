import express from "express";
import pg from "pg";

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
        created_at
      FROM print_jobs
      ORDER BY created_at DESC
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

app.get("/", (req, res) => {
  res.send("Backend is alive 🚀");
});

app.listen(5000, () => {
  console.log("Backend running on port 5000");
});
