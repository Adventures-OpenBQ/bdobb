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

**NOT_RUN (needs the user):** native gestures (fresh-profile load, Apps import and Save-panel export, expanded Save panel + New Folder, restart): computer use was declined. Workspace sign-in. key-maint over the tailnet (needs the `svc:openbq-keys` Tailscale Service on a tagged host). The NAS dashboard/settings sync verifies (the NAS API runs with auth off by ruling).

**Backend report (not a client gate):** V3-010, the full OpenBQ widget sweep, runs after this receipt; its result is recorded in the run folder.

Run folder (outside the repo): `adventures-in-openbb-articles/output/regression/v3-0590bd6-20261015T163820Z/`; NAS verify `…/backend-verify/v3.0.0-e12bbb0/`.
