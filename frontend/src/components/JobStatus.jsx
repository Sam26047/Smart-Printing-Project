// frontend/src/components/JobStatus.jsx
import { useEffect, useState } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";
import PaymentStep from "./PaymentStep";

const STEPS = ["PENDING", "QUEUED", "PRINTING", "READY", "COLLECTED"];

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status?.toLowerCase()}`}>
      <span className="badge-dot" />
      {status?.toLowerCase()}
    </span>
  );
}

// Shows which step is done / active / pending in the status flow
function StepDot({ stepName, currentStatus }) {
  const currentIdx = STEPS.indexOf(currentStatus);
  const stepIdx    = STEPS.indexOf(stepName);
  const isDone     = stepIdx < currentIdx;
  const isActive   = stepIdx === currentIdx;

  return (
    <div className="stepper-node">
      <div className={`stepper-circle ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}>
        {isDone ? (
          <svg className="stepper-check" viewBox="0 0 12 12">
            <polyline points="1.5,6 4.5,9 10.5,3" />
          </svg>
        ) : (
          <div className="stepper-dot" />
        )}
      </div>
      <div className="stepper-label">{stepName.toLowerCase()}</div>
    </div>
  );
}

// Payment pill — same inline-pill idiom as UrgencyPill
function PaymentPill({ paymentStatus }) {
  const map = {
    UNPAID: { label: "unpaid",         color: "var(--amber-dark)", bg: "var(--amber-lite)" },
    PAID:   { label: "paid",           color: "var(--teal-dark)",  bg: "var(--teal-lite)"  },
    FAILED: { label: "payment failed", color: "var(--rose-dark)",  bg: "var(--rose-lite)"  },
  };
  const p = map[paymentStatus];
  if (!p) return null;
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 11,
      color: p.color, background: p.bg,
      padding: "2px 8px", borderRadius: 20,
    }}>
      {p.label}
    </span>
  );
}

// Urgency pill — shows the user's chosen priority on their live job card
function UrgencyPill({ level }) {
  const map = {
    URGENT: { emoji: "🔴", label: "urgent",  color: "var(--rose-dark)",  bg: "var(--rose-lite)"  },
    SOON:   { emoji: "🟡", label: "soon",    color: "var(--amber-dark)", bg: "var(--amber-lite)" },
    NORMAL: { emoji: "🟢", label: "normal",  color: "var(--teal-dark)",  bg: "var(--teal-lite)"  },
  };
  const u = map[level] || map.NORMAL;
  return (
    <span style={{
      fontFamily: "var(--mono)", fontSize: 11,
      color: u.color, background: u.bg,
      padding: "2px 8px", borderRadius: 20,
    }}>
      {u.emoji} {u.label}
    </span>
  );
}

// ── Collect section (shown when status = READY) ───────────────────────────────
function CollectPrint({ jobId }) {
  const { removeActiveJob } = useAuth();
  const [otp, setOtp]         = useState("");
  const [msg, setMsg]         = useState(null);
  const [err, setErr]         = useState(null);
  const [loading, setLoading] = useState(false);

  const handleCollect = async () => {
    setMsg(null); setErr(null); setLoading(true);
    try {
      await printJobService.collectPrintJob(otp, jobId);
      setMsg("Collected! ✓");
      removeActiveJob(jobId); // removes card from active list and bumps history
    } catch (e) {
      setErr(e.response?.data?.error || "Collection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await printJobService.regenerateOtp(jobId);
      setMsg("New OTP sent to your email.");
    } catch {
      setErr("Failed to resend OTP.");
    }
  };

  return (
    <div>
      <div className="otp-box" style={{ marginBottom: 10 }}>
        <div className="otp-label">enter otp to collect</div>
        <input
          className="form-input"
          style={{ textAlign: "center", letterSpacing: "0.2em", fontSize: 20, marginTop: 6 }}
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          placeholder="——————"
        />
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={handleResend}>resend otp</button>
        <button className="btn btn-primary" onClick={handleCollect} disabled={loading || otp.length < 6}>
          {loading ? "…" : "collect →"}
        </button>
      </div>
      {msg && <div className="alert alert-success">{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
    </div>
  );
}

// ── Main JobStatus card ───────────────────────────────────────────────────────
export default function JobStatus({ jobId }) {
  const [job, setJob]     = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetch = () => {
      printJobService.getJobById(jobId)
        .then((res) => setJob(res.data))
        .catch(() => setError("Could not load job."));
    };
    fetch();
    // Poll every 5s so status updates (PRINTING → READY) appear automatically
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [jobId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!job)  return <p className="loading-text">Loading job {jobId.slice(0, 8)}…</p>;

  const primaryFile = job.files?.[0]?.file_name
    || job.file_name
    || `Job ${jobId.slice(0, 8)}`;
  const extraFiles  = (job.files?.length || 1) - 1;

  const submittedAt = job.created_at
    ? new Date(job.created_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="card card-padded" data-tour-job-card={jobId} style={{ marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>
            {primaryFile}
            {extraFiles > 0 && (
              <span style={{ fontSize: 12, color: "var(--gray)", marginLeft: 6 }}>
                + {extraFiles} more
              </span>
            )}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
            job · {jobId.slice(0, 8)}…
            {submittedAt && <span style={{ marginLeft: 8 }}>· submitted {submittedAt}</span>}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((step, i) => (
          <div className="stepper-step" key={step}>
            <StepDot stepName={step} currentStatus={job.status} />
            {i < STEPS.length - 1 && (
              <div className={`stepper-line ${STEPS.indexOf(job.status) > i ? "done" : ""}`} />
            )}
          </div>
        ))}
      </div>

      {/* Payment step — a PENDING job doesn't enter the queue until paid
          (webhook-confirmed) or queued at the counter by the shopkeeper */}
      {job.status === "PENDING" && (job.payment_status === "UNPAID" || job.payment_status === "FAILED") && (
        <div style={{ marginBottom: 12 }}>
          <PaymentStep
            jobId={jobId}
            amount={job.estimated_cost != null ? Number(job.estimated_cost) : null}
            paymentStatus={job.payment_status}
          />
        </div>
      )}

      {/* Footer: urgency + payment pills + collect section */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <UrgencyPill level={job.urgency_level || "NORMAL"} />
          <PaymentPill paymentStatus={job.payment_status} />
        </div>
        {job.status === "READY" && <CollectPrint jobId={jobId} />}
      </div>
    </div>
  );
}