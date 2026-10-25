# v7 SSRM walk

The user's rulings of 2026-10-15 carry the v6 SSRM walk (`docs/releases/v6-ssrm-walk.md`) forward to
v7, the iPad line, by real merges. Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| openbq-docker v7 | 0083f21 | merge od `claude/walk-ssrm-v6` |
| openbq-docker v7 | a1e0c4f | lock pinned to a01b26a (superseded) |
| bdobb v7 | a01b26a | merge `claude/walk-ssrm-v6` |
| bdobb v7 | 4783c19 | policy vendored from a1e0c4f (superseded) |
| openbq-docker v7 | 8e74f54 | merge od `claude/walk-ssrm-v6` (backend base `url` docs, v6 re-pin) |
| bdobb v7 | e9d92f5 | merge `claude/walk-ssrm-v6` (automatic managed statement relabelling, v6 re-pin) (pairing commit Y7) |
| openbq-docker v7 | 6d1ff2e | `table-service/source.lock.json` pinned to e9d92f5 (pairing commit X7) |
| bdobb v7 | 340a588 | policy vendored from 6d1ff2e, `openbqDocker` = 6d1ff2e (pairing commit Z7) |

Pairing: the lock names e9d92f5. The pinned conflicts in the merges kept v7's side and were then re-pinned. Between Y7 and Z7 only `package.json`,
`web/policy.mjs` (its header names v7.0.0) and `web/policy.vendored.json` change. The policy body
sha256 is e6e66ba1, unchanged. The Dockerfile hash is unchanged (41c59cdc). The native crates are
byte-identical to v5's and v6's.

## Merge resolutions (a01b26a)

- **WidgetCard export.** It keeps v7's iPad order: rows are gathered before the save picker, through
  `saveTextFile` and `saveBinaryFile`. The rows are gathered with the walk's `collectPresentedExport`
  in place of v7's inline loop.
- **Help.** `web-preview.md` and the stack page take the walked text with v7's numbers.
- **`openbqDocker`.** It takes the walk's paired commit and is re-pinned in Z7.

## Gates (2026-10-15)

