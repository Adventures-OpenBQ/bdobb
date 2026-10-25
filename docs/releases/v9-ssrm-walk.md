# v9 SSRM walk

The user's rulings of 2026-10-15 carry the v8 SSRM walk (`docs/releases/v8-ssrm-walk.md`) forward to
v9 by real merges, in both repositories, and bring in the held v9 gap fix `claude/v9-rita-aggregation-hint`
(V9-P2). Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| openbq-docker v9 | fe14f63 | merge od `claude/walk-ssrm-v8` (clean) |
| bdobb v9 | 431754e | merge `claude/walk-ssrm-v8` |
| bdobb v9 | 4a20424 | merge `claude/v9-rita-aggregation-hint` (4e7ec5f, 23d151f, 5662f21, ee83688; clean) |
| bdobb v9 | e2a5275 | managed backend sources carry the provider aggregation hint (pairing commit Y9) |
| openbq-docker v9 | 1c74875 | `table-service/source.lock.json` pinned to e2a5275 (pairing commit X9) |
| bdobb v9 | 718ae2b | policy vendored from 1c74875, `openbqDocker` = 1c74875 (pairing commit Z9) |
| openbq-docker v9 | 5421a90 | table-service README names the aggregation hint ingest carries (docs only; the lock is unchanged) |

Pairing: the lock names e2a5275 (tree aaf5a266). The Dockerfile hash is unchanged (41c59cdc). Between
Y9 and Z9 only `package.json`, `web/policy.mjs` and `web/policy.vendored.json` change. The policy body's
sha256 is a5d50619, the same as v8's: od v9 changes no gateway route. The native crates are identical to v8's.

## Merge resolutions (431754e)

- `dashboardStore.test.ts`: v9's calendar test and the walk's managed-source reopen test are both kept.
- Help: the stack page keeps v9's openbq-eodhd pairing sentence with the walked v4-gateway wording;
  `web-preview.md` names v9.0.0's gateway as the same door as v8.0.0's.
- `package.json` `version`: the merge took v8's 8.0.0, as at v8. It was corrected to 9.0.0 in the merge.
- `openbqDocker` and the vendored policy took the walk's side and were re-pinned in Z9.

## The aggregation hint on managed tables (e2a5275)

