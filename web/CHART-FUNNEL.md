# v10 Live Chart on Vercel through Tailscale Funnel

The browser draws the existing lightweight-charts chart. Its accepted-data
WebSocket connects directly to the authenticated v10 gateway over Funnel:

```
Vercel page -> same-origin /socket-ticket (signed-in session)
            <- short-lived origin-bound chart ticket
Vercel page -> wss://gateway.<your-tailnet>.ts.net:10000/grid/chart_stream_ws?ticket=...
Funnel gateway -> live-grid /chart_stream_ws -> private named q API
```

Vercel does not host the long-lived WebSocket. Its existing preview function
authenticates the viewer and issues a short-lived ticket; the Funnel gateway
owns the socket and relays accepted snapshots/updates. Browser reconnects obtain
fresh tickets. No machine token or q credential belongs in browser JavaScript,
widget parameters, persisted dashboard data, or a `VITE_`/`NEXT_PUBLIC_` variable.

## Matched configuration

Use the matching v10 CLIENT, HOST and KDB changes, with the new gateway policy
vendored into `web/policy.mjs` through `scripts/gateway-vendor.mjs`. A renderer
cannot acquire the new ticket while its vendored route policy is still legacy.
The backend advertises `extra_metadata.chart_stream_v1: true` and
`wsEndpoint: "chart_stream_ws"` only with a qualified source. Legacy backends
continue using their existing quote socket; they are not accepted-data streams.

Set these **server-side** Vercel environment values through the existing project
settings, alongside the preview's existing GitHub OAuth configuration:

| Variable | Value |
|---|---|
| `APP_ORIGIN` | Exact canonical deployment origin, e.g. `https://chart-demo.vercel.app` |
| `BACKEND_GATEWAY_ORIGIN` | Exact Funnel HTTPS origin, e.g. `https://gateway.<your-tailnet>.ts.net:10000` |
| `BACKEND_GATEWAY_TOKEN` | Existing private machine credential matching HOST `GATEWAY_TOKEN` |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | The preview OAuth app; callback is `APP_ORIGIN/auth/callback/github` |
| `AUTH_SECRET` | Private preview session secret |
| `GITHUB_ALLOWED_USER_IDS` | Existing reviewed numeric viewer IDs; an empty list admits nobody |
| `SESSION_EPOCH` | Deployment-controlled session revision |

HOST `gateway-config/settings.json` must have its existing full configuration,
with `origin` equal to the Funnel HTTPS origin, `previewOrigin` equal to the
exact Vercel `APP_ORIGIN`, and `liveGrid: true`. Do not replace the full settings
file with this partial list. Preview domains are an exact origin match; a new
Vercel deployment hostname must be explicitly configured or reached through the
canonical alias. No wildcard `*.vercel.app` admission is added.

Keep q on `live-private` without a published port. The gateway relays through
live-grid; neither the q IPC listener nor live-grid's raw port is a Funnel
target. Operator-supplied q service credentials remain mounted only in backend
services. Use the HOST deployment instructions for the matched secured API
bootstrap and recorder source, not the stage-1 ping-only qualification server.

## Funnel setup and activation

This repository already builds a Vercel preview function using `build:web`, and
HOST already supplies `ts-config/serve-funnel.json` (or `serve-v3-funnel.json`
when using the v3 overlay). Those configurations publish the gateway on 10000.
Keep the existing topology and follow `funnel-gateway/README.md` when selecting
the active Tailscale serve configuration; preserve other Serve routes on the
same node. Do not expose q as a convenience shortcut.

Funnel must be enabled for the node, with MagicDNS and HTTPS configured. Funnel
supports TLS on ports 443, 8443 and 10000 and has bandwidth limits; the existing
10000 gateway route matches those constraints. See the current
[Tailscale Funnel documentation](https://tailscale.com/docs/features/tailscale-funnel)
and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/funnel).

Code/configuration changes do not themselves activate Funnel, deploy Vercel,
create secrets, or grant new viewers. Build the matched revisions and use the
existing deployment procedure for the intended node/project when ready.

## Demo checks

1. Open the canonical Vercel origin outside the tailnet and sign in as an allowed
   viewer. An anonymous or expired session must not receive a chart ticket.
2. Confirm the Live Chart widget advertises protocol v1. Its socket URL uses
   `wss://` on the configured Funnel origin and contains a ticket, not a Bearer
   token or q credentials. Treat that short-lived URL as a credential too.
3. Verify snapshot completion precedes cursor acknowledgments, accepted updates
   advance the chart, and a late trade replaces an older candle without adding
   its full volume twice.
4. Drop the connection and reconnect. A fresh ticket is issued; retained cursors
   resume, while expired/changed-epoch cursors explicitly resnapshot. A slow
   renderer or close 4009 must show resynchronization, not silent missing ticks.
5. A ticket used from a different page origin, a ticket replay, and an arbitrary
   `/grid/` target must be rejected. Confirm normal legacy quote widgets still
   work, with q remaining unreachable from the public internet.

Local broker, gateway, renderer and protocol tests exercise these contracts.
An actual deployed Vercel-to-Funnel browser check is separate evidence and must
be recorded with its paired revisions; do not label local sockets a deployed
demo verification.
