-- backend/db/init.sql
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

-- Add per-file print settings to job_files
ALTER TABLE job_files
ADD COLUMN IF NOT EXISTS copies INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS color BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS double_sided BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE print_jobs
DROP COLUMN copies,
DROP COLUMN color,
DROP COLUMN double_sided;

-- ─── Phase: Priority levels + smart pricing ──────────────────────────────────

-- urgency_level replaces the free-form deadline for user-facing priority selection.
-- NORMAL → no surcharge | SOON (+20%) → 2–4 hrs | URGENT (+50/80%) → 30–60 mins
ALTER TABLE print_jobs
ADD COLUMN IF NOT EXISTS urgency_level TEXT NOT NULL DEFAULT 'NORMAL'
  CHECK (urgency_level IN ('NORMAL', 'SOON', 'URGENT'));

-- Track urgent job submissions per user for abuse protection:
--   • max 2 URGENT jobs per user per 24 hours
--   • 1-hour cooldown between URGENT submissions
-- Each row = one URGENT job submitted by that user
CREATE TABLE IF NOT EXISTS urgency_usage (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index so the abuse-check query (WHERE user_id = X AND used_at > ...) is fast
CREATE INDEX IF NOT EXISTS idx_urgency_usage_user_time
  ON urgency_usage (user_id, used_at DESC);

-- Only these two columns are missing from job_files
ALTER TABLE job_files
ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'portrait',
ADD COLUMN IF NOT EXISTS paper_size  TEXT NOT NULL DEFAULT 'A4';

--add orientation and paper_size to job_files (safe to run multiple times)

ALTER TABLE job_files
  ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'portrait',
  ADD COLUMN IF NOT EXISTS paper_size  TEXT NOT NULL DEFAULT 'A4';

-- ─── Phase: Multi-tenant shops + per-shop agent tokens ────────────────────────

-- One row per print shop (tenant). fulfillment:
--   AGENT   → jobs printed by a physical Windows print agent polling /agent/*
--   VIRTUAL → demo shop: jobs fulfilled by a cloud virtual-printer worker that
--             authenticates with an agent token exactly like a real agent
CREATE TABLE IF NOT EXISTS shops (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  fulfillment TEXT NOT NULL DEFAULT 'AGENT'
    CHECK (fulfillment IN ('AGENT', 'VIRTUAL')),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Per-shop device tokens for /agent/* auth (replaces the global AGENT_SECRET).
-- Token format: pfa_<id>.<secret>; only sha256(secret) is stored, plaintext is
-- shown once at issuance. Multiple live tokens per shop → zero-downtime
-- rotation now, multi-device/multi-printer later.
CREATE TABLE IF NOT EXISTS agent_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  label        TEXT,                      -- e.g. 'Front desk PC'
  last_used_at TIMESTAMP,                 -- updated on agent polls (lazy later)
  revoked_at   TIMESTAMP,                 -- NULL = active
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_shop ON agent_tokens (shop_id);

-- shop_id on jobs is THE routing key: agent polling, queue scoping, admin views
ALTER TABLE print_jobs
ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);

-- Admins: the shop they run. Students: NULL (they pick a shop per job).
ALTER TABLE users
ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id) ON DELETE SET NULL;

-- Backfill: create the default shop, attach all existing jobs + admin users
INSERT INTO shops (name, slug)
SELECT 'Default Shop', 'default'
WHERE NOT EXISTS (SELECT 1 FROM shops WHERE slug = 'default');

UPDATE print_jobs
SET shop_id = (SELECT id FROM shops WHERE slug = 'default')
WHERE shop_id IS NULL;

UPDATE users
SET shop_id = (SELECT id FROM shops WHERE slug = 'default')
WHERE role = 'ADMIN' AND shop_id IS NULL;

-- Composite index for the hot per-shop queries (agent poll, queue size)
CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_status
  ON print_jobs (shop_id, status);

-- Run only after createPrintJob passes shop_id on INSERT (done — applied 2026-07-06)
ALTER TABLE print_jobs ALTER COLUMN shop_id SET NOT NULL;

-- ─── Phase: Multi-printer routing + per-shop pricing + WAITING_FOR_PRINTER ────

-- Physical printers per shop. status is a manual shopkeeper toggle (no
-- agent-reported health yet). device_name is the exact Windows printer name
-- the agent passes to pdf-to-printer, entered manually by the shopkeeper.
CREATE TABLE IF NOT EXISTS printers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  label           TEXT,
  device_name     TEXT,
  supports_color  BOOLEAN NOT NULL,
  supports_duplex BOOLEAN NOT NULL DEFAULT TRUE,
  paper_sizes     TEXT[] NOT NULL DEFAULT '{A4}',
  status          TEXT NOT NULL DEFAULT 'ONLINE'
    CHECK (status IN ('ONLINE', 'OFFLINE', 'OUT_OF_SERVICE')),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Routing query filters on (shop, status) every worker cycle
CREATE INDEX IF NOT EXISTS idx_printers_shop_status ON printers (shop_id, status);

-- Per-shop pricing (1:1 with shops). Paper size is intentionally NOT priced.
CREATE TABLE IF NOT EXISTS shop_pricing (
  shop_id              UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  bw_price_per_page    NUMERIC(10,2) NOT NULL,
  color_price_per_page NUMERIC(10,2) NOT NULL,
  duplex_discount_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0
);

-- page_count: server-side authoritative count (pdf-lib) stored at submission.
-- printer_id: bound at DISPATCH time only — stays NULL until routing succeeds
-- or the shopkeeper manually pins the file. Never SET NOT NULL on this.
ALTER TABLE job_files
ADD COLUMN IF NOT EXISTS page_count INTEGER,
ADD COLUMN IF NOT EXISTS printer_id UUID REFERENCES printers(id) ON DELETE SET NULL;

-- estimated_cost: server-computed price LOCKED at submission (pre-Razorpay).
-- urgency_multiplier: the exact multiplier applied at submission — it depends
-- on queue size at that moment (URGENT is 1.5 or 1.8), so it can't be
-- re-derived later; stored so reassign-file recomputes the price exactly.
ALTER TABLE print_jobs
ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS urgency_multiplier NUMERIC(4,2);

-- Seed pricing for the existing default shop so cost calc never hits NULL
INSERT INTO shop_pricing (shop_id, bw_price_per_page, color_price_per_page, duplex_discount_pct)
SELECT id, 2.00, 10.00, 0 FROM shops WHERE slug = 'default'
ON CONFLICT (shop_id) DO NOTHING;