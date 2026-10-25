---
type: Note
tags: [bdobb, help, integrations, openbq-docker, stack, services, ports, web, news]
---

# The openbq-docker Stack

**openbq-docker** is the self-hosted Open Data Platform (the OpenBB Platform packages, whose commands keep their `openbb-*` names) in Docker, behind a Tailscale sidecar, that the *Adventures in OpenBQ* series builds episode by episode. **BDOBB 8.0.0 pairs with openbq-docker v8.0.0**, the stack its `package.json` names as `openbqDocker`; the two repositories tag independently. Until the stack's tag is cut it names the paired openbq-docker commit. (The older `openbbDocker` key is historical: it names the openbb-docker release, `v3.0.1`, that v3 vendored the web layer's gateway policy from. From v4.0.0 the policy comes from openbq-docker; see [[web-preview|Web Preview]] and *The vendored gateway policy* below.) openbq-docker v8 (Adventures-OpenBQ/openbq-docker) is v7.0.0 plus the News wire in the opt-in `web` compose profile (the profile, its gateway and the `table` profile arrive at v4), and a hidden route for BDOBB's locked widgets. This page is the map: what runs, how each piece is reached, and what each one is inside BDOBB.

## The base compose: two containers, one tailnet node, no host ports

`docker-compose.yml` alone runs two containers on a private Docker bridge, `openbq-internal`: a **Tailscale sidecar** that joins your tailnet as a node named `openbq`, and the API, **`openbq-api`**, listening on port 6900 inside the bridge. Nothing is published to the host or the LAN. **Tailscale Serve is the only way in**: real HTTPS at `https://openbq.<your-tailnet>.ts.net` (port 443), reachable from devices on your tailnet and nothing else. Funnel is disabled on every port. (An optional Episode 2 `workspace` profile adds an OpenBB Workspace server on a node of its own; BDOBB does not need it.)

The API is the full image, `openbq-local:8.0.0`, built from the `Dockerfile`'s `v3` stage: the official core and API, seventeen providers, and the technical, quantitative and econometric extensions; the openbq-yfinance widgets; the trading-calendar and fiscal-year-end routes that date expressions read (see [[card-parameters|Card Parameters]]); and, with auth on, BDOBB's settings, dashboard and app sync routes (`/pro/*`; see [[settings-and-logs|Settings and Logs]]). `docker-compose.yml` alone builds and serves all of it.

## The Episode 3 overlay

`docker-compose.v3.yml`, used together with the base file, adds Episode 3's two services and switches the sidecar to `ts-config/serve-v3.json`, which also publishes the reference backend:

| Service | Reached at | In BDOBB |
|---|---|---|
| the reference backend (`openbq-reference`) | `https://openbq.<your-tailnet>.ts.net:8443` | a connection: the reference widgets and pivot examples, open (no auth) |
| `key-maint` | `http://127.0.0.1:8447` on the Docker host, or `https://openbq-keys.<your-tailnet>.ts.net` once you create the Tailscale Service `svc:openbq-keys` | a connection: **Settings ▸ Provider API Keys** |

