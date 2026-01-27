import { useState} from "react";
import printJobService from "../services/printJobs";
import JobStatus from "./JobStatus";

function UploadForm(){
    const [files,setFiles] = useState([]);
    const [copies,setCopies] = useState(1);
    const [color,setColor] = useState(false);
    const [doubleSided,setDoubleSided] = useState(false);
    const [jobId, setJobId] = useState(null);
    const [error, setError] = useState(null);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);

        if(!files){
            setError("Please select a PDF file");
            return;
        }

        const formData = new FormData(); //FormData is a browser provided class that lets js build a multipart/form-data request
        files.forEach((file) => {
            formData.append("files", file); //append each file
        });
        formData.append("copies",copies);
        formData.append("color",color);
        formData.append("double_sided",doubleSided);

        try{
            const response = await printJobService.createPrintJob(formData);
            setJobId(response.data.job_id);
        }catch(err){
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
                    accept="application/pdf" //add multiple files
                    onChange={(e) => setFiles(Array.from(e.target.files))}
                    />
                </div>
                
                {files.length > 0 && ( //show selected files list on UI
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
                        values={copies}
                        min="1"
                        onChange={(event)=>setCopies(event.target.value)}
                    />
                </div>

                <div>
                    <label>
                        <input
                        type="checkbox"
                        checked={color}
                        onChange={() => setColor(!color)}
                        />
                        Color
                    </label>
                </div>

                <div>
                    <label>
                        <input
                        type="checkbox"
                        checked={doubleSided}
                        onChange={() => setDoubleSided(!doubleSided)}
                        />
                        Double sided
                    </label>
                </div>
                
                <button type="submit">Submit</button>

            </form>
            {jobId && <p>Job created successfully. Job ID: {jobId}</p>}
            {error && <p style={{ color: "red" }}>{error}</p>}
            {jobId && <JobStatus jobId={jobId} />}
        </div>
    );
}

export default UploadForm;