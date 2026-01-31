import UploadForm from "./components/UploadForm";
import AdminQueue from "./components/AdminQueue";
import { useState, useEffect } from "react";
import authService from "./services/authService";
import adminJobs from "./services/adminJobs";
import LoginForm from "./components/LoginForm";
import RegisterForm from "./components/RegisterForm";
import adminUsers from "./services/adminUsers";
import AdminUsers from "./components/AdminUsers";
import sessionService from "./services/sessionService";
import JobStatus from "./components/JobStatus";

function App(){

  const [user, setUser] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);

  useEffect(() => { //restore login on every refresh,checks if user already exists
    const savedUser = localStorage.getItem("loggedPrintUser");
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      adminJobs.setToken(parsedUser.token); //.token means value of key token in the object
      adminUsers.setToken(parsedUser.token);
    }
  }, []);

  useEffect(()=>{
    if(!user) return;

    sessionService.setToken(user.token);

    sessionService.getActivejob().then((res)=>{
      if(res.jobId){
        setActiveJobId(res.jobId);
      }
    });
  },[user]);

  const handleRegister = async (credentials) => {
    try {
      await authService.register(credentials);
      alert("Registration successful. Please log in.");
    } catch (err) {
      alert(err.response?.data?.error || "Registration failed");
    }
  };

  const handleLogin = async (credentials) =>{ //add new user,this method given to login form
    try{
      const userData = await authService.login(credentials); //request to /login route

      setUser(userData);
      localStorage.setItem("loggedPrintUser",JSON.stringify(userData));

      adminJobs.setToken(userData.token);
      adminUsers.setToken(userData.token);
    }catch(err){
      alert("Invalid credentials");
    }
  };

  const logout = () => {
    localStorage.removeItem("loggedPrintUser");  //because we are not using refresh tokens so server cant explicitly logout a user, so no /logout path
    setUser(null);
    adminJobs.setToken(null);
    adminUsers.setToken(null);
  };

  return (
    <div>
      <h1>Smart Printing System</h1>
      {!user ? ( //if not existing user give login and register form
        <>  
          <LoginForm onLogin={handleLogin} />
          <RegisterForm onRegister={handleRegister} />
        </>
      ) : (                                  //if existing user give pdf upload form
        <div>
          <p>Welcome {user.username}</p> 
          <UploadForm />
          <button onClick={logout}>Logout</button>
          {activeJobId && <JobStatus jobId={activeJobId} clearActiveJob={() => setActiveJobId(null)}/>}
        </div>
      )}
       
      <hr />
      {user?.role === 'ADMIN' && (
        <>
          <AdminQueue />
          <AdminUsers />
        </>
      )}
    </div>
  );
}

export default App
