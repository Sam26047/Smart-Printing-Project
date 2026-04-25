// frontend/src/components/JobStatus.jsx
import { useEffect, useState, useRef } from "react";
import printJobService from "../services/printJobs";
import CollectPrint from "./CollectPrint";

const STEPS = ["PENDING", "QUEUED", "PRINTING", "READY", "COLLECTED"];

function CheckIcon() {
  return (
    <svg className="stepper-check" viewBox="0 0 16 16">
      <polyline points="3,8 6.5,11.5 13,5" />
    </svg>
  );
}

function StepDot({ stepName, currentStatus }) {
  const stepIndex    = STEPS.indexOf(stepName);
  const currentIndex = STEPS.indexOf(currentStatus);

  const isDone   = stepIndex < currentIndex;
  const isActive = stepIndex === currentIndex;

  let cls = "stepper-circle";
  if (isDone)   cls += " done";
  if (isActive) cls += " active";

  return (
    <div className="stepper-node">
      <div className={cls}>
        {isDone   && <CheckIcon />}
        {isActive && <div className="stepper-dot" />}
      </div>
      <span className="stepper-label">{stepName.toLowerCase()}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = `badge badge-${status?.toLowerCase()}`;
  return (
    <span className={cls}>
      <span className="badge-dot" />
      {status?.toLowerCase()}
    </span>
  );
}

export default function JobStatus({ jobId }) {
  const [job, setJob]     = useState(null);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null); // ✅ ref instead of let variable

  useEffect(() => {
    if (!jobId) return;

    const fetch = async () => {
      try {
        const res = await printJobService.getJobById(jobId);
        setJob(res.data);

        if (["READY", "COLLECTED"].includes(res.data.status)) {
          clearInterval(intervalRef.current); // ✅ always has the right value
        }
      } catch {
        setError("Could not fetch job status.");
        clearInterval(intervalRef.current);
      }
    };

    fetch();
    intervalRef.current = setInterval(fetch, 4000);

    return () => clearInterval(intervalRef.current); // cleanup on unmount
  }, [jobId]);

  if (!jobId) return null;
  if (error)  return <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>;
  if (!job)   return <p className="loading-text">Loading job {jobId.slice(0, 8)}…</p>;

  const primaryFile = job.files?.[0]?.file_name
    || job.file_name
    || `Job ${jobId.slice(0, 8)}`;
  const extraFiles  = (job.files?.length || 1) - 1;

  const submittedAt = job.created_at
    ? new Date(job.created_at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="card card-padded" style={{ marginBottom: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>
            {primaryFile}
            {extraFiles > 0 && (
              <span style={{ fontSize: 12, color: "var(--gray)", marginLeft: 6 }}>
                + {extraFiles} more
              </span>
            )}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
            job · {jobId.slice(0, 8)}…
            {submittedAt && <span style={{ marginLeft: 8 }}>· submitted {submittedAt}</span>}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((step, i) => (
          <div className="stepper-step" key={step}>
            <StepDot stepName={step} currentStatus={job.status} />
            {i < STEPS.length - 1 && (
              <div
                className={`stepper-line ${STEPS.indexOf(job.status) > i ? "done" : ""}`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Body: deadline left + OTP if ready */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
        <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--gray)" }}>
          {job.deadline
            ? `deadline: ${new Date(job.deadline).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`
            : "no deadline set"}
        </div>
        {job.status === "READY" && (
          <CollectPrint jobId={jobId} />
        )}
      </div>
    </div>
  );
}