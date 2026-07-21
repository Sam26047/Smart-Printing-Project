// frontend/src/components/AdminQueue.jsx
import { useEffect, useState } from "react";
import adminJobs from "../services/adminJobs";
import tiersService from "../services/tiers";
import AdminJobRow from "./AdminJobRow";

const STATUSES = ["ALL", "PENDING", "QUEUED", "WAITING_FOR_PRINTER", "PRINTING", "READY", "COLLECTED"];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="22" y2="22" />
    </svg>
  );
}

export default function AdminQueue() {
  const [jobs, setJobs]                 = useState([]);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search, setSearch]             = useState("");
  const [tiers, setTiers]               = useState([]); // target-tier options for the reassign flow

  const fetchJobs = () => {
    adminJobs.getAllJobs()
      .then((res) => setJobs(res.data.jobs || res.data))
      .catch(() => {});
  };

  const fetchTiers = () => {
    tiersService.getAdminTiers()
      .then((res) => setTiers(res.data.tiers || []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchJobs();
    fetchTiers();
    const interval = setInterval(() => { fetchJobs(); fetchTiers(); }, 5000); // live availability too
    return () => clearInterval(interval);
  }, []);

  // filter uses the aggregated `files` array from the backend (each job.files is an array of file objects)
  const filtered = jobs.filter((job) => {
    const matchStatus = filterStatus === "ALL" || job.status === filterStatus;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      job.id.toLowerCase().includes(q) ||
      (job.files || []).some((f) => f.file_name?.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  });

  // Stat counts
  const count = (s) => jobs.filter((j) => j.status === s).length;

  return (
    <>
      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card amber">
          <div className="stat-val">{count("QUEUED")}</div>
          <div className="stat-lbl">queued</div>
        </div>
        <div className="stat-card rose">
          <div className="stat-val">{count("WAITING_FOR_PRINTER")}</div>
          <div className="stat-lbl">blocked</div>
        </div>
        <div className="stat-card rose">
          <div className="stat-val">{count("PRINTING")}</div>
          <div className="stat-lbl">printing</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-val">{count("READY")}</div>
          <div className="stat-lbl">ready</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-val">{jobs.length}</div>
          <div className="stat-lbl">total jobs</div>
        </div>
      </div>

      {/* Controls */}
      <div className="admin-controls">
        <div className="search-wrap">
          <SearchIcon />
          <input
            className="search-input"
            type="text"
            placeholder="search by job ID or filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.toLowerCase().replaceAll("_", " ")}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="queue-table-wrap">
        {filtered.length === 0 ? (
          <div className="empty-state">No jobs match your filter.</div>
        ) : (
          <table className="queue-table">
            <thead>
              <tr>
                <th>job id</th>
                <th>files</th>
                <th>status</th>
                <th>priority</th>
                <th>urgency</th>{/* ← replaces old "deadline" header */}
                <th>action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <AdminJobRow key={job.id} job={job} tiers={tiers} onUpdate={fetchJobs} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}