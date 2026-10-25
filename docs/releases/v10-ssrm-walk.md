# v10 SSRM walk

The user's rulings of 2026-10-15 carry the v9 SSRM walk (`docs/releases/v9-ssrm-walk.md`) forward to
v10 by real merges, in both repositories. They also bring in the held V10-P1 socket-ticket branches and
PR #10's and PR #56's v10-only hunks and documents. Walked v10 is checked against the reviewed PR sources.
Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| openbq-docker v10 | c48d9c2 | merge od `claude/walk-ssrm-v9`, with the gateway reconciliation (below) |
| openbq-docker v10 | bf0b111 | PR #10's v10-only hunks: `server.mjs` `^`/`%5E` and `subscriptionRoute`, `.env.example` `TABLE_*`, `table-service/ROLLUP-HANDOFF.md` (with a walk note) |
| openbq-docker v10 | ebf252f | merge od `claude/v10-grid-socket-ticket` (76fd6a3, 019e122), plus a desktop-Origin table test |
| openbq-docker v10 | ceb521a | merge od `claude/walk-ssrm-v9` again (5421a90, the README hint line) |
| bdobb v10 | afc2717 | merge `claude/walk-ssrm-v9` |
| bdobb v10 | 4f9935e | merge `claude/v10-grid-socket-ticket` (1a310c6, cfa70ec) |
| bdobb v10 | 1700481 | PR #56's handoff, evidence and `.superpowers/sdd` (tracked in the PR, force-added), with a walk note |
| bdobb v10 | c1f31e6 | evidence names the pnpm store by `~` so `pnpm scrub` passes |
| bdobb v10 | d3d46f6 | parity fixes and the commit-pinned stack page (pairing commit Y10) |
| openbq-docker v10 | 2dda793 | `table-service/source.lock.json` pinned to d3d46f6, tree 4069cb78 (pairing commit X10) |
| bdobb v10 | 4116c7c | policy vendored from 2dda793, `openbqDocker` = 2dda793 (pairing commit Z10) |

Pairing: the Dockerfile hash is unchanged (41c59cdc). Between Y10 and Z10 only `package.json`,
`web/policy.mjs` and `web/policy.vendored.json` change. **The canonical policy sha256 stays c4d1a2bd**,
the PR's own. It was expected to change, but PR #10's `policy.mjs` already carried the table routes, and
V10-P1's ticket endpoint lives in `server.mjs` (`policy.mjs` is unchanged, as 76fd6a3 states). The
vendored body is byte-identical to 1382c316's `web/policy.mjs`.

## Gateway reconciliation (od c48d9c2, ebf252f)

release/v10's gateway equals PR #10's base (1860342), so 41641c6 is the target. `config.mjs` and `server.mjs`
equal 41641c6 after bf0b111. `server.mjs` differs only by V10-P1. `.gitignore` and the compose file take the
union in the PR's order, and compose names the gateway-down origin of `/table`. The table-service README
names the news and grid routes again, which the walk had dropped at v4, where they did not exist. Gateway
tests: 100. That is the PR's 96, plus 3 ticket tests, plus a new one: the packaged desktop Origins reach
`/table` as the desktop principal behind the lock, and `:1420` and foreign Origins get 403.

## bdobb merge resolutions (afc2717, 4f9935e)

- **Web relay.** `web/server.mjs`, `bootstrap.mjs` and `security.test.mjs` equal 1382c316. The table lines
  read the namespace-imported policy, as v10 injects it, in place of v8's named imports.
- **Tests.** `widgetsJson.test.ts` equals 1382c316's.
- **Help.** The help keeps v10's pairing sentence with the walked v4-gateway wording.
- **`OPEN-QUESTIONS.md`.** It keeps both lines' entries, with the ticket branch's live-grid note.
- **`package.json`.** `version` was corrected to 10.0.0 (the merge took 9.0.0).

## Parity with the reviewed PRs

The comparison covers every path in `git diff --name-only origin/release/v10...origin/codex/table-ssrm-v10`:
171 bdobb paths and 18 od paths. Code is compared with bdobb 1382c316 and od 41641c6. The documents that
the publication commits changed are compared with bdobb a8f16e7 and od 2d839ce. Paths not listed here are
byte-identical. No PR test is missing by name in either repository.

**bdobb**

