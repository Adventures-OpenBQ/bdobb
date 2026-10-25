<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# v10 handoff (context reset before Episode 10)

Written 2026-10-12 by the overnight orchestrator after the local v9 FREEZE. Local only. Nothing has been pushed, tagged or published.

## Branches and SHAs

| Repo | Path | Branch | SHA | State |
|---|---|---|---|---|
| bdobb (clean client) | ~/bdobb | claude/clean-v9 | 62d1aae | v9.0.0 FREEZE (local), cloud gate green |
| bdobb (clean client) | ~/bdobb | claude/clean-v10 | from 62d1aae | Episode 10 work goes here |
| bdobb (clean client) | ~/bdobb | claude/bdobb-v8-worktree-g5rhar | de951a1d | v8.0.0 FREEZE (untouched) |
| openbq-docker (clean server) | ~/openbq-docker | claude/openbq-docker-v9 | 69c907e | openbb-eodhd port + v9 examples sync (local) |
| openbq-docker | ~/openbq-docker | claude/openbq-docker-v10 | create from 69c907e | Episode 10 server work |
| bdobb-v2 (client donor, read only) | ~/bdobb-v2 | tags | v9.6.3 5cfe1395 → v10.0.2 93efad8c | 99 files; the 15 commits on origin/release/v10 after v10.0.2 stay out |
| openbb-docker (server donor, read only) | ~/openbb-docker | tags | v9.6.3 99864f2 → v10.1.7 d606169 | 222 files; ancestor relation holds |

## v9 summary (for the ledger chain)

- Client commits de951a1..62d1aae: manifest fd2081d (105 paths: 87 EXCLUDE, 10 MERGE, 7 PROVENANCE, 1 ADD), aggregation hint 686891a, Calendar tests 70adcb8, example a0ddc85 (`docs/examples/v9.0.0-calendars.apps.json`), EODHD help 2ebad48, version 1378c53, release notes ee21164, ledger 91caa66, V9-P4 resolved b80688e, FREEZE 62d1aae. Most of the donor v9 delta (News strip, settings bundle, apps-sync EPISODE routing, a11y fixes) was already in clean from v8.
- Server commits a95969e..69c907e: openbb-eodhd at v9.6.6 in `v9/eodhd/source/`, served as `obb.eodhd.*` (52 widgets under /api/v1/eodhd/), installed in Dockerfile.v3, ledger `docs/v9/eodhd-port.md`. patch_openbb_core_auth.py was rejected because our provider-fixes overlay already makes both edits (proved by a test). The EODHD SDK could not be fetched (github archive 403), so the SDK-dependent tests are Mac-pending.

## Gate receipts

- v9: `docs/releases/validation/v9/v9-freeze-2026-10-12/` — typecheck, lint, unit 7463/29 skipped, revision 54, build, e2e Chromium 280/8 skipped, web, build-web, web-browser, scrub, help 98, diff-check green. notices-check exit 1 was environmental (no offline cargo registry). Mac-pending.
- Gate method: copy v9's run-gates.sh and change the base SHA. The scratch Playwright config and preload are at `<scratchpad>/gate/` (playwright.scratch.config.ts copied into the repo root, git-excluded; `PW_NODE_OPTIONS=--import=<scratchpad>/gate/chromium-preload.mjs`). e2e takes about 30 minutes.

## Rulings for Episode 10 (the user's)

- Local only. No push, tag, PR, release/*, main, image build, deploy, NAS or public Funnel.
- Client donor bdobb-v2 through v10.0.2 ONLY. Write `v10-delta-manifest.tsv` and `v10-assembly.md` by v8/v9's method (statuses, dispositions, REVIEW notes, hand ports naming donor commits, never weaken an assertion).
- Clean's live grid is ONLY the v3 reference-compatibility renderer `src/components/renderers/LiveGridRenderer.tsx` (83 lines, untouched since v3). v8 only added a "reconnect" mode to the shared useReconnectingSocket for News. The donor's v10 live-grid work is MERGE/ADD onto that baseline, not KEEP, and v3 reference compatibility must keep working.
- Client scope: the live_grid renderer and buildWidgetWsUrl; /symbol_meta logos and range bars; the streaming chart fixes; the web preview's /grid relay (c183f880); help (7876c86a); the Episode 10 example `docs/examples/v10.0.0-live-grid.apps.json` plus 1621cee1's chart cards.
- Server: port openbb-docker through v10.1.7 into openbq-docker `claude/openbq-docker-v10`:
  - the live-grid FastAPI sidecar;
  - the kdb+ cache tier;
  - the gateway /grid family, Bearer-gated, with per-symbol metering and frame caps (d32966d, 7212a1d, d7ec9d1, 995e06a, b9545f5, dc61be8, e8c1239);
  - live-grid/apps.json.
  Keep our OpenBB Platform 5.0 and take only 5.0 fixes we lack.
- kdb (<registry>/kdb-x:amd64, ./kdb-license mounted read-only) and live-grid sit behind an opt-in `live` compose profile; the default stack is unchanged. live-grid degrades without kdb. The /grid routes stay in the opt-in `web` profile. Re-vendor the gateway policy into the client as v8 did (`pnpm gateway:vendor`, move the `openbbDocker` pin; see V9-P3).
- kdb is tested against fakes and recorded data only. No licence in the cloud.
- Examples: `EPISODE=10` sync into openbq-docker v10. The live-grid example maps to the live profile.
- Version 10.0.0 everywhere (same places as v9's 1378c53), full cloud gate, local FREEZE commit "chore(v10): version 10.0.0 — gate receipts — FREEZE", no tag.
- Conflicts: take the recommended option and mark it PROVISIONAL in OPEN-QUESTIONS.md. PivotParamRow.viewer.test.tsx is a known intermittent: rerun it alone once and record that. WebKit, cargo/Tauri, iOS, dashsync and live Docker are Mac-pending.
- Pre-existing open item: the live-grid websocket auth note in OPEN-QUESTIONS (dev 98301b6) said "fix only if a clean target refuses the socket". The v10 gateway /grid socket is Bearer-gated, so a clean target now does need a credential. Re-examine it under that ruling.

## Open questions so far

- Connections export/import (open since v7).
- PROVISIONAL V9-P1 (Pivot suggestion not shown), V9-P2 (Rita does not read the hint), V9-P3 (gateway pin stays at cab61a9 for v9).
- openbq-docker v9 port provisionals (in `docs/v9/eodhd-port.md`): openbb-eodhd taken at v9.6.6; no standard routers, EODHD only under /api/v1/eodhd; SDK extras not yet locked (lock on the first Mac build); ArcticDB tier kept and self-disabling; the EODHD app ships in the extension rather than in examples/bdobb; the SDK's MIT licence needs confirming.

## EODHD calls

EODHD_API_KEY is absent in this environment. Live checks NOT_RUN. Calls used: **0** of 5,000 (counter `<scratchpad>/eodhd-calls.tsv`).
