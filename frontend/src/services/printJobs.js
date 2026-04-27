// frontend/vite-project/src/services/printJobs.js
import apiClient from "./apiClient";

const createPrintJob = (formData) => {
  return apiClient.post("/print-jobs", formData);
};

const getJobById = (id) => {
  return apiClient.get(`/print-jobs/${id}`);
};

const collectPrintJob = (otp, id) => {
  return apiClient.post(`/print-jobs/${id}/collect`, { otp }); //because this data is sent in application/json format
}; //i.e as raw json object

const regenerateOtp = (id) => {
  //because in post(url,data,config) so need to pass {} or auth header considered data payload
  return apiClient.post(`/print-jobs/${id}/regenerate-otp`, {});
};

// Fetches current queue size and whether urgent is disabled (peak load check)
// Used by UploadForm to show queue position and grey-out Urgent when needed
const getQueueStatus = () => {
  return apiClient.get("/print-jobs/queue/status");
};

export default {
  createPrintJob,
  getJobById,
  collectPrintJob,
  regenerateOtp,
  getQueueStatus,
};