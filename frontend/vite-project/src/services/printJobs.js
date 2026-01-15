import axios from "axios";

const baseUrl = "http://38.242.129.188:5000";
//later we'll use env vars

const createPrintJob = (formData)=>{
    return axios.post(`${baseUrl}/print-jobs`,formData);
};

const getJobId = (id)=>{
    return axios.get(`${baseUrl}/print-jobs/${id}`);
};

const collectPrintJob = (otp)=>{
    return axios.post(`${baseUrl}/print-jobs/collect`,{ otp }); //because this data is sent in application/json format
};                                                              //i.e as raw json object

export default {
    createPrintJob,
    getJobId,
    collectPrintJob
};