| Path | Δ | Class |
|---|---|---|
| `package.json`, `web/policy.vendored.json` | 1 line each | pins (Z10) |
| `server/table-ingest/backend.ts`, `backend.test.ts`, `README.md` | +87/−11, +112, +3/−2 | rulings: managed relabel at ingest via `backends[id].url` (v5); V9-P2 hint carry (v9) |
| `scripts/build-table-ingest.mjs` | `external:['xlsx']` for `packages:'external'` | ruling (relabel): the child bundles `@internationalized/date`, so `xlsx` stays its only runtime package (83566f7) |
| `src/components/WidgetCard.tsx`, `WidgetCard.test.tsx` | +50/−3, +119/−5 | ruling (relabel): statement rows relabelled, the as-reported note, *FY ends from* on local tables; merge adaptation: `dashboardId ?? ""` |
| `src/stores/tableExecutionStore.ts`, `src/lib/tableExecution/types.ts` | +18/−5, +4/−3 | rulings: worker relabel as the second step (`importFile` `yearEnds`); V9-P2 hint metadata |
| `src/lib/agent/tableModel/describe.ts`, `src/lib/widgetsJson.ts` | +3/−1, +2/−40 | ruling: V9-P2 (`toAggregationHint` moved to `aggregationHint.ts`) |
| `src/lib/dataClient.ts` | +36/−3 | rulings: V10-P1 socket ticket (`ticketedWsUrl`); relabel (`FISCAL_YEAR_END_PATH` from `periods`) |
| `src/help/index.test.ts` | +4 | rulings: V9-P2 and V10-P1 help pins |
| `src/help/topics/tables.md` | +11/−2 | ruling (relabel paragraph); help fix: a backend table still answers `server-execution-pending` in the PR's own `target.ts`, so the sentence the PR dropped is kept |
| `src/stores/dashboardStore.test.ts` | +17 | merge adaptation: the walk's v5 owner-scope test for `clearManagedSource` |
| `crates/pivot-native-worker/Cargo.toml`, `deploy/table-service/Dockerfile.worker-qualification` | +2 each | header-check fix: license header |
| `docs/releases/table-ssrm-rollup-handoff.md` | +8 | walk note (step 5) |
| `docs/superpowers/evidence/2026-10-14-table-ssrm/qualification.json` | 1 line | scrub fix: home path → `~` |

Fixed in d3d46f6 (they were unexplained): the README's evidence link, the `SCOPED`
`clearManagedSource` revision step, and a stray blank line in `workspaceDashboards.test.ts`.

**openbq-docker**

| Path | Δ | Class |
|---|---|---|
| `table-service/source.lock.json` | 2 lines | pins (X10) |
| `funnel-gateway/server.mjs`, `README.md` | +31/−5, +11/−1 | ruling: V10-P1 socket ticket (76fd6a3) |
| `funnel-gateway/gateway.test.mjs` | +71 | V10-P1 tests (+56); the desktop-Origin table test (+13); v4's `tableOrigin === null` check (+2) |
| `funnel-gateway/Dockerfile` | node:22-alpine for node:26.10.0-alpine | walk decision from v4 (`docs/v4/gateway-down.md`) |
| `funnel-gateway/control-admission.test.mjs`, `table-service/settings.example.json` | 1–2 lines | check-public fixes |
| `docker-compose.yml`, `.gitignore` | +9/−2, +2 | release/v10's own later `credentials.demo.env` lines; ruling: the gateway-down comment |
| `table-service/README.md` | +16 | rulings: relabel via `backends[id].url`; V9-P2 hint line |
| `table-service/ROLLUP-HANDOFF.md` | +8 | walk note (step 4) |

Nothing is left unexplained.

## Ancestry (for `main` = walked v10)

The check runs `merge-base --is-ancestor` and `rev-list <walked>..<ref>` for `origin/release/vN` and
`vN.0.0`, v3–v10.
- **openbq-docker (2dda793):** every ref is an ancestor; every `rev-list` is empty.
- **bdobb (4116c7c):** v4–v10 pass.
- **bdobb `origin/release/v3` = `v3.0.0` (34cc789) fails.** Seven commits are missing:
  - the 2026-10-13…15 v3 help relaunch;
  - the apps-sync and key-save fixes;
  - the v3.0.0 re-cut receipt.

  They are not in `origin/release/v4` either, so this is a release-chain hole that predates the walk.

## Gates (2026-10-15)

| Gate | Result (handoff baseline) |
|---|---|
| Full `pnpm exec vitest run` | 8259 passed, 30 skipped (8171/29). The first run failed only `guide.test.ts`'s tag-form pin, changed in d3d46f6 (below) |
| `node --test web/*.test.mjs` | 57/57 (57) |
| od `node --test funnel-gateway/*.test.mjs` | 100/100 on Node 26.10.0 (96). Node 22 is not installed here |
| table-service (Rust, cargo 1.98.1 `--locked`) | 33 passed on macOS (72 includes the Linux-only suites, not run). Crates identical to v9's |
| Native browser (`test:ssrm:browser`) | not run: needs `TABLE_QUAL_LINUX_ROOT` artifacts and Docker (4) |
| Pivot wasm build and `--verify`, `test:pivot:packaging`, `table-ingest` typecheck/test/build | pass; ingest 29/29 |
| `pnpm typecheck`, `pnpm lint`, `pnpm scrub` | pass |
| `test:web:browser` after `build:web` | pass (News and Live quotes over ticketed sockets) |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| od `pytest tests`, `check-public.py` | 54 passed, PASS |
| od `prepare-source.mjs`; `docker compose --profile web --profile table --profile live config --quiet` | pass (scratch export with the example env files) |
| Production image, live Rita, physical iPad | not run |

