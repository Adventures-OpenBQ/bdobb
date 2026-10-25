---
type: Note
tags: [bdobb, help, integrations, tailscale, networking, serve, services, security]
---

# Tailscale Networking

Every backend in the companion stack — the OpenBB API and key-maint — is designed to run privately on a Tailscale tailnet rather than be exposed to the internet. BDOBB itself knows nothing about Tailscale; it sees `https://` base URLs and nothing else. But the pattern decides what goes in the Connections dialog and why reaching an address is already half the credential. This page covers the pattern and its sharp edges.

## The pattern: Serve is the door

A service joins your private network as a compose service behind a Tailscale sidecar: on a private Docker bridge that other Docker networks cannot reach — processes on the Docker host itself can — not published on any host port, with **Tailscale Serve** terminating TLS and fronting it at `https://<node>.<your-tailnet>.ts.net:<port>`. Only devices on your tailnet can reach it at all — reachability substitutes for a chunk of what a public service would need explicit auth for.

The `openbb` node publishes one port per service: 443 for the API and 10000 for key-maint. See [[openbb-docker-stack|The openbb-docker Stack]].

**Serve vs. Funnel.** Serve keeps a service tailnet-only. Funnel exposes it to the public internet. Only put a service behind Funnel if it authenticates on its own — which in this stack is the OpenBB API, with its mandatory Basic auth, enforced by the image on every path, metadata included — and even that is a choice, not a default. The funnel variant of the Serve config funnels exactly one address — the stack node's own name on port 443 (`${TS_CERT_DOMAIN}:443` in its `AllowFunnel`); no other port is funnelled, and none of the Tailscale Service names are. key-maint answers with the same Basic auth, but its funnel was deliberately removed and it is never funnelled. The README at this tag still describes key-maint's lowest tier as what *public* callers see; the Serve configuration gives the public no route to it, and this guide follows the configuration.

## Tailscale Services: stable names on 443

Newer than Serve's per-port publishing, a **Tailscale Service** (`svc:<name>`) gives a backend a stable HTTPS name — `https://openbb-api.<your-tailnet>.ts.net`, `https://openbb-keys.<your-tailnet>.ts.net` — that survives the service moving between nodes and needs no port in the URL. At this version the stack publishes two: `svc:openbb-api` (the API) and `svc:openbb-keys` (key-maint). A service name is what you paste into a connection. The `openbb` node's `:port` forms still work, and both are in the compose file's Serve config; the two are alternatives.

Service hostnames in `serve.json` are literal — `${TS_CERT_DOMAIN}` expands to the node's own name and cannot express a Service's — so replace `<your-tailnet>` with your real tailnet name before deploying. Service hosts must be tagged nodes, and a service that does not appear on the admin console's Services page, or whose name answers NXDOMAIN, has usually not been defined and approved there yet. Until it is, the node's own `${TS_CERT_DOMAIN}` handlers keep working.

## The sharp edges

**`serve.json` is applied wholesale.** The sidecar re-applies the file at startup and on every edit, with no merge, so anything set up with the `tailscale serve` or `tailscale advertise` CLI that is not in the file is erased at that moment. Everything goes in `serve.json`, nothing by CLI. Edits apply live with no restart, and a malformed file kills the sidecar: write to `serve.json.new`, run `jq empty` on it, then move it over.

**Kernel networking is mandatory.** Tailscale's container image defaults to userspace networking, where the daemon terminates inbound tailnet connections itself and forwards them to loopback internally. The compose file sets `TS_USERSPACE=false` (with the tun device and `NET_ADMIN`) and marks it mandatory: on this bridge arrangement the sidecar's own loopback has nothing listening, because the services live on the bridge rather than in its namespace, and kernel mode is what gives the node a real interface and lets Serve proxy to each service by name. The README calls this setting the one mistake that silently exposes everything — wording from the arrangement the bridge replaced. Either way, verify the door rather than the lock's spec sheet: from a *second* tailnet device, run `scripts/verify-isolation.sh openbb.<your-tailnet>.ts.net`, which confirms the API's raw port `:6900` is refused. At this version the script's first step, which checks that the front door answers, fetches `/widgets.json` with no credential; the API refuses it with a 401, as it should, so that step prints curl's error rather than its *OK*, and the script carries on to the raw-port check that matters.

**A certificate before an answer.** Serve's real certificate needs the tailnet's **MagicDNS** and **HTTPS certificates** switched on in the admin console; the README lists both as prerequisites.

**The bridge.** The services used to share the sidecar's network namespace and find each other on `127.0.0.1`; they now live on a private bridge and find each other by service name. A bind that defaults to `127.0.0.1` fails closed on the bridge, which is why the compose file sets `KEYMAINT_NETWORK_HOST=0.0.0.0` for key-maint, the one service whose bind lives in Python. The bridge is not `internal: true` on purpose: that would cut the API's outbound calls to its data providers.

**Tagged viewing devices.** A device you tag stops carrying a user identity in Serve's injected headers. Nothing BDOBB talks to at this version authenticates on those headers — key-maint decides a caller's tier by the tailnet address Serve forwards, not by who they are. If you build anything that does trust those headers, do not tag the devices you expect it to recognise.

---
*Source: `openbb-docker` `README.md`, `docker-compose.yml`, `ts-config/serve.json`, `ts-config/serve-funnel.json`, `docs/funnel.md`, `scripts/verify-isolation.sh` and `key-maint/app/server.py` at `v3.0.0`; Adventures in OpenBB, Ep. 1 — "Your Own Bloomberg in a Cabinet" and Ep. 2 — "The Borrowed Terminal."*
*See also: [[openbb-docker-stack|The openbb-docker Stack]] · [[backends-and-connections|Backends and Connections]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
