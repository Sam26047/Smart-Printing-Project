// frontend/src/services/adminUsers.js
import apiClient from "./apiClient";

const getAllUsers = () => {
  return apiClient.get("/users");
};

const updateUserRole = (id, role) => {
  return apiClient.patch(`/users/${id}/role`, { role });
};

export default {
  getAllUsers,
  updateUserRole,
};