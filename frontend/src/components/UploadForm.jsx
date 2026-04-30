// frontend/src/components/UploadForm.jsx
import { useState, useEffect } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";

const DEFAULT_FILE_SETTINGS = {
  copies: 1,
  color: false,
  double_sided: false,
  orientation: "portrait",  
  paper_size: "A4",          
};

// ─── Pricing constants (mirror backend/utils/pricing.js) ─────────────────────
// Kept in sync manually — Phase 4 can fetch these from a /pricing/config endpoint
const RATES = { BW_SINGLE: 1, BW_DOUBLE: 0.8, COLOR_SINGLE: 5, COLOR_DOUBLE: 4 };
const QUEUE_LARGE_THRESHOLD = 5; // same threshold as backend

function pageRate(color, doubleSided) {
  if (color) return doubleSided ? RATES.COLOR_DOUBLE : RATES.COLOR_SINGLE;
  return doubleSided ? RATES.BW_DOUBLE : RATES.BW_SINGLE;
}

// Returns the urgency multiplier for a given level + queue size.
// Must stay in sync with backend/utils/pricing.js → getUrgencyMultiplier()
function getUrgencyMultiplier(urgencyLevel, queueSize) {
  if (urgencyLevel === "SOON")   return 1.2;
  if (urgencyLevel === "URGENT") return queueSize >= QUEUE_LARGE_THRESHOLD ? 1.8 : 1.5;
  return 1.0;
}

// Round to 2 decimal places, then drop trailing zeros for display
// e.g. 2.40000000001 → "2.40" → displayed as "2.4", 3.0 → "3"
function fmt(n) {
  return parseFloat(n.toFixed(2));
}

// Computes a live cost breakdown from the current fileSettings + urgency selection
function computeCost(fileSettings, urgencyLevel, queueSize) {
  let baseTotal = 0;
  const breakdown = fileSettings.map((s) => {
    const copies      = parseInt(s.copies) || 1;
    const color       = Boolean(s.color);
    const doubleSided = Boolean(s.double_sided);
    const pages       = 1; // placeholder — Phase 4 will compute from PDF.js
    const rate        = pageRate(color, doubleSided);
    const fileCost    = fmt(rate * pages * copies);
    baseTotal        += fileCost;
    return { copies, color, doubleSided, pages, rate, fileCost };
  });

  baseTotal = fmt(baseTotal);

  const multiplier   = getUrgencyMultiplier(urgencyLevel, queueSize);
  const grandTotal   = Math.ceil(baseTotal * multiplier); // always a whole rupee
  const urgencyExtra = fmt(grandTotal - baseTotal);

  return { baseTotal, urgencyExtra, grandTotal, multiplier, breakdown };
}

// ─── Priority level definitions ───────────────────────────────────────────────
const PRIORITY_OPTIONS = [
  { value: "NORMAL", emoji: "🟢", label: "Normal", sublabel: "Standard queue",  priceTag: "No extra charge",   borderColor: "var(--teal)",       bgColor: "var(--teal-lite)",  textColor: "var(--teal-dark)"  },
  { value: "SOON",   emoji: "🟡", label: "Soon",   sublabel: "2 – 4 hours",     priceTag: "+20%",              borderColor: "var(--amber)",      bgColor: "var(--amber-lite)", textColor: "var(--amber-dark)" },
  { value: "URGENT", emoji: "🔴", label: "Urgent", sublabel: "30 – 60 mins",    priceTag: "+50% / +80% busy",  borderColor: "var(--rose)",       bgColor: "var(--rose-lite)",  textColor: "var(--rose-dark)"  },
];

