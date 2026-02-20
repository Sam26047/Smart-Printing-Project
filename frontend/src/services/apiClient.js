// frontend/src/services/apiClient.js
import axios from "axios";

// const baseURL = "http://38.242.129.188:5000";
//latest env var after jwt implementation
const baseURL = "http://localhost:5000";

const apiClient = axios.create({
  baseURL,
});
//Think of axios.create() as making your own custom version of axios that remembers settings. When you set a header on apiClient.defaults.headers.common["Authorization"], every future request made with apiClient automatically includes that header — across all your service files.

// Single function to set token for ALL requests
export const setAuthToken = (token) => {
  if (token) {
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common["Authorization"];
  }
};

export default apiClient;