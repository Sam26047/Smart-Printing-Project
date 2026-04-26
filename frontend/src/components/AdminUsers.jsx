// frontend/src/components/AdminUsers.jsx
import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";

function initials(username) {
  if (!username) return "?";
  return username.slice(0, 2).toUpperCase();
}

// Soft colour for the avatar circle based on first char of username
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
  const [updating, setUpdating] = useState(null); // userId being updated

  const fetchUsers = () => {
    apiClient
      .get("/users") // getAllUsers controller lives on /users route
      .then((res) => {
        // getAllUsers returns result.rows directly (plain array)
        // handle all possible shapes: array, { users:[] }, { rows:[] }
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
  };

  useEffect(() => { fetchUsers(); }, []);

  // Toggle ADMIN ↔ STUDENT
  const toggleRole = async (u) => {
    const newRole = u.role === "ADMIN" ? "STUDENT" : "ADMIN";
    setUpdating(u.id);
    try {
      await apiClient.patch(`/users/${u.id}/role`, { role: newRole });
      fetchUsers(); // re-fetch to reflect change
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update role.");
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <p className="loading-text">Loading users…</p>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!users.length) return <div className="empty-state">No users found.</div>;

  return (
    <>
      {/* ── Stat summary ───────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 24 }}>
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

      {/* ── Users table ────────────────────────────────── */}
      <div className="data-table-wrap">
        <table className="data-table" style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>user</th>
              <th>email</th>
              <th>role</th>
              <th>joined</th>
              <th>action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const av = avatarColor(u.username);
              const isUpdating = updating === u.id;
              return (
                <tr key={u.id}>
                  {/* User + avatar */}
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: "50%",
                        background: av.bg, color: av.color, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--mono)", fontSize: 12, fontWeight: 500,
                      }}>
                        {initials(u.username)}
                      </div>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{u.username}</span>
                    </div>
                  </td>

                  {/* Email */}
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.email || <span style={{ opacity: 0.4 }}>—</span>}
                  </td>

                  {/* Role badge */}
                  <td>
                    <span className={`badge ${u.role === "ADMIN" ? "badge-printing" : "badge-queued"}`}>
                      <span className="badge-dot" />
                      {(u.role || "student").toLowerCase()}
                    </span>
                  </td>

                  {/* Joined — created_at may not exist in DB yet */}
                  <td style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gray)" }}>
                    {u.created_at
                      ? new Date(u.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
                      : <span style={{ opacity: 0.4 }}>—</span>}
                  </td>

                  {/* Promote / Demote */}
                  <td>
                    <button
                      className={`btn btn-ghost btn-sm ${u.role === "ADMIN" ? "demote" : ""}`}
                      onClick={() => toggleRole(u)}
                      disabled={isUpdating}
                      style={{
                        fontSize: 11,
                        color: u.role === "ADMIN" ? "var(--rose-dark)" : "var(--teal-dark)",
                        borderColor: u.role === "ADMIN" ? "#fca5a5" : "#5eead4",
                      }}
                    >
                      {isUpdating ? "…" : u.role === "ADMIN" ? "demote" : "promote"}
                    </button>
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