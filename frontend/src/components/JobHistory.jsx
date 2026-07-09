// frontend/src/components/JobHistory.jsx
import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { useAuth } from "../hooks/useAuth";

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status?.toLowerCase()}`}>
      <span className="badge-dot" />
      {status?.toLowerCase()}
    </span>
  );
}

// Urgency pill — mirrors UrgencyBadge in AdminJobRow
function UrgencyBadge({ level }) {
  const map = {
    URGENT: { emoji: "🔴", label: "urgent", color: "var(--rose-dark)",  bg: "var(--rose-lite)",  border: "#fca5a5" },
    SOON:   { emoji: "🟡", label: "soon",   color: "var(--amber-dark)", bg: "var(--amber-lite)", border: "#fbbf24" },
    NORMAL: { emoji: "🟢", label: "normal", color: "var(--teal-dark)",  bg: "var(--teal-lite)",  border: "#5eead4" },
  };
  const u = map[level] || map.NORMAL;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      fontFamily: "var(--mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.05em",
      color: u.color, background: u.bg, border: `0.5px solid ${u.border}`,
      whiteSpace: "nowrap",
    }}>
      {u.emoji} {u.label}
    </span>
  );
}

// Payment pill — shown only when informative: unpaid/failed always, paid only
// while the job is still in flight (a COLLECTED job is implicitly settled)
function PaymentPill({ paymentStatus, status }) {
  const map = {
    UNPAID: { label: "unpaid", color: "var(--amber-dark)", bg: "var(--amber-lite)", border: "#fbbf24" },
    PAID:   { label: "paid",   color: "var(--teal-dark)",  bg: "var(--teal-lite)",  border: "#5eead4" },
    FAILED: { label: "pay failed", color: "var(--rose-dark)", bg: "var(--rose-lite)", border: "#fca5a5" },
  };
  const p = map[paymentStatus];
  if (!p) return null;
  if (paymentStatus === "PAID" && status === "COLLECTED") return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 20, marginLeft: 5,
      fontFamily: "var(--mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.05em",
      color: p.color, background: p.bg, border: `0.5px solid ${p.border}`,
      whiteSpace: "nowrap",
    }}>
      {p.label}
    </span>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function JobHistory() {
  const { historyVersion } = useAuth(); //to keep job history updated after a job collected
  const [jobs, setJobs]       = useState([]);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get("/users/me/jobs")
      .then((res) => { setJobs(res.data.jobs || []); setLoading(false); })
      .catch(() => { setError("Failed to load job history."); setLoading(false); });
  }, [historyVersion]); //re-fetch whenever a job is collected

  if (loading) return <p className="loading-text">Loading history…</p>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!jobs.length) return <div className="empty-state">No past jobs yet.</div>;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="history-table">
        <thead>
          <tr>
            <th>job id</th>
            <th>files</th>
            <th>status</th>
            <th>urgency</th>{/* ← replaces old "deadline" header */}
            <th>submitted</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const firstName = job.files?.[0]?.file_name || job.file_name || "—";
            const extra     = (job.files?.length || 1) - 1;
            return (
              <tr key={job.id}>
                <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
                  {job.id.slice(0, 8)}…
                </td>
                <td style={{ fontSize: 13 }}>
                  {firstName}
                  {extra > 0 && (
                    <span style={{ fontSize: 11, color: "var(--gray)", marginLeft: 5 }}>
                      +{extra}
                    </span>
                  )}
                </td>
                <td>
                  <StatusBadge status={job.status} />
                  <PaymentPill paymentStatus={job.payment_status} status={job.status} />
                </td>
                {/* Urgency badge replaces old deadline timestamp */}
                <td><UrgencyBadge level={job.urgency_level || "NORMAL"} /></td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
                  {timeAgo(job.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}