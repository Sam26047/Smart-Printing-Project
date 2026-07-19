// frontend/src/services/printers.js
// Shopkeeper printer management — admin JWT routes, scoped server-side to the
// admin's own shop.
import apiClient from "./apiClient";

const listPrinters = () => {
  return apiClient.get("/printers");
};

const createPrinter = (printer) => {
  return apiClient.post("/printers", printer);
};

// Partial update — also used for the ONLINE/OFFLINE/OUT_OF_SERVICE toggle
// (setting status to ONLINE re-queues the shop's blocked jobs server-side)
const updatePrinter = (id, fields) => {
  return apiClient.patch(`/printers/${id}`, fields);
};

// 409 if the printer is bound to a job currently PRINTING
const deletePrinter = (id) => {
  return apiClient.delete(`/printers/${id}`);
};

// Agent-reported spooler names (dropdown options for device_name).
// Response: { discovered: [{device_name, last_seen_at, agent_label, ...}],
//             stale_after_minutes }
const getDiscovered = () => {
  return apiClient.get("/printers/discovered");
};

export default { listPrinters, createPrinter, updatePrinter, deletePrinter, getDiscovered };
