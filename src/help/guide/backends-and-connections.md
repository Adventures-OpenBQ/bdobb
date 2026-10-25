---
type: Note
tags: [bdobb, help, configuration, backends, connections, credentials, auth]
---

# Backends and Connections

BDOBB has no data of its own — every widget comes from a backend you have connected by URL. The companion stack is up to three such backends. This page is the reference. For the mechanics of the dialog, see [[connecting-a-backend|Connecting a Backend]].

## What each service wants

| Service | Needs | Key / Value / Location |
|---|---|---|
| **The API** (`openbq-api`) — the standard providers, at `https://openbq.<your-tailnet>.ts.net` | the base compose | nothing while `OPENBB_API_AUTH` is off; with it on, `Authorization` / `Basic <base64 of user:password>` / **Header** |
| **The reference backend** (`openbq-reference`), at `https://openbq.<your-tailnet>.ts.net:8443` | the Episode 3 overlay | nothing |
| **key-maint** — the Provider API Keys backend, at `http://127.0.0.1:8447` on the Docker host or `https://openbq-keys.<your-tailnet>.ts.net` | the Episode 3 overlay (key-maint ships with openbq-docker `v7.0.0`) | the same as the API: nothing while its auth is off, the same Basic auth when it is on |
| **Rita**, at `https://openbq.<your-tailnet>.ts.net:10443`, or the Tailscale Service `https://openbq-rita.<your-tailnet>.ts.net` | the Episode 6 overlay | not a connection: it is the AI Library's Rita URL; no client authentication (restrict it, and plain-HTTP 7777, with a tailnet ACL) |
| **MCP server** (`openbb-mcp`), at `https://openbq.<your-tailnet>.ts.net:11443/mcp`, or the Tailscale Service `https://openbq-mcp.<your-tailnet>.ts.net/mcp` | the Episode 6 overlay | not a connection: it is an **AI Library ▸ MCP Servers** row; no credential, yet it spends the stack's provider keys, so restrict it with a tailnet ACL |

With the API's auth on, `/widgets.json` and `/apps.json` stay open, so discovery succeeds without the credential and only the cards fail with a 401. The user name and password are `OPENBB_API_USERNAME` and `OPENBB_API_PASSWORD` in the stack's `credentials.env`. To keep your settings, dashboards and apps on the API (**Settings ▸ General ▸ User Settings ▸ Server**), it needs `OPENBB_API_AUTH=true`, and the connection needs that Basic auth as its key; see [[settings-and-logs|Settings and Logs]].

## Reachability as the credential

Every service in the stack sits on its private bridge and is published only by Tailscale Serve (key-maint also on the host's loopback), so reaching an address at all already takes a device on your tailnet; the optional Basic auth is a second gate. Funnel is off for every backend; the one public door is the v8 `web` profile's funnel-gateway, which relays only the web preview's route families (see [[web-preview|Web Preview]]). See [[openbq-docker-stack|The openbq-docker Stack]] for the ports.

## Why the seeded `Local` never works

A fresh install seeds one connection, `Local` at `http://localhost:6900`. The stack's API does listen on 6900 — inside the container network, not on your host. openbq-docker publishes no port for it, so the entry sits red until you replace the URL with the Serve address. It is a placeholder for people who run an OpenBB backend of their own on the local machine.

## Where the credentials go

Into `backends.json` in the app's data directory, in the clear. Choosing **Query Parameter** as the location puts the key in every request URL, where a proxy log can catch it; the dialog warns, and the app itself strips query strings before logging a failed request's URL. See [[app-data-and-settings|App Data and Settings]].

## Multiple backends, independent health

Each connection is tracked independently. Discovery runs at launch and on demand; a backend that fails moves to *Inactive* with a red dot, its cards show a retry state, and nothing else notices. A single dashboard can mix cards from every connection — a Platform table beside a widget from a backend of your own — because each card only ever depends on its own backend being reachable.

---
*Source: BDOBB v3.0.2 in-app manual, "Connections"; `openbq-docker` `README.md`, `credentials.env.example`, `docker-compose.yml`, `docker-compose.v3.yml`, `ts-config/serve.json` and `ts-config/serve-v3.json` at `v7.0.0`; `key-maint/README.md` at `v7.0.0`.*
*See also: [[connecting-a-backend|Connecting a Backend]] · [[openbq-docker-stack|The openbq-docker Stack]] · [[tailscale-networking|Tailscale Networking]] · [[provider-keys|Provider Keys]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
