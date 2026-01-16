import adminJobs from "../services/adminJobs";

const AdminJobRow = ({ job, onUpdate }) => {
  const setPriority = async (value) => {
    await adminJobs.updatePriority(job.id, value);
    onUpdate();
  };

  const moveToQueue = async () => {
    await adminJobs.updateStatus(job.id, "QUEUED");
    onUpdate();
  };

  return (
    <tr>
      <td>{job.id.slice(0, 8)}...</td>
      <td>{job.file_name}</td>
      <td>{job.status}</td>
      <td>{job.priority}</td>
      <td>{job.deadline ? new Date(job.deadline).toLocaleString() : "-"}</td>
      <td>
        <button onClick={() => setPriority(job.priority + 1)}>+ Priority</button>
        <button onClick={moveToQueue}>Queue</button>
      </td>
    </tr>
  );
};

export default AdminJobRow;