**Changed assertion (warning):** `guide.test.ts` required "At 10.0.0 `openbqDocker` is `v10.0.0`". That pin
was set by the 2026-10-14 tag ruling. Under the walk's pairing, `openbqDocker` names X10 until tags are
re-cut, so the test now pins the commit wording; the REVIEW note in the test records this. Restore the tag
form when re-tagging.

## Open

- **The desktop Origin below v10 (needs a ruling).** V10-P1 found that Tauri's http plugin stamps
  `tauri://localhost` / `http://tauri.localhost` on every request, and the gateway refused it with 403
  until V10-P1. Managed-table requests (`createManagedTableRequest`) use that plugin. So on walked v4–v9,
  where the gateway now serves `/table` but has no desktop-Origin rule, the packaged desktop and the v7
  iPad would likely get 403 on `/table`. This is untested: no packaged app was run. Whether the
  Origin half of V10-P1, without the ticket, moves down with the gateway is a placement question the
  rulings do not answer.
- The `SCOPED` `clearManagedSource` revision step is missing on walked v5–v9; it is fixed only at v10.
- The bdobb v3.0.0 re-cut is not carried into v4+ (see Ancestry).
- Since v6, the guide's Rita paragraphs still list only CSV/XLS and linked tables (see the v9 ledger).

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | d6b5d55 | merge od `claude/walk-ssrm-v9` (gateway resolution below) |
| bdobb | bd344ef | merge `claude/walk-ssrm-v9` (pairing commit Y10) |
| openbq-docker | 60f921a | lock pinned to bd344ef (X10) |
| bdobb | 2f51fa3 | policy vendored from 60f921a (Z10) |

Pairing: lock = bd344ef; between bd344ef and 2f51fa3 only `package.json` and `web/policy.vendored.json` change.

- **Gateway.** `server.mjs` and the README keep v10's: the v4 rule was taken from 76fd6a3. The tests drop the walked duplicate `DESKTOP` declaration and add the walked `/api` desktop test. Gateway tests 100 → 101. The policy sha256 stays c4d1a2bd.
- The SCOPED `clearManagedSource` step merges onto v10's identical d3d46f6 line.
- **Parity re-check** (171 bdobb, 18 od PR paths, against 1382c316 / 41641c6). Since 4116c7c / 2dda793, the only PR paths that changed are the pins (`package.json`, `web/policy.vendored.json`, `source.lock.json`) and od `funnel-gateway/gateway.test.mjs` (+1 test: the walked `/api` desktop-Origin test, class: ruling, desktop Origin moved down). The classification above still holds otherwise.
- **Ancestry** (re-run after this cascade): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor of walked v10 and every `rev-list` is empty. **bdobb v3 (34cc789) now passes.**
- Open items above: the desktop Origin below v10 is ruled and built at v4; the SCOPED step is on v5–v9; the v3.0.0 re-cut is carried; the Rita guide paragraphs are fixed at v6.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 8260 passed, 30 skipped |
| `pnpm typecheck`, `pnpm lint`, `pnpm scrub` | pass |
| Pivot wasm build (fresh) and `--verify`, `test:pivot:packaging` | pass |
| `table-ingest` typecheck, test | pass, 29/29 |
| `node --test web/*.test.mjs` | 57/57 |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| `test:web:browser` after `build:web` | pass |
| od `node --test funnel-gateway/` | 101/101 (Node 26.10.0) |
| od `pytest tests`, `check-public.py` | 54 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web, table, live config --quiet` | pass |
| Rust crate tests | not re-run: no Rust changed in this cascade (the wasm build compiles pivot-wasm) |

## v3.0.0 cascade (2026-10-15)

v3.0.0 (bdobb 9e94bc1, od cad5cc9) and the V8-pin fix 94aee52 are carried from v4 (d057cdf / od 466a8e5) by real merges, then the lines are re-paired. Nothing was pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | efe981c | Merge claude/walk-ssrm-v9 (v3.0.0 + the V8-pin fix) into the walked v10 |
| bdobb | 262c7a9 | feat(v10): vendor the gateway policy from openbq-docker db914ba and pair with it |
| openbq-docker | a81963e | Merge od claude/walk-ssrm-v9 (v3.0.0 + the V8-pin re-pair) into the walked v10 |
| openbq-docker | db914ba | feat(v10): pin the table service source to BDOBB v10 efe981c |

Pairing: od `table-service/source.lock.json` names bdobb efe981c, and the last bdobb commit vendors the policy from od HEAD and sets `openbqDocker` to it.

- **Gateway (od a81963e).** v10's gateway (`/grid`, desktop tickets, news, tables) plus v3's: the `/ref` family by concatenation on the fixed `refOrigin` (and `target()` now concatenates for `/grid` and `/table` as well), `boundedForward`, and the 16 MiB manifest cap. The socket door has four routes. `socketTarget` reads the raw request text (v3's `want`). `/ref/live_grid_ws` is a third frame family beside the wire and the grid: params frames are re-validated by `refSubscription`, there is no vendor meter, and v10's `FRAME_CAP`, pending-frame and back-pressure bounds apply. **Decision:** `FRAME_CAP` (60) now bounds `/ref` frames, which v3 left unbounded. Desktop tickets stay `/grid`-only. The three fixes are all present: `TICKET_SKEW_MS`; the 16 MiB cap; the replay prune at `until < now()` (v10 had `<=`, and the exact-expiry test fails with it, checked by mutation). There is one `SYMBOL_LIST_RE`. v3's `/ref` tests used `/grid/live_grid_ws` as a non-route; here they use `/grid/ta_series_ws`.
- bdobb: `web/` gets the three ticket targets and the seeded reference connection beside the grid's.
- **Parity re-check** (PR paths changed acce2d8/60f921a → now). bdobb `ordering.rs` is the V8-pin fix (ruled). `bootstrap.mjs`, `server.mjs`, `security.test.mjs` and `gateway-vendor.mjs` keep every PR line. The pins are as before. od: every PR line is kept except two. The `server.mjs` import line is now a superset, and `tableOrigin` is concatenated: both are v3 carries. The `Dockerfile` Node is an existing walk decision. The classification otherwise holds.
- **Ancestry** (`ancestry.sh`): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor of walked v10 with `missing=0`. v4's final freeze is still to come (another session owns v4).
- **CSP** (v4 ruling 2026-10-15): `tauri.conf.json` CSP is v4's object form, and it and `csp.test.ts` are byte-identical on v4–v10.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 8262 passed, 30 skipped (8292) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build (fresh), `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 29 passed |
| `node --test web/*.test.mjs` | 60 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| `test:web:browser` after `build:web` | pass |
| od `node --test funnel-gateway/` | 122 passed, 0 failed |
| od `pytest tests`, `check-public.py` | 57 passed, 15 subtests passed, pass |
| od `prepare-source.mjs`, `docker compose --profile web, table, live config --quiet` | pass, pass |
| Spark Linux tests | not run: they run after v4's final freeze |

