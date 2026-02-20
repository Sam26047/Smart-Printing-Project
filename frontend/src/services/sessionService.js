// frontend/src/services/sessionService.js
import apiClient from "./apiClient";

const getActiveJob = async () => {
  const response = await apiClient.get("/users/me/active-job");
  return response.data;
};

export default {
  getActiveJob,
};