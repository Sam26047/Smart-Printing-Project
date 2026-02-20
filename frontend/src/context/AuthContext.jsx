// frontend/vite-project/src/context/AuthContext.jsx
import { createContext, useState, useEffect } from "react";
import authService from "../services/authService";
import { setAuthToken } from "../services/apiClient";
import adminJobs from "../services/adminJobs";
import adminUsers from "../services/adminUsers";
import printJobs from "../services/printJobs";
import sessionService from "../services/sessionService";

//this file along with useAuth.js is used to establish global shared context for components which helps to prevent prop drilling

export const AuthContext = createContext(); // Creates the "channel" other components tune into

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);

  // Restore login on every refresh, checks if user already exists
  useEffect(() => {
    const savedUser = localStorage.getItem("loggedPrintUser");
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      setAuthToken(parsedUser.token); // Single call sets token for ALL services
    }
  }, []);

  // Fetch active job when user logs in
  useEffect(() => {
    if (!user) return;

    sessionService.getActiveJob().then((res) => {
      if (res.jobId) {
        setActiveJobId(res.jobId);
      }
    });
  }, [user]);

  const handleRegister = async (credentials) => {
    try {
      await authService.register(credentials);
      alert("Registration successful. Please log in.");
    } catch (err) {
      alert(err.response?.data?.error || "Registration failed");
    }
  };

  const handleLogin = async (credentials) => {
    //add new user, this method given to login form
    try {
      const userData = await authService.login(credentials); //request to /login route

      setUser(userData);
      localStorage.setItem("loggedPrintUser", JSON.stringify(userData));

      setAuthToken(userData.token); // Single call - no more manual setToken for each service
    } catch (err) {
      alert("Invalid credentials");
    }
  };

  const logout = () => {
    localStorage.removeItem("loggedPrintUser"); //because we are not using refresh tokens so server cant explicitly logout a user, so no /logout path
    setUser(null);
    setActiveJobId(null);
    setAuthToken(null); // Single call clears token
  };

  const clearActiveJob = () => {
    setActiveJobId(null);
  };


  //The AuthProvider component wraps your whole app and holds the state (user, activeJobId) and all the functions (handleLogin, logout, etc.). It then broadcasts all of this through AuthContext.Provider:

  return (
    <AuthContext.Provider
      value={{
        user,
        activeJobId,
        handleRegister,
        handleLogin,
        logout,
        clearActiveJob,
      }} 
      //children here means "whatever is wrapped inside <AuthProvider>". So in main.jsx, you'd wrap your whole app:
    >
      {children} 
    </AuthContext.Provider>
  );
}