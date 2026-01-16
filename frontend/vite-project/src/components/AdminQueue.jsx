import { useEffect, useState } from "react";
import adminJobs from "../services/adminJobs";
import AdminJobRow from "./AdminJobRow";

const AdminQueue = () => {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    const fetchJobs = () => {
      adminJobs.getAllJobs().then((res) => {
        setJobs(res.data.jobs || res.data);
      });
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>Admin – Print Queue</h2>

      <table border="1" cellPadding="6">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>File</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Deadline</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          {jobs.map((job) => (
            <AdminJobRow
              key={job.id}
              job={job}
              onUpdate={() =>
                adminJobs.getAllJobs().then((res) =>
                  setJobs(res.data.jobs || res.data)
                )
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminQueue;
