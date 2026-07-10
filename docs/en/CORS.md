# Automatic CORS

CORS comes into play in one scenario only: a frontend **in the browser**, served from a
different origin, calling Mockxy **directly**. The port counts for the origin too, so the
typical case is not exotic: the app on `localhost:4200` pointing at `http://localhost:3000`
without configuring the dev server's proxy. The other case is the server exposed on the LAN,
called from your colleagues' browsers.

In the recommended flow CORS is never needed — and that's why the option is **off by
default**: if the frontend goes through its dev server's proxy the browser sees a single
origin, and non-browser clients (Postman, tests, mobile apps, other backends) don't know what
CORS is.

It is enabled with `CORS_ENABLED=true` (headless) or with the «Automatic CORS» switch in the
workspace settings (desktop app).

## The principle: the policy is Mockxy's

With the option enabled, the CORS policy of **everything that leaves Mockxy is Mockxy's own** —
mocks, handlers, local errors and **proxied responses as well**. The real backend's policy is
written for the browsers that talk to it directly: on a shared staging it may allow the
deployed frontends' origins and not yours; with Mockxy in the middle it is irrelevant, and it
gets overridden. The same goes for CORS headers saved *inside* a mock — typical of mocks
created from a capture, which inherit the original backend's policy.

If you want to observe the backend's real CORS policy through the proxy, or manage the headers
by hand in your mocks, simply keep the option off: then Mockxy touches nothing, anywhere.

## Preflights

Before a "non-simple" cross-origin request (a JSON `POST`, a custom header) the browser sends
a preflight: an `OPTIONS` with the `Origin` and `Access-Control-Request-Method` headers. With
the option enabled the engine answers by itself, **before any forwarding to the backend** — so
the preflight's policy is always consistent with that of the responses that will follow:

```
< HTTP/1.1 204 No Content
< x-mock-source: cors-preflight
< Access-Control-Allow-Origin: http://localhost:4200      ← echoes the request Origin
< Access-Control-Allow-Credentials: true
< Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS
< Access-Control-Allow-Headers: authorization, x-api-key  ← echoes the requested headers
< Access-Control-Max-Age: 600
< Vary: Origin
```

The surrounding rules:

- an **explicit `OPTIONS`** mock or handler on the route takes precedence: the automatic
  handler steps aside;
- an `OPTIONS` **without** `Access-Control-Request-Method` is not a preflight (it is, for
  example, a capability discovery) and follows the normal flow — mock, proxy or 404;
- automatic preflights **don't show up in the monitor**: they are browser infrastructure, not
  API traffic (there would be one for every cross-origin write);
- the 10-minute `Max-Age` reduces round-trips; keep it in mind when you *turn off* the option:
  for a few minutes the browser may still use cached preflights.

## Responses

Every response served with an `Origin` header in the request goes out with:

- **`Access-Control-Allow-Origin`** = the request's origin, reflected (never `*`: the wildcard
  is rejected by the browser on credentialed requests, i.e. those with cookies — and sessions
  through the proxy are a primary use case);
- **`Access-Control-Allow-Credentials: true`**;
- **`Vary: Origin`**, because the response now depends on the origin;
- **`Access-Control-Expose-Headers`** with at least `X-Total-Count`
  ([pagination](LISTE.md)) and `x-mock-source` (the [source](PROXY.md)), which cross-origin
  JavaScript could not read otherwise; any exposed headers declared by mocks or the backend
  are **merged**, not lost.

On `Allow-Origin` and `Allow-Credentials` the engine's override wins over any pre-existing
value (captured mocks, proxied responses); without an `Origin` header in the request — that
is, for all same-origin and non-browser traffic — nothing is touched.

## The rest of the story

CORS grants the *permission* to use credentials; for a cookie session to actually work the
cookies also need to survive the trip — that's the job of the [proxied cookie
adaptation](COOKIE.md) — and the backend's redirects must not let the browser escape from
Mockxy — that's the [redirect rewriting](REDIRECT.md). The three options together cover the
«browser → Mockxy → real backend» topology.
