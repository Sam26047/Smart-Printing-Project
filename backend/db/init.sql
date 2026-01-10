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
