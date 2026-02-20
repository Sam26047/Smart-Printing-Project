// frontend/vite-project/src/services/authService.js
import apiClient from "./apiClient";

const login = async (credentials) => {
  const response = await apiClient.post("/login", credentials);
  return response.data;
};

const register = async (credentials) => {
  const response = await apiClient.post("/register", credentials);
  return response.data;
};

export default { login, register };