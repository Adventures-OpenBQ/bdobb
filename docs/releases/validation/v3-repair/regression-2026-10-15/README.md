# v3.0.0 regression, 2026-10-15 (re-cut)

The 2026-10-15 walk (user order: v3 first, then v4–v10, one version at a time; openbq-docker tested on the NAS). Re-cut on pass by the user's standing ruling (0 client FAIL among automatable cases).

## What this re-cut adds over v3.0.0 412777f

- `release/v3` 49f1034: pairing with openbq-docker v3, Demo providers on its widget ids, one combined examples file (`openbq-pairing-2026-10-14.md`).
- The Help rewrite for the openbq-docker stack (`claude/v3-help-relaunch`, merged in 0590bd6): the stack page is now `openbq-docker-stack`; the key-save message names the `openbq-api` container. Conflicts took `release/v3` for `apps-sync`, its examples test and Example Dashboards. Corrected while merging: the demo keys are EIA and Congress.gov only, and `credentials.demo.env` loads before `credentials.env` (not only when it is absent).
- Importing Dashboards names the rail's **Apps** row (it said v3 does not fetch a backend's `apps.json`).
- Help shots retaken (`pnpm help:shots`): getting-started, the-left-rail, widget-library, tables.

## Pairing under test

openbq-docker `release/v3` e12bbb0 = 1279da2 + `claude/v3-key-maint` (key-maint and `/providers.json`, ruled into v3 on 2026-10-13), built as `ghcr.io/adventures-openbq/openbq-local:3.0.0@sha256:cc45d434…` and run on the NAS (`openbq-api` pinned by digest, key-maint `openbq-key-maint:3.0.0@sha256:ba2d3d25…`, `credentials.demo.env` before `credentials.env`). Reference services: curated `openbq-reference:sha-1978c19` (72 widgets, 2 apps, 18 tabs, 74 cards), baseline `a6293707` (70 / 1 / 14 / 70).

## Results (tested commit 0590bd6; later commits are Help text and shots only, Help suite 45/45 on them)

| Check | Result |
|---|---|
| typecheck, lint, scrub, test:web, build, build:web, smoke, privacy grep, `git diff --check 412777f` | pass |
| unit | 3235 passed, 8 skipped |
| help | 45/45 |
| e2e | 100 passed |
| cargo test --lib | pass |
| web smoke (`test:web:browser`) | pass on rerun; first run hit the known `browser-smoke.mjs:105` flake at load 49 |
| reference contract, curated / baseline | 7/7 / 7/7 |
| reference acceptance, curated / baseline | 1/1 / 1/1 (baseline exits 1 at teardown from an in-flight route, the known pattern) |
| native build (`--bundles app`, disposable identifier) | pass |
| reference protocol sweeps | 70/70, 72/72 |
| reference payload + render sweeps | pass |
| browser cases: apps-walk, csv, grouping, outage, params, slowdisc, tables, v3008, gaps, misc | all pass (gaps and misc after the harness learned Save…; exports carry no credential, plain re-import 70 cards) |
| OpenBQ (NAS): nine named smoke checks | 9/9 rendered |
| OpenBQ: OBBject warnings, E05-047, fixtures | 1/1, 1/1, 9/9 |
| OpenBQ: Apps walk | 36/36 non-BLS apps; BLS 5/5 (one request in flight) |
| NAS backend verify | app layouts, provider fixes, heavy routes (242 probes, max 0.66 s), cftc-responsive, smoke.py, isolation: pass; key-maint on the host loopback: widget, key rows (tier 2), live FRED test OK |

**Native, by the user (2026-10-15 evening, packaged build whose native code equals this tag):** PASS on all six native gestures. E05-053, a real Finder drop of `practice.csv`: 3 of 12 rows (300/500/350), then Clear gives 12 of 12. E05-032, quit and relaunch: the card is restored. E05-001, apps.json export through the Save panel and import through the Open panel: 14 tabs and 70 cards, imported beside the original as "(2)". E05-033, Cancel in the expanded Save panel: creates nothing. E05-045, New Folder in the Save panel: the file is saved inside it. E05-062, a fresh profile: no settings banner.

