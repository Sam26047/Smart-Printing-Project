// frontend/src/components/UploadForm.jsx
import { useState, useEffect } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";
import PaymentStep from "./PaymentStep";

const DEFAULT_FILE_SETTINGS = {
  copies: 1,
  color: false,
  double_sided: false,
  orientation: "portrait",  
  paper_size: "A4",          
};

// ─── Pricing ──────────────────────────────────────────────────────────────────
// ALL pricing math lives on the server (per-shop rates + queue-dependent
// urgency). The form debounces settings changes and asks POST
// /print-jobs/estimate — the browser only displays what the server returns.

// ─── Priority level definitions ───────────────────────────────────────────────
const PRIORITY_OPTIONS = [
  { value: "NORMAL", emoji: "🟢", label: "Normal", sublabel: "Standard queue",  priceTag: "No extra charge",   borderColor: "var(--teal)",       bgColor: "var(--teal-lite)",  textColor: "var(--teal-dark)"  },
  { value: "SOON",   emoji: "🟡", label: "Soon",   sublabel: "2 – 4 hours",     priceTag: "+20%",              borderColor: "var(--amber)",      bgColor: "var(--amber-lite)", textColor: "var(--amber-dark)" },
  { value: "URGENT", emoji: "🔴", label: "Urgent", sublabel: "30 – 60 mins",    priceTag: "+50% / +80% busy",  borderColor: "var(--rose)",       bgColor: "var(--rose-lite)",  textColor: "var(--rose-dark)"  },
];

