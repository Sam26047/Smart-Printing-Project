CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; --postgres is like a core engine+plugins system
--so this is basicallu uuid generation plugin

CREATE TABLE IF NOT EXISTS print_jobs(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    copies INTEGER NOT NULL CHECK (copies>0),
    color BOOLEAN NOT NULL,
    double_sided BOOLEAN NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE print_jobs
ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

ALTER TABLE print_jobs
ADD COLUMN IF NOT EXISTS deadline TIMESTAMP;

ALTER TABLE print_jobs
ADD COLUMN IF NOT EXISTS otp TEXT,
ADD COLUMN IF NOT EXISTS otp_used BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('STUDENT', 'ADMIN')),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE job_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE print_jobs
DROP COLUMN IF EXISTS file_name,
DROP COLUMN IF EXISTS file_path;   --link path and name to job-files and instead of jobs

ALTER TABLE print_jobs  
ADD COLUMN user_id UUID;  --connect users to jobs for job history

ALTER TABLE print_jobs
ADD CONSTRAINT print_jobs_user_fk  --added foreign key to associate user and jobs
FOREIGN KEY (user_id)
REFERENCES users(id)
ON DELETE SET NULL; --jobs history remain even if user deletec

ALTER TABLE print_jobs
DROP COLUMN otp,
DROP COLUMN otp_used;
