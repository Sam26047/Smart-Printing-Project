// frontend/src/services/adminJobs.js
import apiClient from "./apiClient";

//ADMIN paths so need jwt auth

const getAllJobs = () => {
  return apiClient.get("/print-jobs"); //apiClient now automatically attaches auth header
};

const updatePriority = (id, priority) => {
  return apiClient.patch(`/print-jobs/${id}/priority`, { priority });
};

const updateStatus = (id, status) => {
  return apiClient.patch(`/print-jobs/${id}/status`, { status });
};

// Shopkeeper override for WAITING_FOR_PRINTER jobs: pin one file to a printer
// of a different tier. Called first WITHOUT confirm — the 400 response carries
// current/new price for the confirm dialog — then again with confirm: true.
const reassignFile = (id, file_id, printer_id, confirm = false) => {
  return apiClient.post(`/print-jobs/${id}/reassign-file`, {
    file_id,
    printer_id,
    confirm,
  });
};

export default {
  getAllJobs,
  updatePriority,
  updateStatus,
  reassignFile,
};