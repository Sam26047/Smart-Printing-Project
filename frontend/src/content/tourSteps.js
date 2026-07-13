// frontend/src/content/tourSteps.js
// UI step sequence for the guided demo tour. Narrative text comes from
// demoTour.js (the content source — untouched); this file adds the per-step
// wiring: which real control to spotlight (data-tour value), the short action
// line, and how the step advances. The tour is PASSIVE — "advance" conditions
// only OBSERVE the DOM or the real job state, they never drive the app.
//
// advance shapes:
//   { type: "manual" }                — user clicks next
//   { type: "dom",  when: (ctx) => bool }  — ctx.doc is document
//   { type: "job",  when: (ctx) => bool }  — ctx.job is the latest polled job
// Optional per step: skipIf(ctx), minDwellMs, waitingLabel, dynamicBody(job),
// payment (renders DEMO_TEST_PAYMENT), payoff (renders the stamped output).

import { DEMO_CREDENTIALS, DEMO_TEST_PAYMENT, DEMO_TOUR_STEPS } from "./demoTour";

const content = Object.fromEntries(DEMO_TOUR_STEPS.map((s) => [s.id, s]));

export { DEMO_CREDENTIALS, DEMO_TEST_PAYMENT };

// UploadForm exposes how many shops loaded via data-tour-shop-count — this is
// how step 3 distinguishes "selector hidden because single shop" (skip) from
// "shops still loading" (wait), so the race can't deadlock or mis-skip.
function shopCount(ctx) {
  const el = ctx.doc.querySelector("[data-tour-shop-count]");
  return el ? Number(el.getAttribute("data-tour-shop-count")) : null;
}

const tabActive = (ctx, tourId) =>
  ctx.doc.querySelector(`[data-tour="${tourId}"]`)?.classList.contains("active") || false;

export const TOUR_UI_STEPS = [
  {
    id: "welcome",
    target: null,
    title: "The PrintFlow demo tour",
    body: "This walks you through the full loop — submit a job, pay in test mode, and watch a virtual printer do the work. You perform every action; the tour just points at the right control and watches real state.",
    credentials: true, // component renders the DEMO_CREDENTIALS check/hint
    advance: { type: "manual" },
  },
  {
    id: "open-submit",
    target: "tab-submit-job",
    title: "Open the submit tab",
    body: "Everything starts with a print job.",
    action: "Click the “submit job” tab.",
    advance: { type: "dom", when: (ctx) => tabActive(ctx, "tab-submit-job") },
  },
  {
    id: "pick-shop",
    target: "shop-select",
    title: "Choose the demo shop",
    body: "Pricing, queue and printers are per shop. The demo shop's printers are virtual — that's what lets you watch the job “print” online.",
    action: "Select “PrintFlow Demo Shop”.",
    waitingHint: "loading shops…",
    // Single-shop deployments hide the selector entirely — skip, don't strand
    skipIf: (ctx) => shopCount(ctx) === 1,
    advance: {
      type: "dom",
      when: (ctx) => {
        const sel = ctx.doc.querySelector('[data-tour="shop-select"]');
        return !!sel && sel.selectedIndex > 0 &&
          sel.options[sel.selectedIndex].textContent.includes("Demo");
      },
    },
  },
  {
    id: "upload",
    target: "upload-zone",
    title: "Upload a PDF",
    body: "Any PDF works. Try two files — one B&W, one colour — and they'll route to different virtual printers.",
    action: "Drop a PDF here, or click to browse.",
    advance: { type: "dom", when: (ctx) => !!ctx.doc.querySelector(".file-card") },
  },
  {
    id: "settings",
    target: "file-card",
    title: "Per-file settings + live estimate",
    body: "Each file has its own copies / colour / duplex options. The estimate below is computed server-side with the demo shop's per-page rates — change a setting and watch it update (real page counts are confirmed at submission).",
    advance: { type: "manual" },
  },
  {
    id: "submit",
    target: "submit-btn",
    title: "Submit the job",
    body: "The server counts the real PDF pages and locks the final price at submission — that locked total is what you'll pay.",
    action: "Click “submit job →”.",
    // ctx.newJobId is set by the engine only when a FRESH submission's card
    // appears (a stale card from an earlier run doesn't count)
    advance: { type: "dom", when: (ctx) => !!ctx.newJobId },
  },
  {
    id: "pay",
    target: "pay-btn",
    title: content.pay.title,
    body: "This opens the REAL Razorpay checkout in test mode — no money moves. The bank window will cover this panel, so keep these values handy (copy the card first):",
    payment: true,
    action: "Click “pay →”, enter the values above, then click Success on the mock bank page.",
    waitingLabel: "waiting for the payment webhook…",
    advance: {
      type: "job",
      when: (ctx) => !!ctx.job && (ctx.job.payment_status === "PAID" || ctx.job.status !== "PENDING"),
    },
  },
  {
    id: "confirming",
    target: "locked-total",
    title: content.confirm.title,
    body: content.confirm.body,
    minDwellMs: 2500, // let the "webhook confirmed it" moment actually register
    advance: { type: "job", when: (ctx) => !!ctx.job && ctx.job.status !== "PENDING" },
  },
  {
    id: "open-myjobs",
    target: "tab-my-jobs",
    title: "Watch it print",
    body: content.printing.body,
    action: "Click the “my jobs” tab.",
    advance: { type: "dom", when: (ctx) => tabActive(ctx, "tab-my-jobs") },
  },
  {
    id: "watch-print",
    target: "job-card", // resolved via data-tour-job-card={jobId}
    title: content.printing.title,
    dynamicBody: (job) => {
      if (!job) return "watching the job…";
      switch (job.status) {
        case "QUEUED":
          return "Paid ✓ and queued. The dispatcher is binding each file to an eligible virtual printer…";
        case "PRINTING":
          return "Printing — the virtual printer takes a few seconds, like a real one. It's stamping your PDF right now.";
        case "WAITING_FOR_PRINTER":
          return "⚠ No eligible printer is ONLINE, so the job is parked — this is the real routing engine talking, not an error in the tour. A shop admin bringing a printer online re-queues it automatically. Wait here, or skip ahead.";
        case "READY":
        case "COLLECTED":
          return "Done — the job is READY.";
        default:
          return `status: ${job.status}`;
      }
    },
    waitingLabel: "following the job in real time…",
    advance: {
      type: "job",
      when: (ctx) => !!ctx.job && (ctx.job.status === "READY" || ctx.job.status === "COLLECTED"),
    },
  },
  {
    id: "output",
    target: "job-card",
    title: content.output.title,
    body: content.output.body,
    payoff: true, // component fetches + embeds the stamped PDF
    closing: content.shopside.body,
    advance: { type: "manual", finish: true },
  },
];
