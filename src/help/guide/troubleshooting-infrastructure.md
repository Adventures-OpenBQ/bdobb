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
The settings, dashboard and app sync routes come with the Episode 3 overlay (`docker-compose.v3.yml`) and answer only when `OPENBB_API_AUTH=true`. On the base compose alone, or with auth off, the API has no settings API. See [[openbq-docker-stack|The openbq-docker Stack]].

**There is no Provider API Keys tab.**
key-maint is not running or not connected. It is part of the Episode 3 overlay and needs its own connection; see [[provider-keys|Provider Keys]].

**A new key saved from Provider API Keys has no effect.**
The running API container cannot see it — its environment is fixed when the process starts. Restart `openbq-api`; the panel says so on save (its message names the container `openbb-api`, the original stack's name for it).

**A provider key mysteriously equals a comment.**
Compose's dotenv parser takes an inline `# comment` after an empty value as the value. In `credentials.env`, keep comments on their own lines, always.

**An EIA or Congress.gov card stops answering after a while.**
With no key of your own, those providers use the public demo key in `credentials.demo.env`, which allows 30 requests an hour and 50 a day per address. Put your own key in `credentials.env` and recreate the API.

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

---
*Source: `openbq-docker` `README.md`, `VERIFICATION.md`, `credentials.demo.env`, `credentials.env.example`, `docker-compose.yml`, `docker-compose.v3.yml`, `ts-config/`, `v3/openbq_settings.py`, `scripts/verify-isolation.sh` and `key-maint/README.md` at `v3.0.0`; BDOBB v3.0.1 in-app manual, "Provider keys"; Adventures in OpenBQ, Eps. 1–3.*
*See also: [[openbq-docker-stack|The openbq-docker Stack]] · [[tailscale-networking|Tailscale Networking]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
