<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The reference backend through the Funnel door, live grid included

Date: 2026-10-15
Status: approved in brainstorming (sections 1–3); written spec awaiting review
Home line: v3 (BDOBB and openbq-docker), carried v4 → v10 by the SSRM walk

## Why

The reference backend's Live Grid card streams over a WebSocket (`live_grid_ws`). The desktop app
reaches it directly over the tailnet, but the web preview cannot: openbq-docker v3 has no gateway,
and BDOBB v3's web layer refuses every socket. The user ruled (2026-10-15) that the reference's
socket must work through the Funnel door to the Vercel preview from v3, and that the whole
reference backend is offered there, not only the Live Grid card.

**Success:** a ticketed WebSocket opened by the preview page reaches the reference's
`live_grid_ws` through the public Funnel door and the card ticks; the desktop app is unchanged.

## Decisions

- **Approach A.** A gateway in openbq-docker v3 carries a `/ref` family and one socket. The browser
  opens that socket on the door with a thirty-second ticket from the web layer — the design v8 and
  v10 already use. Rejected: relaying through the Vercel Function (bills function time while open,
  beta WebSockets, 240 s cap) and funnelling `:8443` directly (an unauthenticated backend on the
  Internet, no GitHub gate).
- **Base.** The SSRM walk's v4 gateway (openbq-docker `claude/walk-ssrm-v4` ca9ba1b, itself
  brought down from v8) minus PR #10's table routes, table service and `control-admission.test.mjs`;
  plus v8's socket door (ticketed upgrades, `previewOrigin`, `maxSockets`, the `ws` dependency, the
  240 s socket lifetime). The walk's v4 then takes this by merge from v3.
- **Scope.** Every GET the reference serves; POSTs (multi-file PDFs, forms, Omni) stay refused, as
  the web preview already documents.

## openbq-docker v3: the gateway

- **Routes.** `/_gateway/health`; `/api/widgets.json`, `/api/apps.json`, `/api/api/v1/**` and
  `/state/**` as at the walk's v4. New:
  - `GET /ref/widgets.json`, `GET /ref/apps.json`, no query;
  - `GET /ref/<path>` under the `/api` side's structural bounds (lowercase segments, no dot, no
    `%`, query pairs/lengths/characters bounded, query re-serialised), refusing `/ref/omni*`;
  - socket `/ref/live_grid_ws`: admitted with the Bearer token, or with a ticket whose upgrade
    carries `Origin: previewOrigin`. Each client frame is revalidated: only
    `{"params":{"symbol":"<symbol>"}}` is relayed; anything else closes the socket. Upstream
    `ws://openbq-reference:17783/live_grid_ws`.
- **Policy.** `upstreamPath` gains the `/ref` family; `socketTarget` admits exactly
  `/ref/live_grid_ws`; a `refSubscription` validator holds the frame rule. BDOBB vendors this file.
- **Compose.** A `funnel-gateway` service in the `web` profile, image
  `ghcr.io/adventures-openbq/openbq-funnel-gateway:3.0.0`, its state volume, `gateway.env.example`,
  and `ts-config/serve-v3-funnel.json` (Serve 443 and 8443 as now, the door on 10000 with
  `AllowFunnel`).
- **Errors** (the gateway's existing answers): no token or bad ticket 401; wrong Origin 403;
  unknown path, POST or Omni 404; reference down 502; budget spent 429; a bad frame closes the
  socket; a socket lives at most 240 s and each reconnect needs a new ticket.

## BDOBB v3: the web layer

- **Policy.** `web/policy.mjs` re-vendored from openbq-docker v3's gateway (`pnpm gateway:vendor`);
  `package.json` pins that commit; `web/security.test.mjs` pins the new hash.
- **Seed.** `web/bootstrap.mjs` adds a second backend, "OpenBQ Reference (preview)", at
  `<origin>/ref`, only when the gateway is configured.
- **Socket shim.** `src/browser-shim/socket.ts` from v8, unchanged but for its comment (at v3 the
  one target is `/ref/live_grid_ws`), wired as v8 wires it and inert unless the bootstrap sets
  `window.__bdobbSocketTickets`. The desktop app, browser mode, e2e and help shots keep the native
  WebSocket.
- **Unchanged.** `connect-src` already gains `wss://<door>` (`web/server.mjs`); the server's upgrade
  handler keeps refusing every socket.
- **Docs.** `web/README.md` names the `/ref` family and the socket; the Help's web-preview page gets
  the matching sentence.

## Deployment (NAS)

The gateway image is built for amd64 and arm64 and pushed to GHCR, then pinned by digest in the NAS
compose. `settings.json` sets `origin` to the door; `previewOrigin` stays unset (ticketed upgrades
refused) until a Vercel project exists. The machine token lives in `gateway.env` (mode 0600), never
echoed. Serve adds `:10000` with `AllowFunnel`; if the tailnet policy lacks the node's funnel
attribute, that is the user's admin-console step and work stops to ask.

## Verification

1. Gateway: the walk's v4 tests minus tables, plus `/ref` route and socket cases (ticket accepted,
   wrong Origin 403, expired or replayed ticket 401, bad frame closes), on Node 22.
2. BDOBB: `pnpm test:web`, the shim tests, the full v3 gates.
3. Live, from the Mac through the public Funnel ingress (the public IP pinned so MagicDNS is
   skipped): anonymous 401; with the token `/ref/widgets.json` 200, a `/ref` data route 200,
   `/ref/omni-sql-widget` 404; a ticketed socket with the right Origin streams rows, a replayed
   ticket 401, a wrong Origin 403. `previewOrigin` is set to a scratch origin for this test only.
4. Open item, the user's: the deployed-Vercel run (GitHub sign-in, the card ticking in a browser),
   once a Vercel project and OAuth app are approved.

## Out of scope

POST routes through the door; a Vercel project, OAuth app or DNS; any other socket family (news
stays v8, the grid v10).
