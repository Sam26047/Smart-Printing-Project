// frontend/src/App.jsx
import { useState } from "react";
import { useAuth } from "./hooks/useAuth"; //custom hook function that developers make for auth
import UploadForm from "./components/UploadForm";
import JobStatus from "./components/JobStatus";
import JobHistory from "./components/JobHistory";
import AdminQueue from "./components/AdminQueue";
import AdminUsers from "./components/AdminUsers";
import LoginForm from "./components/LoginForm";
import RegisterForm from "./components/RegisterForm";
import WelcomePage from "./components/WelcomePage";

// ── Navbar ────────────────────────────────────────────────
function Navbar({ user, logout }) {
  return (
    <header className="navbar">
      <div className="navbar-logo">
        <div className="navbar-logomark">P/</div>
        <span className="navbar-title">print<span>flow</span></span>
      </div>
      {user && (
        <div className="navbar-right">
          <span className="navbar-user">{user.email || user.username}</span>
          <span className={`role-badge ${user.role === "ADMIN" ? "admin" : ""}`}>
            {user.role?.toLowerCase() || "student"}
          </span>
          <button className="btn-logout" onClick={logout}>logout</button>
        </div>
      )}
    </header>
  );
}

// ── Tab Nav ───────────────────────────────────────────────
const USER_TABS  = ["home", "submit job", "my jobs"];
const ADMIN_TABS = ["home", "submit job", "my jobs", "admin queue", "admin users"];

function TabNav({ tabs, active, onSelect }) {
  return (
    <nav className="tab-nav">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={`tab-nav-item ${active === tab ? "active" : ""}`}
          onClick={() => onSelect(tab)}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const { user, activeJobIds, handleRegister, handleLogin, logout } = useAuth();
  const [showRegister, setShowRegister] = useState(false);

  // Start on "home" so new users see the welcome/explainer page first
  const [activeTab, setActiveTab] = useState("home");

  const tabs = user?.role === "ADMIN" ? ADMIN_TABS : USER_TABS;

  // "Get Started" on WelcomePage jumps straight to Submit Job tab
  const handleGetStarted = () => setActiveTab("submit job");

  if (!user) { //if not existing user give login and register form
    return (
      <div className="app-shell">
        <header className="navbar">
          <div className="navbar-logo">
            <div className="navbar-logomark">P/</div>
            <span className="navbar-title">print<span>flow</span></span>
          </div>
        </header>

        <div className="auth-wrap">
          <div className="auth-card">
            <div className="auth-logomark">P/</div>
            <div className="auth-heading">
              <h2>printflow</h2>
              <p>campus print management</p>
            </div>

            {showRegister ? (
              <>
                <RegisterForm onRegister={handleRegister} />
                <div className="auth-toggle">
                  already have an account?{" "}
                  <button onClick={() => setShowRegister(false)}>sign in</button>
                </div>
              </>
            ) : (
              <>
                <LoginForm onLogin={handleLogin} />
                <div className="auth-toggle">
                  don't have an account?{" "}
                  <button onClick={() => setShowRegister(true)}>register here</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar user={user} logout={logout} />
      <TabNav tabs={tabs} active={activeTab} onSelect={setActiveTab} />

      <main className="page-content">

        {/* WelcomePage receives onGetStarted so its CTA button navigates to submit job */}
        {activeTab === "home" && (
          <WelcomePage onGetStarted={handleGetStarted} />
        )}

        {activeTab === "submit job" && (
          <>
            <div className="section-header">
              <h1 className="section-title">New Print Job</h1>
              <p className="section-sub">upload files · configure settings · submit</p>
            </div>
            <UploadForm />
          </>
        )}

        {activeTab === "my jobs" && (
          <>
            <div className="section-header">
              <h1 className="section-title">My Jobs</h1>
              <p className="section-sub">live status · history</p>
            </div>

            {activeJobIds.length > 0 && (
              <>
                <p className="jobs-section-label">active jobs</p>
                {/* ✅ Render a JobStatus card for each active job */}
                {activeJobIds.map((jobId) => (
                  <JobStatus key={jobId} jobId={jobId} />
                ))}
                <hr className="divider" />
              </>
            )}

            <p className="jobs-section-label">history</p>
            <JobHistory />
          </>
        )}

        {activeTab === "admin queue" && user?.role === "ADMIN" && (
          <>
            <div className="section-header">
              <h1 className="section-title">Admin — Print Queue</h1>
              <p className="section-sub">manage · advance · prioritise</p>
            </div>
            <AdminQueue />
          </>
        )}

        {activeTab === "admin users" && user?.role === "ADMIN" && (
          <>
            <div className="section-header">
              <h1 className="section-title">Admin — Users</h1>
              <p className="section-sub">registered accounts</p>
            </div>
            <AdminUsers />
          </>
        )}

      </main>
    </div>
  );
}