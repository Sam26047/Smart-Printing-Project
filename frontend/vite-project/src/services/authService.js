import axios from "axios";

// const baseUrl = "http://38.242.129.188:5000"; //latest env var after jwt backend implementation
const baseUrl = "http://localhost:5000";

const login = async (credentials)=>{
    const response = await axios.post(`${baseUrl}/login`,credentials);
    return response.data;
};

const register = async (credentials) => {
  const response = await axios.post(`${baseUrl}/register`, credentials);
  return response.data;
};

export default { login, register };

