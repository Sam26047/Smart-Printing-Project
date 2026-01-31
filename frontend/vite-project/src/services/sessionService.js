import axios from "axios";

const baseUrl = "http://38.242.129.188:5000";

let token = null;

const setToken = (newToken) => {
    token = `Bearer ${newToken}`;
};

const authConfig = () => ({
    headers: { Authorization:token },
});

const getActivejob = async ()=>{
    const response = await axios.get(
        `${baseUrl}/users/me/active-job`,
        authConfig()
    );
    return response.data;
};

export default {
    setToken,
    getActivejob
};