# Adapting proxied cookies

When the browser talks to Mockxy and the login happens through the [proxy
fallback](PROXY.md), the real backend's session cookies must survive a trip they were not
written for. A `Set-Cookie` emitted by a staging is meant for browsers that talk to the
staging *directly*: it is tied to its domain (`Domain`), often bound to https (`Secure`) and
to cross-site flows (`SameSite=None`). To the browser, though, that cookie arrives **from
Mockxy's host, over http**: those attributes would get it silently discarded, and the session
would never be established — the classic login that "doesn't stick" with no visible error.

That's why, **by default**, Mockxy adapts the `Set-Cookie` headers forwarded by the proxy. The
option is `ADAPT_PROXY_COOKIES` (headless) or the «Adapt proxied cookies» switch in the
workspace settings.

## What gets adapted

Three attributes are removed from every `Set-Cookie` in transit from the backend:

- **`Domain`** — the cookie becomes *host-only* on Mockxy's host, which is where the browser
  will send it back. With the backend's `Domain` it would be rejected right away;
- **`Secure`** — over http via IP (typical of LAN use) a `Secure` cookie gets discarded;
- **`SameSite=None`** — without `Secure` it is rejected in turn; once removed, the cookie
  falls back to the `Lax` default, adequate for same-site development flows.

**The cookie's name and value are never touched**, and the other attributes (`Path`,
`HttpOnly`, `Expires`, `Max-Age`, the other `SameSite` values) pass through intact. The
parsing is tolerant of the sloppy formats seen in the wild (uppercase, spaces around the
equals sign). Mocks are not involved: the adaptation only concerns proxied responses.

When to turn it off: to observe the backend's original `Set-Cookie` headers through the proxy,
or in the rare case of cookies shared across multiple subdomains reached through a DNS alias
pointing at Mockxy.

## How a session works through Mockxy

1. The login **must go through Mockxy**: to the browser, cookies belong to the host it talks
   to, so a cookie obtained by visiting the staging directly will never be sent to Mockxy.
2. The staging answers the login with the `Set-Cookie`; Mockxy adapts it and the browser
   registers it as a cookie **of Mockxy's host**.
3. From then on the browser attaches it to requests towards Mockxy, and the proxy forwards it
   to the staging: the session works.

For the browser to *attach* the cookies to cross-origin calls you also need [automatic
CORS](CORS.md) enabled and, on the frontend side, `credentials: 'include'` (fetch) or
`withCredentials: true` (XHR/HttpClient).

## The limits no adaptation can overcome

The `SameSite` rules reason in terms of *site* (registrable domain), not origin — and the port
counts neither for the site nor for cookie scope. Hence the two scenarios:

- **same site** (e.g. frontend on `localhost:4200` and Mockxy on `localhost:3000`): no
  obstacle; on `localhost`, moreover, browsers treat http as a secure context;
- **different sites over http** (e.g. a frontend served from a colleague's `localhost` calling
  Mockxy on your LAN IP): `SameSite=Lax` prevents cookies from being sent on fetches, and the
  `SameSite=None` alternative would require `Secure`, i.e. https, which Mockxy doesn't offer.
  Cookie authentication is impractical there — **token authentication in the `Authorization`
  header** works perfectly, and the echoing CORS preflight already covers it.

Note: the monitor masks the `Set-Cookie` value like the other sensitive headers — session
tokens don't end up in captures.