## v5.0.0 carry (2026-10-16)

Walk v9's carry of v5.0.0 (through walk v6 193b615, v7 and v8) is merged into v10, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | bcd384c | Merge walk v9 (pairing commit Y10) |
| bdobb | a11cda3 | policy vendored from add5ff6, `openbqDocker` = add5ff6 (pairing commit Z10) |
| openbq-docker | 701d274 | Merge walk v9 |
| openbq-docker | add5ff6 | lock pinned to bcd384c (X10) |

Between Y10 and Z10 only `package.json`, `web/policy.mjs` and `web/policy.vendored.json` change.

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v10's side (version 10.0.0), then re-pinned; the lock takes v4.0.0's Dockerfile hash (b5a8cd1a), since bdobb v10 now carries 740e23c's Dockerfile.
- `web/server.mjs`: v10's `policy.*` names with v4's SSRM deadline (`ssrmTimeoutMs` for SSRM, `tableTimeoutMs` for managed routes).
- `TableRenderer.test.tsx`: both sides' tests. `docs/examples/v10.0.0-live-grid`: description within v5's 400 characters, keeping "BDOBB 10.0.0 or later".
- od gateway: v10's own (`openbq-funnel-gateway:10.0.0`, `liveGrid`, `/grid`, desktop tickets) with v4's `ssrmTimeoutMs`, the vendored default SSRM routes and both sides' tests. Overlay and key-maint 10.0.0.
- Help: cron "is not supported"; key-maint cited at `v7.0.0`.
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, sockets `/ref/live_grid_ws`, `/news/ws/news`, `/grid` and desktop tickets (V10-P1 `/grid/ws_ticket`), the desktop Origin rule, the V9-P2 hint fill-in.
- **Parity re-check** (166 bdobb, 17 od PR paths against 1382c316 / 41641c6; changed since 7c956b8 / 4eab159: 37 bdobb, 7 od). Every PR line dropped since then is also absent on walk v6 (0 exceptions): each was replaced by a v4.0.0/v5.0.0 review fix carried from below, or by a superset line in a union resolution (gateway settings keys, the SSRM deadline), or is a pin. The classification otherwise holds.
- **Ancestry** (`ancestry.sh`): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor of walked v10 with `missing=0` (bdobb release/v5 = v5.0.0 = 4a49a01). The v6+ release branches will be re-cut by the regression session.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8326 passed, 30 skipped (8356) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 65 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 128 passed |
| od `pytest tests`, `check-public.py` | 58 passed, 17 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table --profile live config --quiet` | pass, pass |
| Linux (Spark, `run.sh v10`, source a11cda3, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v6.0.0 carry (2026-10-16)

Walk v9's carry of the frozen v6.0.0 (bdobb ceacb4d, od 6685c87) and bdobb ad5e139 (`claude/v6-regression-20261016`, for the final v6.0.0 re-cut), through walks v7–v9, is merged into v10 in both repositories, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | f4bf70b | Merge walk v9 (v6.0.0) |
| bdobb | 0d6071c | Merge walk v9 (ad5e139, v8's docked-card push-down) (pairing commit Y10) |
| bdobb | 2e1d56c | policy vendored from 804bb7a, `openbqDocker` = 804bb7a (pairing commit Z10) |
| bdobb | 57412f3 | Merge walk v9's ledgers |
| openbq-docker | 41e27d8 | Merge walk v9 (Rita and MCP overlay), reconciled with v10's live and lake tiers |
| openbq-docker | 21d0434 | Merge walk v9 (re-pin) |
| openbq-docker | 804bb7a | lock pinned to 0d6071c (X10) |

5ceb03b / e545da4 are an earlier pairing (before ad5e139), superseded. Between Y10 and Z10 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged (sha256 85cf23a3).

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v10's side (version 10.0.0), then re-paired.
- Code merged cleanly: v8's `cardAndDef` union; ad5e139 with v8's docked-card push-down (v10's `move_widget` and `StatusTrail` equal v8's).
- Help: v10's text with v6.0.0's Run/Deny, Stop and row-send wording; the Rita/MCP overlay cited at openbq-docker `v10.0.0` (with rss-ticker on 8088 for `serve-v6.json`). The last branch citation, "at the v9 branch (`d66e4d0`)" in `openbq-docker-stack`, now reads `v9.0.0`, which contains d66e4d0 and both cited files.
- od overlay, reconciled with v10: nothing else claims Rita's `127.0.0.1:7777` in the sidecar namespace or MCP's 6901; the live (kdb, live-grid) and lake (rustfs) "not served" checks now cover `serve-v6.json` and `serve-v6-keys.json`; compose config passes with the v3 + v6 overlays and the web, table and live profiles. Rita and MCP keep the 6.0.0 digests; key-maint 10.0.0; the gateway stays `openbq-funnel-gateway:10.0.0`.
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, sockets `/ref/live_grid_ws`, `/news/ws/news`, `/grid` and desktop tickets (V10-P1 `/grid/ws_ticket`), the desktop Origin rule, web preview over HTTP, the V9-P2 hint fill-in.
- **Parity re-check** (`parity-lost.py`, 171 bdobb and 18 od PR paths against 1382c316 / 41641c6): no PR line present at the previous walked v10 (f7159dc / add5ff6) is gone at this head, and none was dropped between walk v6 (193b615 / 343b84b) and v6.0.0 + ad5e139 / 6685c87. The PR paths this carry touched (`DropZone`, `WidgetCard` and their tests, `topics/tables.md`, the pairing files, the od lock) only gained v6 review-fix lines or pins. The classification holds.
- **Ancestry** (`ancestry.sh`): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor of walked v10 with `missing=0` (bdobb release/v6 = v6.0.0 = ceacb4d; od release/v6 = v6.0.0 = 6685c87). ad5e139 is an ancestor too.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8360 passed, 30 skipped (8390) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 65 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 128 passed |
| od `pytest tests`, `check-public.py` | 60 passed, 19 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table --profile live config --quiet`; with the v3 + v6 overlays | pass, pass; pass |
| Linux (Spark, `run.sh v10`, source 2e1d56c, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v7.0.0 carry (2026-10-16)

Walk v9's carry of the frozen v7.0.0 (bdobb 96670d6, od ebafc5c), through walks v8 and v9, is merged into v10 in both repositories, then the lines are re-paired. See `v8-ssrm-walk.md`, "v7.0.0 carry", for what v7.0.0 brings. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 43be22a | Merge walk v9 (v7.0.0) (pairing commit Y10) |
| bdobb | 8ebd791 | policy vendored from 52bd8d9, `openbqDocker` = 52bd8d9 (pairing commit Z10) |
| openbq-docker | 2721509 | Merge walk v9 (od v7.0.0, re-pin) |
| openbq-docker | 52bd8d9 | lock pinned to 43be22a (X10) |

Re-paired because the od head changed. No native path changed. Between Y10 and Z10 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged (sha256 810f9547).

**Merge resolutions**
- Only the pairing files conflicted (`package.json`, `web/policy.vendored.json`, od `source.lock.json`): v10's side (version 10.0.0), then re-paired. The code, the Help and the touch example merged cleanly with v8's resolutions.

**Line checks**
- `envPrefix` is `["VITE_", "TAURI_ENV_"]`; `screenFit.ts`, `screenFit.test.ts`, `vite.config.ts` and `envPrefix.test.ts` equal v7.0.0's.
- Monitor calls (whole tree, vendored swift-rs aside): only `screenFit.ts`, all behind `nativeMonitors()`. `TAURI_ENV_PLATFORM` branches: v7.0.0's own; v8–v10 add none (v10's grid socket reconnect on foreground is an option, not a platform branch).
- Help: no "…behind a chevron" label remains.
- **Parity re-check** (`parity-lost.py`, 171 bdobb and 18 od PR paths against 1382c316 / 41641c6): no PR line present at the previous walked v10 (3b0512c / 804bb7a) is gone at 8ebd791 / 52bd8d9.
- **Ancestry** (`ancestry.sh`): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor of walked v10 with `missing=0` (bdobb release/v7 = v7.0.0 = 96670d6; od release/v7 = v7.0.0 = ebafc5c).

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8377 passed, 30 skipped (8407) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 65 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 128 passed |
| od `pytest tests`, `check-public.py` | 60 passed, 19 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table --profile live config --quiet` | pass, pass |
| Linux (Spark, `run.sh v10`, source 8ebd791, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v8.0.0 carry (2026-10-16)

Walk v9's carry of the frozen v8.0.0 (bdobb ef1797a, od 238daee) is merged into v10 in both repositories, then the lines are re-paired. See `v9-ssrm-walk.md`, "v8.0.0 carry", for what v8.0.0 brings. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 8805119 | Merge walk v9 (v8.0.0) |
| bdobb | 1386d92 | docs: the release notes name the `openbqDocker` pin (pairing commit Y10) |
| bdobb | c6ad13f | policy vendored from c69bbb1, `openbqDocker` = c69bbb1 (pairing commit Z10) |
| openbq-docker | a48cae1 | Merge walk v9 (od v8.0.0, re-pin) |
| openbq-docker | c69bbb1 | lock pinned to 1386d92 (X10) |

Re-paired because the od head changed. No native path changed; the policy bytes are unchanged (sha256 810f9547). The gateway image stays `openbq-funnel-gateway:10.0.0`.

**Merge resolutions**
- `useReconnectingSocket.ts`: both options, v10's `resolveUrl` (single-use gateway tickets) and v8.0.0's `foregroundMinHiddenMs`, with v8.0.0's visibility handler. `useNewsWire.ts` equals v8.0.0 (seeding 4 at a time, 60 s web / 0 native).
- `src/help/guide/web-preview.md`: v10's socket paragraph (it names `/grid`; v8.0.0 only dropped the "v10, say" aside).
- `web/README.md`: v10's five families with v8.0.0's commit-pin wording.
- Pairing files: v10's side, then re-paired. od `source.lock.json`: v10's side, then re-pinned.
- Checked: `.tab-bar-tabs` keeps `min-width: 0; overflow-x: auto` and nothing in v10's CSS overrides it; `localTools.ts` equals v8.0.0's docked-move and `pin_card` code; Apps once in the rail and the Help; `OPEN-QUESTIONS.md` Open says "None." with one Connections entry, identical to 92a4569's.
- 1386d92: v10's release notes said the `openbbDocker` pin names openbq-docker `ebd1622`; they now name the `openbqDocker` pin.

**Parity re-check** (`parity-lost.py`, 171 bdobb and 18 od PR paths against 1382c316 / 41641c6): no PR line present at the previous walked v10 (3040524 / 52bd8d9) is gone at c6ad13f / c69bbb1.

**Ancestry** (`ancestry.sh`): od, every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor with `missing=0`. bdobb, the same except `release/v7` and `v7.0.0` = 92a4569 (NOT-ANCESTOR, missing=1). **Pending the v8 re-cut:** the v8 owner re-tagged v7.0.0 onto 92a4569 (the Connections ruling, child of 96670d6) and cut v8.0.0 without it. The content is identical (v8.0.0's e11d737 carries the same `OPEN-QUESTIONS.md`). The re-cut v8.0.0 merges v7.0.0; the coordinator merges it in. 92a4569 is not merged here.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8387 passed, 30 skipped (8417) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 65 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 128 passed |
| od `pytest tests`, `check-public.py` | 60 passed, 19 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table --profile live config --quiet` | pass, pass |
| Linux (Spark, `run.sh v10`, source c6ad13f, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v9.0.0 carry (2026-10-16)

The frozen v9.0.0 (bdobb `release/v9` = `v9.0.0` = 72eae66, od 43169cd) is merged straight into walk v10 in both repositories, then the lines are re-paired. Walk v9 (42c82f3 / eb3ec2d) was already in v10; v9.0.0 adds the EODHD key-redaction fix, the trailing dividend yield, calendar paging, the pinned SDK dependencies, the provider-operator guards and their Help. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | e87316a | Merge v9.0.0 (43169cd) |
| openbq-docker | 35c87a6 | fix(v10/live-grid): redact the EODHD key from a technical-indicator fetch failure |
| openbq-docker | 170f4b2 | lock pinned to cfcf2f4 (X10) |
| bdobb | cfcf2f4 | Merge v9.0.0 (72eae66) (pairing commit Y10) |
| bdobb | ca591d7 | policy vendored from 170f4b2, `openbqDocker` = 170f4b2 (pairing commit Z10) |

Re-paired because the od head changed. No native path changed. v10's vendored policy bytes are unchanged (sha256 cda0d7d8, v10.0.0). The earlier sections' "810f9547" is v9's policy hash, not v10's. The gateway image stays `openbq-funnel-gateway:10.0.0`.

**Merge resolutions**
- od merged cleanly. `v9/eodhd/**`, including `_client.py`, `calendar.py` and `dividend_yield.py`, is byte-identical to 43169cd.
- `requirements.extra.lock`: only `Dockerfile` and `Dockerfile.v3` install openbq-eodhd, and both take it with `--no-deps`. v10's `Dockerfile.lake`, `live-grid/Dockerfile` and `kdb-x/Dockerfile` do not bundle openbq-eodhd.
- bdobb: `package.json` and `web/policy.vendored.json` take v10's side (10.0.0, the od v10 pin), then are re-paired. `example-dashboards.md` keeps v10's thirteen examples and its live-grid sentence, with v9.0.0's key sentence (the demo token answers the two price cards and the income card, and the two calendars need a real `EODHD_API_KEY`).
- `hint.ts`, `hint.test.tsx`, `hintGuards.test.tsx`, `pivotSuggestion.ts`, `topics/eodhd.md` and the v9.0.0 release notes are byte-identical to 72eae66. v10 has no code of its own in them. `eodhd-data-provider.md` differs only by v10's live-grid sentence, and `tables.md` only by v10's Live grids sections. The three demo keys (EIA, Congress.gov, EODHD) are named on the stack and Example Dashboards pages. v10's release notes repeat no v9 statement, so they are unchanged.

**Key-leak audit (v10-only paths).** In od v10's openbq_eodhd, `api_token` appears only in the redaction pattern and a comment. key-maint's probes report only status codes and exception class names, and are unchanged since v9. live-grid's quotes and `symbol_meta` swallow their errors without text. Its OpenBB history fetches carry no key in the URL. **Fixed in 35c87a6:** live-grid `EodhdSource` (the TA chart's EODHD source) sends `api_token` in the query string, and httpx quotes the full URL in a status error. That text went into the live-grid log and the series annotation. It is now redacted, plain and `%3D`, with v9.0.0's pattern. A test was added first and was red. The live-grid suite passes, 456 tests, in a scratch venv with openbq-kdb and moto. Residual risk, outside our code: the EODHD SDK's websocket client prints its own reconnect errors.

