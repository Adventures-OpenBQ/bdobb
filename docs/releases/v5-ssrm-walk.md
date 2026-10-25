# v5 SSRM walk

The user's rulings of 2026-10-15 carry the v4 SSRM walk (`docs/releases/v4-ssrm-walk.md` on
`claude/walk-ssrm-v4`) forward to v5 by real merges. On the same day, the user ruled that the web
preview is offered from v4, over HTTP. Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| bdobb v4 | 64b5df8 | help: server-side tables are served, not refused |
| bdobb v4 | b3b4de3 | help and `web/README.md`: the web preview over HTTP at v4 |
| openbq-docker v4 | ca9ba1b | `docs/v4/gateway-down.md`: the preview needs nothing more from v8 |
| openbq-docker v5 | d032ee8 | merge od `claude/walk-ssrm-v4` |
| openbq-docker v5 | 6701d4e | `table-service/source.lock.json` pinned to BDOBB ea43146 (pairing commit X5) |
| bdobb v5 | 497a75c | merge `claude/walk-ssrm-v4` |
| bdobb v5 | 0fbdf8c | group F: managed tables offer the Statement view |
| bdobb v5 | 17d7812 | merge `claude/v5-fiscal-labels-pivot-import` (681ea23, 80c6da6, 7e65c6d) |
| bdobb v5 | ea43146 | test: a managed card imported with dev's `pivotView` opens on Statement (pairing commit Y5) |
| bdobb v5 | 72e4ce8 | policy vendored from 6701d4e, `openbqDocker` = 6701d4e (superseded pairing) |
| bdobb v5 | 83566f7 | a managed statement source is relabelled at ingest (superseded pairing Y) |
| openbq-docker v5 | 9ed33b3 | lock pinned to 83566f7 (superseded) |
| bdobb v5 | 0d0858e | policy vendored from 9ed33b3 (superseded) |
| bdobb v5 | e0f79f7 | local and managed statement rows relabelled at the source, with the as-reported note |
| openbq-docker v5 | 792d803 | lock pinned to e0f79f7 (superseded) |
| bdobb v5 | bccdf59 | policy vendored from 792d803 (superseded) |
| bdobb v5 | 8cb6a32 | ingest tells a statement widget from its backend's widgets.json; the per-widget opt-in goes (pairing commit Y5) |
| openbq-docker v5 | d6b29f2 | `table-service/README.md`: a backend names its base `url` |
| openbq-docker v5 | bb1398c | `table-service/source.lock.json` pinned to 8cb6a32 (pairing commit X5) |
| bdobb v5 | ac57dab | policy vendored from bb1398c, `openbqDocker` = bb1398c (pairing commit Z5) |

Pairing: the lock names 8cb6a32, tree e3204766, which matches `git rev-parse 8cb6a32^{tree}`. The
Dockerfile sha256 is 41c59cdc, unchanged. Between Y5 and Z5 only `package.json` and
`web/policy.vendored.json` change, so the native-path diff is empty. The policy body sha256 is
e6e66ba1 on both sides, the same as v4's.

## Merge resolutions

- v5's Statement view, preset and dashboard-ownership changes are kept, and the walked v4 content
  lands in full. `persistedCard` keeps v5's `statement` and v4's `managedSource`.
  `isWorkerTableProducer` admits managed tables and v5's `statement` view (the v10 form).
- `clearManagedSource` writes through `mutateOwnerOfCard`, because v5 has no `mutateActive`. A store
  test checks that it clears the card on its own, non-active dashboard. A mutation check confirmed
  that the test fails on an active-dashboard write.
- Help: the stack page and `web-preview.md` take v4's text with v5's version numbers.

## Group F (Statement)

`isStatement` and `StatementWorkerView owned=` include `isManagedTable`, and the inline views list
offers Statement on a managed card. `eligibility` keeps `statement`. `tables.md` says Statement uses
the complete managed snapshot. `WidgetCard.test` adds the PR's managed-Statement test and a
views-toggle test.

## Held gap fixes with managed tables

- The `pivotView` import is widget-independent, and a managed card with dev's `pivotView` imports on
  Statement with its folds and its saved source (new test in `appsJson.devPivot.test.ts`).
- Fiscal relabelling: resolved by the user's rulings of 2026-10-15 ("all get relabelled"). There is
  one implementation, `correctStatementRows`, plus the shared year-end lookup.
  - **Backend statement card:** as in 681ea23.
  - **Managed source:** automatic (user ruling 2026-10-15, option A; 8cb6a32). A backend in the
    private `ServerBackendConfig` names its base `url`. When a binding's `period` is a statement
    period value, ingest reads `<url>/widgets.json` with the configured widget's headers, matches the
    widget by its resolved endpoint and applies the client's `isStatementPeriodParam`. A statement
    widget is relabelled from `<url>/api/v1/fundamentals/fiscal_year_end`; any other widget is left
    alone. No `url`, or no widgets.json answer, leaves the rows as reported with the note. The
    per-widget `fiscalYearEndUrl` opt-in (83566f7) is gone. The Rust catalogue is not marked.
    `FISCAL_YEAR_END_PATH` moved to `periods.ts`, because importing `dataClient` or `widgetsJson`
    would bundle the client's data layer and Tauri into the server child.
  - **Local CSV/XLS:** relabelled in the worker, in a per-row mode that reads each row's own
    `fiscal_period`. `importFile` reports the reporters and takes year ends. The store asks the backend
    the card names (`params.fiscalYearEndBackend`, the "FY ends from" select beside the note) and
    re-imports. The year ends ride in the worker client's source, so a rehydrated worker replays them.
  - **Linked tables, Statement, charts and export** read the relabelled input.
  - **As reported:** rows left as reported carry a `FISCAL_AS_REPORTED` input diagnostic, from the local
    parse or the server ingest, and the card shows the existing note from it.
  - **Tests:** one per path, and one parity test over card, managed and local.
- **Ruling 5 (resolved 2026-10-15, option A).** The server tells a statement widget itself from
  its backend's widgets.json (above), so the client says nothing.
- **Decision.** od `settings.example.json` keeps `backend_config: null`. That file is the Rust
  service's settings and only points at the private backend file, so it has no `backends` to carry
  a `url`. The od table-service README (d6b29f2) documents `url` in the backend file instead.
- **Decision (ruling 6).** The as-reported mark is an input diagnostic, not provenance. Provenance
  reaches the client only in export batches; input diagnostics reach the card's view on the JS, wasm
  and native paths.
- The local file is parsed twice when it holds statement rows (first to name the reporters, then to
  relabel). This is marked `ponytail:` in the store.

## Gates (2026-10-15)

