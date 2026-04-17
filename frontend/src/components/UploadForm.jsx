import { useState } from "react";
import printJobService from "../services/printJobs";
import { useAuth } from "../hooks/useAuth";

function UploadForm() {
  const { addActiveJob } = useAuth(); // ✅ get addActiveJob from context
  const [files, setFiles] = useState([]);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState(false);
  const [doubleSided, setDoubleSided] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!files.length) {
      setError("Please select a PDF file");
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("copies", copies);
    formData.append("color", color);
    formData.append("double_sided", doubleSided);

    try {
      const response = await printJobService.createPrintJob(formData);
      const newJobId = response.data.job_id;
      addActiveJob(newJobId); // ✅ add to active jobs list
      setSuccess(`Job submitted! Tracking job ${newJobId.slice(0, 8)}...`);
      setFiles([]);
    } catch (err) {
      setError("Upload failed");
    }
  };

  return (
    <div>
      <h2>Upload Document</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <input
            type="file"
            multiple
            accept="application/pdf"
            onChange={(e) => setFiles(Array.from(e.target.files))}
          />
        </div>
        {files.length > 0 && (
          <ul>
            {files.map((file, index) => (
              <li key={index}>{file.name}</li>
            ))}
          </ul>
        )}
        <div>
          Copies:
          <input
            type="number"
            value={copies}
            min="1"
            onChange={(e) => setCopies(e.target.value)}
          />
        </div>
        <div>
          <label>
            <input type="checkbox" checked={color} onChange={() => setColor(!color)} />
            Color
          </label>
        </div>
        <div>
          <label>
            <input type="checkbox" checked={doubleSided} onChange={() => setDoubleSided(!doubleSided)} />
            Double sided
          </label>
        </div>
        <button type="submit">Submit</button>
      </form>
      {success && <p style={{ color: "green" }}>{success}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default UploadForm;