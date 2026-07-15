// Middleware di fixture per gli e2e: aggiunge un campo alla risposta del backend.
module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-enriched": "true" },
      jsonBody: { ...jsonBody, enriched: true },
    };
  },
};
