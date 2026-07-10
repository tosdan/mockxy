# Network exposure and bind security

By default Mockxy listens **on loopback only** (`127.0.0.1`): reachable from the machine it
runs on, invisible to the network. This isn't timidity — it's the direct consequence of what
the **admin API** can do: it creates handlers, i.e. it writes files and **executes JavaScript**.
On a network bind, anyone who reaches the port can run code on the machine. Exposure must
therefore be an explicit, informed choice.

## Exposing on the network

- **Headless**: `HOST=0.0.0.0` (all interfaces).
- **Desktop app**: the «Reachable from the whole network» switch in the workspace settings,
  which only accepts the binary loopback/network choice and shows the risk warning.
- **Docker**: the images set `HOST=0.0.0.0` on their own, because the *container's* loopback
  is not reachable through the port mapping; the actual exposure is decided on the host's
  port mapping.

When the admin API is active on a non-loopback bind, at startup the log shows a **warning
designed to be impossible to miss**. It's not a block — on a trusted network it can be a
legitimate choice — but the combination must be entered with eyes open. The safe alternatives:

- **turning the admin off** with `ADMIN_API_ENABLED=false`: mocks keep being served, the
  code-executing surface disappears. It's what the standalone image does by itself for shared
  environments (see the README, Docker section);
- for browser frontends calling the exposed server from other origins, enabling
  [automatic CORS](CORS.md) — which concerns the *mocks*, not the admin.

## The DNS rebinding defense

There's an attack that hits even servers listening *only* on loopback: **DNS rebinding**. A
hostile web page re-resolves its own domain to `127.0.0.1`: to the victim's browser the
requests to the hostile domain are same-origin (CORS doesn't step in), but they reach the
local server — and could drive the admin API, even reading its responses.

The defense leverages the one signal the attacker cannot forge: the **`Host`** header keeps
the hostile domain. The admin API therefore only accepts requests with a loopback `Host`
(`localhost`, `127.0.0.1`, `::1`), plus any extra names declared in
**`ADMIN_ALLOWED_HOSTS`** (for example an alias in `/etc/hosts`, or the server name in a
hardened intranet deployment — declaring them enables the check on non-loopback binds too).
Everything else gets `403`.

Two deliberate boundaries of the check:

- it applies **to the admin API only**: the *mocks* accept any `Host`, because they must be
  consumable by clients of every kind without configuration;
- on the network bind *without* an allowlist the check doesn't apply: the legitimate hosts
  wouldn't be predictable, and on that bind the exposure warning already applies.

## Reminder for the LAN case

Exposing the server for your colleagues typically means: network bind, **admin off** (or a
truly trusted network), [CORS enabled](CORS.md) if their frontends run in the browser on other
origins — while adapted [cookies](COOKIE.md) and [redirects](REDIRECT.md) are already active by
default. The README's "Security and limits" section gathers the complete picture of the
warnings.
