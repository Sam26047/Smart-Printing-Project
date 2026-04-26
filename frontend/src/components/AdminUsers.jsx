// frontend/src/components/AdminUsers.jsx
import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";

function initials(username) {
  if (!username) return "?";
  return username.slice(0, 2).toUpperCase();
}

// Soft colour for the avatar circle based on username char code
const AVATAR_COLORS = [
  { bg: "#dbeafe", color: "#1e40af" }, // blue
  { bg: "#ccfbf1", color: "#065f46" }, // teal
  { bg: "#fef3c7", color: "#92400e" }, // amber
  { bg: "#ffe4e6", color: "#9f1239" }, // rose
  { bg: "#f3e8ff", color: "#6b21a8" }, // purple
];

function avatarColor(username) {
  const code = (username || "").charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

export default function AdminUsers() {
  const [users, setUsers]     = useState([]);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get("/users") // getAllUsers controller lives on /users, not /admin/users
      .then((res) => {
        // getAllUsers returns result.rows directly (plain array)
        // handle all possible shapes defensively: array, { users:[] }, { rows:[] }
        const raw = res.data;
        let arr = [];
        if (Array.isArray(raw))             arr = raw;
        else if (Array.isArray(raw?.users)) arr = raw.users;
        else if (Array.isArray(raw?.rows))  arr = raw.rows;
        setUsers(arr);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Failed to load users.");
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="loading-text">Loading users…</p>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!users.length) return <div className="empty-state">No users found.</div>;

  return (
    <>
      {/* Summary stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        <div className="stat-card blue">
          <div className="stat-val">{users.length}</div>
          <div className="stat-lbl">total users</div>
        </div>
        <div className="stat-card rose">
          <div className="stat-val">{users.filter(u => u.role === "ADMIN").length}</div>
          <div className="stat-lbl">admins</div>
        </div>
        <div className="stat-card teal">
          <div className="stat-val">{users.filter(u => u.role !== "ADMIN").length}</div>
          <div className="stat-lbl">students</div>
        </div>
      </div>

      {/* Users table */}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>user</th>
              <th>email</th>
              <th>role</th>
              <th>joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const av = avatarColor(u.username);
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* coloured initials avatar */}
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: av.bg, color: av.color,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500,
                        flexShrink: 0,
                      }}>
                        {initials(u.username)}
                      </div>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{u.username}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
                    {u.email || "—"}
                  </td>
                  <td>
                    <span className={`badge ${u.role === "ADMIN" ? "badge-printing" : "badge-queued"}`}>
                      <span className="badge-dot" />
                      {(u.role || "student").toLowerCase()}
                    </span>
                  </td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
                    {u.created_at
                      ? new Date(u.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}