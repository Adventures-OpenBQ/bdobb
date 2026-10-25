---
type: Note
tags: [bdobb, help, configuration, backends, connections, credentials, auth]
---

# Backends and Connections

BDOBB has no data of its own — every widget comes from a backend you have connected by URL. The companion stack is two such backends, both behind the same Basic auth. This page is the reference. For the mechanics of the dialog, see [[connecting-a-backend|Connecting a Backend]].

## What each service wants

| Service | Connection? | Key / Value / Location |
|---|---|---|
| **OpenBB Platform API** (`openbb-api`) — the standard providers | yes | `Authorization` / `Basic <base64 of user:password>` / **Header** — the HTTP Basic auth the stack requires from v2 on |
| **key-maint** — the Provider API Keys backend | yes | the same Basic auth as the API |

The Basic auth is mandatory on the OpenBB API by design: the stack's compose file refuses to start the API without a password file, because Tailscale Funnel *can* expose port 443 to the public internet and there must be no configuration in which the public door exists and the lock does not. See [[tailscale-networking|Tailscale Networking]].

## Reachability as the credential

Both of the stack's services sit on its private bridge and are published only by Tailscale Serve, so reaching the address at all already takes a device on your tailnet; the Basic auth is the second gate, not the only one. Only the API's port 443 may be funnelled to the public internet, and key-maint's funnel was deliberately removed. The rule behind that is general: a service that authenticates nothing must never be given a public door. See [[openbb-docker-stack|The openbb-docker Stack]] for the ports.

## Why the seeded `Local` never works

A fresh install seeds one connection, `Local` at `http://localhost:6900`. The stack's API does listen on 6900 — inside the container network, not on your host. No openbb-docker compose publishes that port, so the entry sits red until you replace the URL with the Serve address. It is a placeholder for people who run an OpenBB backend of their own on the local machine.

## Where the credentials go

Into `backends.json` in the app's data directory, in the clear. Choosing **Query Parameter** as the location puts the key in every request URL, where a proxy log can catch it; the dialog warns, and the app itself strips query strings before logging a failed request's URL. See [[app-data-and-settings|App Data and Settings]].

## Multiple backends, independent health

Each connection is tracked independently. Discovery runs at launch and on demand; a backend that fails moves to *Inactive* with a red dot, its cards show a retry state, and nothing else notices. A single dashboard can mix cards from every connection — a Platform table beside a widget from a backend of your own — because each card only ever depends on its own backend being reachable.

---
*Source: BDOBB v3.0.2 in-app manual, "Connections"; `openbb-docker` `README.md`, `api-auth.env.example`, `docker-compose.yml` and `ts-config/serve.json` at `v3.0.0`.*
*See also: [[connecting-a-backend|Connecting a Backend]] · [[openbb-docker-stack|The openbb-docker Stack]] · [[tailscale-networking|Tailscale Networking]] · [[provider-keys|Provider Keys]]*
