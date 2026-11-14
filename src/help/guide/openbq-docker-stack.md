---
type: Note
tags: [bdobb, help, integrations, openbq-docker, stack, services, ports]
---

# The openbq-docker Stack

**openbq-docker** is the self-hosted Open Data Platform (the OpenBB Platform packages, whose commands keep their `openbb-*` names) in Docker, behind a Tailscale sidecar, that the *Adventures in OpenBQ* series builds episode by episode. BDOBB v5.0.0 pairs with openbq-docker `v5.0.0`; the two repositories tag independently. BDOBB's `package.json` names, as `openbqDocker`, the openbq-docker commit whose gateway policy the web layer vendors; see [[web-preview|Web Preview]]. This page is the map: what runs, how each piece is reached, and what each one is inside BDOBB.

## The base compose: two containers, one tailnet node, no host ports

`docker-compose.yml` alone runs two containers on a private Docker bridge, `openbq-internal`: a **Tailscale sidecar** that joins your tailnet as a node named `openbq`, and the API, **`openbq-api`**, listening on port 6900 inside the bridge. Nothing is published to the host or the LAN. **Tailscale Serve is the only way in**: real HTTPS at `https://openbq.<your-tailnet>.ts.net` (port 443), reachable from devices on your tailnet and nothing else. Funnel is disabled on every port; the opt-in web door below is the one exception. (An optional Episode 2 `workspace` profile adds an OpenBB Workspace server on a node of its own; BDOBB does not need it.)

The API is the full image, `openbq-local:5.0.0`, built from the `Dockerfile`'s `v3` stage: the official core and API, seventeen providers, and the technical, quantitative and econometric extensions; the openbq-yfinance widgets; the trading-calendar and fiscal-year-end routes that date expressions read (see [[card-parameters|Card Parameters]]); and, with auth on, BDOBB's settings, dashboard and app sync routes (`/pro/*`; see [[settings-and-logs|Settings and Logs]]). `docker-compose.yml` alone builds and serves all of it.

## The Episode 3 overlay

`docker-compose.v3.yml`, used together with the base file, adds Episode 3's two services and switches the sidecar to `ts-config/serve-v3.json`, which also publishes the reference backend:

| Service | Reached at | In BDOBB |
|---|---|---|
| the reference backend (`openbq-reference`) | `https://openbq.<your-tailnet>.ts.net:8443` | a connection: the reference widgets, the *Onboarding App for Devs* and the *Episode 3 — Pivot examples* app, whose tables open with their Pivot settings; open (no auth) |
| `key-maint` | `http://127.0.0.1:8447` on the Docker host, or `https://openbq-keys.<your-tailnet>.ts.net` once you create the Tailscale Service `svc:openbq-keys` | a connection: **Settings ▸ Provider API Keys** |

key-maint's image is `openbq-key-maint:5.0.0`, built from the openbq-docker checkout like the API's; the API answers its provider inventory at `/providers.json` (Basic auth when the API's auth is on).

## What it serves to BDOBB: examples, demo keys and the logo

- **One combined examples file.** openbq-docker serves one `examples/bdobb/apps.json` of every BDOBB example from v3 up to its own version, and has from v3 on; the stack's lanes hook appends it to the API's `/apps.json`. openbq-docker v3 serves **Built-in widgets**, **Demo providers** and **Video Library**, and v4 and v5 add theirs, so v5 serves every example in [[example-dashboards|Example Dashboards]]. BDOBB writes the file with `EPISODE=5 pnpm apps:sync`.
- **The widgets those need.** From v3 the API carries the `openbb-videos` extension (the Video Library's `videos_video_custom_obb`) and the EconDB extension, next to its keyless BLS, CFTC and Nasdaq widgets.
- **Large tables, server-paged.** 41 table widgets whose full response is too large to send at once (FINRA bonds, FFIEC institution structure and many EIA tables among them) are advertised as server-paged tables (`ssrm_table`), which BDOBB draws a page at a time; their list is the stack's `lanes/ssrm_widgets.json`. See [[tables|Tables]].
- **Demo keys.** A committed `credentials.demo.env` supplies api.data.gov's public demo key for EIA and Congress.gov; Compose loads it before `credentials.env`, so a key you set there wins. BLS, CFTC and Nasdaq need no key; EconDB asks its service for a temporary token, which the service may refuse. See [[example-dashboards|Example Dashboards]].
- **The BDOBB logo** each example card shows, at `/openbq/bdobb-logo.svg`, served by the lanes hook without auth.

## Opt-in profiles: the web door and managed tables

Two compose profiles add services that plain `docker compose up -d` never starts:

- **`web`** adds `funnel-gateway`, the door for BDOBB's [[web-preview|Web Preview]]: `/api`, `/state` (each viewer's saved configuration), with `table` `/table`, and with the Episode 3 overlay `/ref` (the reference backend) and its Live Grid socket. It is published on port 10000, the only port any serve file funnels, and only when you swap the sidecar's serve file for its Funnel variant. It needs the API's auth on.
- **`table`** adds the private native table service behind the managed tables. See [[tables|Tables]].

## Auth is optional

The API is open unless `credentials.env` sets `OPENBB_API_AUTH=true` with `OPENBB_API_USERNAME` and `OPENBB_API_PASSWORD`. With auth on, every data route needs HTTP Basic auth; `/widgets.json` and `/apps.json` stay open. The settings, dashboard and app sync routes need `OPENBB_API_AUTH=true`: with auth off there is no credential to tie your settings to, and those routes answer 404. key-maint's auth follows the API's. The reference backend has none.

## Before first start

Every secret is a file you copy from its `.example` and never commit: `ts.env` (the Tailscale auth key) and `credentials.env` (provider keys and the optional API auth). The overlay adds `v3.env` (the reference backend's extra browser origins and Omni languages) and, for key-maint, a host directory created once with `mkdir -p key-maint-admin && chmod 700 key-maint-admin`. The README's *Start* and *Episode 3* sections and `key-maint/README.md` are the authority for the exact sequence; this guide does not repeat them.

## Connecting BDOBB to it

Up to three connections cover the stack: the API, the reference backend and key-maint. The per-service credential table is in [[backends-and-connections|Backends and Connections]].

## What runs where

Any Docker Compose host runs the stack (the series uses a NAS), and the Mac runs BDOBB, reaching the stack over the tailnet. The tailnet needs **MagicDNS** and **HTTPS certificates** enabled in the admin console.

---
*Source: the user's pairing rulings of 2026-10-14 (the combined examples file from v3 on, the `openbb-videos` and EconDB extensions, `credentials.demo.env`, the logo route); `openbq-docker` `README.md`, `Dockerfile` (stage `v3`), `docker-compose.yml`, `docker-compose.v3.yml`, `credentials.env.example`, `ts-config/serve.json`, `ts-config/serve-v3.json`, `v3/openbq_settings.py`, `v3/openbb.toml`, `v4/routes/`, `lanes/ssrm_widgets.json`, `examples/episode3/README.md`, `funnel-gateway/README.md` and `docs/credentials-demo-receipt.md` at `v5.0.0`; `BDOBB` `src/lib/appsExtensionsV4.ts`; `BDOBB` `package.json` (`openbqDocker`) at `v5.0.0`; `openbq-docker` `ts-config/serve-v3-keys.json` and `key-maint/README.md` at `v5.0.0`; Adventures in OpenBQ, Eps. 1–5.*
*See also: [[backends-and-connections|Backends and Connections]] · [[tailscale-networking|Tailscale Networking]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v5.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
