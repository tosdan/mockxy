# Wiring up the frontend to Mockxy

The idea is just one: the application must talk to Mockxy instead of the backend, and Mockxy
must know where the real backend is (`BACKEND_URL`). As for the *how*, there are two routes —
and the choice determines whether CORS comes into play or not.

## Route A: the dev server's proxy (recommended)

The frontend's dev server forwards API calls to Mockxy: the browser sees **a single origin**
and CORS simply doesn't exist. Calls in the code stay relative (`/api/...`), only the proxy
configuration changes.

Angular (`proxy.conf.json`):

```json
{ "/api": { "target": "http://localhost:3000", "secure": false } }
```

Vite (`vite.config.js`):

```js
export default { server: { proxy: { "/api": "http://localhost:3000" } } };
```

Advantages: zero configuration on the Mockxy side, cookies and sessions with no worries
(everything same-origin), no difference from the deployed setup (where the reverse proxy does
the same job).

## Route B: direct cross-origin calls

The frontend points directly at `http://localhost:3000` (or the server's IP on the LAN) as the
base URL. Careful: `localhost:4200` and `localhost:3000` are **different origins** — the port
counts for the origin too — so the browser applies CORS to every call.

What you need:

1. **[Automatic CORS](CORS.md) enabled** (`CORS_ENABLED=true`, or the switch in the workspace
   dialog): without it, the first call dies with the classic error about
   `Access-Control-Allow-Origin` in the console;
2. for cookie sessions, `withCredentials: true` (HttpClient/XHR) or
   `credentials: 'include'` (fetch) — and the login **must go through Mockxy**
   ([cookies through the proxy](COOKIE.md));
3. nothing, instead, for token authentication in a header: the reflected preflight already covers it.

It's the natural route when there is no dev server with a proxy (static apps, third-party tools)
or when the server is [exposed on the LAN](RETE.md) for your colleagues. The known limit: cookie
sessions between different *sites* over http are not possible due to browser rules — use the
token there.

## Verifying that everything goes through Mockxy

Whichever route you choose, the litmus test is the [monitor](MONITOR.md): every call from the
app must show up there, with the right origin (`x-mock-source`). If a call doesn't show
up, it's still going straight to the backend — a forgotten base URL, a proxy rule that
doesn't cover that prefix.
