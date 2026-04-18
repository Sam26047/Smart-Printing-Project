import { useEffect, useState, useRef } from "react";
import printJobService from "../services/printJobs";
import CollectPrint from "./CollectPrint";

function JobStatus({ jobId }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null); // ✅ ref instead of let variable

  useEffect(() => {
    if (!jobId) return;

    const fetchStatus = async () => {
      try {
        const response = await printJobService.getJobById(jobId);
        setStatus(response.data.status);

        if (["READY", "COLLECTED"].includes(response.data.status)) {
          clearInterval(intervalRef.current); // ✅ always has the right value
        }
      } catch (err) {
        setError("Failed to fetch job status");
        clearInterval(intervalRef.current);
      }
    };

    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 3000);

    return () => clearInterval(intervalRef.current); // cleanup on unmount
  }, [jobId]);

  if (!jobId) return null;

  return (
    <div style={{ border: "1px solid #ccc", padding: "8px", margin: "8px 0" }}>
      <p>Job: {jobId.slice(0, 8)}...</p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {status ? <p>Status: {status}</p> : <p>Loading...</p>}
      {status === "READY" && <CollectPrint jobId={jobId} />}
    </div>
  );
}

export default JobStatus;