**Parity re-check** (`parity-lost.py`, 171 bdobb and 18 od PR paths against 1382c316 / 41641c6): no PR line present at the previous walked v10 (c5ae430 / c69bbb1) is gone at ca591d7 / 170f4b2.

**Ancestry** (`ancestry.sh`, after fetching every od branch): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor with `missing=0`. That includes bdobb `release/v7` = `v7.0.0` = 92a4569, through the re-cut v8.0.0 64a528f.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8390 passed, 30 skipped (8420) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 65 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| od `node --test funnel-gateway/` | 128 passed |
| od `pytest tests`, `check-public.py` | 60 passed, 19 subtests; PASS |
| od openbq-eodhd, in a py3.12 venv built as `Dockerfile.v3` does (ODP lock, `extra.lock --no-deps`, SDK pin, provider-fixes overlay) | `pip check` clean. `verify.py` 9 OK, the app under `OPENBB_API_AUTH` included. `source/tests`: 333 passed, 1 skipped, 1 failed. The failure is `test_no_extra_mirror_routes`, a router-parity test that the README says needs the standard routers, which neither this venv nor the image installs. That file is identical to v9.0.0. |
| od live-grid `pytest` | 456 passed |
| od `prepare-source.mjs`, `docker compose --profile web --profile table --profile live config --quiet` | pass, pass |
| Linux (Spark, `run.sh v10`, source ca591d7, `target/v10` deleted first, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

**Open.** v10's release-notes status line still says the policy is vendored from od `ebd1622`. That predates this carry and is left for the v10 release-notes pass.

## v9.0.0 re-cut carry (openbq-eodhd 9.0.1, 2026-10-16)

The re-cut v9.0.0 is merged into walk v10 in both repositories, then the lines are re-paired. bdobb `release/v9` = `v9.0.0` = 0a71108, paired with od `release/v9` = `v9.0.0` = c548397. The od re-cut vendors openbq-eodhd **9.0.1** (Adventures-OpenBQ/openbq-eodhd tag `v9.0.1`, merge commit 59603cc; openbq-eodhd #2 ports the v9 review fixes onto 9.0.0 7f4cbe2). The EODHD SDK is now vendored inside the package at `openbq_eodhd/_vendor/eodhd`, so `v9/eodhd/requirements.extra.lock` is gone. openbq-eodhd 9.0.0 stays 7f4cbe2: the user ruled 9.0.1 because PyPI already holds 9.0.0. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | 319696f | Merge v9.0.0 re-cut (c548397) |
| openbq-docker | 73597fe | lock pinned to 80d2524 (X10) |
| bdobb | 80d2524 | Merge v9.0.0 re-cut (0a71108) (pairing commit Y10) |
| bdobb | 3049efd | policy vendored from 73597fe, `openbqDocker` = 73597fe (pairing commit Z10) |

**35c87a6 is separate from the re-vendor.** 35c87a6 is v10's own live-grid fix (`EodhdSource` redacts `api_token` in fetch-failure text). It is not part of openbq-eodhd and is not touched by this carry: `live-grid/app/ta/sources.py` and `live-grid/tests` are unchanged since 35c87a6, and its tests pass.

**Merge resolutions**
- od merged cleanly. `v9/eodhd/**`, including `source.json` (tag `v9.0.1`, commit 59603cc), is byte-identical to c548397: the tree hashes match (3811018).
- `requirements.extra.lock` and the separate SDK install: `Dockerfile` and `Dockerfile.v3` take v9's new install unchanged (the 9.0.1 wheel, `--no-deps`, no SDK fetch). No v10 Dockerfile, compose file, script or doc referenced the extra lock or the SDK archive.
- live-grid imports `eodhd` itself (`WebSocketClient` in `feeds.py`, `APIClient` in `main.py`) and pins the SDK's GitHub archive in `live-grid/pyproject.toml`. Its image (`live-grid/Dockerfile`) installs only openbq-kdb and live-grid, never openbq-eodhd, so the vendored copy (REST client only, no `WebSocketClient`) cannot replace it and verify.py's no-separate-`eodhd` check never runs there. The pin still resolves (`pip download` of the archive succeeds), and the suite passes. No change at v10.
- bdobb: 0a71108 changes only the pairing fields. `package.json` (10.0.0) and `web/policy.vendored.json` keep v10's side, then are re-paired; the merge tree equals v10's. No v10 Help page, README or release-notes text names openbq-eodhd 9.0.0, the extra lock or the SDK install, so none was adjusted. The policy bytes are unchanged (sha256 cda0d7d8, v10.0.0).

**Key-leak re-grep (v10-only paths).** The same paths as the previous carry; none changed in this merge. `api_token` in v10-only code is only live-grid's `EodhdSource` query and its redaction pattern (35c87a6), key-maint's registry probe (which reports status codes and class names), and a comment. live-grid's `/series`, `/chart`, `/ta_chart` and `ta_chart_ws` error texts come from the OpenBB history and kdb paths, which carry no key.

**Parity re-check** (`parity-lost.py`, 171 bdobb and 18 od PR paths against 1382c316 / 41641c6): no PR line present at c5ae430 / c69bbb1 is gone at 3049efd / 73597fe.

**Ancestry** (`ancestry.sh`, after fetching every od branch): in both repositories every `origin/release/vN` and `vN.0.0`, v3–v10, is an ancestor with `missing=0`, including bdobb `release/v9` = `v9.0.0` = 0a71108 and od `release/v9` = `v9.0.0` = c548397.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8390 passed, 30 skipped (8420) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 65 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| od `node --test funnel-gateway/` | 128 passed |
| od `pytest tests`, `check-public.py` | 60 passed, 19 subtests; PASS |
| od openbq-eodhd 9.0.1, in a py3.12 venv built as `Dockerfile.v3` does (ODP lock, provider-fixes overlay, yfinance/videos/econdb/routes wheels, the 9.0.1 wheel `--no-deps`) | `pip check` clean. `verify.py` 9 OK, including the no-separate-`eodhd` check and the app under `OPENBB_API_AUTH`. `source/tests`: 333 passed, 1 skipped, 1 failed: `test_no_extra_mirror_routes`, the router-parity test that needs the standard routers, as at the previous carry. |
| od live-grid `pytest` | 456 passed; the 35c87a6 redaction tests pass |
| od `prepare-source.mjs`, `docker compose --profile web --profile table --profile live config --quiet` | pass, pass |
| Linux (Spark, `run.sh v10`, source 3049efd, `target/v10` deleted first, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

**Open (from v9, not changed at v10).** od's `NOTICE` still says openbq-eodhd is vendored from v9.0.0 and that the EODHD SDK "is not stored in this repository", and od's `README.md` says `Dockerfile.v3` installs openbq-eodhd 9.0.0. Both lines are identical at c548397. They need fixing at v9 first and then carry forward; v10 does not diverge on its own.

## v9.0.0 docs re-tag carry (2026-10-16)

- od v9.0.0 = 1621ef6 (docs only over c548397: NOTICE and README name openbq-eodhd 9.0.1 and both API images) merged into od v10 as 97d07e1. od v10 c07eddd corrects `.env.example`, a v10-only file: since v9 both API images install openbq-eodhd 9.0.1, so the base image does serve the EODHD routes.
- bdobb release/v9 35a0c54 (re-pair with od 1621ef6) merged as d17fe4a (Y); pairing files kept v10's side, then `pin.sh 10`: od X ed4e6f6 pins d17fe4a; Z 28f2c67 vendors from ed4e6f6 (policy bytes unchanged).
- Gates for this docs/pin-only step: `node --test web/` 65, prepare-source, check-public, compose config (web, table, live) pass. No source changed, so the earlier full gates and the Spark run (on 3049efd) stand.
