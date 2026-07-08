// frontend/src/services/shopPricing.js
// Per-shop pricing config (B&W rate, color rate, duplex discount %).
// Server is the pricing authority — this only reads/writes the config.
import apiClient from "./apiClient";

const getPricing = () => {
  return apiClient.get("/shops/pricing");
};

const putPricing = (pricing) => {
  return apiClient.put("/shops/pricing", pricing);
};

export default { getPricing, putPricing };
