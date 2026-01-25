import { useEffect, useState } from "react";
import adminUsers from "../services/adminUsers";

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminUsers
      .getAllUsers()
      .then((res) => setUsers(res.data))
      .catch(() => setError("Failed to load users"));
  }, []);

  const changeRole = (id, newRole) => {
    adminUsers
      .updateUserRole(id, newRole)
      .then((res) => {
        setUsers(users.map((u) => (u.id === id ? res.data : u)));
      })
      .catch(() => alert("Role update failed"));
  };

  return (
    <div>
      <h2>User Management</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.role}</td>
              <td>
                {u.role === "STUDENT" ? (
                  <button onClick={() => changeRole(u.id, "ADMIN")}>
                    Promote
                  </button>
                ) : (
                  <button onClick={() => changeRole(u.id, "STUDENT")}>
                    Demote
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default AdminUsers;
