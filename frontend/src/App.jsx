// frontend/src/App.jsx
import UploadForm from "./components/UploadForm";
import AdminQueue from "./components/AdminQueue";
import LoginForm from "./components/LoginForm";
import RegisterForm from "./components/RegisterForm";
import AdminUsers from "./components/AdminUsers";
import JobStatus from "./components/JobStatus";
import JobHistory from "./components/JobHistory";
import { useAuth } from "./hooks/useAuth";

function App() {
  const { user, activeJobIds, handleRegister, handleLogin, logout } = useAuth();
  //custom hook function that developers make for auth

  return (
    <div>
      <h1>Smart Printing System</h1>
      {!user ? (//if not existing user give login and register form
        <>
          <LoginForm onLogin={handleLogin} />
          <RegisterForm onRegister={handleRegister} />
        </>
      ) : ( //if existing user give pdf upload form
        <div>
          <p>Welcome {user.username}</p>
          <button onClick={logout}>Logout</button>

          <UploadForm />

          {/* ✅ Render a JobStatus card for each active job */}
          {activeJobIds.map((jobId) => (
            <JobStatus key={jobId} jobId={jobId} />
          ))}

          <hr />
          <JobHistory />
        </div>
      )}

      {user?.role === "ADMIN" && (
        <>
          <hr />
          <AdminQueue />
          <AdminUsers />
        </>
      )}
    </div>
  );
}

export default App;