| Gate | Result |
|---|---|
| Rust tests, cargo 1.98.1 `--locked`, shared target | table-service 33/33 re-run after the carry (no crate changed). Earlier: pivot-core 163, pivot-wire 6, pivot-native 8, pivot-native-worker 5, table-service 33 passed, 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, which is unchanged from v5 |
| Pivot wasm | rebuilt fresh on v7 with wasm-bindgen 0.2.128 (`PIVOT_WASM_BINDGEN`); `--verify` passes |
| `test:pivot:packaging` | pass |
| `table-ingest` typecheck and test | pass, 28/28 |
| `pnpm typecheck`, `pnpm lint` | pass |
| Full `pnpm exec vitest run` | 7875 passed, 29 skipped |
| `node --test web/*.test.mjs` | 38/38 |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts`, fixture and agent halves | 2/2 Chromium |
| od `node --test funnel-gateway/*.test.mjs` | 40/40 |
| od `pytest tests`, `check-public.py` | 24 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass (compose run in a scratch export with the example env files) |
| `pnpm ios:check` | toolchain complete: Xcode 27.0, simulator runtime, CocoaPods, Rust iOS targets, llvm-objcopy |
| iPad simulator smoke | not run, for two reasons: the build would need several GB of space the volume does not have (see below), and the tool cannot drive the simulator on Xcode 27 |

## iPad

- **Why no simulator smoke.**
  - `ios:sim` needs `ios:init`, then a Tauri iOS build: the app's whole Rust tree for the simulator
    target, plus Xcode DerivedData. That is several GB, and the host volume is at 99% (26 GB free).
  - The Episode 7 iPad port recorded that simulator input through the tool is dead under Xcode 27, so
    a smoke could launch the app but not drive the SSRM card.
- **Physical iPad acceptance (the user's).** Against a stack with the `web` and `table` profiles up:
  1. **Settings → Connections:** add the gateway URL with its token; managed tables appear.
  2. **Upload:** upload a CSV/XLS to a managed table; it opens and pages.
  3. **Apply:** apply a Pivot model; the result applies.
  4. **Lazy groups:** expanding a group fetches its children on demand.
  5. **Statement:** switch a managed table to the Statement view.
  6. **Linked tables:** create a linked table and a linked chart from it; selection flows to both.
  7. **Export:** CSV, JSON and XLSX each reach the save picker with every presented row.
  8. **Reopen:** close and reopen the dashboard; the card reopens on its saved source.
  9. **Fiscal labels (rulings of 2026-10-15):**
     - A local statement CSV shows *Fiscal labels as reported* with **FY ends from**.
     - Choosing a backend relabels it (for example, WMT quarters read `FQ… / FY…`).
     - A managed statement source whose year end is unknown shows the note.

## Ruling 5

Resolved on 2026-10-15 (option A): managed ingest tells a statement widget from its backend's
widgets.json, with no per-widget opt-in. See the v5 record.

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | 0361075 | merge od `claude/walk-ssrm-v6` |
| bdobb | 77949fb | merge `claude/walk-ssrm-v6` (pairing commit Y7) |
| openbq-docker | d20a507 | lock pinned to 77949fb (X7) |
| bdobb | 5a1c6ad | policy vendored from d20a507 (Z7) |

Pairing: lock = 77949fb; between 77949fb and 5a1c6ad only `package.json` and `web/policy.vendored.json` change.

- Docs-and-tests carry only. The v7 iPad's managed tables no longer depend on V10-P1: od's desktop Origin rule now admits the packaged webview origins on `/table` from v4. Still untested on a device.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 7877 passed, 29 skipped |
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
| bdobb | 6de8a2b | Merge claude/walk-ssrm-v6 (v3.0.0 + the V8-pin fix) into the walked v7 |
| bdobb | 9d78c0b | feat(v7): vendor the gateway policy from openbq-docker 7b2ba15 and pair with it |
| bdobb | 771db86 | Merge claude/walk-ssrm-v6 (the v5 version fix) into the walked v7 |
| bdobb | adbd7d0 | feat(v7): vendor the gateway policy from openbq-docker 0fb32dd and pair with it |
| openbq-docker | 757e2bf | Merge claude/walk-ssrm-v6 (v3.0.0 + the V8-pin re-pair) into the walked v7 |
| openbq-docker | 7b2ba15 | feat(v7): pin the table service source to BDOBB v7 6de8a2b |
| openbq-docker | d39f0e1 | Merge claude/walk-ssrm-v6 (version fix re-pair) into the walked v7 |
| openbq-docker | 0fb32dd | feat(v7): pin the table service source to BDOBB v7 771db86 |

Pairing: od `table-service/source.lock.json` names bdobb 771db86, and the last bdobb commit vendors the policy from od HEAD and sets `openbqDocker` to it.

- **Version fix.** Merge 6de8a2b had the same `package.json` loss: version 4.0.0 and the `capabilities`, `ios:*` and `test:live` scripts. The merge of the fix (771db86) restores v7's own file.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 7887 passed, 29 skipped (7916) |
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

Walk v6 (bdobb dd00aa2, od af8b3e9), which carries v5.0.0, and then the re-cut v5.0.0 through walk v6 (bdobb 193b615, od 343b84b), are carried into v7 by real merges, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | e89de2b | Merge walk v6 (dd00aa2) |
| bdobb | 4ab3fe2 | fix: the touch example describes itself within 400 characters |
| bdobb | 9982c13 | Merge walk v6 (193b615: export-delete test fix, date-chip min-height, DayPicker test) (pairing commit Y7) |
| bdobb | b622edb | policy vendored from 1f7ea43, `openbqDocker` = 1f7ea43 (pairing commit Z7) |
| openbq-docker | c1d4de3 | Merge walk v6 (af8b3e9) |
| openbq-docker | 562ca50 | fix: the table-service lock carries v4.0.0's Dockerfile hash |
| openbq-docker | 64c874c | examples re-synced (EPISODE=7) |
| openbq-docker | d5cf35d | Merge walk v6 (343b84b) |
| openbq-docker | 1f7ea43 | lock pinned to 9982c13 (X7) |

5b0f8dd/b36e7d0 and c5f76e5/4981f8a are earlier pairings, superseded. Between Y7 and Z7 only `package.json`, `web/policy.mjs` and `web/policy.vendored.json` change.

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v7's side (version 7.0.0, v7's `capabilities`, `ios:*`, `test:live` scripts), then re-pinned.
- Help: v6's text with v7's numbers. key-maint citations name openbq-docker `v7.0.0` in place of `claude/v7-key-maint`; the examples page keeps v7's nine examples and `EPISODE=7`. The Rita/MCP citations keep `claude/v7-rita-mcp` (the v6 open item).
- od: overlay and key-maint 7.0.0 (`test_images.py`); the gateway stays `openbq-funnel-gateway:4.0.0`.
- Auto-merged and checked: the "Report model off" footer reads `definition.table.pivot` and the inspection's input ids; the ingest tsconfig includes `src/vite-env.d.ts`.
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB manifest cap, prune `until < now()`, the one `/ref/live_grid_ws` socket door, the desktop Origin rule, web preview over HTTP.

**Two failures fixed at v7, where they originate**
- `appsJson.examples.test` (v5's 400-character rule) failed on v7's own 471-character touch example: shortened.
- od `prepare-source.mjs`: the kept v7 lock carried the pre-740e23c Dockerfile hash (as at v6).

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 7947 passed, 29 skipped (7976) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 30 passed |
| `node --test web/*.test.mjs` | 46 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 68 passed |
| od `pytest tests`, `check-public.py` | 28 passed, 14 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |
| Linux (Spark, `run.sh v7`, source b622edb, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

The export-delete test that hung at v6 now passes on Linux (the re-cut v5.0.0's fix).

## v6.0.0 carry (2026-10-16)

The frozen v6.0.0 (bdobb `release/v6` = ceacb4d, openbq-docker `release/v6` = 6685c87) is merged into v7 in both repositories, then bdobb ad5e139 (`claude/v6-regression-20261016`, on ceacb4d, for the final v6.0.0 re-cut), then the lines are re-paired. v6.0.0 descends from walk v6 (193b615 / 343b84b), so the merge brings only what v6.0.0 adds: the v6 review fixes (remote images blocked in agent and card markdown, undo and settings-drop fixes, sendToAgent filling the draft under Context sharing, tool-param and result bounds, Run/Deny on external MCP calls, Stop aborting an MCP call), the Help for them, and od's Episode 6 Rita and MCP overlay; ad5e139 adds `move_widget` taking the spot it is moved to and pushing down what it lands on (`pushed_down`, Undo restores all) and a status trail that names a tool once. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 5d2e286 | Merge v6.0.0 |
| bdobb | 907f1fe | ledger (first pairing e46b28e / 875af6e, superseded) |
| bdobb | 82ee0bb | Merge ad5e139 (pairing commit Y7) |
| bdobb | 140ad38 | policy vendored from 96e0405, `openbqDocker` = 96e0405 (pairing commit Z7) |
| openbq-docker | 966991c | Merge v6.0.0 (Rita and MCP overlay) |
| openbq-docker | 875af6e | lock pinned to 5d2e286 (superseded) |
| openbq-docker | 96e0405 | lock pinned to 82ee0bb (X7) |

ad5e139 merged cleanly: v7's `move_widget` and `StatusTrail` equal v6's. Between Y7 and Z7 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged (sha256 85cf23a3).

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`: v7's side (version 7.0.0, v7's scripts), then re-paired. The table-service lock keeps v4.0.0's Dockerfile hash.
- Help (user ruling 2026-10-16): v6.0.0's wording with v7's numbers. The Rita/MCP overlay is cited at openbq-docker `v7.0.0` in every place that named `claude/v7-rita-mcp` (`rita-ai-agent-setup`, `ai-library`, `openbq-docker-stack`, `tailscale-networking`, `troubleshooting-infrastructure`); v6.0.0's "cites no working branch" test now guards it. The Run/Deny, Stop and row-send pages (`rita-chat`, `troubleshooting-using-bdobb`, `topics/rita`, `topics/tables`) merged cleanly.
- od: the overlay (`docker-compose.v6.yml`, `ts-config/serve-v6*.json`, `rita.env.example`, `rita-resolv.conf`, README, VERIFICATION) merged cleanly; v7's tailscale service and `serve-v3.json` equal v6's. Rita and MCP keep the Episode 6 builds (6.0.0, digests 6e422484 / d76fbbac): GHCR has no 7.0.0 or later Rita/MCP tag, so `test_images.py` pins 6.0.0 rather than key-maint's release (7.0.0 here). `rita.env` is ignored (`*.env`).
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, the `/ref/live_grid_ws` socket door, the desktop Origin rule, web preview over HTTP. The gateway stays `openbq-funnel-gateway:4.0.0`.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 7980 passed, 29 skipped (8009) on Z7 (7978 / 29 before ad5e139) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 30 passed |
| `node --test web/*.test.mjs` | 46 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`; crate sources unchanged by ad5e139) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 68 passed |
| od `pytest tests`, `check-public.py` | 29 passed, 16 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet`; with `-f docker-compose.v3.yml -f docker-compose.v6.yml` | pass, pass; pass |
| Linux (Spark, `run.sh v7`, source 140ad38, no test skipped; also e46b28e) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |
