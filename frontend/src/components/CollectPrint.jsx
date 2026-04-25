// frontend/src/components/CollectPrint.jsx
import { useState } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";

export default function CollectPrint({ jobId }) {
  const { removeActiveJob } = useAuth(); // ✅
  const [otp, setOtp]         = useState("");
  const [message, setMessage] = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  const handleCollect = async () => {
    setError(null);
    setLoading(true);
    try {
      await printJobService.collectPrintJob(otp, jobId); //because this data is sent in application/json format
      setMessage("Print collected successfully");
      removeActiveJob(jobId); // ✅ remove only this job
    } catch (err) {
      setError(err.response?.data?.error || "Invalid OTP or job not ready.");
    } finally {
      setLoading(false);
    }
  };

  const regenerateOtp = async () => {
    setError(null);
    try {
      //because in post(url,data,config) so need to pass {} or auth header considered data payload
      await printJobService.regenerateOtp(jobId);
      setMessage("New OTP sent to your email.");
      setError(null);
    } catch {
      setError("Failed to regenerate OTP.");
    }
  };

  if (message) {
    return (
      <div className="otp-box" style={{ background: "var(--teal-lite)", borderColor: "#5eead4" }}>
        <p style={{ fontSize: 13, color: "var(--teal-dark)", fontFamily: "var(--mono)" }}>{message}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <div className="otp-box">
        <div className="otp-label">enter collection otp</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
          <input
            className="form-input"
            type="text"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="_ _ _ _"
            maxLength={6}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 20,
              letterSpacing: "0.2em",
              textAlign: "center",
              width: 120,
              padding: "6px 10px",
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleCollect}
            disabled={loading || otp.length < 4}
          >
            {loading ? "…" : "collect"}
          </button>
        </div>
      </div>
      {error && (
        <span style={{ fontSize: 12, color: "var(--rose)", fontFamily: "var(--mono)" }}>{error}</span>
      )}
      <button
        className="btn btn-ghost btn-sm"
        onClick={regenerateOtp}
        style={{ fontSize: 11 }}
      >
        resend OTP
      </button>
    </div>
  );
}