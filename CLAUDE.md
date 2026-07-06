# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PrintFlow — a campus print-job management system with three independent Node.js apps:

- **`backend/`** — Express + PostgreSQL + Redis API, deployed via Docker.
- **`frontend/`** — React 19 + Vite SPA, deployed via Docker/nginx.
- **`print-agent/`** — standalone Node.js script that runs on the Windows PC physically connected to the printer (USB). It is not part of the Docker stack and is never deployed to the VPS.

## Commands

Backend (`cd backend`):
- `npm start` — runs `node index.js` (also boots `worker.js` as a side-effect import)
- No test suite, lint, or build step is configured for the backend.

Frontend (`cd frontend`):
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run lint` — ESLint over `**/*.{js,jsx}`
- `npm run preview` — preview a production build
- No test suite configured.

Print agent (`cd print-agent`):
- `npm start` — runs `node agent.js` (long-lived poll loop; requires `.env` with `BACKEND_URL`, `AGENT_TOKEN`, `PRINTER_NAME`)

Full stack via Docker:
- `docker-compose up --build` from the repo root, brings up `backend`, `frontend`, `postgres`, `redis`. Requires a root `.env` with `DB_*`, `JWT_SECRET`, `EMAIL_*`, `PRINTER_URI`, `PRINTER_MOCK`. (Agent auth is per-shop tokens in the `agent_tokens` table — no `AGENT_SECRET` env var.)

There is no automated test runner anywhere in this repo currently — verify changes by running the relevant app manually.

## Working conventions

- For any non-trivial change, outline all planned changes and wait for my approval
  BEFORE writing code. Don't jump straight to edits on multi-file or schema work.
- ALTER TABLE takes effect on the live DB immediately; only code changes require
  `docker-compose restart backend`.
- Prefer small, reviewable diffs. Don't refactor unrelated code in the same change.

## Guardrails

- The cloud backend cannot reach the LAN printer (NAT/firewall). This is a hard
  constraint, not a bug — never propose direct cloud→printer printing. The polling
  agent (or a future VPN/tunnel) is the only bridge.
- Server is the single source of truth for pricing. Never trust a client-sent
  amount; the authoritative cost is always computed in backend/utils/pricing.js.
- Keep agent auth (per-shop device tokens, x-agent-token header) and user auth
  (JWT) separate — never route /agent/* through `authenticate`.
- The print agent is never part of the Docker stack and never deployed to the VPS.

## Frontend styling

Design system (keep consistent): Sora (headings/UI) + DM Mono (mono/labels);
amber accent (--amber-lite / --amber-dark) on a dark-navy navbar; paper-tone
background #f8f6f1. Reusable classes: upload-zone, file-card, badge, btn btn-primary.
Build new UI from these tokens/components rather than one-off styles.

## Gotchas

- Vite bakes VITE_API_URL at BUILD time — it must be a Docker build arg (ARG/ENV in
  the frontend Dockerfile + build.args in compose), not just `environment:`.
  Otherwise local dev silently hits production.
- The worker dispatch loop can stall on a job stuck in PRINTING; print/IPP calls
  need timeouts (a Promise.race timeout is already in place) — preserve them.
- Email sends are fire-and-forget after res.json() and non-fatal by design — don't
  await them in the request path or fail the request on email errors.
- LEFT JOIN of print_jobs → job_files duplicates job rows; aggregate with
  JSON_AGG / ARRAY_AGG instead.
- JWT logout has no server-side blocklist; mitigation is short expiry + the axios
  401 interceptor. Don't assume tokens can be revoked server-side.


## Current focus

Phases 1–3 work end-to-end (agent currently prints via "Microsoft Print to PDF" as
a stand-in for the Epson L3000). Next: Phase 4 — Razorpay payments and a PDF.js
preview with page count + server-authoritative cost estimate. Planned larger work:
multi-tenant support with per-shop agent tokens, and packaging the agent as a
Windows installer. (Detailed roadmap lives outside this file.)

## Context

You're working on PrintFlow, a campus print-shop management web app I'm building.

STACK: PERN (PostgreSQL, Express, React/Vite, Node), Redis, Docker Compose on a
VPS behind Nginx. JWT auth, Nodemailer/SMTP, Multer uploads, bcrypt. A separate
Windows "print agent" (Node) uses pdf-to-printer / node-ipp.

ARCHITECTURE (this is the core constraint, do not fight it): cloud VPS backend +
a local Windows print agent installed on the shop's admin PC, wired to the printer
by USB. The VPS CANNOT initiate connections to the LAN printer (NAT/firewall), so
the agent POLLS the backend's /agent endpoints (~every 5s), downloads jobs, prints
locally, and reports status back. PRINTER_MOCK=true on the VPS. Right now the loop
works end-to-end using "Microsoft Print to PDF" as a stand-in for the real Epson L3000.

STATE: Phases 1–3 work end-to-end (auth/OTP, multi-file jobs, per-file settings,
queue, status workflow, admin dashboard, deadline picker, email notifications,
agent poll/download/report endpoints). Phase 4 (Razorpay payments, PDF.js preview
with page count + cost estimate) is NOT started.

DESIGN SYSTEM (exists but is applied poorly): Sora + DM Mono fonts, amber/navy
palette (--amber-lite / --amber-dark), paper tone #f8f6f1, dark-navy navbar with
amber accent, class names like upload-zone / file-card / badge / btn btn-primary.

MY WORKING STYLE: Outline ALL planned changes before writing any code, then wait
for my approval, THEN implement. No migrations framework — I run SQL directly via
psql and append changes to init.sql for reference. ALTER TABLE takes effect live;
only code changes need `docker-compose restart backend`.

## Architecture

### The core split: cloud backend vs. local print agent

The backend runs on a VPS/cloud and has **no access to the physical printer**. Printing happens on a separate Windows PC (`print-agent/agent.js`) connected via USB to the printer, using Windows Print Spooler through `pdf-to-printer`. The backend and agent talk over HTTP using a per-shop device-token header (`x-agent-token`, format `pfa_<id>.<secret>`, verified against the hashed `agent_tokens` table by `middleware/agentAuth.js`) instead of JWT — the agent is a background process, not a logged-in user. The verified token scopes every `/agent/*` query to that shop's jobs only.

Flow:
```
Browser client → uploads PDFs → backend (multer → uploads/, DB row PENDING/QUEUED)
backend/worker.js → dispatch loop → flips QUEUED job to PRINTING (priority/deadline/FIFO order)
print-agent → polls GET /agent/jobs/printing → downloads each file → sends to Print Spooler
print-agent → POST /agent/jobs/:id/complete → backend generates OTP, emails user, flips job to READY
print-agent → POST /agent/jobs/:id/fail → backend re-queues job (status back to QUEUED) on print failure
Customer → enters OTP → POST /print-jobs/:id/collect → job flips to COLLECTED
```
`backend/routes/agent.routes.js` and `backend/controllers/agent.controller.js` are intentionally separate from `printJobs.routes.js`/`printJobs.controller.js` because of this different auth mechanism — don't merge them.

### Job status state machine

`print_jobs.status` moves through: `PENDING → QUEUED → PRINTING → READY → COLLECTED`, with `PRINTING → QUEUED` as a failure-retry path. Valid transitions are enforced centrally in `updateJobStatus` (`backend/controllers/printJobs.controller.js`) via the `ALLOWED_STATUS_TRANSITIONS` map — any new transition needs to be added there, not just at the call site.

### Data model

- `users` — id, username, email, password_hash, role (`STUDENT`/`ADMIN`).
- `print_jobs` — one row per submitted job: status, priority, deadline, urgency_level, user_id. Per-file attributes (copies, color, double_sided, orientation, paper_size) were migrated out of this table.
- `job_files` — one row per uploaded PDF within a job, holding the per-file print settings and `file_path`/`file_name` on disk (under `backend/uploads/`).
- `urgency_usage` — one row per URGENT job submission, used purely for the abuse-protection rate limiting described below.

`backend/db/init.sql` is an append-only migration log (not a single idempotent schema) — new schema changes should be added as new `ALTER TABLE ... IF NOT EXISTS` statements at the end, matching the existing style, rather than editing earlier statements.

### Pricing and urgency

All pricing/rate logic lives in `backend/utils/pricing.js`, kept out of the controller on purpose. Three urgency levels (`NORMAL`, `SOON`, `URGENT`) apply a cost multiplier that also scales with current queue size (busier queue → higher URGENT multiplier, and URGENT is disabled entirely above a peak-load threshold). URGENT submissions are additionally rate-limited per user (max `URGENT_DAILY_LIMIT` per 24h, `URGENT_COOLDOWN_MS` cooldown between them) — tracked via inserts into `urgency_usage` and checked in `createPrintJob` (`backend/controllers/printJobs.controller.js`) before a job is created.

### Redis usage

Redis is used for two unrelated purposes, both keyed per-job or per-user:
- OTP storage: `job:<jobId>:otp`, 10-minute TTL, deleted on successful collection (one-time use).
- Active job tracking: `user:<userId>:activeJobs` is a Redis Set of job IDs, so a user can have multiple in-flight jobs at once; the frontend polls `GET /users/me/active-job` to know what to show as "in progress."

### Auth

JWT-based for browser clients (`backend/middleware/auth.js`): `authenticate` verifies the bearer token and attaches `req.user`; `requireAdmin` gates admin-only routes. The print agent uses the separate per-shop device-token scheme described above — never route agent traffic through `authenticate`.

### Frontend structure

Single-page app with no router — `App.jsx` holds a simple string-based `activeTab` state and conditionally renders tab content (`home`, `submit job`, `my jobs`, and admin-only `admin queue`/`admin users`). `AuthContext`/`useAuth` provide global user/session state (persisted to `localStorage` under `loggedPrintUser`) and expose `addActiveJob`/`removeActiveJob` to keep the active-jobs list in sync with backend state. `services/apiClient.js` is a shared axios instance — `setAuthToken()` is the single place that sets/clears the bearer token for all requests; don't set auth headers per-service.