Since v6 (group G) Rita's table-model tools also take managed server tables. The hint branch carried the
hint only through `backendTableSource` (the client's backend table and the linked tables it feeds).
Without the hint, a managed source's columns could not satisfy "Rita reads the hint" on every table she
arranges, so the hint is now carried for managed sources too:

- Ingest already read the backend's `widgets.json` (statement detection). It now reads it for every
  binding of a backend that has a base `url`, finds the entry by endpoint as before, and puts each
  declared column's valid `data.table.columnsDefs[].aggregation` on `metadata.aggregationHint`.
- `toAggregationHint` moves to the Tauri-free `src/lib/aggregationHint.ts`, so the server child validates
  a hint by the client's rule. The built child bundles no Tauri.
- Uploads have no provider, so they have no hint. A `response.kind: "dataset"` backend controls its own metadata.
- **Changed assertion (warning):** `backend.test.ts` asserted that a non-statement binding never fetches
  `widgets.json`. Now it does, for the hints. The test still asserts that no year end is fetched and no
  note is given.
- Tests: `backend.test.ts` checks that ingest carries a valid hint, drops a malformed one, and leaves the
  columns as declared without `url` or `widgets.json`. `hintManaged.test.ts` runs a managed card over the
  real Rust runtime with the hinted column, with no view mocking. `describe_table` reports the hint
  (`source_kind: managed-native`), and `arrange_table` fills in `last` on a quarterly arrangement (90, not
  120). It leaves an omitted operator alone off the rule, and keeps a named `sum` with the warning.
- Help: `tables.md` and the Rita topic say a managed server table read from a backend widget keeps the
  hint; the ingest README and `OPEN-QUESTIONS.md` V9-P2 record it.

## Gates (2026-10-15)

| Gate | Result |
|---|---|
| Rust | crates identical to v8's (empty diff); table-service 33/33 re-run, cargo 1.98.1 `--locked`, shared target. Clippy unchanged from v8 |
| Pivot wasm | built fresh on v9 with wasm-bindgen 0.2.128; `--verify` passes |
| `test:pivot:packaging` | pass |
| `table-ingest` typecheck, test, build | pass, 29/29 |
| `pnpm typecheck`, `pnpm lint` | pass |
| Full `pnpm exec vitest run` | 8194 passed, 30 skipped |
| `node --test web/*.test.mjs` | 47/47 |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| od `node --test funnel-gateway/*.test.mjs` | 55/55 (Node 26.10.0) |
| od `pytest tests`, `check-public.py` | 27 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass (compose run in a scratch export with the example env files) |
| Linux-only Rust tests, browser `ssrm-widget`/`ssrm-resources`, production image, live Rita | not run |

## Open

- Since v6 the guide's `tables.md` Rita paragraph, `rita-ai-agent-setup.md` and the Rita topic still say
  the tools work on "CSV/XLS and linked tables". Group G changed only `topics/tables.md`. The fix belongs
  at v6, carried forward.

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | 62be113 | merge od `claude/walk-ssrm-v8` |
| bdobb | f25a7ba | merge `claude/walk-ssrm-v8` (pairing commit Y9) |
| openbq-docker | 407eb10 | lock pinned to f25a7ba (X9) |
| bdobb | c2fd33a | policy vendored from 407eb10 (Z9) |

Pairing: lock = f25a7ba; between f25a7ba and c2fd33a only `package.json` and `web/policy.vendored.json` change.

- Rita help: v9's aggregation-hint wording and the managed server / LIVE wording both stand.
- Demo keys: od v9 adds EODHD's demo token, so the stack and Example Dashboards pages name EIA, Congress.gov and EODHD, still loaded before `credentials.env`.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 8196 passed, 30 skipped |
| `pnpm typecheck`, `pnpm lint`, `pnpm scrub` | pass |
| Pivot wasm build (fresh) and `--verify`, `test:pivot:packaging` | pass |
| `table-ingest` typecheck, test | pass, 29/29 |
| `node --test web/*.test.mjs` | 47/47 |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| `test:web:browser` after `build:web` | pass |
| od `node --test funnel-gateway/` | 57/57 (Node 26.10.0) |
| od `pytest tests`, `check-public.py` | 27 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass |
| Rust crate tests | not re-run: no Rust changed in this cascade (the wasm build compiles pivot-wasm) |

## v3.0.0 cascade (2026-10-15)

v3.0.0 (bdobb 9e94bc1, od cad5cc9) and the V8-pin fix 94aee52 are carried from v4 (d057cdf / od 466a8e5) by real merges, then the lines are re-paired. Nothing was pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | c982a7d | Merge claude/walk-ssrm-v8 (v3.0.0 + the V8-pin fix) into the walked v9 |
| bdobb | c9e36bc | feat(v9): vendor the gateway policy from openbq-docker 8b3ed70 and pair with it |
| openbq-docker | 5460be9 | Merge claude/walk-ssrm-v8 (v3.0.0 + the V8-pin fix) into the walked v9 |
| openbq-docker | 8b3ed70 | feat(v9): pin the table service source to BDOBB v9 c982a7d |

Pairing: od `table-service/source.lock.json` names bdobb c982a7d, and the last bdobb commit vendors the policy from od HEAD and sets `openbqDocker` to it.

- `web/README.md` keeps v9's text with v3's `/ref` family and `/ref/live_grid_ws` target. Everything else merged cleanly.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 8198 passed, 30 skipped (8228) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build (fresh), `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 29 passed |
| `node --test web/*.test.mjs` | 50 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| `test:web:browser` after `build:web` | pass |
| od `node --test funnel-gateway/` | 78 passed, 0 failed |
| od `pytest tests`, `check-public.py` | 30 passed, 14 subtests passed, pass |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass, pass |
| Spark Linux tests | not run: they run after v4's final freeze |

## v5.0.0 carry (2026-10-16)

Walk v8's carry of v5.0.0 (through walk v6 193b615 and walk v7) is merged into v9, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 89b0a19 | Merge walk v8 (pairing commit Y9) |
| bdobb | 4cf915b | policy vendored from f7d13de, `openbqDocker` = f7d13de (pairing commit Z9) |
| openbq-docker | b340d5e | Merge walk v8 |
| openbq-docker | f7d13de | lock pinned to 89b0a19 (X9) |

Between Y9 and Z9 only `package.json`, `web/policy.mjs` and `web/policy.vendored.json` change.

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v9's side (version 9.0.0), then re-pinned; the lock takes v4.0.0's Dockerfile hash (b5a8cd1a), which `prepare-source.mjs` checks.
- `table-ingest/backend.ts` (V9-P2): the single widgets.json read gives both the statement test and the aggregation hints, with v5's bounded year-end lookups (64 symbols) and v5's "as reported only for statement-like rows" rule for an untellable source. `backend.test.ts`: both sides' tests.
- `docs/examples/v9.0.0-calendars`: description within v5's 400 characters, keeping "BDOBB 9.0.0 or later".
- Help: cron "is not supported"; key-maint cited at `v7.0.0`.
- od: overlay and key-maint 9.0.0. The gateway stays `openbq-funnel-gateway:8.0.0`: its source is byte-identical to v8's, and the v9.0.0 tag ships 8.0.0 (decision taken in the walk; see the open item).
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, sockets `/ref/live_grid_ws` and `/news/ws/news`, the desktop Origin rule, the V9-P2 hint fill-in.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8261 passed, 30 skipped (8291) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 31 passed, 16 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |
| Linux (Spark, `run.sh v9`, source 4cf915b, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

**Open item.** The gateway image tag at v9: kept at 8.0.0 (above). If v9 should build its gateway as `openbq-funnel-gateway:9.0.0`, that needs a ruling.

## v6.0.0 carry (2026-10-16)

Walk v8's carry of the frozen v6.0.0 (bdobb ceacb4d, od 6685c87) and bdobb ad5e139 (`claude/v6-regression-20261016`, for the final v6.0.0 re-cut), through walks v7 and v8, is merged into v9 in both repositories, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 2f107fa | Merge walk v8 (v6.0.0) |
| bdobb | 8173628 | Merge walk v8 (ad5e139, v8's docked-card push-down) (pairing commit Y9) |
| bdobb | ed52cd5 | policy vendored from f62af5b, `openbqDocker` = f62af5b (pairing commit Z9) |
| bdobb | ae0b9e4 | Merge walk v8's ledgers |
| openbq-docker | 17c08c4 | Merge walk v8 (Rita and MCP overlay) |
| openbq-docker | fdb8b2d | Merge walk v8 (re-pin) |
| openbq-docker | f62af5b | lock pinned to 8173628 (X9) |

c8ec7b2 / b8054da are an earlier pairing (before ad5e139), superseded. Between Y9 and Z9 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged (sha256 85cf23a3).

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v9's side (version 9.0.0), then re-paired.
- Code merged cleanly: v8's `cardAndDef` union; ad5e139 with v8's docked-card push-down (v9's `move_widget` and `StatusTrail` equal v8's).
- Help: v9's text with v6.0.0's Run/Deny, Stop and row-send wording; the Rita/MCP overlay cited at openbq-docker `v9.0.0` (with rss-ticker on 8088 for `serve-v6.json`).
- od: the overlay with v8's reconciliation; v9's serve configs and tailscale service equal v8's. Rita and MCP keep the 6.0.0 digests; key-maint 9.0.0. The gateway stays `openbq-funnel-gateway:8.0.0` (open item from the v5.0.0 carry).
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, sockets `/ref/live_grid_ws` and `/news/ws/news`, the desktop Origin rule, web preview over HTTP, the V9-P2 hint fill-in.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8295 passed, 30 skipped (8325) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 33 passed, 18 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet`; with the v3 + v6 overlays | pass, pass; pass |
| Linux (Spark, `run.sh v9`, source ed52cd5, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v7.0.0 carry (2026-10-16)

Walk v8's carry of the frozen v7.0.0 (bdobb 96670d6, od ebafc5c) is merged into v9 in both repositories, then the lines are re-paired. See `v8-ssrm-walk.md`, "v7.0.0 carry", for what v7.0.0 brings. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 5949963 | Merge walk v8 (v7.0.0) (pairing commit Y9) |
| bdobb | 880780b | policy vendored from b36f8c5, `openbqDocker` = b36f8c5 (pairing commit Z9) |
| openbq-docker | c4ccabe | Merge walk v8 (od v7.0.0, re-pin) |
| openbq-docker | b36f8c5 | lock pinned to 5949963 (X9) |

Re-paired because the od head changed. No native path changed. Between Y9 and Z9 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged.

**Merge resolutions**
- Only the pairing files conflicted (`package.json`, `web/policy.vendored.json`, od `source.lock.json`): v9's side (version 9.0.0), then re-paired. The code, the Help and the touch example merged cleanly with v8's resolutions.

**Line checks**
- `envPrefix` is `["VITE_", "TAURI_ENV_"]`; `screenFit.ts`, `vite.config.ts` and `envPrefix.test.ts` equal v7.0.0's.
- Monitor calls: only `screenFit.ts`, all behind `nativeMonitors()`. `TAURI_ENV_PLATFORM` branches: v7.0.0's own; v9 adds none.
- Help: no "…behind a chevron" label remains.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8312 passed, 30 skipped (8342) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 33 passed, 18 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |
| Linux (Spark, `run.sh v9`, source 880780b, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v8.0.0 carry (2026-10-16)

The frozen v8.0.0 (bdobb ef1797a, od 238daee) is merged into v9 in both repositories, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 9a59665 | Merge v8.0.0 (ef1797a) |
| bdobb | 8e7fca1 | docs: the release notes name the `openbqDocker` pin (pairing commit Y9) |
| bdobb | 08a48f1 | policy vendored from eb3ec2d, `openbqDocker` = eb3ec2d (pairing commit Z9) |
| openbq-docker | 729680a | Merge v8.0.0 (238daee): patch 004 PUT race fix, pinned example wording, receipt |
| openbq-docker | eb3ec2d | lock pinned to 8e7fca1 (X9) |

v8.0.0 brings: News seeds 4 at a time and `foregroundMinHiddenMs` (60 s in the web build, 0 native); `resolveDocksImport` refuses while the editor is open or in viewer mode, and band heights are clamped; `pin_card` in `CARD_TOOLS`, its Undo restores the displaced card, and `move_widget` on a docked card touches only its own slot; `takeDocks` ignores an older 409 record and re-uploads once; `.tab-bar-tabs { min-width: 0; overflow-x: auto }`; the rail Help lists Apps once; the Connections export ruling. Re-paired because the od head changed. No native path changed; the policy bytes are unchanged (sha256 810f9547).

**Merge resolutions**
- `OPEN-QUESTIONS.md`: Open says "None."; v9's Provisional and Resolved entries are kept; the Connections entry is v7's 92a4569 wording, once (v9's older "closed on v8 2026-10-14" duplicate removed).
- `web/README.md`: v9.0.0 with v8.0.0's commit-pin wording.
- Pairing files (`package.json`, `web/policy.vendored.json`): v9's side, then re-paired.
- Auto-merged and checked: `localTools.ts` equals v8.0.0 apart from v9's aggregation-hint text (b9293e4 already builds on our f9600f7; both tests kept); `useNewsWire.ts`, `useReconnectingSocket.ts`, `TabBar.tsx` and `styles.css` equal v8.0.0; the rail renders Apps once and the Help lists it once.
- 8e7fca1: v9's release notes said `openbbDocker` pins openbq-docker `cab61a9`; they now name the `openbqDocker` pin, as v8.0.0's 1adca2e does for v8.

**Ancestry hole, pending the v8 re-cut.** bdobb `v7.0.0` / `release/v7` now point at 92a4569 (the Connections ruling, child of 96670d6), which v8.0.0 does not contain. The content is identical (v8.0.0's e11d737 carries the same `OPEN-QUESTIONS.md`). The v8 owner is re-cutting v8.0.0 with v7.0.0 merged; the coordinator merges the re-cut in. 92a4569 is not merged here.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8322 passed, 30 skipped (8352) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 31 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 33 passed, 18 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |
| Linux (Spark, `run.sh v9`, source 08a48f1, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |
