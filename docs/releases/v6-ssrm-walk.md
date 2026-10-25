# v6 SSRM walk

The user's rulings of 2026-10-15 carry the v5 SSRM walk (`docs/releases/v5-ssrm-walk.md`) forward to
v6 by real merges. They add group G (Rita's table-model tools on managed tables) and dev 191610b01
(Rita reads the corrected statement rows). Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| openbq-docker v6 | ce249ef | merge od `claude/walk-ssrm-v5` |
| openbq-docker v6 | 0b19e18 | merge od `claude/walk-ssrm-v5` again (the v5 re-pin) |
| openbq-docker v6 | 354bb63 | lock pinned to 32dc636 (superseded) |
| openbq-docker v6 | e989ca5 | merge od `claude/walk-ssrm-v5` (backend base `url` docs, v5 re-pin) |
| openbq-docker v6 | 67b6b2f | `table-service/source.lock.json` pinned to ec341c6 (pairing commit X6) |
| bdobb v6 | 360a16b | merge `claude/walk-ssrm-v5` |
| bdobb v6 | 43e1b8a | group G: Rita's table-model tools take managed server tables |
| bdobb v6 | a91b92f | merge `claude/walk-ssrm-v5` again (source-level fiscal relabel, v5 re-pin) |
| bdobb v6 | 32dc636 | Rita reads the corrected statement rows |
| bdobb v6 | 71336e7 | policy vendored from 354bb63 (superseded) |
| bdobb v6 | 1708b3f | merge `claude/walk-ssrm-v5` (automatic managed statement relabelling, v5 re-pin) |
| bdobb v6 | ec341c6 | merge `claude/walk-ssrm-v5` (v5 ledger) (pairing commit Y6) |
| bdobb v6 | c2ed837 | policy vendored from 67b6b2f, `openbqDocker` = 67b6b2f (pairing commit Z6) |

Pairing: the lock names ec341c6. The pinned conflicts in the merges (`source.lock.json`, `package.json`, `web/policy.vendored.json`) kept v6's side and were then re-pinned. Between Y6 and Z6 only `package.json`,
`web/policy.mjs` (its header names v6.0.0) and `web/policy.vendored.json` change. The policy body
sha256 is e6e66ba1, the same as v4's and v5's. The native crates are byte-identical to v5's.

## Merge resolutions (360a16b)

- WidgetCard keeps v6's `availableViews` call, and the managed-table Statement predicate moves into
  `cardViews.ts` in the PR's form (`availableViews` and `possibleViews`).
- `runAppsImport` and `appsJson` keep v6's MCP servers and v5's dropped-import issues together.
- Help: `web-preview.md` and the stack page take the walked text with v6's numbers. The Rita row
  of `about-this-guide.md` stays.
- `openbqDocker` takes the walk's paired commit, as v5 did, and is re-pinned in Z6.

## Group G (43e1b8a)

This follows PR #56 (1382c316).
- `resolveTableTarget` treats a managed table as a worker target, because it is server-executed.
- A standard LIVE table answers `server-execution-pending` with the PR's wording. A backend table
  still answers `server-execution-pending` at v6.
- `describe_table` reports `source_kind: managed-native`, and the revision witness covers the
  managed source.
- Help: the Rita sentence in `tables.md`, which keeps v6's backend-table sentence.
- The agent half of `e2e/ssrm-parity.spec.ts`.

## Fiscal relabel at v6

- The v5 rulings carry in by merge: card, managed ingest, local worker, linked tables, export and
  the as-reported note. Managed ingest tells a statement widget from its backend's widgets.json
  (option A, see the v5 record), with no per-widget opt-in.
- Dev 191610b01 (32dc636): Rita's widget fetch runs a statement widget's rows through
  `correctStatementData`, beside the shared year-end lookup.
- Rita's `describe_table` and `arrange_table` read the worker's relabelled input, so they need no
  change. Three ported tests in `execute.test.ts` failed before the change.

## Gates (2026-10-15)

| Gate | Result |
|---|---|
| Rust tests, cargo 1.98.1 `--locked`, shared target | table-service 33/33 re-run after the carry (no crate changed). Earlier: pivot-core 163, pivot-wire 6, pivot-native 8, pivot-native-worker 5, table-service 33 passed, 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, which is unchanged from v5 (see the v5 record) |
| Pivot wasm | rebuilt fresh on v6 with wasm-bindgen 0.2.128 (`PIVOT_WASM_BINDGEN`); `--verify` passes |
| `test:pivot:packaging` | pass |
| `table-ingest` typecheck and test | pass, 28/28 |
| `pnpm typecheck`, `pnpm lint` | pass |
| Full `pnpm exec vitest run` | 7796 passed, 29 skipped |
| `node --test web/*.test.mjs` | 38/38 |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts`, fixture and agent halves | 2/2 Chromium |
| od `node --test funnel-gateway/*.test.mjs` | 40/40 |
| od `pytest tests`, `check-public.py` | 24 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass (compose run in a scratch export with the example env files) |
| Live Rita gate | not run: no live model here |
| Browser `ssrm-widget`/`ssrm-resources`, production image | not run: they need Linux and Docker, and the Docker disk is full |

## Ruling 5

Resolved on 2026-10-15 (option A): see the v5 record. Nothing is open from it.

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | f9927a5 | merge od `claude/walk-ssrm-v5` |
| bdobb | 278229f | merge `claude/walk-ssrm-v5` |
| bdobb | 6340d4a | Rita help: managed server tables, the LIVE refusal (pairing commit Y6) |
| openbq-docker | dc963f5 | lock pinned to 6340d4a (X6) |
| bdobb | 2cd2f4b | policy vendored from dc963f5 (Z6) |

Pairing: lock = 6340d4a; between 6340d4a and 2cd2f4b only `package.json` and `web/policy.vendored.json` change.

- Rita help: the guide's tables, setup, chat, troubleshooting and about pages and the Rita topic now name managed server tables (server execution, since v6) and say a standard OpenBB SSRM (LIVE) table still answers `server-execution-pending`. A guide test pins both and refuses the old "CSV/XLS and linked tables" wording. This closes the v9 record's open item.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 7798 passed, 29 skipped |
| `pnpm typecheck`, `pnpm lint`, `pnpm scrub` | pass |
| Pivot wasm build (fresh) and `--verify`, `test:pivot:packaging` | pass |
| `table-ingest` typecheck, test | pass, 28/28 |
| `node --test web/*.test.mjs` | 38/38 |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| od `node --test funnel-gateway/` | 42/42 (Node 26.10.0) |
| od `pytest tests`, `check-public.py` | 24 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass |
| Rust crate tests | not re-run: no Rust changed in this cascade (the wasm build compiles pivot-wasm) |

## v3.0.0 cascade (2026-10-15)

v3.0.0 (bdobb 9e94bc1, od cad5cc9) and the V8-pin fix 94aee52 are carried from v4 (d057cdf / od 466a8e5) by real merges, then the lines are re-paired. Nothing was pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | aca62ea | Merge claude/walk-ssrm-v5 (v3.0.0 + the V8-pin fix) into the walked v6 |
| bdobb | e6502f7 | feat(v6): vendor the gateway policy from openbq-docker 30694a6 and pair with it |
| bdobb | b0ea56c | Merge claude/walk-ssrm-v5 (the v5 version fix) into the walked v6 |
| bdobb | 1de22c0 | feat(v6): vendor the gateway policy from openbq-docker 6064e2f and pair with it |
| openbq-docker | e24037d | Merge claude/walk-ssrm-v5 (v3.0.0 + the V8-pin re-pair) into the walked v6 |
| openbq-docker | 30694a6 | feat(v6): pin the table service source to BDOBB v6 aca62ea |
| openbq-docker | ee95d67 | Merge claude/walk-ssrm-v5 (version fix re-pair) into the walked v6 |
| openbq-docker | 6064e2f | feat(v6): pin the table service source to BDOBB v6 b0ea56c |

Pairing: od `table-service/source.lock.json` names bdobb b0ea56c, and the last bdobb commit vendors the policy from od HEAD and sets `openbqDocker` to it.

- **Version fix.** Merge aca62ea took v4's whole `package.json` too: the version read 4.0.0 (3 `version.test.ts` failures) and the `capabilities` and `test:live` scripts were gone. The merge of v5's fix (b0ea56c) restores v6's own file.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 7808 passed, 29 skipped (7837) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build (fresh), `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 28 passed |
| `node --test web/*.test.mjs` | 41 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| od `node --test funnel-gateway/` | 62 passed, 0 failed |
| od `pytest tests`, `check-public.py` | 27 passed, 12 subtests passed, pass |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass, pass |
| Spark Linux tests | not run: they run after v4's final freeze |

## v5.0.0 carry (2026-10-16)

The frozen v5.0.0 (bdobb 86b55d4, od 9c82dc6) is carried into v6 by real merges, then the lines are re-paired. v5.0.0 is the walk's v5 plus v4.0.0 (ec04852 / od 3f57fc8) and the v5 review fixes. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | edbf762 | Merge release/v5 (v5.0.0 86b55d4) into the walked v6 |
| bdobb | 07aa107 | test: Rita reads v5's yfinance and multi-company statement relabels |
| bdobb | 4154c8b | fix: the table-ingest typecheck reads the app's Vite env typings (pairing commit Y6) |
| bdobb | 65d6055 | policy vendored from af8b3e9, `openbqDocker` = af8b3e9 (pairing commit Z6) |
| openbq-docker | da54167 | Merge openbq-docker v5.0.0 (9c82dc6) into the walked v6 |
| openbq-docker | 7784925 | fix: the table-service lock carries v4.0.0's Dockerfile hash |
| openbq-docker | af8b3e9 | lock pinned to 4154c8b (X6) |

0194b75 and dafa78a are an earlier pairing, superseded by the two fixes. Pairing: the lock names 4154c8b. Between Y6 and Z6 only `package.json` and `web/policy.vendored.json` change. The gateway policy body is unchanged (sha256 85cf23a3).

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v6's side, then re-pinned. v5 changed only the `openbqDocker` pin in `package.json`, so v6 keeps its scripts and version 6.0.0.
- `LocalTableRenderer`: v4's "Report model off" footer reads `definition.table.pivot` and the inspection's input column ids directly. v6's 74d7268 had moved the old `config`/`inputColumns` locals into `draftModelFor`.
- `runAppsImport`: v5's singular/plural notice plus v6's MCP-server import. `tableCommitCoordinator`: v6's `peek` and v5's `subscribe`. `appsJson.examples.test` and `providerKeys.test`: both sides' tests.
- Help: v6's text with v5's edits applied. `claude/v6-key-maint` citations now name openbq-docker `v6.0.0`, which ships `key-maint/README.md`, `serve-v3-keys.json` and `docker-compose.v3.yml`. The topics Statement page gains v5's yfinance, unreadable-date and multi-company sentences beside v6's Rita sentence.
- v5 rules meeting v6 content: the rail-drop test passes `onOpenAI`; the LeftRail and DropZone notices read "1 dashboard"; the v6.0.0 Rita example's description fits the 400-character limit (od `examples/bdobb/apps.json` re-synced with `EPISODE=6`).
- od: the overlay and key-maint are 6.0.0 on this line (v5 set 5.0.0; v6 still had 3.0.0), as `test_images.py` now requires. The gateway stays at 4.0.0.
- Rules in force are checked unchanged: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB manifest cap, prune `until < now()`, the `/ref/live_grid_ws` socket door, the desktop Origin rule.

**Rita and the fiscal fixes.** Rita's `get_widget_data` runs through the card's relabel (`correctStatementData`, v6 32dc636), so v5's `date` relabel and per-company year ends reach it with no code change. 07aa107 pins both. Statement detection in `cardViews` uses the union of row keys, so v5's per-symbol widening does not change it.

**Two failures fixed at v6, where the lines meet**
- `table-ingest:typecheck`: v4's 230794a makes the remote transport import `dataClient`, which reaches `settingsFile.ts`, whose v6 Rita/MCP seeds read `import.meta.env`. The fix includes `src/vite-env.d.ts`. It is type-only: the ingest bundle is unchanged.
- od `prepare-source.mjs`: the merge kept v6's lock, whose `dockerfileSha256` predated v4.0.0's 740e23c Dockerfile.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 7866 passed, 29 skipped (7895). A single-fork run had 8 failures from state leaking between files; those 7 files pass in isolation (158/158) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build (fresh) and `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 30 passed |
| `node --test web/*.test.mjs` | 46 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36, pivot-wasm 0; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 68 passed, 0 failed |
| od `pytest tests` (incl. `test_images.py`), `check-public.py` | 28 passed, 14 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |

**Linux (Spark, `run.sh v6`, source 65d6055)**

| Crate | Result |
|---|---|
| pivot-core | 164 passed |
| pivot-wire | 7 passed |
| pivot-native | 8/8 |
| pivot-native-worker | 18 passed |
| table-service | 75 passed, 0 failed with one test skipped. `export_delete_succeeds_while_principal_compute_admission_is_full` hangs |

- **Open, not ours.** The hanging test is v4.0.0's (7d3c599), and the crates are byte-identical to v5.0.0, so it belongs to the v4/v5 lines and is not fixed here. The test is `#[tokio::test]` (current-thread). Unverified lead: its armed observer blocks on a std `Condvar` while the test task awaits `entered.notified()`, a deadlock if the observer runs on the runtime thread. The Mac does not run these Linux-only export tests (0 there).
- The first ship to the Spark carried macOS AppleDouble `._*` files. They made the two `all_frozen_native_session_consumers` tests fail with invalid UTF-8. The re-ship streams `git archive` directly and has none.

**Open item (v6 Help).** Five guide pages still cite openbq-docker's `claude/v6-rita-mcp` branch for the Episode 6 Rita/MCP overlay (`docker-compose.v6.yml`, `serve-v6*.json`, `rita.env.example`). No od ref here, including the v6.0.0 tag and `release/v6`, contains those files, so no release can be cited in their place. This needs a ruling.