**NOT_RUN (needs the user):** Workspace sign-in. key-maint over the tailnet (needs the `svc:openbq-keys` Tailscale Service on a tagged host). The NAS dashboard/settings sync verifies (the NAS API runs with auth off by ruling).

**Backend report (not a client gate):** V3-010, the full OpenBQ widget sweep, against openbq-docker v3.0.0 on the NAS: 1,675 renders. 1,455 rendered; 162 show the backend's own error; 58 need review, mostly empty-result notices. Every non-render is an upstream or backend answer the card presents verbatim (upstream 502/504, OECD 55 s, EIA rate limit, Yahoo/Fed refusals, required params). No client defect. One widget is not rendered, because its body crashes the Chromium renderer above the 40 MB cut.

Run folder (outside the repo): `adventures-in-openbb-articles/output/regression/v3-0590bd6-20261015T163820Z/`; NAS verify `…/backend-verify/v3.0.0-e12bbb0/`.

## Full-codebase review (user order, same day)

Five read-only reviewers covered the whole v3 tree of both repositories (bdobb: `src/lib`; components, hooks and stores; native, web, scripts and CI. openbq-docker: lanes, key-maint, Workspace, compose; provider fixes, yfinance, the reference demo). No Critical finding. Fixed before the re-cut, each with a test:

- `useChildDialog` closes its dialog on cleanup, as `useModalDialog` does (StrictMode's dev-only re-run threw `InvalidStateError` in a real browser for every child dialog).
- `feed.ts`: an Atom link with no `rel` is the alternate (RFC 4287 §4.2.7.2). `dashboardsFile.ts`: `withBindings` copies instead of pushing into the stored card's array.
- openbq-docker: key-maint sets its admin directory to 0700 itself; the Dallas Fed overlays raise a clear error on a third sheet rename instead of a 500; check-public allows the providers' public demo keys in JSON form.

Held for the user (hardening, not defects): a tighter desktop CSP (packaged-only breakage risk, needs a native check), narrowing the `http://*:*` capability, a macOS CI job for `save_panel.rs`, key-maint as non-root.

## The packaged-app CSP (user ruling: do it in v3)

`tauri.conf.json` now sets `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self' ipc: http://ipc.localhost ws: wss:`, `object-src 'none'`, `base-uri 'none'` beside `frame-ancestors 'none'`, and stops Tauri stamping a style nonce. Checked natively on a packaged build against the NAS reference: the Live Grid streams over `wss`; Plotly, TradingView, YouTube and pdf.js (base64 and URL) render; a fresh profile shows no settings banner.

## The reference backend through the Funnel door (user ruling: in v3)

Spec `docs/superpowers/specs/2026-10-15-reference-socket-through-funnel-design.md`, plan `docs/superpowers/plans/2026-10-15-reference-socket-through-funnel.md`, executed task by task with a review per task and a final whole-branch review (every finding fixed, minors included). openbq-docker v3 gains `funnel-gateway` (`ghcr.io/adventures-openbq/openbq-funnel-gateway:3.0.0@sha256:76b50f88…`); this line re-vendors its `policy.mjs`, seeds "OpenBQ Reference (preview)" at `<origin>/ref`, ports the ticketed socket shim, and streams the two catalogue documents (16 MiB cap, gzip).

Deployed on the NAS behind the recycled public Funnel door (user ruling; the openbb-docker preview gateway it served is stopped), API left open by ruling. Live, through the public ingress: anonymous 401; `/ref/widgets.json`, a data route, `live_grid_data` and the logo 200; Omni and `//` 404; `/api/widgets.json` 200 (5,045,104 bytes); a ticketed `wss` upgrade minted on a clock 3 s ahead → 101 and live rows; replay 401; wrong Origin 403. The scratch `previewOrigin` used for that test is removed again: ticketed sockets stay refused until a Vercel project exists (open item: the deployed-Vercel run).

Final gate on this head: typecheck, lint, scrub, notices, test:web 34, unit 3246 / 8 skipped, help 45, build:web + web smoke, build, smoke, e2e 100, cargo 16 — all pass.
