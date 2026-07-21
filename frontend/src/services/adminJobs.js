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

// Reassign one file of a WAITING_FOR_PRINTER job to a target TIER. Same tier /
// same price → free. Cross-tier with a price difference → the first call
// (no resolution) returns a 400 { decision_required, delta, ... }; call again
// with resolution 'absorb' (delta>0 only) or 'cancel_refund'.
const reassignFile = (id, file_id, target_tier_id, resolution) => {
  const body = { file_id, target_tier_id };
  if (resolution) body.resolution = resolution;
  return apiClient.post(`/print-jobs/${id}/reassign-file`, body);
};

// Cross-tier reassignment audit for the admin's shop
const getReassignmentAudit = () => {
  return apiClient.get("/print-jobs/reassignment-audit");
};

export default {
  getAllJobs,
  updatePriority,
  updateStatus,
  reassignFile,
  getReassignmentAudit,
};