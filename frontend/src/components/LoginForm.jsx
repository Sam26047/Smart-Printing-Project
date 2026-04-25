// frontend/src/components/LoginForm.jsx
import { useState } from "react";

export default function LoginForm({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onLogin({ username, password });
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group" style={{ marginBottom: 14 }}>
        <label className="form-label">username</label>
        <input
          className="form-input"
          type="text"
          placeholder="your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
        />
      </div>

      <div className="form-group" style={{ marginBottom: 14 }}>
        <label className="form-label">password</label>
        <input
          className="form-input"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <button
        className="btn btn-dark btn-full"
        type="submit"
        disabled={loading}
        style={{ marginTop: 16 }}
      >
        {loading ? "signing in…" : "sign in"}
      </button>
    </form>
  );
}