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
        }catch(err){
            setError("Invalid OTP or job not ready");
        }
    };

    if(message){
        return <p>{messsage}</p>;
    }

    return (
        <form onSubmit = {handleCollect}>
            <h3>Collect Print</h3>
            <input 
                value={otp}
                onChange={(event)=>setOtp(event.target.value)}
                placeholder="Enter OTP"
            />
            <button type="submit">Collect</button>
            {error && <p style={{color:"red"}}>{error}</p>}
        </form>
    );
};

export default CollectPrint;