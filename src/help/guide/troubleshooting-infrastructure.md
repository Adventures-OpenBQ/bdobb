---
type: Note
tags: [bdobb, help, troubleshooting, infrastructure, openbb-docker, tailscale]
---

# Troubleshooting: Configuring the Infrastructure

Symptom-first index of issues in the services BDOBB connects to — the openbb-docker stack and Tailscale. These are all fixed server-side, not inside the app. For app-side symptoms, see [[troubleshooting-using-bdobb|Using BDOBB]].

## The OpenBB API and the stack

**Every connection to the stack is red, and `curl` gets nothing.**
Check you are on the tailnet at all, and that the tailnet has **MagicDNS** and **HTTPS certificates** enabled in the admin console — the README lists both as prerequisites, and Serve's real certificate depends on them.

**The API answers 401 to everything.**
The stack requires HTTP Basic auth on the API and refuses to start without `api-auth.env`. The connection needs Key `Authorization`, Value `Basic <base64 of user:password>`, Location Header — the base64 of the *pair*, colon included; re-derive it if the password was rotated. The lock covers every path, `/widgets.json` included — the image patches OpenBB's `rest_api.py` to enforce it as middleware — so without the credential discovery fails as well as every card. The README and the compose file agree. `docs/funnel.md` at this version contradicts itself: its prose says `/widgets.json` answers 200 without credentials, and the example beneath it says 401. The code says 401. See [[backends-and-connections|Backends and Connections]].

**A new key saved from Provider API Keys has no effect.**
The running `openbb-api` container cannot see it — its environment is fixed when the process starts. Restart it; the panel says so on save.

**A provider key mysteriously equals a comment.**
Compose's dotenv parser takes an inline `# comment` after an empty value as the value. In `credentials.env`, keep comments on their own lines, always.

## Tailscale

**`scripts/verify-isolation.sh` fails with *:6900 answered directly*.**
The API's raw port answered a second tailnet device without going through Serve. The script's own hint is the fix: check `TS_USERSPACE=false` on the sidecar and the service bindings. See [[tailscale-networking|Tailscale Networking]].

**`scripts/verify-isolation.sh` prints a curl 401 error at step 1.**
Expected at this version. Step 1 fetches `/widgets.json` with no credential, and the API rightly refuses it, so the step prints curl's error instead of its *OK* and the script carries on to step 2 — the check that matters.

**A Tailscale Service name answers NXDOMAIN, or does not appear on the admin console.**
The host must be a tagged node, and the service must be defined and approved in the admin console. The `${TS_CERT_DOMAIN}` handlers — the `openbb` node's own name and ports — keep working meanwhile.

**The Service names went dark after a `tailscale serve` command.**
`serve.json` is applied wholesale, at startup and on every edit, with no merge: anything configured with the `tailscale serve` or `tailscale advertise` CLI that is not in the file is erased at the next apply. Put everything in `serve.json`, nothing by CLI.

**The sidecar died after an edit to `serve.json`.**
Edits apply live, with no restart, and a malformed file kills the sidecar. Write to `serve.json.new`, run `jq empty` on it, then move it over `serve.json`.

---
*Source: `openbb-docker` `README.md`, `docker-compose.yml`, `ts-config/serve.json`, `docs/funnel.md` and `scripts/verify-isolation.sh` at `v3.0.0`; BDOBB v3.0.1 in-app manual, "Provider keys"; Adventures in OpenBB, Eps. 1–3.*
*See also: [[openbb-docker-stack|The openbb-docker Stack]] · [[tailscale-networking|Tailscale Networking]]*
