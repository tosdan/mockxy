# 29 — Exposing Mockxy on the network, safely

By default Mockxy listens **only on loopback** (`127.0.0.1`): reachable from the machine
it runs on, invisible to the network. This chapter explains why that is the default, when
changing it makes sense, and with what precautions.

## Loopback and bind, in two words

A listening server binds to a network interface. **`127.0.0.1`** (loopback) is the
machine's internal interface: only local processes can reach it — `localhost` resolves
there. **`0.0.0.0`** means *all interfaces*: the server becomes reachable on the machine's
LAN address too (e.g. `192.168.1.10`), hence from any device on the same network.

## Why the default is loopback

It is not generic prudence — it is the direct consequence of what the **admin API** can
do: it creates handlers, i.e. it **writes files and executes JavaScript**, and it has **no
authentication**. On a network bind, whoever reaches the port can create a handler and,
with it, run arbitrary code on the machine. Exposure must therefore be an explicit,
informed choice, never a default.

The legitimate cases exist: the **physical mobile device** that must reach the mocks
during app development, the **colleague on the LAN** trying the frontend against your
workspace, the internal server serving mocks to the team.

## How to expose

- **Desktop app**: the "Reachable from the whole network" switch in the workspace
  settings — the choice is binary (loopback / all interfaces) and the risk warning is part
  of the switch;
- **Headless**: `HOST=0.0.0.0`;
- **Docker**: the images set `HOST=0.0.0.0` on their own — the *container's* loopback
  would not be reachable through port mapping — and the real exposure is decided by the
  host port mapping (`-p 127.0.0.1:3000:3000` stays local, `-p 3000:3000` exposes).

When the admin API is active on a non-loopback bind, the log shows an explicit warning at
startup. It is not a blocker — on a trusted network it can be a legitimate choice — but
the combination must be made with eyes open.

> 📷 **SCREENSHOT** — `29-esposizione-avvertenza.png`
> What to show: the workspace settings dialog with "Reachable from the whole network" on
> and the security warning clearly visible.

## The existing protections

Three defenses are in place by construction:

- **anti DNS rebinding guard.** An insidious attack hits even loopback-only servers: a
  hostile web page re-resolves its own domain to `127.0.0.1`, and the victim's browser —
  to which those requests are same-origin — can reach the local server. The defense uses
  the one signal the attacker cannot forge: the `Host` header keeps the hostile domain,
  and the admin API only accepts requests with a loopback `Host` (plus any extra names
  declared in `ADMIN_ALLOWED_HOSTS` — an `/etc/hosts` alias, an intranet server's name).
  Everything else receives `403`. The check applies to the admin only: the *mocks* accept
  any `Host`, because they must be consumable by clients of every kind;
- **JSON-only mutations.** The admin API's writes accept only explicit content types: a
  cross-origin request with `application/json` triggers the browser preflight and dies
  there — it is the anti-CSRF defense;
- **admin off in production.** With `NODE_ENV=production` the admin API is disabled by
  default.

## The right configuration per scenario

| Scenario | Configuration |
|---|---|
| Personal development | the default: loopback, admin on |
| Mobile device / LAN colleague, occasional | network bind on a trusted network, switch off when done |
| Continuous serving to the team | admin off (`ADMIN_API_ENABLED=false`), or better the **standalone** image — which turns off admin, proxy and watch by construction ([chapter 31](31-headless-docker.md)) |

With colleagues' frontends calling the server from the browser, from other origins, you
also need automatic CORS ([chapter 27](27-proxy-topology.md)); adapted cookies and
redirects are already on by default.

Two final reminders that go beyond the bind's perimeter: **handlers and middleware are
code** — whoever opens a workspace runs its scripts, so other people's workspaces deserve
the trust you grant a repository you clone and execute; and the **monitor's archives** may
contain personal data — they stay out of git and must not be mounted on shared servers.

The admin API, seen here as a surface to protect, is also Mockxy's most powerful
automation tool: the [next chapter](30-admin-api.md) puts it to use.
