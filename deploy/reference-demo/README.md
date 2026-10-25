<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Reference Backend Public Demo

A fully public demo of the v3.3 BDOBB client — live over the internet,
including `live_grid` streaming — against OpenBB's keyless **reference
backend**, exposed with Tailscale Funnel.

```
  Browser (anyone)
      │  HTTPS
      ▼
  reference.bdobb.secretoftheuniverse.com     Vercel — static v3.3 browser build
      │  fetch + wss   (CORS: this origin allowed by the backend)
      ▼
  https://reference-backend.<tailnet>.ts.net  Tailscale Funnel, public :443
      │  →  http://reference-backend:5050
      ▼
  OpenBB reference backend (FastAPI + websockets), no auth
```

Funnel proxies WebSockets, so the live grid streams — the piece a Vercel
serverless backend could not do. Funnel public ports are **443 / 8443 / 10000**
only; this uses 443. It is deliberately **public and keyless** (synthetic demo
data); nothing here touches the private stack or `bdobb-funnel-gateway`. Because
it is public, the image drops the reference app's Python Chart omni widget,
which executes caller-supplied Python (see Notes).

## Layout

| Path | What it is | Who runs it |
|---|---|---|
| `reference-backend/` | Dockerfile for the reference app + `websockets`, CORS via `EXTRA_CORS_ORIGINS` (`patch-cors.py`), the Python Chart omni widget removed (`patch-omni-python.py`) and a build gate that fails if it is still served (`check-no-exec.py`) | me (build) → you (deploy) |
| `compose.yaml` | the reference backend + a Tailscale sidecar that funnels :443 to it | you (on the NAS) |
| `tailscale/funnel.json` | the `TS_SERVE_CONFIG` funnel mapping (443 → `reference-backend:5050`) | — |
| `.env.example` | `TS_AUTHKEY`, `TS_HOSTNAME`, `EXTRA_CORS_ORIGINS` | you (copy to `.env`) |
| `tailnet-policy-snippet.hujson` | `tag:reference-demo` + the funnel nodeAttr for your tailnet policy | you (admin console) |
| `vercel/vercel.json` | Vercel build config (static browser bundle) | you (project) |
| `vercel/build.mjs` | `vite build --mode browser` + seeds the backend URL and a demo dashboard | Vercel (build) |
| `vercel/demo-seed.mjs` | the demo dashboard + Reference backend seed (no user JSONs) | — |

## Deploy order (dependency-correct)

1. **Tailnet policy (you).** Merge `tailnet-policy-snippet.hujson` — add
   `tag:reference-demo` and give it the `funnel` nodeAttr. Create a reusable
   auth key tagged `tag:reference-demo`.

2. **NAS node (you).** On the NAS: `cp .env.example .env`, fill `TS_AUTHKEY`
   and `EXTRA_CORS_ORIGINS`, then `docker compose up -d --build`. The Dockerfile
   builds the reference image locally (or pull a pushed
   `ghcr.io/bdobb-dev/openbb-reference:v3`). Read the public hostname from
   `docker compose logs tailscale` — `https://<TS_HOSTNAME>.<tailnet>.ts.net`.
   Sanity-check it from anywhere: `curl https://…ts.net/widgets.json` — it
   lists `omni-widget` and `omni-sql-widget` but **not** `omni-python-widget`
   (`curl -s https://…ts.net/widgets.json | grep -c omni-python-widget` → `0`).
   If it does list it, the image was not built from this Dockerfile: take the
   node down before going further. Don't probe the route itself with a POST.

3. **Vercel (you).** New Vercel project on `release/v3.3` with **Root
   Directory = repo root** and this repo's `deploy/reference-demo/vercel/vercel.json`
   config (or set Build Command `node deploy/reference-demo/vercel/build.mjs`,
   Output `dist`). Set env `VITE_REFERENCE_BACKEND_URL` = the ts.net URL from
   step 2. Add the custom domain `reference.bdobb.secretoftheuniverse.com`;
   point its DNS (CNAME) at Vercel.

4. **Verify.** Open `reference.bdobb.secretoftheuniverse.com`: the demo
   dashboard loads, Charts/News render, **Live Grid** streams, and **Omni**
   answers a prompt.

## Notes

- **CORS** is the one change to the upstream app, and it is a build-time patch
  (`reference-backend/patch-cors.py`) that only makes the origin list
  env-driven — set `EXTRA_CORS_ORIGINS` to the Vercel origin.
- The backend URL the frontend talks to is a bare `*.ts.net` hostname; users
  only ever see `reference.bdobb…`.
- **Public, no auth: anyone with the URL can call every route the image
  serves.** What that exposes:
  - **Removed — remote code execution.** Upstream's Python Chart omni widget
    (`POST /omni-python-widget`, `get_omni_python_widget` in
    `widgets_omni_sql_python.py`) runs `exec()` on the request's `prompt`. Its
    `{"go": go}` namespace is not a sandbox, so on a public node anyone could run
    arbitrary code in the container (and reach whatever it can: the shared
    Tailscale netns, the NAS's network). `patch-omni-python.py` deletes the
    handler, its widget registration and its `apps.json` layout entry;
    `check-no-exec.py` fails the build unless the route answers 404/405, the
    widget is absent from `widgets.json` and no app module calls `exec(`. The
    local dev script (`scripts/reference-backend.sh`, on 127.0.0.1) keeps it.
  - **Kept — caller SQL.** `POST /omni-sql-widget` runs the caller's SQL against
    a fresh in-memory SQLite table of mock rows. It can't reach real data, but
    it is caller-controlled and synchronous: a runaway query (e.g. an unbounded
    recursive CTE) can pin the CPU, grow memory and stall the single worker.
    Treat it as a denial-of-service surface, not a data risk.
  - **Kept — the rest.** Synthetic/static widgets (charts, tables, news, PDFs,
    the live grid) and two fixed outbound fetches (api.llama.fi,
    api.star-history.com); none take a caller-chosen URL or path.
  A rate limit, a container memory/CPU limit, or a light token at the Tailscale
  node would cover the remaining denial-of-service surface.
