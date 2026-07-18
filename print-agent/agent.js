// print-agent/agent.js
// ─────────────────────────────────────────────────────────────────────────────
// PrintFlow Local Print Agent
// Runs on the Windows admin PC that has the Epson L3000 connected via USB.
//
// What it does (per poll cycle):
//   1. GET  /agent/jobs/printing        — fetch jobs the backend has dispatched
//   2. For each job → for each file:
//      a. GET  /agent/jobs/printing/:jobId/files/:fileId  — download the PDF
//      b. Send to Windows Print Spooler via `pdf-to-printer`
//   3. POST /agent/jobs/:jobId/complete — tell backend it's done (triggers OTP)
//      OR POST /agent/jobs/:jobId/fail  — re-queues on error
//
// Setup:
//   npm install                  (in this folder)
//   copy .env.example → .env     (fill in your values)
//   node agent.js
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import fetch from "node-fetch";
import fs from "fs";
import os from "os";
import path from "path";
import pkg from "pdf-to-printer";

const { print, getPrinters } = pkg;

const BACKEND_URL  = process.env.BACKEND_URL;   // e.g. http://your-vps-ip:5000
const AGENT_TOKEN  = process.env.AGENT_TOKEN;   // per-shop device token (pfa_...) issued via POST /shops/:shopId/agent-tokens
const PRINTER_NAME = process.env.PRINTER_NAME;  // LAST-RESORT fallback only — each file normally carries its routed printer's device_name
const POLL_MS      = Number(process.env.POLL_MS) || 5000;

if (!BACKEND_URL || !AGENT_TOKEN) {
  console.error("❌  Missing required env vars: BACKEND_URL, AGENT_TOKEN");
  process.exit(1);
}
if (!PRINTER_NAME) {
  console.warn("⚠  PRINTER_NAME not set — files without a routed device_name will fail instead of falling back");
}

