// frontend/src/components/AdminJobRow.jsx
import { useState } from "react";
import adminJobs from "../services/adminJobs";

const STATUS_TRANSITIONS = {
  PENDING: "QUEUED",
  QUEUED: "PRINTING",
  PRINTING: "READY",
  READY: "COLLECTED",
};

const STATUS_COLORS = {
  PENDING: "#999",
  QUEUED: "#2196F3",
  PRINTING: "#FF9800",
  READY: "#4CAF50",
  COLLECTED: "#9E9E9E",
};

const AdminJobRow = ({ job, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [priorityInput, setPriorityInput] = useState(job.priority ?? 0);

  const nextStatus = STATUS_TRANSITIONS[job.status];

  const handleStatusAdvance = async () => {
    if (!nextStatus) return;
    setLoading(true);
    try {
      await adminJobs.updateStatus(job.id, nextStatus);
      onUpdate();
    } catch (err) {
      alert("Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  const handlePriorityChange = async (newPriority) => {
    if (job.status !== "QUEUED") return;
    try {
      await adminJobs.updatePriority(job.id, newPriority);
      setPriorityInput(newPriority);
      onUpdate();
    } catch (err) {
      alert("Failed to update priority");
    }
  };

  const formatDeadline = (deadline) => {
    if (!deadline) return "—";
    const d = new Date(deadline);
    const diffMs = d - new Date();
    const diffMin = Math.round(diffMs / 60000);
    const formatted = d.toLocaleString();
    if (diffMs < 0) return `${formatted} ⚠️ overdue`;
    if (diffMin < 30) return `${formatted} ⚠️ ${diffMin}m left`;
    return formatted;
  };

  return (
    <tr>
      <td style={{ fontFamily: "monospace", fontSize: "12px" }}>
        {job.id.slice(0, 8)}...
      </td>
      <td>{job.file_name || "—"}</td>
      <td>
        <span
          style={{
            color: STATUS_COLORS[job.status] || "#333",
            fontWeight: "bold",
          }}
        >
          {job.status}
        </span>
      </td>
      <td>
        {job.status === "QUEUED" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button
              onClick={() => handlePriorityChange(priorityInput - 1)}
              title="Lower priority"
            >
              ▼
            </button>
            <span style={{ minWidth: "24px", textAlign: "center" }}>
              {priorityInput}
            </span>
            <button
              onClick={() => handlePriorityChange(priorityInput + 1)}
              title="Raise priority"
            >
              ▲
            </button>
          </div>
        ) : (
          <span style={{ color: "#aaa" }}>{job.priority ?? 0}</span>
        )}
      </td>
      <td
        style={{
          color:
            job.deadline && new Date(job.deadline) - new Date() < 30 * 60000
              ? "orange"
              : "inherit",
        }}
      >
        {formatDeadline(job.deadline)}
      </td>
      <td>
        {nextStatus ? (
          <button onClick={handleStatusAdvance} disabled={loading}>
            {loading ? "..." : `→ ${nextStatus}`}
          </button>
        ) : (
          <span style={{ color: "#aaa" }}>Done</span>
        )}
      </td>
    </tr>
  );
};

export default AdminJobRow;