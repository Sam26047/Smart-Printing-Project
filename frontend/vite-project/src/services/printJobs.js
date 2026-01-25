import axios from "axios";

const baseUrl = "http://38.242.129.188:5000";
//later we'll use env vars

//PUBLIC -i.e need no auth token as no access to protected resources involved
const createPrintJob = (formData)=>{
    return axios.post(`${baseUrl}/print-jobs`,formData);
};

const getJobById = (id)=>{
    return axios.get(`${baseUrl}/print-jobs/${id}`);
};

const collectPrintJob = (otp,id)=>{
    return axios.post(`${baseUrl}/print-jobs/${id}/collect`,{ otp }); //because this data is sent in application/json format
};                                                              //i.e as raw json object

export default {
    createPrintJob,
    getJobById,
    collectPrintJob
};