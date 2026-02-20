// frontend/src/services/adminJobs.js
import apiClient from "./apiClient";

//ADMIN paths so need jwt auth

const getAllJobs = () => {
  return apiClient.get("/print-jobs"); //apiClient now automatically attaches auth header
};

const updatePriority = (id, priority) => {
  return apiClient.patch(`/print-jobs/${id}/priority`, { priority });
};

const updateStatus = (id, status) => {
  return apiClient.patch(`/print-jobs/${id}/status`, { status });
};

export default {
  getAllJobs,
  updatePriority,
  updateStatus,
};