| Gate | Result |
|---|---|
| Rust tests, cargo 1.98.1 `--locked` | table-service 33/33 re-run after 8cb6a32 (the ingest child changed; no crate did). Earlier: pivot-core 163, pivot-wire 6, pivot-native 8 (native parity against v5's pivot-core fixtures, Statement included), pivot-native-worker 5, table-service 33 passed, 0 failed |
| Clippy `--all-targets -D warnings` | clean on pivot-wire, pivot-native, pivot-native-worker, table-service and pivot-wasm. **pivot-core fails** with `result_large_err` at `statement/presentation.rs:14`. This predates the walk: pivot-core is byte-identical to release/v5 130e9bd and to PR #56's v10, and CI runs no clippy. Not changed here. |
| Linux-only Rust tests | not run on macOS: the worker's `semantics.rs` (Statement member/witness parity against native), `lifecycle` and protocol suites, and table-service's Linux suites |
| `test:pivot:packaging`, `pivot:build` | pass |
| `table-ingest:typecheck`, `table-ingest:test` | pass, 28/28 after 8cb6a32 (`table-ingest:build` must run before the table-service ingest tests; the built child bundles no Tauri) |
| `consumers.test`, `tableExecution/rust`, Statement renderers | 245/245 |
| `pnpm typecheck`, `pnpm lint` | pass |
| Full `pnpm exec vitest run` | 6902 passed, 7 skipped after 8cb6a32; 6900 after e0f79f7 (6883 before the relabel work). The first run, overlapping cargo builds at load average 75, failed `useFiscalYearEnd.test.tsx` "logs once" (2 log lines, 3 expected). The file passes 3/3 alone and in the second full run. It is a timing flake. |
| `node --test web/*.test.mjs` | 38/38 |
| `test:web:browser` after `build:web` | pass |
| Web relay against od v5's gateway (scratch interop, OpenBB mocked) | catalogue, data route, `/state` PUT and reseed pass; `/api/docs` is refused |
| od `node --test funnel-gateway/*.test.mjs` | 40/40 |
| od `pytest tests`, `check-public.py` | 24 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass (compose run in a scratch copy with the example env files) |
| Browser `ssrm-parity.spec.ts` (fixture) | 2/2 Chromium |
| Browser `ssrm-widget`/`ssrm-resources` (native harness) | not run: they need a Linux root and target, and Docker |
| Production table-service image | not built: the Docker disk is full. Nothing was pruned. |

## Left for later lines

As in the v4 record: v6 gets group G, v8 the gateway's `/news` wire and socket door, and v10 PR #10's
`^`/`%5E` and `subscriptionRoute` hunks and the evidence. Re-pin on every forward merge. The legacy
`package.json` `openbbDocker: v3.0.1` key is now read by nothing.

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | 4fc972f | merge od `claude/walk-ssrm-v4` |
| bdobb | 384c32b | merge `claude/walk-ssrm-v4` |
| bdobb | 0246e62 | the SCOPED `clearManagedSource` revision step (pairing commit Y5) |
| openbq-docker | 3c6e3a0 | lock pinned to 0246e62 (X5) |
| bdobb | e200761 | policy vendored from 3c6e3a0 (Z5) |

Pairing: lock = 0246e62; between 0246e62 and e200761 only `package.json` and `web/policy.vendored.json` change.

- The SCOPED `clearManagedSource` step (PR #56, found missing by the v10 parity check) lands here, where `SCOPED` and `mutateOwnerOfCard` begin. Checked by mutation: with `mutateActive` it fails.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 6903 passed, 7 skipped |
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
| bdobb | 55c6dca | Merge claude/walk-ssrm-v4 (v3.0.0 + the V8-pin fix) into the walked v5 |
| bdobb | d1c10f4 | feat(v5): vendor the gateway policy from openbq-docker 723fe88 and pair with it |
| bdobb | 538f729 | fix(v5): restore package.json version 5.0.0 lost in the v4 catch-up merge |
| bdobb | cdea708 | feat(v5): vendor the gateway policy from openbq-docker 00bfddc and pair with it |
| openbq-docker | 2ebe379 | Merge claude/walk-ssrm-v4 (v3.0.0 + the V8-pin re-pair) into the walked v5 |
| openbq-docker | 723fe88 | feat(v5): pin the table service source to BDOBB v5 55c6dca |
| openbq-docker | 00bfddc | feat(v5): pin the table service source to BDOBB v5 538f729 |

Pairing: od `table-service/source.lock.json` names bdobb 538f729, and the last bdobb commit vendors the policy from od HEAD and sets `openbqDocker` to it.

- **Version fix (found by this cascade's vitest: 2 failures).** Merge 55c6dca resolved the `openbqDocker` conflict by taking v4's whole `package.json`, so the version read 4.0.0 and `version.test.ts` failed twice. 538f729 restores v5's file; it carries up by merge. Not environmental: the test reads the files.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 6913 passed, 7 skipped (6920) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build (fresh), `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 28 passed |
| `node --test web/*.test.mjs` | 41 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| od `node --test funnel-gateway/` | 62 passed, 0 failed |
| od `pytest tests`, `check-public.py` | 27 passed, 12 subtests passed, pass |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass, pass |
| Spark Linux tests | not run: they run after v4's final freeze |
