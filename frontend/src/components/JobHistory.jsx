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

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
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
  const [jobs, setJobs]     = useState([]);
  const [error, setError]   = useState(null);
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
            <th>deadline</th>
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
                <td><StatusBadge status={job.status} /></td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
                  {job.deadline
                    ? new Date(job.deadline).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </td>
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