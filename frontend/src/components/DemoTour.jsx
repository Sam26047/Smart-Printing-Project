// frontend/src/components/DemoTour.jsx
// Coach-mark overlay for the guided demo tour. PASSIVE by design: it spotlights
// the real control for the current step and observes what the user does (DOM
// state) or what the pipeline does (job state via getJobById polling) — it
// never clicks, navigates, or mutates app state.
//
// Mask = four fixed rectangles around the target's box, so the spotlighted
// control has NO element over it (stays fully clickable) while everything
// else is dimmed and click-blocked. Progress lives in React state only —
// no localStorage/sessionStorage; a reload simply means restarting the tour.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import printJobService from "../services/printJobs";
import apiClient from "../services/apiClient";
import { useAuth } from "../hooks/useAuth";
import { TOUR_UI_STEPS, DEMO_CREDENTIALS, DEMO_TEST_PAYMENT } from "../content/tourSteps";

const TICK_MS = 500;       // DOM observation cadence
const JOB_POLL_MS = 3000;  // job-state observation cadence
const STALE_MS = 90000;    // show "skip ahead" escape on observing steps
const PAD = 6;             // spotlight padding around the target

const SUBMIT_STEP_INDEX = TOUR_UI_STEPS.findIndex((s) => s.id === "submit");

// ── credentials block (step 1) ────────────────────────────────────────────────
function CredentialsBlock({ user }) {
  const isDemo = user?.username === DEMO_CREDENTIALS.customer.username;
  if (isDemo) {
    return (
      <div className="tour-tip-action" style={{ color: "var(--teal-dark)", background: "var(--teal-lite)" }}>
        ✓ you're signed in as {DEMO_CREDENTIALS.customer.username} — perfect
      </div>
    );
  }
  return (
    <div className="tour-tip-action">
      best experienced as {DEMO_CREDENTIALS.customer.username} / {DEMO_CREDENTIALS.customer.password} —
      log out, sign in as the demo customer, then restart the tour from the home tab
      (progress isn't stored, and that's fine).
    </div>
  );
}

// ── payment values block (step 7) ─────────────────────────────────────────────
function PaymentBlock({ copied, onCopy }) {
  return (
    <div className="tour-pay-box">
      <div className="tour-pay-row">
        <span>card</span>
        <b>{DEMO_TEST_PAYMENT.card_number}</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy}>
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <div className="tour-pay-row"><span>expiry</span><b>{DEMO_TEST_PAYMENT.expiry}</b></div>
      <div className="tour-pay-row"><span>cvv</span><b>{DEMO_TEST_PAYMENT.cvv}</b></div>
      <div className="tour-pay-row"><span>phone</span><b>{DEMO_TEST_PAYMENT.phone}</b></div>
      <div className="tour-pay-note">🏦 {DEMO_TEST_PAYMENT.mock_bank_note}</div>
    </div>
  );
}

