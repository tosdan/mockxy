# 27 — Browser, cookies, CORS and redirects: the proxy topology

The workspace settings hold three switches — **Automatic CORS**, **Adapt proxied
cookies**, **Rewrite proxied redirects** — that at first glance look like obscure details.
They are, instead, the answers to the three problems that arise, mathematically, when a
proxy is placed between a browser and a backend. This chapter tells them problem by
problem: once the problem is clear, the switch explains itself.

The premise: a backend is written for browsers that talk to it **directly**. Its CORS
policy lists its own frontends' origins; its cookies are bound to its own domain; its
redirects point at its own address. With Mockxy in the middle, the browser talks to
**Mockxy's host, typically over http** — and each of those three assumptions breaks in a
specific way.

## Automatic CORS: the permission to talk

CORS enters the picture in one scenario only: a frontend in the browser, served from
**another origin**, calling Mockxy **directly** — [chapter 4](04-connect-your-frontend.md)'s
"road B", typically `localhost:4200` → `localhost:3000` (the port counts for the origin),
or the LAN-exposed server called by colleagues' browsers. In the recommended flow — the
dev server proxy — CORS is never needed: that is why the option is **off by default**.

When on, the principle is clear-cut: **the CORS policy of everything leaving Mockxy is
Mockxy's** — mocks, handlers, local errors and proxied responses too. The backend's policy
(which may admit the deployed frontends' origins, not yours) is overridden; and the same
goes for the CORS headers saved *inside* captured mocks, which inherit the original
backend's policy. Concretely:

- **preflight** `OPTIONS` requests get an automatic answer from the engine, before any
  forwarding (an explicit `OPTIONS` mock takes precedence; preflights don't appear in the
  monitor — they are browser infrastructure, not API traffic);
- every response to a request carrying an `Origin` goes out with the **origin echoed**
  (never `*`, which browsers reject on credentialed requests), `Allow-Credentials: true`,
  and `X-Total-Count` and `x-mock-source` exposed to cross-origin JavaScript;
- same-origin and non-browser traffic is not touched.

When to turn it off (besides the default): to observe the backend's *real* CORS policy
through the proxy, or to manage CORS headers by hand in the mocks.

## Adapting cookies: the login that "doesn't stick"

The symptom is among the most frustrating because it is **silent**: the login seems to
succeed, but the session never establishes — no error, just requests coming back 401. The
cause: staging answers the login with a `Set-Cookie` written for itself — bound to its
domain (`Domain=staging.example`), restricted to https (`Secure`), marked for cross-site
flows (`SameSite=None`). To the browser, that cookie arrives **from Mockxy's host, over
http**: each of those three attributes makes it silently discarded.

That is why, by default, Mockxy **adapts** the `Set-Cookie` headers forwarded by the
proxy: it removes `Domain` (the cookie becomes host-only on Mockxy's host, where the
browser will send it back), `Secure` and `SameSite=None` (which without Secure would be
rejected anyway; the default `Lax` applies). **Name and value are never touched**, the
other attributes pass intact, and mocks are unaffected: the adaptation concerns proxied
responses only.

A session through Mockxy therefore works like this: the **login goes through Mockxy** (a
cookie obtained by visiting staging directly will never be sent to Mockxy — to the
browser, cookies belong to the host it talks to); the adapted `Set-Cookie` registers as a
cookie of Mockxy's host; from then on the browser attaches it and the proxy forwards it.
In the cross-origin topology you also need automatic CORS and explicit credentials on the
frontend (`credentials: 'include'` / `withCredentials: true`).

One limit no adaptation overcomes: between **different sites over http** (a colleague's
frontend calling Mockxy on your LAN IP) the browser's `SameSite` rules block cookie
sending, and the alternative would require https. Cookie authentication is impractical
there — **header-token** authentication works perfectly.

When to turn it off: to observe the backend's original `Set-Cookie` headers — for
instance while debugging staging's cookie handling itself.

## Rewriting redirects: the browser that "escapes"

Third problem, also silent: the backend answers the login — or a missing trailing slash —
with an absolute redirect **to its own address**
(`Location: https://staging.example/home`). The browser obeys, and from that navigation on
it talks **directly to the backend**: Mockxy, the mocks, the adapted cookies and the CORS
policy have vanished from the loop, with no signal. The typical symptoms: the monitor
going quiet mid-flow, mocks that "worked a second ago".

That is why, by default, Mockxy **rewrites** the `Location` of proxied redirects pointing
at the configured backend's origin: scheme, host and port become those the client used to
reach Mockxy, while path, query and fragment pass intact:

```
request:   GET http://192.168.1.10:3000/login
backend:   Location: https://staging.example/home?welcome=1
to client: Location: http://192.168.1.10:3000/home?welcome=1
```

**Relative** `Location`s (`/home`) pass intact — they are correct by definition — and so
do redirects to **third-party hosts** (the corporate SSO, a payment provider): those
*must* leave Mockxy, and rewriting them would break legitimate flows.

When to turn it off: to observe the backend's original redirect chain.

## The connecting thread: a full login

The three switches together, in the story where they are all needed: a cross-origin
frontend calling Mockxy directly, staging as the backend. The user hits "Sign in": the
`POST /login` preflight is answered by **automatic CORS**; the `POST` crosses the proxy
and staging answers with the session `Set-Cookie`, which **cookie adaptation** makes
acceptable to the browser; the same response is a redirect to
`https://staging.example/home`, which **redirect rewriting** brings back onto Mockxy's
address. The browser navigates, the session holds, and all subsequent traffic keeps
flowing through Mockxy — observable in the monitor, mockable one endpoint at a time.

> 📷 **SCREENSHOT** — `27-tre-interruttori.png`
> What to show: the settings dialog's Behavior section with the three switches (Automatic
> CORS, Adapt cookies, Rewrite redirects) and their hints visible.

> 📷 **SCREENSHOT** — `27-setcookie-adattato.png`
> What to show: the browser DevTools on a login response that went through Mockxy, with
> the adapted `Set-Cookie` visible (no Domain/Secure); alternatively, the same response
> compared with adaptation off.

The local topology is settled; the next step is when Mockxy stops being local-only —
network exposure, with what it entails: [chapter 29](29-network-security.md), by way of
the [desktop multi-workspace](28-desktop-workspaces.md) first.
