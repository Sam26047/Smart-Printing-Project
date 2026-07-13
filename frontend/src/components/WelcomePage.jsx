// frontend/src/components/WelcomePage.jsx
// Landing screen shown to all users before they interact with the system.
// "Get Started" calls onGetStarted() which App.jsx wires to switch to the Submit tab.
// "Take the guided demo tour" starts the coach-mark walkthrough (DemoTour).

import { useAuth } from "../hooks/useAuth";
import { DEMO_CREDENTIALS } from "../content/demoTour";

function WelcomePage({ onGetStarted, onStartTour }) {
  const { user } = useAuth();
  const isDemoCustomer = user?.username === DEMO_CREDENTIALS.customer.username;

  return (
    <div>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", padding: "48px 0 40px", borderBottom: "1px solid var(--border)", marginBottom: "36px" }}>
        <div style={{
          width: "56px", height: "56px",
          background: "var(--ink)", borderRadius: "14px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--mono)", fontSize: "22px", color: "var(--amber)",
          margin: "0 auto 20px",
        }}>
          P/
        </div>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 600, marginBottom: "10px" }}>
          Smart Print Queue
        </h1>
        <p style={{ fontFamily: "var(--mono)", fontSize: "13px", color: "var(--gray)", maxWidth: "480px", margin: "0 auto 28px", lineHeight: "1.7" }}>
          Upload your documents, pick a priority, and collect your prints — no waiting in line, no guessing when they'll be ready.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={onGetStarted}>
            Get Started →
          </button>
          {onStartTour && (
            <button className="btn btn-outline" data-tour="start-tour" onClick={onStartTour}>
              🎬 take the guided demo tour
            </button>
          )}
        </div>
        {onStartTour && (
          <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--gray)", marginTop: "12px" }}>
            {isDemoCustomer
              ? "you're signed in as demo_customer — perfect for the tour"
              : `tour works best as ${DEMO_CREDENTIALS.customer.username} / ${DEMO_CREDENTIALS.customer.password}`}
          </div>
        )}
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div className="section-header">
        <div className="section-title">How it works</div>
        <div className="section-sub">four steps from upload to collection</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px", marginBottom: "36px" }}>
        {STEPS.map((step) => (
          <div key={step.num} className="card card-padded" style={{ textAlign: "center" }}>
            <div style={{
              width: "26px", height: "26px", borderRadius: "50%",
              background: "var(--amber)", color: "var(--ink)",
              fontFamily: "var(--mono)", fontSize: "12px", fontWeight: 500,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 10px",
            }}>
              {step.num}
            </div>
            <div style={{ fontSize: "22px", marginBottom: "8px" }}>{step.icon}</div>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "5px" }}>{step.title}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--gray)", lineHeight: "1.6" }}>{step.desc}</div>
          </div>
        ))}
      </div>

      {/* ── Priority levels ──────────────────────────────────────────────── */}
      <div className="section-header">
        <div className="section-title">Priority levels</div>
        <div className="section-sub">choose how fast you need your prints — price adjusts automatically</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px", marginBottom: "36px" }}>
        {PRIORITY_LEVELS.map((level) => (
          <div key={level.label} className="card card-padded" style={{ borderLeft: `3px solid ${level.color}` }}>
            <div style={{ fontSize: "22px", marginBottom: "8px" }}>{level.emoji}</div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: level.color, marginBottom: "3px" }}>{level.label}</div>
            <div className="mono-sm" style={{ marginBottom: "4px" }}>{level.time}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "12px", fontWeight: 500, color: "var(--amber-dark)", marginBottom: "8px" }}>{level.price}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--gray)", lineHeight: "1.6" }}>{level.desc}</div>
          </div>
        ))}
      </div>

      {/* ── Pricing table ────────────────────────────────────────────────── */}
      <div className="section-header">
        <div className="section-title">Transparent pricing</div>
        <div className="section-sub">you'll always see the exact cost before confirming</div>
      </div>

      {/* Rates are per shop now — no hardcoded numbers here. The submit form
          shows the selected shop's exact per-page rates via the live estimate. */}
      <div className="card card-padded" style={{ marginBottom: "12px" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: "12px", color: "var(--gray-dark)", lineHeight: "1.7" }}>
          Each print shop sets its own B&amp;W and colour per-page rates (plus an
          optional duplex discount). When you submit, the live estimate shows the
          selected shop's exact prices — and the final total is locked, server-side,
          before you pay.
        </div>
      </div>

      <div className="deadline-warn" style={{ marginBottom: "36px" }}>
        <span>💡</span>
        <span>Urgent pricing increases automatically when the queue is busy — you'll always see the exact cost before confirming your job.</span>
      </div>

      {/* ── Fair use ─────────────────────────────────────────────────────── */}
      <div className="section-header">
        <div className="section-title">Fair use policy</div>
        <div className="section-sub">keeps the queue fair for everyone</div>
      </div>

      <div className="card card-padded" style={{ marginBottom: "40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
          {FAIR_USE.map((item) => (
            <div key={item.text} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>{item.icon}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: "12px", color: "var(--gray-dark)", lineHeight: "1.6" }}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", paddingBottom: "12px" }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: "13px", color: "var(--gray)", marginBottom: "14px" }}>
          ready to print?
        </div>
        <button className="btn btn-primary" onClick={onGetStarted}>
          Submit a job →
        </button>
      </div>

    </div>
  );
}

// ─── Content data ─────────────────────────────────────────────────────────────

const STEPS = [
  { num: "1", icon: "📄", title: "Upload your PDFs",   desc: "Select one or more files and set per-file options: copies, colour, and single- or double-sided." },
  { num: "2", icon: "⚡", title: "Choose a priority",  desc: "Normal, Soon, or Urgent — your spot in the queue and your price depend on this." },
  { num: "3", icon: "👀", title: "See your position",  desc: "Know exactly where you are in the queue and the cost before you confirm." },
  { num: "4", icon: "📬", title: "Collect with OTP",   desc: "When ready you get an email with a one-time code. Show it at the counter to collect." },
];

const PRIORITY_LEVELS = [
  { emoji: "🟢", label: "Normal", time: "Standard queue",  price: "No extra charge",        desc: "Best for non-urgent work. Served in order.",                                  color: "var(--teal)" },
  { emoji: "🟡", label: "Soon",   time: "2 – 4 hours",     price: "+20% on base cost",      desc: "Moves you ahead of Normal jobs. Good for same-day deadlines.",                color: "var(--amber-dark)" },
  { emoji: "🔴", label: "Urgent", time: "30 – 60 minutes", price: "+50% to +80% (by load)", desc: "Highest priority. Max 2 per day, 1-hour cooldown between submissions.",        color: "var(--rose)" },
];

const FAIR_USE = [
  { icon: "🔒", text: "Maximum 2 Urgent jobs per user per day" },
  { icon: "⏱️", text: "1-hour cooldown between Urgent submissions" },
  { icon: "🚫", text: "Urgent disabled automatically during peak load" },
  { icon: "📊", text: "Urgent price rises automatically when queue is large" },
];

export default WelcomePage;