const headers = {
  "Content-Type": "application/json",
  "x-agent-token": AGENT_TOKEN,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jobs the agent is already working on — prevents double-printing if the
// backend still shows them as PRINTING during a slow print cycle
const inProgress = new Set();

// ── printer discovery ─────────────────────────────────────────────────────────
// Enumerate the local spooler every Nth poll (~30s — getPrinters spawns
// PowerShell, too heavy for every 5s) and report to the backend so the admin
// dropdown offers real names instead of hand-typed ones. POST only when the
// set changed, plus a ~10-min heartbeat that keeps last_seen_at fresh
// (UIs treat > 30 min as stale). The hash lives in memory, so a restart
// always sends one startup report — that's intended.
const DISCOVERY_EVERY_N_POLLS = 6;
const DISCOVERY_HEARTBEAT_MS  = 10 * 60 * 1000;

let lastPrinterHash = null;
let lastReportAt    = 0;

async function reportPrinters() {
  let names;
  try {
    const list = await getPrinters();
    names = [...new Set(list.map((p) => p.name))].sort();
  } catch (err) {
    // Spooler hiccup — never let discovery disturb the print loop
    console.warn(`⚠  Printer enumeration failed (will retry): ${err.message}`);
    return;
  }

  const hash = names.join("\n");
  const heartbeatDue = Date.now() - lastReportAt > DISCOVERY_HEARTBEAT_MS;
  if (hash === lastPrinterHash && !heartbeatDue) return;

  try {
    const res = await fetch(`${BACKEND_URL}/agent/printers`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ printers: names }),
    });
    if (!res.ok) throw new Error(`POST /agent/printers → ${res.status}`);
    lastPrinterHash = hash;
    lastReportAt = Date.now();
    console.log(`🔎  Reported ${names.length} local printer(s) to backend`);
  } catch (err) {
    console.warn(`⚠  Printer report failed (will retry): ${err.message}`);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getPrintingJobs() {
  const res = await fetch(`${BACKEND_URL}/agent/jobs/printing`, { headers });
  if (!res.ok) throw new Error(`GET /agent/jobs/printing → ${res.status}`);
  const { jobs } = await res.json();
  return jobs || [];
}

async function downloadFile(jobId, fileId, destPath) {
  const res = await fetch(
    `${BACKEND_URL}/agent/jobs/printing/${jobId}/files/${fileId}`,
    { headers }
  );
  if (!res.ok) throw new Error(`File download → ${res.status}`);
  const buffer = await res.buffer();
  fs.writeFileSync(destPath, buffer);
}

async function reportComplete(jobId) {
  const res = await fetch(`${BACKEND_URL}/agent/jobs/${jobId}/complete`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`POST /agent/jobs/${jobId}/complete → ${res.status}`);
}

async function reportFail(jobId, reason) {
  await fetch(`${BACKEND_URL}/agent/jobs/${jobId}/fail`, {
    method:  "POST",
    headers,
    body:    JSON.stringify({ reason }),
  }).catch(() => {}); // best-effort — don't crash the agent loop
}

// ── print one job (all its files in sequence) ─────────────────────────────────

async function printJob(job) {
  const tmpFiles = [];

  try {
    for (const file of job.files) {
      // Download to a temp file
      const tmpPath = path.join(os.tmpdir(), `printflow-${file.file_id}.pdf`);
      tmpFiles.push(tmpPath);

      console.log(`  ⬇  Downloading ${file.file_name}…`);
      await downloadFile(job.id, file.file_id, tmpPath);

      // Each file is routed server-side to a specific printer and arrives with
      // that printer's Windows device_name. PRINTER_NAME is only a last-resort
      // fallback (e.g. legacy jobs dispatched before routing existed).
      const targetPrinter = file.device_name || PRINTER_NAME;
      if (!targetPrinter) {
        throw new Error(`No device_name for ${file.file_name} and no PRINTER_NAME fallback set`);
      }

      // Build pdf-to-printer options from per-file settings
      const printOptions = {
        printer: targetPrinter,
        copies:  file.copies  || 1,
        monochrome: !file.color,           // true = B&W
        duplex: file.double_sided
          ? "two-sided-long-edge"          // standard duplex
          : "one-sided",
        // orientation: file.orientation  (portrait/landscape) — pdf-to-printer
        // doesn't expose orientation directly; the PDF's own page size drives it.
        // paper_size is likewise handled by the PDF content.
      };

      console.log(`  🖨  Printing ${file.file_name} → "${targetPrinter}" (copies: ${printOptions.copies}, color: ${file.color}, duplex: ${file.double_sided})`);
      await print(tmpPath, printOptions);
    }

    await reportComplete(job.id);
    console.log(`✅  Job ${job.id} complete`);

  } catch (err) {
    console.error(`❌  Job ${job.id} failed:`, err.message);
    await reportFail(job.id, err.message);
  } finally {
    // Clean up temp files regardless of outcome
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
    inProgress.delete(job.id);
  }
}

// ── main poll loop ─────────────────────────────────────────────────────────────

async function run() {
  console.log(`🖨  PrintFlow agent started`);
  console.log(`    Backend : ${BACKEND_URL}`);
  console.log(`    Printer : per-file device_name from backend (fallback: ${PRINTER_NAME || "none"})`);
  console.log(`    Poll    : every ${POLL_MS / 1000}s`);

  let pollCount = 0;

  while (true) {
    try {
      // Discovery on startup (poll 0) and every Nth poll thereafter;
      // change-detection + heartbeat logic lives inside reportPrinters
      if (pollCount % DISCOVERY_EVERY_N_POLLS === 0) await reportPrinters();
      pollCount++;

      const jobs = await getPrintingJobs();

      for (const job of jobs) {
        if (inProgress.has(job.id)) continue; // already being handled

        if (!job.files || job.files.length === 0) {
          console.warn(`⚠  Job ${job.id} has no files — skipping`);
          await reportFail(job.id, "No files attached to job");
          continue;
        }

        inProgress.add(job.id);
        // Fire and forget — don't await so the loop keeps polling
        printJob(job);
      }

    } catch (err) {
      console.error("Poll error:", err.message);
    }

    await sleep(POLL_MS);
  }
}

run();