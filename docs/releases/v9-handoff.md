<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# v9 handoff (context reset before Episode 9)

Written 2026-10-12 by the overnight orchestrator, before any v9 work. Local only. Nothing is pushed, tagged or published tonight.

## Starting point

| Repo | Path | Branch | SHA | Note |
|---|---|---|---|---|
| Adventures-OpenBQ/bdobb (clean) | ~/bdobb | claude/clean-v9 (new, from the v8 FREEZE) | de951a1d | v8.0.0 FREEZE, cloud gate green; the Mac half is PROVISIONAL (Mac session session_01Xc8AQfNVJ9yoAgAJ5m48Ay) |
| bdobb-dev/bdobb-v2 (client donor, read only) | ~/bdobb-v2 | tags | v8.1.2 28aeb65a → v9.6.3 5cfe1395 | v8.1.2 is the v8 donor and an ancestor of v9.6.3; 261 commits, 105 files |
| bdobb-dev/openbb-docker (server donor, read only) | ~/openbb-docker | tags | v9.6.3 99864f2 (v9 line through v9.6.6) | `openbb-eodhd/` (58 files at v9.6.3) |
| Adventures-OpenBQ/openbq-docker (clean server) | ~/openbq-docker | claude/openbq-docker-v8 | a95969e | OpenBB Platform 5.0 (openbb-core 2.0.1); v9 branch `claude/openbq-docker-v9` is made from here |

Clones are blobless (`--filter=blob:none`); blobs download on demand.

## Rulings (the user's, session_011L8xTR2GuwgUucgeiy728q)

- Local commits on local branches only. No push, tag, PR, release/*, main, image build or push, deploy, NAS or public Funnel.
- Method is v8's (`docs/releases/v8-assembly.md`, `v8-delta-manifest.tsv`, `provenance.md`, `validation/v8/v8-freeze-2026-10-12/`):
  - manifest columns `status path feature disposition reason`; status SAME-BASE / DIVERGED / NEW; disposition CLEAN-APPLY / MERGE / ADD / EXCLUDE / PROVENANCE;
  - a REVIEW note whenever a clean assertion changes; never weaken an assertion;
  - no shared git ancestry, so every carry is a hand port with the donor commit named in the commit message.
- Client: donor bdobb-v2 through v9.6.3. Keep ours where equal or better, notably the Calendar and Pivot.
- Server: port openbb-eodhd (the extension and its wiring) from the openbb-docker v9 line into openbq-docker. Keep our OpenBB Platform 5.0; take only donor fixes we lack. Live-grid, kdb and the /grid gateway family are v10, not v9.
- Examples: carry the donor's `docs/examples/v9.6.2-calendars.apps.json` as a v9.0.0 example (keep ours if our calendar is equal or better). openbq-docker v9 gets the openbb-eodhd `assets/apps.json` entries. Then run `EPISODE=9 scripts/apps-sync.mjs` with OPENBB_DOCKER_DIR set to a scratch dir and filter into openbq-docker `examples/bdobb/apps.json` exactly as openbq-docker 41bc742 did for v8. Every example description names its minimum BDOBB version and is covered by appsJson.examples.test.
- Version 9.0.0 in the same places as v8's bump 9c92eefa: package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, Cargo.lock's bdobb entry, src/help/guide/VERSION, the guide home, About This Guide, plus the release notes.
- Help pages for the EODHD features.
- Gate: v8's run-gates.sh (copy it to scratch). Chromium is 1194 and Playwright expects 1234. Use an uncommitted scratch Playwright config with launchOptions.executablePath `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, plus a `--import` preload for scripts that call chromium.launch. Never run `playwright install`. Leave out WebKit-only specs (Mac-pending).
- On green: a local commit "chore(v9): version 9.0.0 — gate receipts — FREEZE" with receipts in docs/releases/validation/v9/. No tag.
- Conflicts: take the recommended option and record it as PROVISIONAL in docs/releases/OPEN-QUESTIONS.md.
- Never skip, disable or weaken a test. PivotParamRow.viewer.test.tsx is a known intermittent: rerun it alone once and record that.
- Mac-pending, not failures: WebKit, cargo/Tauri, iOS, dashsync, live Docker. The `notices-check` exit 1 is environmental (linux-x64 vs darwin-arm64 canvas package), as recorded at v8.

## EODHD

- `EODHD_API_KEY` is **not set** in this environment (checked at session start; the value was never printed). Every live EODHD check is **NOT_RUN**. Use fixtures and recordings only.
- Shared cap: 5,000 calls across v9 and v10. Counter: `<scratchpad>/eodhd-calls.tsv`. Calls used so far: **0**.
- If a key ever appears, never print, echo, log or commit it. Scrub receipts.

## Gate receipts so far

v8 freeze (de951a1, receipts docs/releases/validation/v8/v8-freeze-2026-10-12/): typecheck, lint, unit 7447 passed, e2e Chromium 280 passed (about 45 min), web, build-web, web-browser, scrub, help 94, diff-check all green. notices-check exit 1 was environmental.

## Open questions carried in

- Connections export/import (`backendsJson`): open, see OPEN-QUESTIONS.md.

## Toolchain

Node 22.22, pnpm 10.34.4 (`pnpm install --frozen-lockfile` done on claude/clean-v9), Python 3.13, 4 cores, 15 GB RAM.
