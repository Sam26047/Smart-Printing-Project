// backend/virtualAgent.js
// Demo virtual-printer worker. Fulfills the demo VIRTUAL shop's jobs by
// behaving exactly like a physical print agent: it authenticates with a
// normal per-shop agent token (DEMO_AGENT_TOKEN) and talks to the backend
// OVER HTTP through the same /agent endpoints — never into the DB behind the
// pipeline's back. The token's shop scoping is the only thing that limits it
// to demo jobs; no code anywhere special-cases fulfillment='VIRTUAL'.
//
// Per poll cycle (mirrors print-agent/agent.js):
//   1. GET  /agent/jobs/printing
//   2. per file: download PDF → stamp "PRINTED ✓" overlay (pdf-lib)
//              → POST /agent/jobs/:id/files/:fileId/output (stores artifact)
//   3. POST /agent/jobs/:id/complete
//
// Idempotency (the agent protocol has no lease/claim — PRINTING jobs stay in
// every poll until completed):
//   • in-memory inProgress set guards overlapping polls in-process
//   • files with printed_file_path already set are skipped (crash-safe:
//     a restart between stamp and complete never double-stamps)
//   • output upload is overwrite-safe (same path per file)
//   • a 400 from /complete means another completer won — logged, not fatal

import config from "./config/config.js";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const TOKEN          = process.env.DEMO_AGENT_TOKEN;
const BASE_URL       = process.env.DEMO_AGENT_URL || `http://localhost:${config.port}`;
const POLL_MS        = Number(process.env.DEMO_POLL_MS) || 5000;
const PRINT_DELAY_MS = Number(process.env.DEMO_PRINT_DELAY_MS) || 6000;

const headers = { "x-agent-token": TOKEN };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jobs currently being processed by THIS process (overlapping-poll guard)
const inProgress = new Set();

// ── stamp: "PRINTED ✓ — timestamp" overlay on every page ─────────────────────
// The ✓ is drawn as two vector lines: pdf-lib's standard fonts are WinAnsi-
// encoded and cannot encode U+2713, and embedding a unicode font would need a
// new dependency (@pdf-lib/fontkit) — not allowed here.
//
// ROTATION-AWARE: pdf-lib draws in the page's UNROTATED coordinate space, but
// pages may carry /Rotate — set by the landscape feature at submission OR
// already present in the source PDF. The compensation below derives purely
// from page.getRotation() (never from what our own code applied), laying the
// stamp out in VISUAL space and mapping back, so it reads at the same angle
// and position on any page.

// Map a point from VISUAL space (what the viewer sees; origin bottom-left of
// the displayed page) back to PDF user space, for a page displayed rotated
// clockwise by R degrees. w/h are the unrotated MediaBox dimensions.
function toPdfSpace(vx, vy, R, w, h) {
  switch (R) {
    case 90:  return { x: w - vy, y: vx };
    case 180: return { x: w - vx, y: h - vy };
    case 270: return { x: vy, y: h - vx };
    default:  return { x: vx, y: vy };
  }
}

async function stampPdf(bytes) {
  const doc  = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const stampText = `PRINTED  —  ${new Date().toISOString()}  —  PrintFlow demo`;
  const amber = rgb(0.71, 0.33, 0.04); // --amber-dark

  for (const page of doc.getPages()) {
    const { width: w, height: h } = page.getSize(); // MediaBox (unrotated)
    const R = ((page.getRotation().angle % 360) + 360) % 360;
    const sideways = R === 90 || R === 270;
    const vw = sideways ? h : w; // visual dimensions
    const vh = sideways ? w : h;

    const size = Math.max(14, Math.min(22, vw / 30));
    const textWidth = font.widthOfTextAtSize(stampText, size);

    // Content drawn at PDF-space angle θ appears at θ − R after the viewer's
    // clockwise rotation — so to APPEAR at 30°, draw at 30 + R.
    const drawAngle = 30 + R;

    // Diagonal watermark, anchored at the visual centre-left of the page
    const anchor = toPdfSpace(vw / 2 - textWidth / 2, vh / 2, R, w, h);
    page.drawText(stampText, {
      x: anchor.x,
      y: anchor.y,
      size,
      font,
      color: amber,
      opacity: 0.45,
      rotate: degrees(drawAngle),
    });

    // The ✓, drawn as vectors just left of the text baseline — endpoints laid
    // out in visual space, then mapped through the same transform
    const cx = vw / 2 - textWidth / 2 - 26;
    const cy = vh / 2 - 4;
    const tick = { thickness: 3, color: amber, opacity: 0.45 };
    page.drawLine({
      start: toPdfSpace(cx, cy + 6, R, w, h),
      end:   toPdfSpace(cx + 6, cy, R, w, h),
      ...tick,
    });
    page.drawLine({
      start: toPdfSpace(cx + 6, cy, R, w, h),
      end:   toPdfSpace(cx + 16, cy + 14, R, w, h),
      ...tick,
    });
  }

  return Buffer.from(await doc.save());
}

