---
type: Note
tags: [bdobb, help, integrations, tailscale, networking, serve, services, security]
---

# Tailscale Networking

Every backend in the companion stack runs privately on a Tailscale tailnet rather than being exposed to the internet. BDOBB itself knows nothing about Tailscale; it sees `https://` base URLs and nothing else. But the pattern decides what goes in the Connections dialog and why reaching an address is already half the credential. This page covers the pattern and its sharp edges.

## The pattern: Serve is the door

Each service sits on the stack's private Docker bridge, `openbq-internal`, publishes no host port, and is fronted by the **Tailscale sidecar**, whose **Tailscale Serve** terminates TLS at `https://openbq.<your-tailnet>.ts.net[:port]`. Only devices on your tailnet can reach it at all. Processes on the Docker host itself can reach the bridge, so this is not isolation from the host's administrators.

The `openbq` node publishes the API on 443 with the base compose (`ts-config/serve.json`, which from v8 also publishes rss-ticker on 8088 and answers 502 there until rss-ticker runs), and adds the reference backend on 8443 with the Episode 3 overlay (`ts-config/serve-v3.json`, which also publishes rss-ticker on 8088, as does its key-maint twin `serve-v3-keys.json`), and Rita on 10443 and the MCP server on 11443 with the Episode 6 overlay (`ts-config/serve-v6.json`, which also publishes rss-ticker on 8088, as does `serve-v6-keys.json`, openbq-docker `v10.0.0`). With the opt-in `ts-config/serve-v6-services.json`, the node also hosts the Tailscale Services `svc:openbq-rita` and `svc:openbq-mcp` (`https://openbq-rita.<your-tailnet>.ts.net`, `https://openbq-mcp.<your-tailnet>.ts.net/mcp`) beside `svc:openbq-keys`, proxied to the same places as 10443 and 11443, which stay served (the file is `serve-v6-keys.json` plus those two Services, so everything else it serves, rss-ticker's 8088 included, is unchanged); create the three Services in your tailnet's admin console before switching to it. Neither Rita nor the MCP server asks BDOBB for a credential; reachability on the tailnet is their access control. Because the MCP server spends the stack's provider keys and Rita also answers plain HTTP on the node's port 7777, restrict 10443, 11443 and 7777 with a tailnet ACL; see [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] and [[openbq-docker-stack|The openbq-docker Stack]]. With the v8 `web` profile, the node also funnels the funnel-gateway on port 10000, the stack's only public door, for the web preview: `ts-config/serve-funnel.json` adds it to the base configuration and `ts-config/serve-v3-funnel.json` to the Episode 3 overlay's, so the reference backend and the door run on one node. Port 443 stays tailnet-only. See [[web-preview|Web Preview]].


**Funnel is off by default.** Funnel would expose a port to the public internet. The tailnet-only Serve configurations, `ts-config/serve.json` and the Episode 3 overlay's `serve-v3.json`, have no `AllowFunnel` entry, so they funnel nothing. The one exception is the v8 `web` profile's pair, `serve-funnel.json` and `serve-v3-funnel.json`, which funnel the funnel-gateway's port 10000 and nothing else.

## key-maint: a Tailscale Service, or the host's loopback

key-maint is the one service with a host port, and it is loopback-only: `127.0.0.1:8447` on the Docker host. To reach it from another tailnet device, it uses a **Tailscale Service**, `svc:openbq-keys`, which gives it the stable name `https://openbq-keys.<your-tailnet>.ts.net` with no port in the URL. The API itself has no `svc:` name; you reach it by the node's own name.

The Service has to be created in your tailnet's admin console and this node approved as its host; service hosts must be tagged nodes. Then replace `<your-tailnet>` in `ts-config/serve-v3-keys.json` (Service hostnames are literal; `${TS_CERT_DOMAIN}` expands only to the node's own name) and point the sidecar's `TS_SERVE_CONFIG` at that file. It is `serve-v3.json` plus the Service, tailnet-only and never funnelled. With the Episode 6 overlay, use `ts-config/serve-v6-keys.json` instead: `serve-v6.json` plus the same Service. Until the Service exists, keep `serve-v3.json` (or `serve-v6.json`); a Service name that answers NXDOMAIN, or that is missing from the admin console's Services page, has usually not been defined and approved there yet.

## The sharp edges

**`TS_SERVE_CONFIG` is applied wholesale.** The sidecar applies the file at startup and on every edit, with no merge, so anything set up with the `tailscale serve` CLI that is not in the file is erased at that moment. Put everything in the file, nothing by CLI. A malformed file kills the sidecar: check it with `jq empty` before it replaces the live one.

**Kernel networking.** The compose file sets `TS_USERSPACE=false`, with the tun device and `NET_ADMIN`. The services live on the bridge rather than in the sidecar's namespace, and kernel mode is what lets Serve proxy to each one by service name. Verify the door from a *second* tailnet device, never the Docker host: `scripts/verify-isolation.sh openbq.<your-tailnet>.ts.net` fetches `/widgets.json` over HTTPS and then confirms the API's raw port `:6900` is refused.

**A certificate before an answer.** Serve's certificate needs the tailnet's **MagicDNS** and **HTTPS certificates** switched on in the admin console.

**First start is slow.** The API's first route discovery can take a couple of minutes, and Serve can answer 502 until it is ready.

---
*Source: `openbq-docker` `README.md`, `VERIFICATION.md`, `docker-compose.yml`, `docker-compose.v3.yml`, `ts-config/serve.json`, `ts-config/serve-v3.json` and `scripts/verify-isolation.sh` at `v7.0.0`; `ts-config/serve.json`, `ts-config/serve-funnel.json`, `ts-config/serve-v3.json`, `ts-config/serve-v3-funnel.json` and `funnel-gateway/README.md` at `v8.0.0`; `key-maint/README.md`, `docker-compose.v3.yml` and `ts-config/serve-v3-keys.json` at `v7.0.0`; `README.md`, `ts-config/serve-v6.json` and `ts-config/serve-v6-keys.json` at `v10.0.0`; Adventures in OpenBQ, Eps. 1–3.*
*See also: [[openbq-docker-stack|The openbq-docker Stack]] · [[backends-and-connections|Backends and Connections]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
