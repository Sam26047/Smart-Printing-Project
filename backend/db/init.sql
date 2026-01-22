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
