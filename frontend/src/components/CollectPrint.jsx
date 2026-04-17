import { useState } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";

const CollectPrint = ({ jobId }) => {
  const { removeActiveJob } = useAuth(); // ✅
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const handleCollect = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await printJobService.collectPrintJob(otp, jobId);
      setMessage("Print collected successfully");
      removeActiveJob(jobId); // ✅ remove only this job
    } catch (err) {
      setError("Invalid OTP or job not ready");
    }
  };

  const regenerateOtp = async () => {
    try {
      await printJobService.regenerateOtp(jobId);
      setMessage("New OTP sent to your email.");
      setError(null);
    } catch {
      setError("Failed to regenerate OTP");
    }
  };

  if (message) return <p>{message}</p>;

  return (
    <div>
      <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter OTP from email" />
      <button onClick={handleCollect}>Collect</button>
      <button onClick={regenerateOtp}>Resend OTP</button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
};

export default CollectPrint;