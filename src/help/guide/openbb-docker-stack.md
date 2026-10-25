---
type: Note
tags: [bdobb, help, integrations, openbb-docker, stack, services, ports]
---

# The openbb-docker Stack

**openbb-docker** is the self-hosted OpenBB Platform in Docker, behind a Tailscale sidecar, that the *Adventures in OpenBB* series builds episode by episode — and it is the backend BDOBB was written against. BDOBB v3.3.3 pairs with openbb-docker `v3.0.1`, the stack tag its `package.json` names and its web layer vendors the gateway policy from: the two repositories tag independently, and the stack is tagged only when it changes. Both were tagged for Episode 3, and the stack's Episode 3 point releases add what the table below lists — the funnel gateway behind the [[web-preview|Web Preview]] is an opt-in fourth container, started only with the `web` profile. This page is the map: what runs, how each piece is reached, and what each one is inside BDOBB.

## Three containers, one tailnet node, zero exposed ports

The backbone, unchanged since Ep. 1: a small **Tailscale sidecar** that joins your tailnet as a node named `openbb` — the only container with a tailnet address — and the **OpenBB Platform REST API**, with all the standard providers plus the technical, quantitative and econometrics extensions. Beside the API, on a private Docker bridge, `openbb-internal`, which the sidecar reaches them over, runs **key-maint**. Nothing is published to the host or the LAN. **Tailscale Serve is the only way in**: real HTTPS with a Let's Encrypt certificate at `https://openbb.<your-tailnet>.ts.net`, reachable from every device on your tailnet and invisible to everything else.

| Service | Episode | Reached at | In BDOBB |
|---|---|---|---|
| `openbb-api` | 1–2 | `https://openbb.<your-tailnet>.ts.net` (port 443), or `svc:openbb-api`; Basic auth | a connection — every standard widget |
| `key-maint` | 3 | `:10000`, or `svc:openbb-keys`; Basic auth | a connection — **Settings ▸ Provider API Keys** |

The third container is the sidecar itself. The README at this tag still opens with *Two containers*, counting the sidecar and the API; its compose file runs all three, and this guide follows the compose file.

Other processes on the same Docker host can reach the bridged services directly, but both answer with the same Basic auth as everyone else, on every path. key-maint's admin surface is a unix socket that never touches the bridge. Nothing on your LAN reaches any of them. From your tailnet, Serve publishes each port as HTTPS and terminates TLS, so BDOBB only ever sees an `https://` base URL. The `svc:` names — `svc:openbb-api` and `svc:openbb-keys` — are Tailscale Services: stable HTTPS names that survive the service moving between nodes. See [[tailscale-networking|Tailscale Networking]].

## What each episode added

| Release | Episode | Adds |
|---|---|---|
| v1.0.0 | Ep. 1 — Your Own Bloomberg in a Cabinet | Tailscale sidecar + OpenBB Platform API, Serve-only ingress, provider keys |
| v2.0.0 | Ep. 2 — The Borrowed Terminal | HTTP Basic auth on the API, Funnel on port 443 only |
| v3.0.0 | Ep. 3 | key-maint: the transport-tiered key status backend |
| v3.0.1 | Ep. 3 | the funnel gateway carried onto the v3 line (opt-in, the `web` profile); demo provider keys in `credentials.env.example` (EIA, Congress.gov, Alpha Vantage); `/apps.json` serves the Episode 3 example dashboards — see [[example-dashboards\|Example Dashboards]] |

## Before first start

Every secret is a file you copy from its `.example` and never commit: `ts.env` (the Tailscale auth key), `api-auth.env` (the API's Basic auth — required; the API refuses to start without it) and `credentials.env` (provider keys — optional; keyless providers work with none). key-maint's README also asks for its admin directory first — `mkdir -p key-maint-admin && chmod 700 key-maint-admin` — because that directory's permissions are what raise a caller to its tier 3. Then `docker compose up -d --build`. The README's *Quick start* and *Provider keys* sections are the authority for the exact sequence; this guide does not repeat them.

## Connecting BDOBB to it

Two connections cover the stack: the API (Basic auth) and key-maint (the same Basic auth). The per-service credential table is in [[backends-and-connections|Backends and Connections]].

## What runs where

Two machines are enough: any Docker Compose host runs the stack — the README names a NAS or a Linux box — and the Mac runs BDOBB, reaching the stack over the tailnet. The README's prerequisites are that host plus a free Tailscale account with **MagicDNS** and **HTTPS certificates** enabled in the admin console.

---
*Source: `openbb-docker` `README.md`, `docker-compose.yml`, `Dockerfile`, `ts-config/serve.json` and `key-maint/README.md` at `v3.0.0`; `BDOBB` `package.json` (`openbbDocker`) at `v3.3.3`; the release table in `openbb-docker` `README.md` and the `web` profile in its `docker-compose.yml` at `v3.0.1`; Adventures in OpenBB, Eps. 1–3.*
*See also: [[backends-and-connections|Backends and Connections]] · [[tailscale-networking|Tailscale Networking]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*
