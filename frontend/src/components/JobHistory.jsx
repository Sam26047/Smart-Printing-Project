import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";

function JobHistory() {
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get("/users/me/jobs")
      .then((res) => {
        setJobs(res.data.jobs);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load job history");
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading history...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (jobs.length === 0) return <p>No past jobs.</p>;

  return (
    <div>
      <h2>Job History</h2>
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Status</th>
            <th>Deadline</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.id.slice(0, 8)}...</td>
              <td>{job.status}</td>
              <td>{job.deadline ? new Date(job.deadline).toLocaleString() : "—"}</td>
              <td>{new Date(job.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default JobHistory;