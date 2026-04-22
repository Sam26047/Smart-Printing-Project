import { useState } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";

const DEFAULT_FILE_SETTINGS = { copies: 1, color: false, double_sided: false };

function UploadForm() {
  const { addActiveJob } = useAuth(); // ✅ get addActiveJob from context

  const [files, setFiles] = useState([]);
  const [fileSettings, setFileSettings] = useState([]); // one entry per file (NEW: replaces global copies/color/double_sided)
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // When user selects files → initialize default settings per file
  const handleFilesChange = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(selected);

    // ✅ initialise settings for each file (replaces global inputs)
    setFileSettings(selected.map(() => ({ ...DEFAULT_FILE_SETTINGS })));
  };

  // Update a specific file's setting
  const updateFileSetting = (index, key, value) => {
    setFileSettings((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [key]: value } : s))
    );
  };

  // Returns true if deadline is less than 30 minutes from now
  const isDeadlineTight = () => {
    if (!deadline) return false;
    const diffMs = new Date(deadline) - new Date();
    return diffMs > 0 && diffMs < 30 * 60 * 1000;
  };

  // Minimum datetime string for the input (now, rounded to minute)
  const minDatetime = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    // ✅ validation
    if (!files.length) {
      setError("Please select at least one PDF file");
      return;
    }

    // Block past deadlines
    if (deadline && new Date(deadline) <= new Date()) {
      setError("Deadline must be in the future");
      return;
    }

    const formData = new FormData();

    // append all files
    files.forEach((file) => formData.append("files", file));

    // ❗ NEW: send per-file settings instead of global fields
    formData.append("fileSettings", JSON.stringify(fileSettings));

    // optional deadline
    if (deadline) formData.append("deadline", deadline);

    try {
      const response = await printJobService.createPrintJob(formData);

      const newJobId = response.data.job_id;

      addActiveJob(newJobId); // ✅ add to active jobs list

      setSuccess(`Job submitted! Tracking job ${newJobId.slice(0, 8)}...`);

      // reset state
      setFiles([]);
      setFileSettings([]);
      setDeadline("");
    } catch (err) {
      setError("Upload failed");
    }
  };

  return (
    <div>
      <h2>Upload Documents</h2>

      <form onSubmit={handleSubmit}>
        {/* File picker */}
        <div>
          <input
            type="file"
            multiple
            accept="application/pdf"
            onChange={handleFilesChange}
          />
        </div>

        {/* 2️⃣ Per-file settings (replaces global copies/color/double_sided inputs) */}
        {files.length > 0 && (
          <table
            border="1"
            cellPadding="6"
            style={{ marginTop: "12px", borderCollapse: "collapse" }}
          >
            <thead>
              <tr>
                <th>File</th>
                <th>Copies</th>
                <th>Color</th>
                <th>Sides</th>
              </tr>
            </thead>

            <tbody>
              {files.map((file, index) => (
                <tr key={index}>
                  <td>{file.name}</td>

                  <td>
                    <input
                      type="number"
                      min="1"
                      value={fileSettings[index]?.copies ?? 1}
                      onChange={(e) =>
                        updateFileSetting(
                          index,
                          "copies",
                          parseInt(e.target.value) || 1
                        )
                      }
                      style={{ width: "60px" }}
                    />
                  </td>

                  <td>
                    <select
                      value={fileSettings[index]?.color ? "color" : "bw"}
                      onChange={(e) =>
                        updateFileSetting(
                          index,
                          "color",
                          e.target.value === "color"
                        )
                      }
                    >
                      <option value="bw">Black & White</option>
                      <option value="color">Color</option>
                    </select>
                  </td>

                  <td>
                    <select
                      value={
                        fileSettings[index]?.double_sided ? "double" : "single"
                      }
                      onChange={(e) =>
                        updateFileSetting(
                          index,
                          "double_sided",
                          e.target.value === "double"
                        )
                      }
                    >
                      <option value="single">Single sided</option>
                      <option value="double">Double sided</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 3️⃣ Deadline picker */}
        <div style={{ marginTop: "12px" }}>
          <label>
            Deadline (optional):
            <input
              type="datetime-local"
              value={deadline}
              min={minDatetime()}
              onChange={(e) => setDeadline(e.target.value)}
              style={{ marginLeft: "8px" }}
            />
          </label>

          {isDeadlineTight() && (
            <p style={{ color: "orange", margin: "4px 0 0" }}>
              ⚠️ Deadline is less than 30 minutes away — printing may not finish in time.
            </p>
          )}
        </div>

        <button type="submit" style={{ marginTop: "12px" }}>
          Submit
        </button>
      </form>

      {/* 4️⃣ response messages */}
      {success && <p style={{ color: "green" }}>{success}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default UploadForm;