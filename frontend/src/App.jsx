// frontend/src/App.jsx
import UploadForm from "./components/UploadForm";
import AdminQueue from "./components/AdminQueue";
import LoginForm from "./components/LoginForm";
import RegisterForm from "./components/RegisterForm";
import AdminUsers from "./components/AdminUsers";
import JobStatus from "./components/JobStatus";
import { useAuth } from "./hooks/useAuth";

function App() {
  const { user, activeJobId, handleRegister, handleLogin, logout, clearActiveJob } = useAuth(); //custom hook function that developers make for auth

  return (
    <div>
      <h1>Smart Printing System</h1>
      {!user ? ( //if not existing user give login and register form
        <>
          <LoginForm onLogin={handleLogin} />
          <RegisterForm onRegister={handleRegister} />
        </>
      ) : ( //if existing user give pdf upload form
        <div>
          <p>Welcome {user.username}</p>
          <UploadForm />
          <button onClick={logout}>Logout</button>
          {activeJobId && (
            <JobStatus jobId={activeJobId} clearActiveJob={clearActiveJob} />
          )}
        </div>
      )}

      <hr />
      {user?.role === "ADMIN" && (
        <>
          <AdminQueue />
          <AdminUsers />
        </>
      )}
    </div>
  );
}

export default App;