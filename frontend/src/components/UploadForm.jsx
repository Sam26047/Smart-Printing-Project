// frontend/src/components/UploadForm.jsx
import { useState, useRef } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";

const DEFAULT_FILE_SETTINGS = { copies: 1, color: false, double_sided: false };

/**
 * Utility to format file sizes for the UI
 */
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File icon component based on extension
 */
function FileIcon({ name }) {
  const ext = name?.split(".").pop()?.toLowerCase();
  if (ext === "pdf")  return <span style={{ fontSize: 16 }}>📕</span>;
  if (ext === "docx" || ext === "doc") return <span style={{ fontSize: 16 }}>📘</span>;
  return <span style={{ fontSize: 16 }}>📄</span>;
}

export default function UploadForm() {
  const { addActiveJob } = useAuth(); // ✅ get addActiveJob from context
  const inputRef = useRef();

  const [files, setFiles]               = useState([]);
  const [fileSettings, setFileSettings] = useState([]); // ✅ NEW: one entry per file (replaces global inputs)
  const [deadline, setDeadline]         = useState("");
  const [error, setError]               = useState(null);
  const [success, setSuccess]           = useState(null);
  const [submitting, setSubmitting]     = useState(false);
  const [dragging, setDragging]         = useState(false);

  /**
   * When user selects or drops files → initialize default settings per file
   */
  const applyFiles = (selected) => {
    const arr = Array.from(selected);
    setFiles(arr);
    // ✅ initialise settings for each file (replaces global inputs)
    setFileSettings(arr.map(() => ({ ...DEFAULT_FILE_SETTINGS })));
    setError(null);
    setSuccess(null);
  };

  const handleFilesChange = (e) => applyFiles(e.target.files);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) applyFiles(e.dataTransfer.files);
  };

  // ✅ Update a specific file's setting (dropdowns)
  const updateSetting = (index, key, value) => {
    setFileSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [key]: value } : s))
    );
  };

  // ✅ Update a specific file's setting (increment/decrement)
  const updateCopies = (index, delta) => {
    setFileSettings((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, copies: Math.max(1, s.copies + delta) } : s
      )
    );
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileSettings((prev) => prev.filter((_, i) => i !== index));
  };

  // ✅ Returns true if deadline is less than 30 minutes from now
  const isDeadlineTight = () => {
    if (!deadline) return false;
    const diffMs = new Date(deadline) - new Date();
    return diffMs > 0 && diffMs < 30 * 60 * 1000;
  };

  // ✅ Minimum datetime string for the input (now, rounded to minute)
  const minDatetime = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // ✅ validation
    if (!files.length) {
      setError("Please select at least one file.");
      return;
    }
    
    // ✅ Block past deadlines
    if (deadline && new Date(deadline) <= new Date()) {
      setError("Deadline must be in the future.");
      return;
    }

    const formData = new FormData();
    
    // ✅ append all files
    files.forEach((f) => formData.append("files", f));
    
    // ✅ ❗ NEW: send per-file settings instead of global fields
    formData.append("fileSettings", JSON.stringify(fileSettings)); 
    
    // ✅ optional deadline
    if (deadline) formData.append("deadline", deadline);

    setSubmitting(true);
    try {
      const res = await printJobService.createPrintJob(formData);
      
      const newJobId = res.data.job_id;
      addActiveJob(newJobId); // ✅ add to active jobs list
      
      setSuccess(`Job submitted! Tracking job ${newJobId.slice(0, 8)}…`);
      
      // ✅ reset state
      setFiles([]);
      setFileSettings([]);
      setDeadline("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err.response?.data?.error || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* 1️⃣ File Picker / Drop zone */}
      <div
        className={`upload-zone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.png,.jpg"
          multiple
          onChange={handleFilesChange}
          style={{ display: "none" }}
        />
        <div className="upload-zone-icon">📂</div>
        <h3>Drop files here or click to upload</h3>
        <p style={{ marginBottom: 8 }}>Configure copies, colour, and duplex per file</p>
        <div className="tags-row">
          <span className="file-type-tag">PDF</span>
          <span className="file-type-tag">DOCX</span>
          <span className="file-type-tag">PNG</span>
          <span className="file-type-tag">JPG</span>
        </div>
      </div>

      {/* 2️⃣ Per-file settings (replaces global copies/color/double_sided inputs) */}
      {files.map((file, i) => (
        <div className="file-card" key={i}>
          <div className="file-card-icon">
            <FileIcon name={file.name} />
          </div>
          <div className="file-card-info">
            <div className="file-card-name">{file.name}</div>
            <div className="file-card-meta">{formatBytes(file.size)}</div>
          </div>
          <div className="file-card-controls">
            <select
              className="file-select"
              value={fileSettings[i]?.color ? "color" : "bw"}
              onChange={(e) => updateSetting(i, "color", e.target.value === "color")}
            >
              <option value="bw">B&W</option>
              <option value="color">Color</option>
            </select>
            <select
              className="file-select"
              value={fileSettings[i]?.double_sided ? "double" : "single"}
              onChange={(e) => updateSetting(i, "double_sided", e.target.value === "double")}
            >
              <option value="single">Single</option>
              <option value="double">Double</option>
            </select>
            <div className="copies-ctrl">
              <button
                type="button"
                className="copies-btn"
                onClick={() => updateCopies(i, -1)}
              >−</button>
              <span className="copies-num">{fileSettings[i]?.copies}</span>
              <button
                type="button"
                className="copies-btn"
                onClick={() => updateCopies(i, 1)}
              >+</button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => removeFile(i)}
              title="Remove file"
            >✕</button>
          </div>
        </div>
      ))}

      {/* 3️⃣ Deadline + note row */}
      <div className="form-row-2" style={{ marginTop: 16, marginBottom: 14 }}>
        <div className="form-group">
          <label className="form-label">deadline (optional)</label>
          <input
            className="form-input"
            type="datetime-local"
            value={deadline}
            min={minDatetime()}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">priority note</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Urgent — exam at 3 PM"
          />
        </div>
      </div>

      {isDeadlineTight() && (
        <div className="deadline-warn">
          <span>⚠</span>
          <span>Deadline is less than 30 minutes away — printing may not finish in time.</span>
        </div>
      )}

      {/* 4️⃣ response messages */}
      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => { 
            setFiles([]); 
            setFileSettings([]); 
            setDeadline(""); 
            setError(null); 
            setSuccess(null); 
            if (inputRef.current) inputRef.current.value = ""; 
          }}
        >
          clear all
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "submitting…" : "submit job →"}
        </button>
      </div>
    </form>
  );
}