import axios from "axios";

const baseUrl = "http://38.242.129.188:5000/print-jobs";

const getAllJobs = () => {
  return axios.get(baseUrl);
};

const updatePriority = (id, priority) => {
  return axios.patch(`${baseUrl}/${id}/priority`, { priority });
};

const updateStatus = (id, status) => {
  return axios.patch(`${baseUrl}/${id}/status`, { status });
};

export default {
  getAllJobs,
  updatePriority,
  updateStatus,
};
