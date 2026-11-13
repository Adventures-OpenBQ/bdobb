---
type: Note
tags: [bdobb, help, integrations, tailscale, networking, serve, services, security]
---

# Tailscale Networking

Every backend in the companion stack runs privately on a Tailscale tailnet rather than being exposed to the internet. BDOBB itself knows nothing about Tailscale; it sees `https://` base URLs and nothing else. But the pattern decides what goes in the Connections dialog and why reaching an address is already half the credential. This page covers the pattern and its sharp edges.

## The pattern: Serve is the door

Each service sits on the stack's private Docker bridge, `openbq-internal`, publishes no host port, and is fronted by the **Tailscale sidecar**, whose **Tailscale Serve** terminates TLS at `https://openbq.<your-tailnet>.ts.net[:port]`. Only devices on your tailnet can reach it at all. Processes on the Docker host itself can reach the bridge, so this is not isolation from the host's administrators.

The `openbq` node publishes the API on 443 with the base compose (`ts-config/serve.json`), and adds the reference backend on 8443 with the Episode 3 overlay (`ts-config/serve-v3.json`). See [[openbq-docker-stack|The openbq-docker Stack]].

**Funnel.** Funnel exposes a port to the public internet. The default Serve configurations set `AllowFunnel` to `false` for every port they serve, and no BDOBB connection is ever funnelled. The one exception is opt-in and separate: the `web` profile's funnel gateway, behind the [[web-preview|Web Preview]], is funnelled on port 10000 once you swap the sidecar to `serve-funnel.json` (or `serve-v3-funnel.json` with the overlay). It demands its own token on every request and refuses an API whose auth is off; 443 and 8443 stay tailnet-only even then.

## key-maint: a Tailscale Service, or the host's loopback

key-maint is the one service with a host port, and it is loopback-only: `127.0.0.1:8447` on the Docker host. To reach it from another tailnet device, it uses a **Tailscale Service**, `svc:openbq-keys`, which gives it the stable name `https://openbq-keys.<your-tailnet>.ts.net` with no port in the URL. The API itself has no `svc:` name; you reach it by the node's own name.

The Service has to be created in your tailnet's admin console and this node approved as its host; service hosts must be tagged nodes. Then replace `<your-tailnet>` in `ts-config/serve-v3-keys.json` (Service hostnames are literal; `${TS_CERT_DOMAIN}` expands only to the node's own name) and point the sidecar's `TS_SERVE_CONFIG` at that file. It is `serve-v3.json` plus the Service, tailnet-only and never funnelled. Until the Service exists, keep `serve-v3.json`; a Service name that answers NXDOMAIN, or that is missing from the admin console's Services page, has usually not been defined and approved there yet.

## The sharp edges

**`TS_SERVE_CONFIG` is applied wholesale.** The sidecar applies the file at startup and on every edit, with no merge, so anything set up with the `tailscale serve` CLI that is not in the file is erased at that moment. Put everything in the file, nothing by CLI. A malformed file kills the sidecar: check it with `jq empty` before it replaces the live one.

**Kernel networking.** The compose file sets `TS_USERSPACE=false`, with the tun device and `NET_ADMIN`. The services live on the bridge rather than in the sidecar's namespace, and kernel mode is what lets Serve proxy to each one by service name. Verify the door from a *second* tailnet device, never the Docker host: `scripts/verify-isolation.sh openbq.<your-tailnet>.ts.net` fetches `/widgets.json` over HTTPS and then confirms the API's raw port `:6900` is refused.

**A certificate before an answer.** Serve's certificate needs the tailnet's **MagicDNS** and **HTTPS certificates** switched on in the admin console.

**The bridge.** Services find each other by service name on the bridge, so a bind that defaults to `127.0.0.1` fails closed there; that is why the overlay sets `KEYMAINT_NETWORK_HOST=0.0.0.0` for key-maint. The bridge is not `internal: true` on purpose: that would cut the API's outbound calls to its data providers.

**First start is slow.** The API's first route discovery can take a couple of minutes, and Serve can answer 502 until it is ready.

---
*Source: `openbq-docker` `README.md`, `VERIFICATION.md`, `docker-compose.yml`, `docker-compose.v3.yml`, `ts-config/` (`serve.json`, `serve-v3.json`, `serve-v3-keys.json`, `serve-funnel.json`, `serve-v3-funnel.json`), `funnel-gateway/README.md`, `scripts/verify-isolation.sh` and `key-maint/README.md` at `v3.0.0`; Adventures in OpenBQ, Eps. 1–3.*
*See also: [[openbq-docker-stack|The openbq-docker Stack]] · [[backends-and-connections|Backends and Connections]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
