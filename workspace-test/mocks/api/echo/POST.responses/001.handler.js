// Handler di fixture per gli e2e: rimanda indietro il body JSON ricevuto.
module.exports = {
  async resolveResponse({ jsonBody, requestHeaders }) {
    return {
      status: 200,
      headers: { "x-echo": requestHeaders["x-request-id"] || "true" },
      jsonBody: { echoed: jsonBody ?? null },
    };
  },
};