function UploadForm() {
  const { addActiveJob, user } = useAuth(); // ✅ get addActiveJob from context

  // Shop choice persists per user (shared lab/library machines are normal on
  // campus — one global key would leak the previous student's choice)
  const shopStorageKey = user?.username ? `selectedPrintShop:${user.username}` : null;

  const [files, setFiles]               = useState([]);
  const [fileSettings, setFileSettings] = useState([]); // one entry per file (replaces global copies/color/double_sided)
  const [urgencyLevel, setUrgencyLevel] = useState("NORMAL"); // replaces free-form deadline
  const [dragging, setDragging]         = useState(false);
  const [error, setError]               = useState(null);
  const [success, setSuccess]           = useState(null);

  // Queue status — fetched on mount, on shop change, and after each submission.
  // Used to show queue position and disable Urgent during peak load.
  const [queueSize, setQueueSize]               = useState(0);
  const [urgentDisabled, setUrgentDisabled]     = useState(false);
  const [urgentCooldownMsg, setUrgentCooldownMsg] = useState(null); // set on 429 response

  // Shop selection — pricing, queue, and urgent-lockout are all PER SHOP.
  // Auto-selected and hidden when only one shop exists; an explicit pick is
  // required once there are several.
  const [shops, setShops]                   = useState([]);
  const [selectedShopId, setSelectedShopId] = useState("");

  // Server-authoritative live estimate (response of POST /print-jobs/estimate)
  const [estimate, setEstimate]     = useState(null);
  const [estimating, setEstimating] = useState(false);

  const multiShop  = shops.length > 1;
  const shopChosen = Boolean(selectedShopId);

  // Fetch queue status for the selected shop (per-shop numbers)
  const fetchQueueStatus = async (shopId = selectedShopId) => {
    try {
      const res = await printJobService.getQueueStatus(shopId);
      setQueueSize(res.data.queue_size);
      setUrgentDisabled(res.data.urgent_disabled);
    } catch {
      // non-critical — fail silently, UI still works without it
    }
  };

  // Load shops once; auto-select when there's only one. With several shops,
  // rehydrate the user's persisted choice — but only if that shop still
  // exists in the fetched list; otherwise fall back to the pick-a-shop
  // prompt (no error). Rehydration sets selectedShopId through the same
  // state as a manual pick, so the estimate + queue-status effects re-fire
  // identically.
  useEffect(() => {
    printJobService.getShops()
      .then((res) => {
        const list = res.data.shops || [];
        setShops(list);
        if (list.length === 1) {
          setSelectedShopId(list[0].id); // single-shop: selector stays hidden
        } else if (shopStorageKey) {
          const saved = localStorage.getItem(shopStorageKey);
          if (saved && list.some((s) => s.id === saved)) {
            setSelectedShopId(saved);
          }
        }
      })
      .catch(() => { /* non-critical — dropdown just won't populate */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch queue status whenever the chosen shop changes (position + Urgent
  // lockout must reflect the shop being submitted to, not a global view)
  useEffect(() => {
    if (selectedShopId) fetchQueueStatus(selectedShopId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShopId]);

  // Live estimate — debounced 400ms after any file-settings/urgency change so
  // the displayed number always comes from the same server pricing path that
  // locks the cost at submission. Previous estimate stays visible while the
  // new one is in flight (no flicker).
  useEffect(() => {
    // Need files AND a chosen shop — pricing is per-shop, so an estimate
    // without a shop would be meaningless (and the server would reject it).
    if (fileSettings.length === 0 || !selectedShopId) {
      setEstimate(null);
      return;
    }
    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const res = await printJobService.estimateJob({
          fileSettings,
          urgency_level: urgencyLevel,
          shop_id: selectedShopId,
        });
        setEstimate(res.data);
      } catch {
        // non-critical — keep showing the previous estimate
      } finally {
        setEstimating(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [fileSettings, urgencyLevel, selectedShopId]);

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

  // Server-computed cost (null until the first estimate response arrives)
  const cost = fileSettings.length > 0 ? estimate?.pricing || null : null;

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
    // selectedShopId is intentionally preserved — clearing files shouldn't
    // force the user to re-pick their shop.
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
    if (!selectedShopId) {
      setError("Please choose a print shop");
      return;
    }

    const formData = new FormData();

    // append all files
    files.forEach((file) => formData.append("files", file));

    // ❗ send per-file settings instead of global fields
    formData.append("fileSettings", JSON.stringify(fileSettings));

    // urgency_level replaces the old deadline field
    formData.append("urgency_level", urgencyLevel);

    // per-shop routing/pricing — required now that more than one shop exists
    formData.append("shop_id", selectedShopId);

    try {
      const response = await printJobService.createPrintJob(formData);
      const newJobId = response.data.job_id;

      addActiveJob(newJobId); // ✅ add to active jobs list

      // The LOCKED total from the server — computed with real pdf-lib page
      // counts at insert time. This is the number the student pays.
      setSuccess({
        jobId: newJobId,
        fileNames: files.map((f) => f.name),
        pricing: response.data.pricing,
      });

      // reset state
      setFiles([]);
      setFileSettings([]);
      setUrgencyLevel("NORMAL");
      setEstimate(null);

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
    // data-tour-shop-count lets the demo tour distinguish "selector hidden
    // because single shop" (skip its step) from "shops still loading" (wait)
    <form onSubmit={handleSubmit} data-tour-shop-count={shops.length}>

      {/* ── 0️⃣ Shop selector — only shown when there's a choice to make ───── */}
      {multiShop && (
        <div className="form-group" style={{ marginBottom: "16px" }}>
          <label className="form-label" htmlFor="shop-select">Print shop</label>
          <select
            id="shop-select"
            data-tour="shop-select"
            className="form-select"
            value={selectedShopId}
            onChange={(e) => {
              setSelectedShopId(e.target.value);
              // persist explicit picks only (not the single-shop auto-select)
              if (shopStorageKey && e.target.value) {
                localStorage.setItem(shopStorageKey, e.target.value);
              }
            }}
          >
            <option value="">Select a shop…</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {!shopChosen && (
            <div className="mono-sm" style={{ color: "var(--gray)", marginTop: "6px" }}>
              Pick a print shop to see pricing and submit.
            </div>
          )}
        </div>
      )}

      {/* ── 1️⃣ Drop zone ─────────────────────────────────────────────────── */}
      <div
        className={`upload-zone${dragging ? " dragging" : ""}`}
        data-tour="upload-zone"
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
        <div key={index} className="file-card" data-tour={index === 0 ? "file-card" : undefined}>
          <div className="file-card-icon">📄</div>

          <div className="file-card-info">
            <div className="file-card-name">{file.name}</div>
            <div className="file-card-meta">
              {(file.size / 1024).toFixed(0)} KB
              {cost?.breakdown[index] != null && (
                <> · est. ₹{cost.breakdown[index].file_cost}</>
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
              onChange={(e) => updateFileSetting(index, "orientation", e.target.value)}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>

            <select
              className="file-select"
              value={fileSettings[index]?.paper_size || "A4"}
              onChange={(e) => updateFileSetting(index, "paper_size", e.target.value)}
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
              <div className="form-label">
                Estimated cost{estimating && <span style={{ color: "var(--gray)" }}> · updating…</span>}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "20px", fontWeight: 500, color: "var(--teal)" }}>
                ₹{cost.grand_total}
              </div>
            </div>
          </div>

          {/* Cost breakdown — every number below comes from the server */}
          <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: "12px" }}>
            {cost.breakdown.map((b, i) => (
              <div key={i} className="mono-sm" style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span>{files[i]?.name} · {b.copies}× · {b.color ? "Colour" : "B&W"} · {b.double_sided ? "Duplex" : "Single"}</span>
                <span style={{ color: "var(--gray-dark)", whiteSpace: "nowrap", marginLeft: "12px" }}>
                  ₹{b.rate_per_page}/pg × {b.estimated_pages} = ₹{b.file_cost}
                </span>
              </div>
            ))}

            <div style={{ borderTop: "0.5px solid var(--border)", marginTop: "8px", paddingTop: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }} className="mono-sm">
                <span>Base total</span><span>₹{cost.base_total}</span>
              </div>
              {cost.urgency_extra > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--amber-dark)" }} className="mono-sm">
                  <span>Urgency surcharge (+{Math.round((cost.urgency_multiplier - 1) * 100)}%)</span>
                  <span>+₹{cost.urgency_extra}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginTop: "4px" }} className="mono-sm">
                <span>Total</span>
                <span style={{ color: "var(--teal)", fontSize: "13px" }}>₹{cost.grand_total}</span>
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
        <button type="submit" className="btn btn-primary" data-tour="submit-btn" disabled={!shopChosen}>
          submit job →
        </button>
      </div>

      {/* ── Locked-total confirmation (payment anchor) ────────────────────── */}
      {success && (
        <div
          className="card card-padded"
          data-tour="locked-total"
          data-tour-job-id={success.jobId}
          style={{ marginTop: "16px", borderLeft: "3px solid var(--teal)" }}
        >
          <div className="form-label">job submitted · locked total</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "32px", fontWeight: 600, color: "var(--teal)", margin: "4px 0 2px" }}>
            ₹{success.pricing?.grand_total}
          </div>
          <div className="mono-sm" style={{ color: "var(--gray-dark)", marginBottom: "10px" }}>
            this is the amount payable · tracking {success.jobId.slice(0, 8)}…
          </div>

          {/* Final per-file breakdown with REAL page counts from the server */}
          {success.pricing?.breakdown?.map((b, i) => (
            <div key={i} className="mono-sm" style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
              <span>{success.fileNames[i]} · {b.copies}× · {b.color ? "Colour" : "B&W"} · {b.double_sided ? "Duplex" : "Single"}</span>
              <span style={{ color: "var(--gray-dark)", whiteSpace: "nowrap", marginLeft: "12px" }}>
                ₹{b.rate_per_page}/pg × {b.estimated_pages} pg = ₹{b.file_cost}
              </span>
            </div>
          ))}
          {success.pricing?.urgency_extra > 0 && (
            <div className="mono-sm" style={{ display: "flex", justifyContent: "space-between", color: "var(--amber-dark)" }}>
              <span>Urgency surcharge</span>
              <span>+₹{success.pricing.urgency_extra}</span>
            </div>
          )}

          {/* Pay right here — the job won't enter the print queue until the
              payment webhook confirms (or the shopkeeper queues it for cash) */}
          <div style={{ borderTop: "0.5px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
            <PaymentStep
              jobId={success.jobId}
              amount={success.pricing?.grand_total}
              paymentStatus="UNPAID"
            />
          </div>
        </div>
      )}

      {/* ── Response messages ──────────────────────────────────────────────── */}
      {error && <div className="alert alert-error">{error}</div>}

    </form>
  );
}

export default UploadForm;