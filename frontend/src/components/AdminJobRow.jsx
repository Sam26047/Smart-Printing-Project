// frontend/src/components/AdminJobRow.jsx
import { useState } from "react";
import adminJobs from "../services/adminJobs";

const NEXT_STATUS = { // maps current status → what the advance button sets it to
  PENDING:  "QUEUED",
  QUEUED:   "PRINTING",
  PRINTING: "READY",
  READY:    "COLLECTED",
};

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status?.toLowerCase()}`}>
      <span className="badge-dot" />
      {status?.toLowerCase()}
    </span>
  );
}

// Urgency pill — replaces the old deadline cell
// Uses CSS variables from index.css for colours
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

export default function AdminJobRow({ job, onUpdate }) {
  const [loading, setLoading]   = useState(false);
  const [priority, setPriority] = useState(job.priority ?? 0);

  const nextStatus = NEXT_STATUS[job.status];
  const canAdvance = !!nextStatus;

  const handleAdvance = async () => {
    if (!nextStatus) return;
    setLoading(true);
    try {
      await adminJobs.updateStatus(job.id, nextStatus);
      onUpdate(); // re-fetch the full queue after update
    } catch {
      alert("Failed to update status.");
    } finally {
      setLoading(false);
    }
  };

  const handlePriority = async (newVal) => {
    if (job.status !== "QUEUED") return; // priority only applies to queued jobs
    try {
      await adminJobs.updatePriority(job.id, newVal);
      setPriority(newVal);
      onUpdate();
    } catch {
      alert("Failed to update priority.");
    }
  };

  const primaryFile = job.files?.[0];
  const extraFiles  = (job.files?.length || 1) - 1;

  return (
    <tr>
      <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
        {job.id.slice(0, 8)}…
      </td>

      <td>
        {primaryFile ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{primaryFile.file_name}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)", marginTop: 2 }}>
              {primaryFile.copies}× · {primaryFile.color ? "Color" : "B&W"} · {primaryFile.double_sided ? "Double" : "Single"}
              {extraFiles > 0 && <span style={{ marginLeft: 6 }}>+ {extraFiles} more</span>}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--gray)" }}>—</span>
        )}
      </td>

      <td><StatusBadge status={job.status} /></td>

      {/* Manual priority override — admin can bump a job up/down within the queue */}
      <td>
        {job.status === "QUEUED" ? (
          <div className="priority-ctrl">
            <button className="p-btn" onClick={() => handlePriority(priority - 1)}>▼</button>
            <span className="p-val">{priority}</span>
            <button className="p-btn" onClick={() => handlePriority(priority + 1)}>▲</button>
          </div>
        ) : (
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--gray)", opacity: 0.5 }}>{priority}</span>
        )}
      </td>

      {/* Urgency level — replaces the old free-form deadline column */}
      <td>
        <UrgencyBadge level={job.urgency_level || "NORMAL"} />
      </td>

      <td>
        {canAdvance ? (
          <button className="btn btn-ghost btn-sm" onClick={handleAdvance} disabled={loading}>
            {loading ? "…" : `→ ${nextStatus.toLowerCase()}`}
          </button>
        ) : (
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>done</span>
        )}
      </td>
    </tr>
  );
}