key-maint's image is `openbq-key-maint:8.0.0`, built locally by Compose from openbq-docker's `key-maint/`. The API answers its provider inventory at `/providers.json` (Basic auth when the API's auth is on).

## The Episode 6 overlay: Rita and MCP

`docker-compose.v6.yml`, used together with the base file and the Episode 3 overlay, adds the two services BDOBB's AI side talks to. Neither is a connection; both are set in the AI Library.

| Service | Reached at | In BDOBB |
|---|---|---|
| `openbq-rita` — OpenBQ Rita, the agent | `https://openbq.<your-tailnet>.ts.net:10443`, or `https://openbq-rita.<your-tailnet>.ts.net` (Tailscale Service, opt-in) | the **Rita URL** on **AI Library ▸ Agents** |
| `openbq-mcp` — the OpenBB MCP server | `https://openbq.<your-tailnet>.ts.net:11443/mcp`, or `https://openbq-mcp.<your-tailnet>.ts.net/mcp` (Tailscale Service, opt-in) | a row on **AI Library ▸ MCP Servers** |

Both images are built on the machine that runs them and never pulled from a registry (`pull_policy: never`): `openbq-rita:6.0.0` by `scripts/build.sh` in the recipe `Adventures-OpenBQ/agent-rita-bdobb` `v6.0.0`, and `openbq-mcp:8.0.0` by Compose from `mcp/`, on top of the `openbq-api` image the base compose builds. They publish no host port and are served by the same sidecar, tailnet-only. Neither authenticates its callers, and MCP calls the Platform with the stack's provider keys, so restrict 10443, 11443 and Rita's plain-HTTP 7777 with a tailnet ACL; see [[rita-ai-agent-setup|Setting Up the Rita AI Agent]]. Rita needs an OpenAI-compatible model endpoint, named in a private `rita.env` copied from `rita.env.example`, and runs in the sidecar's network namespace so it can reach a model on the tailnet by its MagicDNS name; if the sidecar is recreated, recreate `openbq-rita` too. The overlay ships in openbq-docker `v8.0.0`. See [[rita-ai-agent-setup|Setting Up the Rita AI Agent]].

## openbq-docker v8: the `web` profile

`docker compose --profile web up -d` adds two services to the stack; a plain `docker compose up -d` never starts them. The profile is for the web preview's door, and it will not load until the door's files exist — `gateway.env` and `gateway-config/`, which `funnel-gateway/README.md` walks through.

**For a desktop News card alone** you need only rss-ticker, not the door. From the openbq-docker checkout, `cp rss-ticker-config/config.yaml.example rss-ticker-config/config.yaml` (rss-ticker will not start without it), then `docker compose up -d rss-ticker`, with the same `-f` files you run the stack with. Naming the service starts it without the profile, so none of the gateway's files are needed. See [[news-widget|The News Widget]].

| Service | Reached at | In BDOBB |
|---|---|---|
| `rss-ticker` (`openbq-rss-ticker:8.0.0`, built locally by Compose from openbq-docker's vendored `rss-ticker/`; nothing is pulled) | your tailnet only, port **8088** (`https://openbq.<your-tailnet>.ts.net:8088`), published by every one of the stack's Serve configurations — `serve.json`, `serve-v3.json`, `serve-v3-keys.json`, `serve-v6.json`, `serve-v6-keys.json` and the two Funnel files — and never funneled | the server a desktop **News** card names; see [[news-widget\|The News Widget]] |
| `funnel-gateway` | Funnel port **10000**, behind one `Authorization: Bearer <GATEWAY_TOKEN>` | the door the [[web-preview\|Web Preview]] relays through |

The gateway forwards these families and nothing else: **`/api`** (the ODP catalogue and its `/api/v1` routes, with the API's own Basic pair injected), **`/news`** (one approved feed's history at `/news/api/news`, and the `/news/ws/news` socket, opened with a short-lived signed ticket), **`/state`** (a preview user's saved files), **`/ref`** (the Episode 3 reference backend, keyless, with its ticketed Live Grid socket `/ref/live_grid_ws`) and, with the `table` profile, **`/table`** (the managed server tables, from v4). There is **no `/ai`**: Rita is not relayed, and every `/ai` path is a 404. Which feeds `/news` serves is the gateway's `feeds` setting — approved feed URL to rss-ticker id, no two sharing an id — and the preview's `NEWS_APPROVED_FEEDS_JSON` must name the same feeds. The gateway rebuilds a socket's subscription from the approved feeds alone and passes back only those feeds' stories. There is no request budget at the door: the GitHub allow-list, the gateway's concurrency and socket caps and the data vendor's own plan limits are what bound a viewer.

Nothing is public until two separate steps both happen: the profile is started, **and** the sidecar's Serve configuration is swapped to the stack's `serve-funnel.json` — or, under the Episode 3 overlay, `serve-v3-funnel.json`, which keeps the reference backend on 8443 — and either funnels port 10000 alone; port 443 stays tailnet-only. The sidecar applies a swapped file at once, without a restart. Neither Funnel file carries the `svc:openbq-keys` Service, so while one is in place key-maint is not reachable by that name; `http://127.0.0.1:8447` on the Docker host still reaches it. The stack asks for the API's own lock first (`OPENBB_API_AUTH=true`). The stack's `README.md` and `funnel-gateway/README.md` are the authority for the exact steps.

openbq-docker v8 also serves BDOBB's **locked widgets** as one hidden dashboard per account on `/pro/dash/sync/system/docks`, in key mode and, through its Workspace patch, in login mode. See [[locked-and-pinned-widgets|Locked and Pinned Widgets]].

## The vendored gateway policy

BDOBB's web layer does not write its own route rules: `web/policy.mjs` is openbq-docker's `funnel-gateway/policy.mjs`, copied verbatim under a header that names **openbq-docker**, the tag and the SHA-256 of the body, and `web/policy.vendored.json` records the tag and the hash. `pnpm gateway:vendor v8.0.0` refreshes it from an openbq-docker checkout — `OPENBQ_DOCKER_DIR`, by default `~/Developer/openbq-docker` — reading the tag. `web/security.test.mjs` proves the copy is intact and that it pairs with `openbqDocker`. That file is itself ported from openbb-docker v8.0.3's gateway with the `/ai` family removed, so the two stacks agree on everything else the door admits.

## What it serves to BDOBB: examples, demo keys and the logo

- **One combined examples file.** openbq-docker serves one `examples/bdobb/apps.json` of every BDOBB example from v3 up to its own version, and has from v3 on; the stack's lanes hook appends it to the API's `/apps.json`. openbq-docker v3 serves **Built-in widgets**, **Demo providers** and **Video Library**, and each later release adds its version's examples, so v8 serves every example in [[example-dashboards|Example Dashboards]]. BDOBB writes the file with `EPISODE=8 pnpm apps:sync`.
- **The widgets those need.** From v3 the API carries the `openbb-videos` extension (the Video Library's `videos_video_custom_obb`) and the EconDB extension, next to its keyless BLS, CFTC and Nasdaq widgets.
- **Demo keys.** A committed `credentials.demo.env` supplies the providers' own public demo keys for EIA and Congress.gov; Compose loads it before `credentials.env`, so a key you set there wins.
- **The BDOBB logo** each example card shows, at `/openbq/bdobb-logo.svg`, served by the lanes hook without auth.

## Opt-in profiles: the web door and managed tables

Two compose profiles add services that plain `docker compose up -d` never starts:

- **`web`** adds `funnel-gateway` and `rss-ticker`; see *openbq-docker v8: the `web` profile* above. With `table`, the gateway also serves `/table`.
- **`table`** adds the private native table service behind the managed tables. See [[tables|Tables]].

## Auth is optional

The API is open unless `credentials.env` sets `OPENBB_API_AUTH=true` with `OPENBB_API_USERNAME` and `OPENBB_API_PASSWORD`. With auth on, every data route needs HTTP Basic auth; `/widgets.json` and `/apps.json` stay open. The settings, dashboard and app sync routes need `OPENBB_API_AUTH=true`: with auth off there is no credential to tie your settings to, and those routes answer 404. key-maint's auth follows the API's. The reference backend has none.

## Before first start

Every secret is a file you copy from its `.example` and never commit: `ts.env` (the Tailscale auth key) and `credentials.env` (provider keys and the optional API auth). The overlay adds `v3.env` (the reference backend's extra browser origins and Omni languages) and, for key-maint, a host directory created once with `mkdir -p key-maint-admin && chmod 700 key-maint-admin`. The README's *Start* and *Episode 3* sections and `key-maint/README.md` are the authority for the exact sequence; this guide does not repeat them.

## Connecting BDOBB to it

Up to three connections cover the stack: the API, the reference backend and key-maint. Rita and the MCP server are set in the AI Library instead. The per-service credential table is in [[backends-and-connections|Backends and Connections]].

## What runs where

Any Docker Compose host runs the stack (the series uses a NAS), and the Mac runs BDOBB, reaching the stack over the tailnet. The tailnet needs **MagicDNS** and **HTTPS certificates** enabled in the admin console.

---
*Source: the user's pairing rulings of 2026-10-14 (the combined examples file from v3 on, the `openbb-videos` and EconDB extensions, `credentials.demo.env`, the logo route); `openbq-docker` `README.md`, `Dockerfile` (stage `v3`), `docker-compose.yml`, `docker-compose.v3.yml`, `credentials.env.example`, `ts-config/serve.json`, `ts-config/serve-v3.json`, `v3/openbq_settings.py`, `v3/openbb.toml` and `v4/routes/` at `v7.0.0`; `BDOBB` `package.json` (`openbqDocker`) at `v7.0.0`; `docker-compose.v3.yml`, `ts-config/serve-v3-keys.json` and `key-maint/README.md` at `v7.0.0`; `README.md`, `docker-compose.v6.yml`, `ts-config/serve-v6.json` and `rita.env.example` at `v8.0.0`; Adventures in OpenBQ, Eps. 1–7; at v8, openbq-docker `README.md`, `docker-compose.yml`, `ts-config/serve.json`, `ts-config/serve-funnel.json`, `ts-config/serve-v3.json`, `ts-config/serve-v3-funnel.json` and `funnel-gateway/README.md` at `v8.0.0`, and BDOBB `package.json` (`openbqDocker`), `scripts/gateway-vendor.mjs`, `web/policy.vendored.json` and `web/config.mjs` at 8.0.0.*
*See also: [[web-preview|Web Preview]] · [[news-widget|The News Widget]] · [[backends-and-connections|Backends and Connections]] · [[tailscale-networking|Tailscale Networking]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
