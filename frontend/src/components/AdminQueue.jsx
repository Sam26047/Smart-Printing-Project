// frontend/src/components/AdminQueue.jsx
import { useEffect, useState } from "react";
import adminJobs from "../services/adminJobs";
import AdminJobRow from "./AdminJobRow";

const STATUSES = ["ALL", "PENDING", "QUEUED", "PRINTING", "READY", "COLLECTED"];

const AdminQueue = () => {
  const [jobs, setJobs] = useState([]);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search, setSearch] = useState("");

  const fetchJobs = () => {
    adminJobs.getAllJobs().then((res) => {
      setJobs(res.data.jobs || res.data);
    });
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  // In AdminQueue.jsx — update the search filter:
  const filtered = jobs.filter((job) => {
    const matchesStatus = filterStatus === "ALL" || job.status === filterStatus;
    const matchesSearch =
      search.trim() === "" ||
      job.id.toLowerCase().includes(search.toLowerCase()) ||
      (job.file_names || []).some((name) =>
        name.toLowerCase().includes(search.toLowerCase())
      );
    return matchesStatus && matchesSearch;
  });

  return (
    <div>
      <h2>Admin – Print Queue</h2>

      {/* Controls */}
      <div style={{ marginBottom: "12px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by Job ID or filename..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "4px 8px", minWidth: "240px" }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: "4px 8px" }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ color: "#666", alignSelf: "center" }}>
          {filtered.length} job{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <table border="1" cellPadding="6">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>File</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Deadline</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: "center", color: "#888" }}>
                No jobs match your filter.
              </td>
            </tr>
          ) : (
            filtered.map((job) => (
              <AdminJobRow key={job.id} job={job} onUpdate={fetchJobs} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default AdminQueue;