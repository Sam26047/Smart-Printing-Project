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

function formatDeadline(deadline) {
  if (!deadline) return "—";
  const d      = new Date(deadline);
  const diffMs = d - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  const formatted = d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (diffMs < 0)    return <span style={{ color: "var(--rose)" }}>{formatted} ⚠ overdue</span>;
  if (diffMin < 30)  return <span style={{ color: "var(--amber-d)" }}>{formatted} · {diffMin}m left ⚠</span>;
  return formatted;
}

export default function AdminJobRow({ job, onUpdate }) {
  const [loading, setLoading]       = useState(false);
  const [priority, setPriority]     = useState(job.priority ?? 0);

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

      <td style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
        {formatDeadline(job.deadline)}
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