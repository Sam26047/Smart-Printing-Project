// frontend/src/services/agentTokens.js
// Print-agent token management for the admin's OWN shop — the shop is
// resolved server-side (getAdminShopId), no shop id in any request.
// The mint response is the ONLY place the plaintext token ever exists;
// the list endpoint returns no secret material.
import apiClient from "./apiClient";

const listTokens = () => {
  return apiClient.get("/shops/agent-tokens");
};

const mintToken = (label) => {
  return apiClient.post("/shops/agent-tokens", { label });
};

const revokeToken = (tokenId) => {
  return apiClient.post(`/shops/agent-tokens/${tokenId}/revoke`, {});
};

export default { listTokens, mintToken, revokeToken };
