---
type: Note
tags: [bdobb, help, integrations, openbq-docker, stack, services, ports]
---

# The openbq-docker Stack

**openbq-docker** (Adventures-OpenBQ/openbq-docker) is the self-hosted Open Data Platform — the OpenBB Platform packages, whose commands keep their `openbb-*` names — in Docker, behind a Tailscale sidecar, that the *Adventures in OpenBQ* series builds episode by episode. **BDOBB 3.0.0 pairs with openbq-docker `v3.0.0`**, the stack tag its `package.json` names as `openbqDocker`; every BDOBB vN pairs with openbq-docker vN, and the two repositories tag independently. This page is the map: what runs, how each piece is reached, and what each one is inside BDOBB.

## The base compose: two containers, one tailnet node, no host ports

`docker-compose.yml` alone runs two containers on a private Docker bridge, `openbq-internal`: a **Tailscale sidecar** that joins your tailnet as a node named `openbq`, and the API, **`openbq-api`**, listening on port 6900 inside the bridge. Nothing is published to the host or the LAN. **Tailscale Serve is the only way in**: real HTTPS at `https://openbq.<your-tailnet>.ts.net` (port 443), reachable from devices on your tailnet and nothing else. Funnel is off.

The base API is the official core and API with seventeen providers and the technical, quantitative and econometric extensions, plus what BDOBB's examples need:

- **The example dashboards.** One combined `examples/bdobb/apps.json` of every BDOBB example from v3 up to the stack's own version is appended to the API's `/apps.json`; at v3 that is **Built-in widgets**, **Demo providers** and **Video Library** (see [[example-dashboards|Example Dashboards]]).
- **The widgets they need.** The `openbb-videos` extension (the Video Library's `videos_video_custom_obb`) and the EconDB extension, next to the keyless BLS, CFTC and Nasdaq providers.
- **Demo keys.** A committed `credentials.demo.env` supplies api.data.gov's public demo key for EIA and Congress.gov; your own keys in `credentials.env` override it.
- **The BDOBB logo** each example card shows, at `/openbq/bdobb-logo.svg`, served without auth.

CFTC (`/api/v1/cftc/*`) and FINRA bonds run in a separate "heavy" lane, one request at a time, so their large answers cannot stall the rest of the API.

Two optional compose profiles add services plain `docker compose up -d` never starts: `workspace` (an Episode 2 OpenBB Workspace server on a node of its own; BDOBB does not need it) and `web` (the funnel gateway behind the [[web-preview|Web Preview]], below).

## The Episode 3 overlay

`docker-compose.v3.yml`, used together with the base file, adds Episode 3:

| Service | Reached at | In BDOBB |
|---|---|---|
| `openbq-api`, rebuilt as `openbq-local:3.0.0` | `https://openbq.<your-tailnet>.ts.net` (443) | a connection: every standard widget, plus the openbq-yfinance widgets and, with auth on, the settings, dashboard and app sync routes (`/pro/*`) |
| the reference backend (`openbq-reference`) | `https://openbq.<your-tailnet>.ts.net:8443` | a connection: the reference widgets and their app, open (no auth) |
| `key-maint` | `http://127.0.0.1:8447` on the Docker host, or `https://openbq-keys.<your-tailnet>.ts.net` once you create the Tailscale Service `svc:openbq-keys` | a connection: **Settings ▸ Provider API Keys** |

The overlay switches the sidecar to `ts-config/serve-v3.json`, which publishes the reference backend on 8443 beside the API. key-maint's image is `openbq-key-maint:3.0.0`, built from the openbq-docker checkout like the API's.

## The `web` profile: the funnel gateway

`docker compose --profile web up -d` starts `funnel-gateway`, the one door the [[web-preview|Web Preview]] uses. It is published on **Funnel port 10000** only after you also swap the sidecar to `ts-config/serve-funnel.json` (or `serve-v3-funnel.json` with the overlay); port 443 stays tailnet-only. The gateway demands its own `GATEWAY_TOKEN` on every request, its preflight refuses an API whose auth is off, and it relays exactly `/api` (the API), `/ref` (the reference backend, which needs the overlay), `/state` (the preview's per-user saved files) and one socket, the reference backend's live grid. Its settings are in `gateway.env`.

## Auth is optional

The API is open unless `credentials.env` sets `OPENBB_API_AUTH=true` with `OPENBB_API_USERNAME` and `OPENBB_API_PASSWORD`. With auth on, every data route needs HTTP Basic auth; `/widgets.json` and `/apps.json` stay open. The settings, dashboard and app sync routes need both the Episode 3 overlay **and** `OPENBB_API_AUTH=true`: with auth off there is no credential to tie your settings to, and those routes answer 404. key-maint's auth follows the API's. The reference backend has none.

## Before first start

Every secret is a file you copy from its `.example` and never commit: `ts.env` (the Tailscale auth key) and `credentials.env` (provider keys and the optional API auth). The overlay adds `v3.env` (the reference backend's extra browser origins and Omni languages) and, for key-maint, a host directory created once with `mkdir -p key-maint-admin`; the `web` profile adds `gateway.env`. The README's *Start* and *Episode 3* sections and `key-maint/README.md` are the authority for the exact sequence; this guide does not repeat them.

## Connecting BDOBB to it

Up to three connections cover the stack: the API, the reference backend and key-maint. The per-service credential table is in [[backends-and-connections|Backends and Connections]].

## What runs where

Any Docker Compose host runs the stack (the series uses a NAS), and the Mac runs BDOBB, reaching the stack over the tailnet. The tailnet needs **MagicDNS** and **HTTPS certificates** enabled in the admin console.

---
*Source: `openbq-docker` `README.md`, `Dockerfile` (stages `api` and `v3`), `docker-compose.yml`, `docker-compose.v3.yml`, `credentials.demo.env`, `credentials.env.example`, `ts-config/`, `examples/bdobb/README.md`, `funnel-gateway/README.md`, `docs/v3/gateway.md` and `key-maint/README.md` at `v3.0.0`; `BDOBB` `package.json` (`openbqDocker`) at 3.0.0; Adventures in OpenBQ, Eps. 1–3.*
*See also: [[backends-and-connections|Backends and Connections]] · [[tailscale-networking|Tailscale Networking]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]] · [[example-dashboards|Example Dashboards]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
