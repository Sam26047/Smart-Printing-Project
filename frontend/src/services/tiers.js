// frontend/src/services/tiers.js
// Admin capability-tier management (own shop, resolved server-side). Prices,
// availability, and printer↔tier assignment. All shop-scoped via getAdminShopId
// on the backend — no shop id in any request.
import apiClient from "./apiClient";

// Admin view: tiers with availability + assigned printers[] (no shop_id param)
const getAdminTiers = () => {
  return apiClient.get("/shops/tiers");
};

// Edit a tier's price and/or name
const updateTier = (tierId, fields) => {
  return apiClient.patch(`/shops/tiers/${tierId}`, fields);
};

// Assign a printer to a tier (hardware-validated server-side; auto-requeues
// this shop's WAITING_FOR_PRINTER jobs)
const assignPrinter = (printerId, tierId) => {
  return apiClient.post(`/printers/${printerId}/tiers`, { tier_id: tierId });
};

const unassignPrinter = (printerId, tierId) => {
  return apiClient.delete(`/printers/${printerId}/tiers/${tierId}`);
};

export default { getAdminTiers, updateTier, assignPrinter, unassignPrinter };
