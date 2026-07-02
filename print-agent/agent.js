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
import { print } from "pdf-to-printer";

const BACKEND_URL  = process.env.BACKEND_URL;   // e.g. http://your-vps-ip:5000
const AGENT_SECRET = process.env.AGENT_SECRET;  // must match backend .env
const PRINTER_NAME = process.env.PRINTER_NAME;  // Windows printer name, e.g. "EPSON L3000 Series"
const POLL_MS      = Number(process.env.POLL_MS) || 5000;

if (!BACKEND_URL || !AGENT_SECRET || !PRINTER_NAME) {
  console.error("❌  Missing required env vars: BACKEND_URL, AGENT_SECRET, PRINTER_NAME");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "x-agent-secret": AGENT_SECRET,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jobs the agent is already working on — prevents double-printing if the
// backend still shows them as PRINTING during a slow print cycle
const inProgress = new Set();

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

      // Build pdf-to-printer options from per-file settings
      const printOptions = {
        printer: PRINTER_NAME,
        copies:  file.copies  || 1,
        monochrome: !file.color,           // true = B&W
        duplex: file.double_sided
          ? "two-sided-long-edge"          // standard duplex
          : "one-sided",
        // orientation: file.orientation  (portrait/landscape) — pdf-to-printer
        // doesn't expose orientation directly; the PDF's own page size drives it.
        // paper_size is likewise handled by the PDF content.
      };

      console.log(`  🖨  Printing ${file.file_name} (copies: ${printOptions.copies}, color: ${file.color}, duplex: ${file.double_sided})`);
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
  console.log(`    Printer : ${PRINTER_NAME}`);
  console.log(`    Poll    : every ${POLL_MS / 1000}s`);

  while (true) {
    try {
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