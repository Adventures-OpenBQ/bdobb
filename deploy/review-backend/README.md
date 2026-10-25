<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The App Review backend

BDOBB is a client for self-hosted OpenBB stacks, so an Apple reviewer has
nothing to connect to. This publishes **OpenBB's own reference backend** — the
public one, from `bdobb-dev/backends-for-openbb` (a fork of the archived
`OpenBB-finance/backends-for-openbb`), pinned to the same commit
`scripts/reference-backend.sh` and the CI `reference` job pin — to one HTTPS
URL behind one credential.

**It exposes nothing of yours.** ~82 widget endpoints of synthetic sample
data. No `credentials.env`, no provider key, no MinIO, no kdb, no volumes but
the node's own identity. It is a separate compose project on its own bridge,
and it does not talk to openbb-docker, the NAS, or the Spark.

## The isolation is structural, not a policy you maintain

**Put this node on its own throwaway Tailscale account.** A second free
account gets its own tailnet with one machine in it. That node has no peers,
so there is nothing on the tailnet for a compromise to reach — no ACL to write
and keep correct, and the public hostname (`tailXXXXX.ts.net`) carries no hint
of your real tailnet.

Putting it on your existing tailnet works too, but then the isolation is an
ACL that has to stay right for as long as the URL is up. Don't.

**A different tailnet is not a different network.** The auth key alone decides
which tailnet a container joins — your NAS can be on one tailnet and this node
on another, on the same host, with neither able to name the other. But the
containers still sit on a Docker bridge, which by default routes to this
host's LAN, so a compromise of the published app could reach the NAS by IP
regardless of tailnets. `review-internal` is therefore `internal: true`: Caddy
and the reference backend have no default route at all — no internet, no LAN.
Only the tailscale sidecar is dual-homed, because tailscaled has to reach the
coordination server.

## Setup

1. **New Tailscale account**, then Settings → Keys → generate an auth key.

   ```bash
   cp ts.env.example ts.env && chmod 600 ts.env    # paste the key
   ```

2. **Allow Funnel on the new tailnet.** It is off until granted. Admin console
   → Access controls:

   ```jsonc
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```

3. **The credential.**

   ```bash
   docker run --rm caddy:2-alpine caddy hash-password --plaintext '<password>'
   cp auth.env.example auth.env && chmod 600 auth.env
   ```

   Paste the hash **inside single quotes** — see the note in the file; an
   unquoted bcrypt hash is silently mangled by compose's `$` interpolation and
   the right password then 401s.

4. **Start it.**

   ```bash
   docker compose up -d --build
   ```

5. **Disable key expiry** for the new machine in the admin console. Review can
   take days; the default 180-day expiry is not the risk — an expired *auth
   key* on a container recreate is, and a node whose key expires goes dark with
   the reviewer holding the URL.

## Before the tailnet: a local smoke test

The lock and the corpus can be exercised with no Tailscale account at all:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d caddy
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7780/widgets.json                    # 401
curl -s -o /dev/null -w '%{http_code}\n' -u reviewer:<password> http://127.0.0.1:7780/widgets.json  # 200
```

The override publishes Caddy on loopback only. It also has to attach Caddy to
`review-edge`, because a container on an `internal: true` network alone cannot
have a published port — docker accepts the `ports:` block and silently maps
nothing, which reads as a dead URL rather than a misconfiguration. The
reference backend stays internal-only either way.

Never pass that file to the real `up`.

## Verify — from a device that is NOT on that tailnet

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://bdobb-demo.<tailnet>.ts.net/widgets.json
# -> 401

curl -s -o /dev/null -w '%{http_code}\n' -u reviewer:<password> https://bdobb-demo.<tailnet>.ts.net/widgets.json
# -> 200
```

Unlike openbb-docker's API — where auth is a FastAPI dependency on `/api/v1`
and `/widgets.json` answers anyone — the lock here is Caddy, in front of
everything. There is no unauthenticated path.

## The review build

A fresh install seeds one backend. `makeDefaultBackend()` takes the build's
seed when the build supplies one, so the reviewer opens the app to a populated
dashboard instead of a Connections dialog:

```bash
VITE_DEFAULT_BACKEND_URL=https://bdobb-demo.<tailnet>.ts.net \
VITE_DEFAULT_BACKEND_AUTH="Basic $(printf 'reviewer:<password>' | base64)" \
pnpm tauri build
```

Both are absent from every other build, which keeps the `http://localhost:6900`
default. Funnel serves a real Let's Encrypt certificate, so App Transport
Security is satisfied with no exception in `Info.plist`.

Put the URL and `reviewer` / `<password>` in the App Review notes anyway — a
reviewer who deletes the seeded backend needs a way back.

## What this does not cover

**The chat pane has no agent.** The reference backend serves data, not an
agent — nothing here answers `agents.json` or the SSE protocol (v5.0.0's spec
says so explicitly, and it is still true). A reviewer exercising Rita needs a
separate sandboxed agent; this stack is the data half only.

## Teardown

```bash
docker compose down -v
```

Then delete the machine in the admin console. The URL dies with the node.
