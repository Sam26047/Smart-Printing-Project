// frontend/vite-project/src/services/printJobs.js
import apiClient from "./apiClient";

const createPrintJob = (formData) => {
  return apiClient.post("/print-jobs", formData);
};

const getJobById = (id) => {
  return apiClient.get(`/print-jobs/${id}`);
};

const collectPrintJob = (otp, id) => {
  return apiClient.post(`/print-jobs/${id}/collect`, { otp }); //because this data is sent in application/json format
}; //i.e as raw json object

const regenerateOtp = (id) => {
  //because in post(url,data,config) so need to pass {} or auth header considered data payload
  return apiClient.post(`/print-jobs/${id}/regenerate-otp`, {});
};

// Fetches current queue size and whether urgent is disabled (peak load check)
// Used by UploadForm to show queue position and grey-out Urgent when needed.
// Queue size + urgent-lockout are PER SHOP, so pass the selected shop's id.
const getQueueStatus = (shopId) => {
  return apiClient.get("/print-jobs/queue/status", {
    params: shopId ? { shop_id: shopId } : {},
  });
};

// Public shop directory (id/name/slug). The submit form's shop selector needs
// this once more than one shop exists.
const getShops = () => {
  return apiClient.get("/shops");
};

// A shop's capability tiers with per-tier price + availability + reason.
// Student path: pass shop_id explicitly (response carries NO device detail).
// Used to render the price catalog and the per-file tier picker.
const getTiers = (shopId) => {
  return apiClient.get("/shops/tiers", { params: { shop_id: shopId } });
};

// Server-authoritative cost preview — same pricing path as submission, creates
// nothing. Pages assumed 1/file; the real total is locked at createPrintJob.
const estimateJob = (payload) => {
  return apiClient.post("/print-jobs/estimate", payload);
};

// Creates (or returns the existing) Razorpay order for a PENDING+UNPAID job.
// Response { order_id, amount, currency, key_id } configures the checkout
// modal — key_id comes from here, the server owns which key is in play.
const createPaymentOrder = (id) => {
  return apiClient.post(`/print-jobs/${id}/payment/order`, {});
};

export default {
  createPrintJob,
  getJobById,
  collectPrintJob,
  regenerateOtp,
  getQueueStatus,
  getShops,
  getTiers,
  estimateJob,
  createPaymentOrder,
};