// frontend/src/components/RegisterForm.jsx
import { useState } from "react";

export default function RegisterForm({ onRegister }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail]       = useState("");
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onRegister({ username, password, email });
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed. Try a different username.");
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
          placeholder="choose a username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
        />
      </div>

      <div className="form-group" style={{ marginBottom: 14 }}>
        <label className="form-label">email</label>
        <input
          className="form-input"
          type="email"
          placeholder="for OTP & job notifications"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
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
          autoComplete="new-password"
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <button
        className="btn btn-dark btn-full"
        type="submit"
        disabled={loading}
        style={{ marginTop: 16 }}
      >
        {loading ? "creating account…" : "create account"}
      </button>
    </form>
  );
}