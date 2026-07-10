// Metodi HTTP offerti dalla UI (creazione/copia mock, filtro del monitor) — unica fonte lato UI.
// NB: il motore ne accetta anche HEAD e OPTIONS (HTTP_METHOD_PATTERN in src/endpoint-loader.js);
// la UI li omette di proposito finché non servono nei flussi di creazione.
export const MOCK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