export default function DemoTour({ active, onExit }) {
  const { user } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);        // spotlight target box (viewport coords)
  const [jobId, setJobId] = useState(null);      // learned from data-tour-job-id
  const [job, setJob] = useState(null);          // latest polled job state
  const [stale, setStale] = useState(false);     // observing step stuck > 90s
  const [copied, setCopied] = useState(false);
  const [outputs, setOutputs] = useState(null);  // [{ file_name, url }]
  const [outputLoading, setOutputLoading] = useState(false);
  const [outputErr, setOutputErr] = useState(null);

  const jobRef = useRef(null);
  const rectRef = useRef(null);
  const enteredAtRef = useRef(Date.now());
  const outputsRef = useRef(null);
  // A success card from an EARLIER submission may still be mounted when the
  // tour (re)reaches the submit step — record what's already there so only a
  // CHANGED data-tour-job-id counts as "the user just submitted".
  const baselineJobIdRef = useRef(null);

  const step = TOUR_UI_STEPS[stepIndex];

  // ── reset everything when the tour is (re)started or closed ───────────────
  useEffect(() => {
    if (active) {
      setStepIndex(0);
      setJobId(null);
      setJob(null);
      jobRef.current = null;
      enteredAtRef.current = Date.now();
      setStale(false);
      setOutputs(null);
      setOutputErr(null);
    } else if (outputsRef.current) {
      outputsRef.current.forEach((o) => URL.revokeObjectURL(o.url));
      outputsRef.current = null;
      setOutputs(null);
    }
  }, [active]);
  useEffect(() => { outputsRef.current = outputs; }, [outputs]);
  useEffect(() => () => {
    (outputsRef.current || []).forEach((o) => URL.revokeObjectURL(o.url));
  }, []);

  const goTo = (index) => {
    if (index >= TOUR_UI_STEPS.length) { onExit(); return; }
    if (index === SUBMIT_STEP_INDEX) {
      baselineJobIdRef.current =
        document.querySelector("[data-tour-job-id]")?.getAttribute("data-tour-job-id") || null;
    }
    setStepIndex(Math.max(0, index));
    enteredAtRef.current = Date.now();
    setStale(false);
    // bring the new target into view once it's measured
    setTimeout(() => {
      const next = TOUR_UI_STEPS[Math.max(0, index)];
      const el = resolveTarget(next, jobId);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 350);
  };

  function resolveTarget(s, jid) {
    if (!s?.target) return null;
    if (s.target === "job-card") {
      return jid ? document.querySelector(`[data-tour-job-card="${jid}"]`) : null;
    }
    return document.querySelector(`[data-tour="${s.target}"]`);
  }

  // ── observation tick: measure target, learn job id, skip/advance ──────────
  useEffect(() => {
    if (!active) return;

    const tick = () => {
      const s = TOUR_UI_STEPS[stepIndex];
      // newJobId is set only when the success card's job id DIFFERS from the
      // baseline recorded on entering the submit step (i.e. a fresh submission)
      const attrJobId =
        document.querySelector("[data-tour-job-id]")?.getAttribute("data-tour-job-id") || null;
      const newJobId = attrJobId && attrJobId !== baselineJobIdRef.current ? attrJobId : null;
      const ctx = { doc: document, job: jobRef.current, newJobId };

      // 1. measure the spotlight target (null → full dim + centered tooltip)
      const el = resolveTarget(s, jobId);
      if (el) {
        const r = el.getBoundingClientRect();
        const next = {
          top: Math.round(r.top), left: Math.round(r.left),
          width: Math.round(r.width), height: Math.round(r.height),
        };
        const prev = rectRef.current;
        if (!prev || prev.top !== next.top || prev.left !== next.left ||
            prev.width !== next.width || prev.height !== next.height) {
          rectRef.current = next;
          setRect(next);
        }
      } else if (rectRef.current !== null) {
        rectRef.current = null;
        setRect(null);
      }

      // 2. learn the submitted job's id — only a FRESH submission counts
      if (!jobId && stepIndex >= SUBMIT_STEP_INDEX && newJobId) {
        setJobId(newJobId);
        console.log(`[tour] tracking job ${newJobId}`);
      }

      // 3. auto-skip (e.g. single-shop: no selector will ever mount)
      if (s.skipIf?.(ctx)) { goTo(stepIndex + 1); return; }

      // 4. passive advance — recognize what the user / pipeline did
      if (s.advance?.type !== "manual" && s.advance?.when?.(ctx)) {
        const dwell = s.minDwellMs || 0;
        if (Date.now() - enteredAtRef.current >= dwell) { goTo(stepIndex + 1); return; }
      }

      // 5. stuck-escape for observing steps
      if (s.advance?.type !== "manual" && Date.now() - enteredAtRef.current > STALE_MS) {
        setStale(true);
      }
    };

    tick();
    const interval = setInterval(tick, TICK_MS);
    const onMove = () => tick();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, jobId]);

  // ── job-state observation (drives the async steps; logs transitions) ──────
  useEffect(() => {
    if (!active || !jobId) return;
    let last = null;
    let cancelled = false; // an in-flight response landing after cleanup must
                           // NOT write a previous run's job into the new run
    const poll = async () => {
      try {
        const res = await printJobService.getJobById(jobId);
        if (cancelled) return;
        const j = res.data;
        if (j.status !== last) {
          console.log(`[tour] job ${jobId.slice(0, 8)} status: ${last || "—"} → ${j.status} (payment: ${j.payment_status})`);
          last = j.status;
        }
        jobRef.current = j;
        setJob(j);
      } catch {
        // transient — keep polling; the stuck-escape covers a dead end
      }
    };
    poll();
    const interval = setInterval(poll, JOB_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active, jobId]);

  // ── payoff: fetch the stamped output(s) as authed blobs ───────────────────
  useEffect(() => {
    if (!active || !step?.payoff || !jobId || outputs || outputLoading) return;
    const printedFiles = (job?.files || []).filter((f) => f.printed_ready);
    if (printedFiles.length === 0) return;

    setOutputLoading(true);
    Promise.all(
      printedFiles.map(async (f) => {
        // apiClient carries the JWT — a plain window.open would be rejected
        const res = await apiClient.get(
          `/print-jobs/${jobId}/files/${f.file_id}/output`,
          { responseType: "blob" }
        );
        const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
        return { file_name: f.file_name, url };
      })
    )
      .then(setOutputs)
      .catch(() => setOutputErr("Couldn't load the stamped output — it's still downloadable from the shop."))
      .finally(() => setOutputLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, job, jobId]);

  if (!active) return null;

  // ── geometry ───────────────────────────────────────────────────────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  const tipWidth = Math.min(step.payoff ? 560 : 340, vw - 24);
  const estHeight = step.payoff ? 500 : step.payment ? 380 : 240;
  let tipStyle;
  if (hole) {
    const below = hole.top + hole.height + 14;
    const top = below + estHeight < vh ? below : Math.max(12, hole.top - estHeight - 14);
    const left = Math.min(Math.max(12, hole.left), vw - tipWidth - 12);
    tipStyle = { top, left, width: tipWidth };
  } else {
    tipStyle = { top: Math.max(24, vh / 2 - estHeight / 2), left: vw / 2 - tipWidth / 2, width: tipWidth };
  }

  const isObserving = step.advance?.type !== "manual";
  const bodyText = step.dynamicBody ? step.dynamicBody(job) : step.body;

  // hide Back when the previous step's condition is already satisfied — it
  // would just bounce straight forward again on the next tick
  const prev = stepIndex > 0 ? TOUR_UI_STEPS[stepIndex - 1] : null;
  const backWouldBounce =
    prev && prev.advance?.type !== "manual" &&
    (prev.advance?.when?.({ doc: document, job: jobRef.current }) || prev.skipIf?.({ doc: document, job: jobRef.current }));
  const showBack = stepIndex > 0 && !backWouldBounce;

  const copyCard = () => {
    const digits = DEMO_TEST_PAYMENT.card_number.replaceAll(" ", "");
    navigator.clipboard?.writeText(digits)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {}); // clipboard unavailable — values are visible anyway
  };

  return createPortal(
    <>
      {/* dimming mask — four rects around the hole keep the target clickable */}
      {hole ? (
        <>
          <div className="tour-mask" style={{ top: 0, left: 0, width: vw, height: hole.top }} />
          <div className="tour-mask" style={{ top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) }} />
          <div className="tour-mask" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
          <div className="tour-mask" style={{ top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height }} />
          <div className="tour-ring" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
        </>
      ) : (
        <div className="tour-mask" style={{ top: 0, left: 0, width: vw, height: vh }} />
      )}

      {/* tooltip / callout */}
      <div className={`tour-tip${step.payoff ? " payoff" : ""}`} style={tipStyle}>
        <div className="tour-tip-counter">demo tour · step {stepIndex + 1} / {TOUR_UI_STEPS.length}</div>
        <div className="tour-tip-title">{step.title}</div>
        <div className="tour-tip-body">{bodyText}</div>

        {step.credentials && <CredentialsBlock user={user} />}
        {step.payment && <PaymentBlock copied={copied} onCopy={copyCard} />}

        {/* target not mounted yet → explain instead of crashing */}
        {step.target && !rect && (
          <div className="tour-tip-action">
            {step.waitingHint || "waiting for this control to appear — follow the instruction above"}
          </div>
        )}
        {step.action && <div className="tour-tip-action">→ {step.action}</div>}

        {/* payoff: the stamped output, fetched with the JWT and embedded */}
        {step.payoff && (
          <div>
            {outputLoading && <p className="loading-text">loading the stamped output…</p>}
            {outputErr && <div className="alert alert-error">{outputErr}</div>}
            {outputs && outputs.length > 0 && (
              <>
                <iframe className="tour-payoff-frame" title="printed output" src={outputs[0].url} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {outputs.map((o) => (
                    <button
                      key={o.url}
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => window.open(o.url, "_blank")}
                    >
                      open {o.file_name} ↗
                    </button>
                  ))}
                </div>
              </>
            )}
            {step.closing && (
              <div className="mono-sm" style={{ color: "var(--gray)", lineHeight: 1.6, marginBottom: 10 }}>
                {step.closing}
              </div>
            )}
          </div>
        )}

        <div className="tour-tip-actions">
          <button type="button" className="tour-tip-skip" onClick={onExit}>skip tour</button>
          {showBack && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(stepIndex - 1)}>
              ← back
            </button>
          )}
          {isObserving ? (
            <div className="tour-wait">
              <span className="tour-wait-dot" />
              {step.waitingLabel || "waiting…"}
              {stale && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(stepIndex + 1)}>
                  skip ahead →
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => goTo(stepIndex + 1)}>
              {step.advance?.finish ? "finish tour ✓" : "next →"}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
