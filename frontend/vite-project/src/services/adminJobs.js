import axios from "axios";

const baseUrl = "http://38.242.129.188:5000/print-jobs";


let token = null;

const setToken = (newToken)=>{
    token = `Bearer ${newToken}`;
};

const authConfig = () => ({
    headers: {
        Authorization: token,
    },
});

//ADMIN paths so need jwt auth

const getAllJobs = () => {
  return axios.get(`${baseUrl}`,authConfig()); //authconfig attaches auth header to the request
};

const updatePriority = (id, priority) => {
  return axios.patch(`${baseUrl}/${id}/priority`, { priority },authConfig());
};

const updateStatus = (id, status) => {
  return axios.patch(`${baseUrl}/${id}/status`, { status },authConfig());
};

export default {
  setToken,
  getAllJobs,
  updatePriority,
  updateStatus,
};