// ── process one job (all files, then report complete) ────────────────────────
async function processJob(job) {
  try {
    // Simulated printing time so a viewer actually sees the PRINTING state
    await sleep(PRINT_DELAY_MS);

    for (const file of job.files) {
      if (file.printed_file_path) {
        console.log(`🤖  [virtual] ${file.file_name} already stamped — skipping (idempotent)`);
        continue;
      }

      const dl = await fetch(
        `${BASE_URL}/agent/jobs/printing/${job.id}/files/${file.file_id}`,
        { headers }
      );
      if (!dl.ok) throw new Error(`file download → ${dl.status}`);
      const bytes = Buffer.from(await dl.arrayBuffer());

      console.log(`🤖  [virtual] stamping ${file.file_name}…`);
      const stamped = await stampPdf(bytes);

      const up = await fetch(
        `${BASE_URL}/agent/jobs/${job.id}/files/${file.file_id}/output`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/pdf" },
          body: stamped,
        }
      );
      if (!up.ok) throw new Error(`output upload → ${up.status}`);
    }

    const done = await fetch(`${BASE_URL}/agent/jobs/${job.id}/complete`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });

    if (done.ok) {
      console.log(`🤖  [virtual] job ${job.id} printed + completed ✓`);
    } else if (done.status === 400) {
      // Job left PRINTING between our poll and this call — someone else
      // completed/failed it. Idempotent no-op, nothing to undo.
      console.log(`🤖  [virtual] job ${job.id} already completed elsewhere — ok`);
    } else {
      throw new Error(`complete → ${done.status}`);
    }
  } catch (err) {
    console.error(`🤖  [virtual] job ${job.id} failed: ${err.message} — reporting fail (re-queues)`);
    await fetch(`${BASE_URL}/agent/jobs/${job.id}/fail`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: `virtual worker: ${err.message}` }),
    }).catch(() => {}); // best-effort, like the real agent
  } finally {
    inProgress.delete(job.id);
  }
}

// ── printer discovery ─────────────────────────────────────────────────────────
// The virtual worker reports its "hardware" like any real agent would — same
// endpoint, same token auth — so the demo shop's dropdown behaves truthfully.
// These names are this worker's device names (the seeded demo printers).
const VIRTUAL_DEVICE_NAMES = ["VIRTUAL-BW", "VIRTUAL-COLOR"];
let printersReported = false;

async function reportVirtualPrinters() {
  const res = await fetch(`${BASE_URL}/agent/printers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ printers: VIRTUAL_DEVICE_NAMES }),
  });
  if (!res.ok) throw new Error(`report printers → ${res.status}`);
  printersReported = true;
  console.log(`🤖  [virtual] reported ${VIRTUAL_DEVICE_NAMES.length} virtual printers`);
}

// ── main poll loop ────────────────────────────────────────────────────────────
async function run() {
  console.log(`🤖  Demo virtual-printer worker started (poll ${POLL_MS / 1000}s, print delay ${PRINT_DELAY_MS / 1000}s)`);

  while (true) {
    try {
      // once per process lifetime, retried until the server is up
      if (!printersReported) await reportVirtualPrinters();

      const res = await fetch(`${BASE_URL}/agent/jobs/printing`, { headers });
      if (res.ok) {
        const { jobs } = await res.json();
        for (const job of jobs || []) {
          if (inProgress.has(job.id)) continue;
          if (!job.files || job.files.length === 0) continue;
          inProgress.add(job.id);
          processJob(job); // fire and forget — keep polling
        }
      } else if (res.status === 401) {
        console.error("🤖  [virtual] agent token rejected (revoked?) — check DEMO_AGENT_TOKEN");
      }
    } catch (err) {
      // Server not up yet (boot race) or transient — retry next cycle
      console.error("🤖  [virtual] poll error:", err.message);
    }
    await sleep(POLL_MS);
  }
}

run();
