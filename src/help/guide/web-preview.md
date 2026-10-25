---
type: Note
tags: [bdobb, help, web, vercel, github, preview]
---

# Web Preview

**From v4.0.0 the web preview is available with the openbq-docker stack, over HTTP.** It is a GitHub-gated browser build of the dashboard grid, for showing someone without the desktop app what BDOBB looks like. It reaches data only through openbq-docker's gateway, so it needs that stack's opt-in `web` profile. Nothing is deployed for you: the repository builds the preview, and the operator decides whether to publish it.

## What it serves

The preview is not a standalone server. Every data call, and each signed-in user's saved dashboards and settings, go through the stack's `funnel-gateway`, with a machine token the browser never sees:

- **`/api`** — openbq-api's `widgets.json`, `apps.json` and its `/api/v1/**` data routes, inside the gateway's shape bounds and daily budget.
- **`/state`** — each GitHub user's saved configuration (dashboards, settings, backends), kept on the stack. The page saves only after it has read the user's store; if it could not, changes last until reload.
- **`/table`** — with the stack's `table` profile, the managed server tables. The seeded connections include **Managed tables** at the preview's own `/table`. See [[tables|Tables]].
- **`/ref`** — the whole Episode 3 reference backend, keyless. The seeded connections include "OpenBQ Reference (preview)" at the preview's own `/ref`; a preview profile that already has saved connections does not get it added automatically, so add it under Connections with that URL.

One socket is served at this version: the reference's Live Grid socket, `/ref/live_grid_ws`. The browser opens it on the gateway with a thirty-second, single-use ticket, not through the Vercel Function.

It is not desktop parity. Both layers are GET-only for data, so `multi_file_viewer` widgets and form widgets render but their `POST` fails. Native file workflows, keys, stores and admin paths are not available, and uploaded documents are never saved. The catalogue is unfiltered: a widget whose provider has no key on the stack loads, then shows the backend's error.

## Setting it up

1. **On the stack.** Turn the API's lock on (`OPENBB_API_AUTH=true`), fill `gateway.env` and `gateway-config/settings.json` from their examples (with `stateDir` set, for `/state`), and start `docker compose --profile web up -d`. Nothing is public until you also swap the sidecar's serve file for its Funnel variant, which publishes port 10000 alone. See openbq-docker's `funnel-gateway/README.md` and [[tailscale-networking|Tailscale Networking]].
2. **The preview.** `pnpm build:web` writes a private Vercel function under `.vercel/output`; `pnpm web:serve` runs the same server on loopback behind your own HTTPS proxy. Set its environment from `web/.env.example`: the GitHub OAuth app, `AUTH_SECRET`, `SESSION_EPOCH`, the numeric `GITHUB_ALLOWED_USER_IDS` (empty admits nobody), `BACKEND_GATEWAY_ORIGIN` (`https://<node>.<tailnet>.ts.net:10000`) and `BACKEND_GATEWAY_TOKEN` (the gateway's `GATEWAY_TOKEN`).

Sign-in is GitHub only, and each session ends after an hour.

## How the two stay in step

`web/policy.mjs` is vendored from the gateway's `funnel-gateway/policy.mjs` at the openbq-docker commit `package.json` names as `openbqDocker`, so the preview and the gateway admit the same requests. `pnpm test:web` checks the copy against that commit. Nothing in the desktop app depends on the web layer.

---
*Source: BDOBB `web/server.mjs`, `web/config.mjs`, `web/bootstrap.mjs`, `src/browser-shim/socket.ts`, `web/policy.mjs`, `web/security.test.mjs` and `package.json` at `v6.0.0`; `openbq-docker` `funnel-gateway/`, `docker-compose.yml` and `ts-config/` at `v6.0.0`.*
*See also: [[openbq-docker-stack|The openbq-docker Stack]] · [[tailscale-networking|Tailscale Networking]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v6.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
