# 04 — Connecting your web app to Mockxy

The idea is a single one: the application must talk to **Mockxy** instead of the backend,
and Mockxy must know where the **real backend** is. The second point is one setting —
`BACKEND_URL` in the headless configuration, or the "Backend URL" field in the desktop
app's workspace settings. For the first, there are two roads, and the choice determines
whether CORS enters the picture or not.

The full chain, in the recommended setup:

```
browser ──▶ frontend dev server ──▶ Mockxy ──▶ real backend
            (proxy: /api → Mockxy)   (mock, or forward)
```

Each link is configured in its own place: the proxy on the frontend's dev server, the
backend on Mockxy. The application code does not change.

## Road A: the dev server proxy (recommended)

Frontend framework dev servers all include a proxy: requests reaching the dev server on
certain prefixes (typically `/api`) are forwarded to another destination. Just point that
proxy at Mockxy: the calls in your code stay relative (`/api/...`), and the browser keeps
seeing **a single origin** — the dev server's.

Angular (`proxy.conf.json`):

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false
  }
}
```

Vite (`vite.config.js`):

```js
export default {
  server: {
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
};
```

The mechanics are identical with webpack devServer, Create React App (`proxy` in
`package.json` or `setupProxy.js`) and the others: you forward the API prefix to Mockxy's
address.

The advantages of this road:

- **CORS simply doesn't exist** — to the browser everything is same-origin;
- cookies and sessions work without a second thought, for the same reason;
- no difference from deployment, where a reverse proxy does the same job as the dev
  server;
- zero configuration on the Mockxy side.

## Road B: direct cross-origin calls

The alternative is pointing the frontend **directly** at Mockxy: API base URL
`http://localhost:3000` (or the server's IP, if exposed on the LAN). It works, but the
browser applies CORS to every call — and this deserves a clarification, because it is the
first wall people hit.

**CORS in brief.** The browser considers two addresses the same *origin* only if scheme,
host **and port** all match: `http://localhost:4200` and `http://localhost:3000` are
different origins, even though both are "local". When a page makes a request toward
another origin, the browser demands that the destination server explicitly declare it
accepts it (the `Access-Control-Allow-Origin` header and, for non-simple requests, a
preliminary `OPTIONS` request — the *preflight*). Without those declarations, the call is
blocked by the browser with the classic CORS error in the console — the server may even
have served it, but the page cannot read it.

Road B therefore needs:

1. Mockxy's **automatic CORS** enabled (`CORS_ENABLED=true` headless, or the "Automatic
   CORS" switch in the workspace settings): Mockxy answers preflights itself and sets the
   CORS headers on every served response. The details — and why the option is off by
   default — are in [chapter 27](27-proxy-topology.md);
2. for cookie sessions, explicit credentials on the client — `credentials: 'include'`
   with `fetch`, `withCredentials: true` with XHR/HttpClient — and the login must go
   through Mockxy;
3. nothing special for header-token authentication.

It is the natural road when there is no dev server with a proxy (static pages, third-party
tools, mobile apps) or when Mockxy is exposed on the LAN for colleagues. Non-browser
clients — Postman, tests, other backends — don't apply CORS: for them, the base URL is all
it takes.

## Verifying that everything goes through Mockxy

Whichever road you pick, the acid test is the **monitor**: every call from the application
must show up there. Start the app, navigate a few screens and open the Monitor view — the
requests must scroll by, all with "Real backend" as their source if you haven't created
mocks yet: it means the chain works and Mockxy is forwarding everything.

If a call **does not appear** in the monitor, it is not going through Mockxy: typically a
base URL still pointed at the backend, or a proxy rule that doesn't cover that prefix. The
double check is the `x-mock-source` header on the response (chapter 2): if it's missing,
the response did not come out of Mockxy.

> 📷 **SCREENSHOT** — `04-monitor-primo-traffico.png`
> What to show: the Monitor view with an application's first real requests in transit, all
> with "Real backend" as source — the visual proof that the connection works. Method,
> path, status and the source column must be visible.

The connection is in place; before creating the first mock, a full tour of the interface
so you know what lives where: [chapter 5](05-ui-tour.md).
