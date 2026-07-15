/** Template iniziali per la sorgente di handler/middleware (allineati a quelli del backend). */

export const HANDLER_TEMPLATE = `module.exports = {
  // data("nome") legge un file JSON dalla pagina Dati:
  //   const items = await data("nome-file");
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    return {
      status: 200,
      headers: {
        "x-handler-generated": requestHeaders["x-request-id"] || "true"
      },
      jsonBody: {
        params,
        query,
        requestBody: jsonBody
      }
    };
  }
};
`;

export const MIDDLEWARE_TEMPLATE = `module.exports = {
  async transformResponse({ status, headers, jsonBody, data }) {
    return {
      status,
      headers: {
        ...headers,
        "x-middleware-generated": "true"
      },
      jsonBody: {
        ...jsonBody,
        transformedByMiddleware: true
      }
    };
  }
};
`;

/** Restituisce il template sorgente per il tipo di script. */
export function scriptTemplate(type: 'handler' | 'middleware'): string {
  return type === 'middleware' ? MIDDLEWARE_TEMPLATE : HANDLER_TEMPLATE;
}
