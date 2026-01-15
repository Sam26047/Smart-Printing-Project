import { useEffect, useState } from "react";
import printJobService from "../services/printJobs";
import CollectPrint from "./CollectPrint";

function JobStatus({ jobId }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobId) return;

    let intervalId;

    const fetchStatus = async () => {
      try {
        const response = await printJobService.getJobById(jobId);
        setStatus(response.data.status);

        // Stop polling once job is READY
        if (response.data.status === "READY") {
          clearInterval(intervalId);
        }
      } catch (err) {
        setError("Failed to fetch job status");
        clearInterval(intervalId);
      }
    };

    // fetch immediately once so user doesnt have to wait for 3seconds initially
    fetchStatus();

    // then poll every 3 seconds
    intervalId = setInterval(fetchStatus, 3000); // wait3->run->wait3->run. so nothing for first 3 seconds

    // cleanup when component unmounts or jobId changes
    return () => clearInterval(intervalId);
  }, [jobId]);

  if (!jobId) return null;

  return (
    <div>
      <h3>Job Status</h3>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {status ? <p>Status: {status}</p> : <p>Loading...</p>}
      {status === "READY" && (
        <CollectPrint jobId={jobId} /> //if job ready ,render otp entering component
      )}
    </div>
  );
}

export default JobStatus;