function UploadForm() {
  const { addActiveJob } = useAuth(); // ✅ get addActiveJob from context

  const [files, setFiles]               = useState([]);
  const [fileSettings, setFileSettings] = useState([]); // one entry per file (replaces global copies/color/double_sided)
  const [urgencyLevel, setUrgencyLevel] = useState("NORMAL"); // replaces free-form deadline
  const [dragging, setDragging]         = useState(false);
  const [error, setError]               = useState(null);
  const [success, setSuccess]           = useState(null);

  // Queue status — fetched once on mount and after each submission.
  // Used to show queue position and disable Urgent during peak load.
  const [queueSize, setQueueSize]               = useState(0);
  const [urgentDisabled, setUrgentDisabled]     = useState(false);
  const [urgentCooldownMsg, setUrgentCooldownMsg] = useState(null); // set on 429 response

  // Fetch queue status from backend
  const fetchQueueStatus = async () => {
    try {
      const res = await printJobService.getQueueStatus();
      setQueueSize(res.data.queue_size);
      setUrgentDisabled(res.data.urgent_disabled);
    } catch {
      // non-critical — fail silently, UI still works without it
    }
  };

  useEffect(() => { fetchQueueStatus(); }, []);

  // When user selects files → initialize default settings per file
  const handleFilesChange = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(selected);
    // ✅ initialise settings for each file (replaces global inputs)
    setFileSettings(selected.map(() => ({ ...DEFAULT_FILE_SETTINGS })));
  };

  // Drag-and-drop handlers
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
    if (dropped.length) {
      setFiles(dropped);
      setFileSettings(dropped.map(() => ({ ...DEFAULT_FILE_SETTINGS })));
    }
  };

  // Update a specific file's setting
  const updateFileSetting = (index, key, value) => {
    setFileSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [key]: value } : s))
    );
  };

  // Increment / decrement copies for a file
  const adjustCopies = (index, delta) => {
    setFileSettings((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, copies: Math.max(1, (s.copies || 1) + delta) } : s
      )
    );
  };

  // Remove a single file from the list
  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileSettings((prev) => prev.filter((_, i) => i !== index));
  };

  // Live cost — recomputed whenever files, settings, urgency, or queue size changes
  const cost = fileSettings.length > 0
    ? computeCost(fileSettings, urgencyLevel, queueSize)
    : null;

  // Approximate queue position after submitting with chosen urgency
  function estimatedPosition() {
    if (urgencyLevel === "URGENT") return Math.min(2, queueSize + 1);
    if (urgencyLevel === "SOON")   return Math.min(Math.ceil(queueSize / 2) + 1, queueSize + 1);
    return queueSize + 1;
  }

  const handleClear = () => {
    setFiles([]);
    setFileSettings([]);
    setUrgencyLevel("NORMAL");
    setError(null);
    setSuccess(null);
    setUrgentCooldownMsg(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setUrgentCooldownMsg(null);

    // ✅ validation
    if (!files.length) {
      setError("Please select at least one PDF file");
      return;
    }

    const formData = new FormData();

    // append all files
    files.forEach((file) => formData.append("files", file));

    // ❗ send per-file settings instead of global fields
    formData.append("fileSettings", JSON.stringify(fileSettings));

    // urgency_level replaces the old deadline field
    formData.append("urgency_level", urgencyLevel);

    try {
      const response = await printJobService.createPrintJob(formData);
      const newJobId = response.data.job_id;

      addActiveJob(newJobId); // ✅ add to active jobs list

      // Show confirmed cost from server (authoritative — matches what backend calculated)
      const p = response.data.pricing;
      const costLine = p
        ? ` · ₹${p.base_total} base${p.urgency_extra > 0 ? ` + ₹${p.urgency_extra} urgency` : ""} = ₹${p.grand_total} total`
        : "";

      setSuccess(`Job submitted — tracking ${newJobId.slice(0, 8)}…${costLine}`);

      // reset state
      setFiles([]);
      setFileSettings([]);
      setUrgencyLevel("NORMAL");

      // Refresh queue size after submission
      fetchQueueStatus();
    } catch (err) {
      const serverError = err.response?.data?.error;

      // 429 = abuse protection triggered — show the specific reason prominently
      if (err.response?.status === 429) {
        setUrgentCooldownMsg(serverError);
        setError(null);
      } else {
        setError(serverError || "Upload failed");
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>

      {/* ── 1️⃣ Drop zone ─────────────────────────────────────────────────── */}
      <div
        className={`upload-zone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept="application/pdf"
          onChange={handleFilesChange}
        />
        <div className="upload-zone-icon">📁</div>
        <h3>Drop files here or click to upload</h3>
        <p>Configure copies, colour, and duplex per file</p>
        <div style={{ marginTop: "8px" }}>
          {["PDF", "DOCX", "PNG", "JPG"].map((t) => (
            <span key={t} className="file-type-tag">{t}</span>
          ))}
        </div>
      </div>

      {/* ── 2️⃣ Per-file cards (replaces old table) ──────────────────────── */}
      {files.map((file, index) => (
        <div key={index} className="file-card">
          <div className="file-card-icon">📄</div>

          <div className="file-card-info">
            <div className="file-card-name">{file.name}</div>
            <div className="file-card-meta">
              {(file.size / 1024).toFixed(0)} KB
              {cost?.breakdown[index] != null && (
                <> · est. ₹{cost.breakdown[index].fileCost}</>
              )}
            </div>
          </div>

          <div className="file-card-controls">
            {/* Copies +/- */}
            <div className="copies-ctrl">
              <button type="button" className="copies-btn" onClick={() => adjustCopies(index, -1)}>−</button>
              <span className="copies-num">{fileSettings[index]?.copies ?? 1}</span>
              <button type="button" className="copies-btn" onClick={() => adjustCopies(index, +1)}>+</button>
            </div>

            {/* Color / B&W */}
            <select
              className="file-select"
              value={fileSettings[index]?.color ? "color" : "bw"}
              onChange={(e) => updateFileSetting(index, "color", e.target.value === "color")}
            >
              <option value="bw">B&amp;W</option>
              <option value="color">Colour</option>
            </select>

            {/* Single / Double sided — full labels, browser will truncate only if truly no space */}
            <select
              className="file-select"
              value={fileSettings[index]?.double_sided ? "double" : "single"}
              onChange={(e) => updateFileSetting(index, "double_sided", e.target.value === "double")}
            >
              <option value="single">Single sided</option>
              <option value="double">Double sided</option>
            </select>
            {/* After the double_sided <select> */}
            <select
              className="file-select"
              value={fileSettings[index]?.orientation || "portrait"}
              onChange={(e) => updateFileSetting(i, "orientation", e.target.value)}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>

            <select
              className="file-select"
              value={fileSettings[index]?.paper_size || "A4"}
              onChange={(e) => updateFileSetting(i, "paper_size", e.target.value)}
            >
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
              <option value="A3">A3</option>
            </select>

            {/* Remove file */}
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => removeFile(index)}
              title="Remove file"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {/* ── 3️⃣ Priority selector (replaces free-form deadline) ─────────────── */}
      <div style={{ marginTop: "20px", marginBottom: "16px" }}>
        <div className="form-label" style={{ marginBottom: "10px" }}>Priority</div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {PRIORITY_OPTIONS.map((opt) => {
            const isUrgentOpt = opt.value === "URGENT";
            const isDisabled  = isUrgentOpt && (urgentDisabled || Boolean(urgentCooldownMsg));
            const isSelected  = urgencyLevel === opt.value;

            return (
              <label
                key={opt.value}
                style={{
                  flex: "1 1 140px",
                  border: `1.5px solid ${isSelected ? opt.borderColor : "var(--border-2)"}`,
                  borderRadius: "var(--r)",
                  padding: "12px 14px",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  opacity: isDisabled ? 0.4 : 1,
                  background: isSelected ? opt.bgColor : "var(--paper2)",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <input
                  type="radio"
                  name="urgency"
                  value={opt.value}
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => !isDisabled && setUrgencyLevel(opt.value)}
                  style={{ display: "none" }}
                />
                <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "3px" }}>
                  {opt.emoji} {opt.label}
                </div>
                <div className="mono-sm" style={{ marginBottom: "4px" }}>{opt.sublabel}</div>
                <div style={{
                  fontFamily: "var(--mono)", fontSize: "11px", fontWeight: 500,
                  color: isSelected ? opt.textColor : "var(--gray)",
                }}>
                  {opt.priceTag}
                </div>
              </label>
            );
          })}
        </div>

        {/* Urgent disabled messages */}
        {urgentDisabled && (
          <div className="deadline-warn" style={{ marginTop: "10px" }}>
            <span>🚫</span>
            <span>Urgent unavailable — queue is at peak load. Try Normal or Soon.</span>
          </div>
        )}
        {urgentCooldownMsg && (
          <div className="deadline-warn" style={{ marginTop: "10px" }}>
            <span>⏱️</span>
            <span>{urgentCooldownMsg}</span>
          </div>
        )}
      </div>

      {/* ── 4️⃣ Queue transparency + live cost estimate ───────────────────── */}
      {files.length > 0 && cost && (
        <div className="card card-padded" style={{ marginBottom: "20px" }}>

          {/* Queue position */}
          <div style={{ display: "flex", gap: "20px", marginBottom: "14px", flexWrap: "wrap" }}>
            <div>
              <div className="form-label">Queue size</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "20px", fontWeight: 500 }}>
                {queueSize} <span style={{ fontSize: "12px", color: "var(--gray)" }}>job{queueSize !== 1 ? "s" : ""}</span>
              </div>
            </div>
            <div>
              <div className="form-label">Your position</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "20px", fontWeight: 500, color: "var(--amber-dark)" }}>
                #{estimatedPosition()}
              </div>
            </div>
            <div>
              <div className="form-label">Estimated cost</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "20px", fontWeight: 500, color: "var(--teal)" }}>
                ₹{cost.grandTotal}
              </div>
            </div>
          </div>

          {/* Cost breakdown */}
          <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: "12px" }}>
            {cost.breakdown.map((b, i) => (
              <div key={i} className="mono-sm" style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span>{files[i]?.name} · {b.copies}× · {b.color ? "Colour" : "B&W"} · {b.doubleSided ? "Duplex" : "Single"}</span>
                <span style={{ color: "var(--gray-dark)", whiteSpace: "nowrap", marginLeft: "12px" }}>
                  ₹{b.rate}/pg × {b.pages} = ₹{b.fileCost}
                </span>
              </div>
            ))}

            <div style={{ borderTop: "0.5px solid var(--border)", marginTop: "8px", paddingTop: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }} className="mono-sm">
                <span>Base total</span><span>₹{cost.baseTotal}</span>
              </div>
              {cost.urgencyExtra > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--amber-dark)" }} className="mono-sm">
                  <span>
                    Urgency surcharge ({urgencyLevel === "SOON" ? "+20%" : queueSize >= QUEUE_LARGE_THRESHOLD ? "+80%" : "+50%"})
                  </span>
                  <span>+₹{cost.urgencyExtra}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginTop: "4px" }} className="mono-sm">
                <span>Total</span>
                <span style={{ color: "var(--teal)", fontSize: "13px" }}>₹{cost.grandTotal}</span>
              </div>
            </div>

            <div className="mono-sm" style={{ marginTop: "8px", color: "var(--gray)" }}>
              * Page count estimated at 1 page per file. Actual cost confirmed after upload.
            </div>
          </div>
        </div>
      )}

      {/* ── 5️⃣ Action row ────────────────────────────────────────────────── */}
      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={handleClear}>
          clear all
        </button>
        <button type="submit" className="btn btn-primary">
          submit job →
        </button>
      </div>

      {/* ── Response messages ──────────────────────────────────────────────── */}
      {success && <div className="alert alert-success">{success}</div>}
      {error   && <div className="alert alert-error">{error}</div>}

    </form>
  );
}

export default UploadForm;