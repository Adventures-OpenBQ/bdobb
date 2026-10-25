---
type: Note
tags: [bdobb, help, troubleshooting, infrastructure, openbq-docker, tailscale]
---

# Troubleshooting: Configuring the Infrastructure

Symptom-first index of issues in the services BDOBB connects to — the openbq-docker stack and Tailscale. These are all fixed server-side, not inside the app. For app-side symptoms, see [[troubleshooting-using-bdobb|Using BDOBB]].

## The API and the stack

**Every connection to the stack is red, and `curl` gets nothing.**
Check you are on the tailnet at all, and that the tailnet has **MagicDNS** and **HTTPS certificates** enabled in the admin console; Serve's certificate depends on them. Right after the first start, the API's route discovery can take a couple of minutes, and Serve answers 502 until it is ready.

**The connection is green but every card answers 401.**
The stack's `credentials.env` sets `OPENBB_API_AUTH=true`, so every data route needs HTTP Basic auth, while `/widgets.json` and `/apps.json` stay open. The connection needs Key `Authorization`, Value `Basic <base64 of user:password>`, Location Header — the base64 of the *pair* `OPENBB_API_USERNAME:OPENBB_API_PASSWORD`, colon included; re-derive it if the password was changed. See [[backends-and-connections|Backends and Connections]].

**The connection card reads *Settings API: no*, and User Settings lists the API as *No settings API*.**
The settings, dashboard and app sync routes answer only when `OPENBB_API_AUTH=true`; with auth off, the API has no settings API. See [[openbq-docker-stack|The openbq-docker Stack]].

**There is no Provider API Keys tab.**
key-maint is not running or not connected. It is part of the Episode 3 overlay and needs its own connection; see [[provider-keys|Provider Keys]].

**A new key saved from Provider API Keys has no effect.**
The running API container cannot see it — its environment is fixed when the process starts. Restart `openbq-api`; the panel says so on save.

**A provider key mysteriously equals a comment.**
Compose's dotenv parser takes an inline `# comment` after an empty value as the value. In `credentials.env`, keep comments on their own lines, always.

**Every date expression shows `⚠` *Fallback calendar*, or every fiscal control falls back to December.**
openbq-docker's API serves `api/v1/calendar/trading` and `api/v1/fundamentals/fiscal_year_end`; on a card whose backend does not, the app uses its bundled NYSE calendar and December. A single symbol falling back to December is expected when Yahoo Finance reports no fiscal year end for it. See [[card-parameters|Card Parameters]].

**A CFTC or FINRA bonds card answers 503 or 504.**
openbq-docker runs `/api/v1/cftc/*` and FINRA bonds in a separate "heavy" lane, one request at a time, so their large responses cannot stall the rest of the API. A full queue, or a lane still starting, answers 503 with `Retry-After`; a request still running after 165 s answers 504 and the lane restarts; a result over 256 MB answers 413. Retry the card once the lane is free.

## Tailscale

**`scripts/verify-isolation.sh` fails with *raw API TCP port 6900 is reachable*.**
The API's raw port answered a second tailnet device without going through Serve. Check `TS_USERSPACE=false` on the sidecar and that no host port is published for `openbq-api`. See [[tailscale-networking|Tailscale Networking]].

**`https://openbq-keys.<your-tailnet>.ts.net` answers NXDOMAIN, or does not appear on the admin console.**
The Tailscale Service `svc:openbq-keys` has to be created in the admin console with this node approved as its host, the host must be a tagged node, and `<your-tailnet>` in `ts-config/serve-v3-keys.json` must be replaced with your tailnet's name. Meanwhile key-maint still answers on `http://127.0.0.1:8447` on the Docker host.

**Something configured with the `tailscale serve` CLI disappeared.**
The Serve configuration file is applied wholesale, at startup and on every edit, with no merge. Put everything in the file the sidecar's `TS_SERVE_CONFIG` names, nothing by CLI.

