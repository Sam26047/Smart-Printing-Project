import axios from "axios";

// const baseUrl = "http://38.242.129.188:5000/users";
const baseUrl = "http://localhost:5000/users";
let token = null;

const setToken = (newToken) => {
  token = `Bearer ${newToken}`;
};

const authConfig = () => ({
  headers: {
    Authorization: token,
  },
});

const getAllUsers = () => {
  return axios.get(baseUrl, authConfig());
};

const updateUserRole = (id, role) => {
  return axios.patch(`${baseUrl}/${id}/role`, { role }, authConfig());
};

export default {
  setToken,
  getAllUsers,
  updateUserRole,
};
