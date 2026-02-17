import axios from "axios";

// const baseUrl = "http://38.242.129.188:5000";
//later we'll use env vars

const baseUrl = "http://localhost:5000";

let token = null;

const setToken = (newToken) => {
  token = `Bearer ${newToken}`;
};

const authConfig = () => ({
  headers: {
    Authorization: token,
  },
});

const createPrintJob = (formData)=>{
    return axios.post(`${baseUrl}/print-jobs`,formData,authConfig());
};

const getJobById = (id)=>{
    return axios.get(`${baseUrl}/print-jobs/${id}`);
};

const collectPrintJob = (otp,id)=>{
    return axios.post(`${baseUrl}/print-jobs/${id}/collect`,{ otp },authConfig()); //because this data is sent in application/json format
};                                                              //i.e as raw json object

const regenerateOtp = (id) => { //because in post(url,data,config) so need to pass {} or auth header considered data payload
  return axios.post(`${baseUrl}/print-jobs/${id}/regenerate-otp`,{},authConfig());
};

export default {
    setToken,
    createPrintJob,
    getJobById,
    collectPrintJob,
    regenerateOtp
};