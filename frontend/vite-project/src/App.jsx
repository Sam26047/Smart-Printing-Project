import UploadForm from "./components/UploadForm";
import AdminQueue from "./components/AdminQueue";
import { useState, useEffect } from "react";
import authService from "./services/authService";
import adminJobs from "./services/adminJobs";
import LoginForm from "./components/LoginForm";

function App(){

  const [user, setUser] = useState(null);

  useEffect(() => { //restore login on every refresh,checks if user already exists
    const savedUser = localStorage.getItem("loggedPrintUser");
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      adminJobs.setToken(parsedUser.token); //.token means value of key token in the object
    }
  }, []);

  const handleLogin = async (credentials) =>{ //add new user,this method given to login form
    try{
      const userData = await authService.login(credentials); //request to /login route

      setUser(userData);
      localStorage.setItem("loggedPrintUser",JSON.stringify(userData));

      adminJobs.setToken(userData.token);
    }catch(err){
      alert("Invalid credentials");
    }
  };

  const logout = () => {
    localStorage.removeItem("loggedPrintUser");  //because we are not using refresh tokens so server cant explicitly logout a user, so no /logout path
    setUser(null);
    adminJobs.setToken(null);
  };


  return (
    <div>
      <h1>Smart Printing System</h1>
      {!user ? (
        <LoginForm onLogin={handleLogin} />  //return login form if non existing user
      ) : (                                  //if existing user give pdf upload form
        <div>
          <p>Welcome {user.username}</p> 
          <UploadForm />
          <button onClick={logout}>Logout</button>
        </div>
      )}
       
      <hr />
      {user?.role === 'ADMIN' && <AdminQueue />}
    </div>
  );
}

export default App
