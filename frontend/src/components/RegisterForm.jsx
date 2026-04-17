import { useState } from "react";

function RegisterForm({ onRegister }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onRegister({ username, email, password });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Register</h2>
      <div>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button type="submit">Register</button>
    </form>
  );
}

export default RegisterForm;