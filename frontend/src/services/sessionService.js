// frontend/src/services/sessionService.js
import apiClient from "./apiClient";

const getActiveJobs = async () => {
  const response = await apiClient.get("/users/me/active-job");
  return response.data; // { jobIds: [...] }
};

export default { getActiveJobs };