**The sidecar died after an edit to the Serve configuration.**
A malformed file kills the sidecar. Check the new file with `jq empty` before it replaces the live one.

## Rita and MCP

**An MCP server that answers `curl` shows *Unreachable* in Check.**
Check the path exactly: the OpenBQ server answers on `/mcp`. BDOBB follows the redirect that the trailing-slash form gets and strips a trailing slash when it compares servers, but a different path is a different server. If you test by hand, the `Accept` header must list both `application/json` and `text/event-stream`, or the server answers 406. Then rule out a token (*Token required*) and a tailnet that cannot resolve the name.

**Chat errors on every request the moment an MCP server is enabled.**
Almost always the tool catalogue overwhelming the model's context window. The OpenBQ MCP is started with `--default-categories equity --tool-discovery`, which exposes about ten lookup tools instead of hundreds; run it that way. BDOBB itself offers a server's tools only within a budget of 128,000 characters and leaves out a server that would exceed it, with a named warning in the status trail, but a model with a smaller context slot than that budget can still refuse the request outright. Untick the large tools you do not use under the server's **Tools**; an unticked tool stops counting. See [[rita-ai-agent-setup|Setting Up the Rita AI Agent]].

**A long answer dies at 45 seconds behind a proxy: keepalive comments never arrive.**
BDOBB abandons a Rita request after 45 seconds without a single byte, and Rita sends SSE keepalive comments during a long think to prove the connection is alive; each one re-arms the timer. If something between BDOBB and Rita buffers the response or strips comment lines, a perfectly healthy long think looks like silence, and the turn fails with *timed out after 45000ms waiting on* the query URL. Serve the stream unbuffered: no response buffering and no idle timeout shorter than 45 seconds on any reverse proxy or ingress in the path.

**Rita went offline after the Tailscale sidecar was recreated.**
On openbq-docker, `openbq-rita` runs in the sidecar's network namespace, so recreating `tailscale` leaves Rita in the old, dead one. Recreate it too: `docker compose -f docker-compose.yml -f docker-compose.v3.yml -f docker-compose.v6.yml up -d --force-recreate openbq-rita`.

**Rita is online but the answer never starts.**
`agents.json` answering proves the agent is up, not the model behind it. Fetch `<rita-url>/agents.json` first; if that works, the model service Rita talks to is the suspect (a cold model can take longer than 45 seconds to produce a first byte).

**One misconfigured tool server hangs a turn.**
A server that accepts a connection and never replies is worse than a dead one. Every MCP call carries a ten-second timeout, and the server is reported as failed after it, so a turn is never held for long. **Stop** cancels a call in flight without waiting for that deadline. If a turn still hangs past that, the timeout is not reaching the call; look for a proxy holding the connection open.

**`install_skill` is refused as turned off.**
By design. The OpenBQ MCP neutralises its `install_skill` tool on the server, and BDOBB's seeded server entry also switches it off on the client so the call is refused before anything is sent. An agent that could write skills to the server could persist instructions a later session reads as trusted.

**A table tool answers *server-execution-pending*.**
Not an infrastructure fault. The card is a standard LIVE table, whose paging runs on the server, so Rita cannot inspect or arrange it; she can still read it with `describe_widget` and `get_widget_data`. See [[troubleshooting-using-bdobb|Using BDOBB]].

---
*Source: `openbq-docker` `README.md`, `VERIFICATION.md`, `credentials.env.example`, `docker-compose.yml`, `docker-compose.v3.yml`, `ts-config/serve.json`, `v3/openbq_settings.py`, `v4/routes/` and `scripts/verify-isolation.sh` at `v7.0.0`; `key-maint/README.md` at `v7.0.0`; `README.md` and `docker-compose.v6.yml` at `v10.0.0`; BDOBB v3.0.1 in-app manual, "Provider keys"; Adventures in OpenBQ, Eps. 1–3.*
*See also: [[openbq-docker-stack|The openbq-docker Stack]] · [[tailscale-networking|Tailscale Networking]]*
