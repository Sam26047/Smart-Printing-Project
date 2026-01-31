import {useState} from "react";
import printJobService from "../services/printJobs";

const CollectPrint = ({jobId})=>{
    const [otp,setOtp] = useState("");
    const [message,setMessage] = useState(null);
    const [error,setError] = useState(null);

    const handleCollect = async (event)=>{
        event.preventDefault();
        setError(null);

        try{
            await printJobService.collectPrintJob(otp,jobId);
            setMessage("Print collected successfully");
            clearActiveJob(); //clear activeJobId state variable
        }catch(err){
            setError("Invalid OTP or job not ready");
        }
    };

    const regenerateOtp = async ()=>{
        try{
            await printJobService.regenerateOtp(jobId);
            setMessage("New OTP generated. Check kiosk.");
            setError(null);
        }catch{
            setError("Failed to regenerate OTP");
        }
    };

    if(message){
        return <p>{message}</p>;
    }

    return (
        <div>
        <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="Enter OTP"
        />
        <button onClick={handleCollect}>Collect</button>
        <button onClick={regenerateOtp}>Resend OTP</button>

        {message && <p>{message}</p>}
        {error && <p style={{ color: "red" }}>{error}</p>}
        </div>
        
    );
};

export default CollectPrint;