// frontend/src/components/AdminJobRow.jsx
import { useState } from "react";
import adminJobs from "../services/adminJobs";

const NEXT_STATUS = { // maps current status → what the advance button sets it to
  PENDING:  "QUEUED",
  // QUEUED intentionally has NO manual advance: the worker dispatches QUEUED
  // jobs (with per-file printer routing) within seconds — a manual flip to
  // PRINTING would bypass routing and leave files unbound.
  WAITING_FOR_PRINTER: "QUEUED", // manual retry after fixing a printer
  PRINTING: "READY",
  READY:    "COLLECTED",
};

function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status?.toLowerCase()}`}>
      <span className="badge-dot" />
      {status?.toLowerCase().replaceAll("_", " ")}
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

export default function AdminJobRow({ job, printers = [], onUpdate }) {
  const [loading, setLoading]   = useState(false);
  const [priority, setPriority] = useState(job.priority ?? 0);

  // Reassign flow state (WAITING_FOR_PRINTER jobs only)
  const [showReassign, setShowReassign]   = useState(false);
  const [selection, setSelection]         = useState({});   // file_id → printer_id
  const [pendingConfirm, setPendingConfirm] = useState(null); // { fileId, printerId, currentCost, newCost }
  const [reassignError, setReassignError] = useState(null);

  const nextStatus = NEXT_STATUS[job.status];
  const canAdvance = !!nextStatus;
  const isBlocked  = job.status === "WAITING_FOR_PRINTER";

  const onlinePrinters = printers.filter((p) => p.status === "ONLINE");

  // First call WITHOUT confirm — the server answers 400 with the old/new
  // price, which we surface as an inline confirm strip. Second call sends
  // confirm: true and reports the dispatch outcome.
  const handleReassign = async (fileId, printerId, confirmed) => {
    setReassignError(null);
    try {
      await adminJobs.reassignFile(job.id, fileId, printerId, confirmed);
      // confirmed call succeeded → job re-queued/dispatched
      setPendingConfirm(null);
      setShowReassign(false);
      onUpdate();
    } catch (err) {
      const data = err.response?.data;
      if (data?.confirm_required) {
        setPendingConfirm({
          fileId,
          printerId,
          currentCost: data.current_estimated_cost,
          newCost: data.new_estimated_cost,
        });
      } else {
        setReassignError(data?.error || "Reassign failed");
        setPendingConfirm(null);
      }
    }
  };

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
    <>
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
              {job.estimated_cost != null && (
                <span style={{ marginLeft: 6, color: "var(--gray-dark)" }}>· ₹{Number(job.estimated_cost)}</span>
              )}
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
        ) : job.status === "QUEUED" ? (
          // Worker dispatches QUEUED jobs automatically (with printer routing)
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>auto</span>
        ) : (
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>done</span>
        )}
        {isBlocked && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 4 }}
            onClick={() => { setShowReassign((v) => !v); setReassignError(null); setPendingConfirm(null); }}
          >
            {showReassign ? "close" : "reassign"}
          </button>
        )}
      </td>
    </tr>

    {/* ── Reassign expander — blocked jobs only ─────────────────────────── */}
    {isBlocked && showReassign && (
      <tr>
        <td colSpan={6} style={{ background: "var(--paper2)", padding: "10px 14px" }}>
          <div className="mono-sm" style={{ color: "var(--gray-dark)", marginBottom: 8 }}>
            no eligible printer for ≥1 file — pin a file to another printer
            (different tier changes the price and asks to confirm)
          </div>

          {(job.files || []).map((f) => (
            <div
              key={f.file_id}
              className="mono-sm"
              style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}
            >
              <span style={{ minWidth: 180 }}>
                {f.file_name} · {f.color ? "Color" : "B&W"} · {f.paper_size}
              </span>
              <span style={{ color: "var(--gray)" }}>
                {f.printer_label ? `pinned: ${f.printer_label}` : "unrouted"}
              </span>
              <select
                className="file-select"
                value={selection[f.file_id] || ""}
                onChange={(e) => setSelection((s) => ({ ...s, [f.file_id]: e.target.value }))}
              >
                <option value="">choose printer…</option>
                {onlinePrinters.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.supports_color ? "colour" : "b&w"})
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!selection[f.file_id]}
                onClick={() => handleReassign(f.file_id, selection[f.file_id], false)}
              >
                reassign →
              </button>
            </div>
          ))}

          {/* Price-change confirmation strip (server-quoted numbers) */}
          {pendingConfirm && (
            <div className="deadline-warn" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>⚠️</span>
              <span>
                this changes the job total to <strong>₹{pendingConfirm.newCost}</strong> (was ₹{pendingConfirm.currentCost}) — proceed?
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleReassign(pendingConfirm.fileId, pendingConfirm.printerId, true)}
              >
                confirm ₹{pendingConfirm.newCost}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setPendingConfirm(null)}>
                cancel
              </button>
            </div>
          )}

          {reassignError && <div className="alert alert-error">{reassignError}</div>}
        </td>
      </tr>
    )}
    </>
  );
}