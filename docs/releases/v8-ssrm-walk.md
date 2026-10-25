# v8 SSRM walk

The user's rulings of 2026-10-15 carry the v7 SSRM walk (`docs/releases/v7-ssrm-walk.md`) forward to
v8 by real merges, in both repositories. The gateway has lived at openbq-docker v4 since that day, so
v8 is where the walked gateway meets v8's own full gateway. Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| openbq-docker v8 | 9424cf8 | merge od `claude/walk-ssrm-v7`: the gateway reconciliation (below), the native table service |
| openbq-docker v8 | 8facc73 | `table-service/source.lock.json` pinned to 5dc3971 (pairing commit X8) |
| bdobb v8 | 5dc3971 | merge `claude/walk-ssrm-v7`, with the merge-boundary edits (pairing commit Y8) |
| bdobb v8 | 9e488d9 | policy vendored from 8facc73, `openbqDocker` = 8facc73 (pairing commit Z8) |

Pairing: the lock names 5dc3971. The Dockerfile hash is unchanged (41c59cdc). Between Y8 and Z8 only
`package.json`, `web/policy.mjs` and `web/policy.vendored.json` change. The policy body's sha256 is
now a5d50619, because v8's policy carries the `/news` wire as well as the table routes; v4–v7's was
e6e66ba1.

## Gateway reconciliation (openbq-docker 9424cf8)

- **Base.** v8's full `funnel-gateway` is kept: the `/news` wire and socket door, `previewOrigin`,
  `maxSockets`, the `ws` dependency and `tls.test.mjs`. On top of it goes PR #10's own gateway delta
  (1860342..41641c6): `tableRoute`, `tableControlRoute`, `validSsrmRoutes` and the table constants;
  the table relay, principal and control lane; the table settings and secrets; the README lines and
  tests. `control-admission.test.mjs` comes as the walk ported it, with the `check-public.py` fixes.
- **Left at v10.** `liveGrid`, the `/grid` subscription routes and their tests, and the
  `requestUrl` `^`/`%5E` rewrite. PR #10's `node:26.10.0-alpine` base image is not taken, as at v4.
- **v4's own test.** The settings-example test adds v4's `tableOrigin === null` check.
- **Not carried.** v4's edf7447 (dropping `upstreamPath`'s `config` parameter). v8's `upstreamPath`
  reads `config.feeds`.
- **Compose.**
  - The gateway image stays `openbq-funnel-gateway:8.0.0`. It takes PR #10's `512m` and joins
    `table-private`.
  - `rss-ticker`, its volume and the 8088 Serve port stay.
  - `tests/test_web_profile.py` pins the gateway's two networks.
- **README.** The stack README's preview paragraph names `/table`.
- **Counts.** The gateway tests go from v8's 47 to 55: 4 gateway table tests, 1 policy test and 3
  control-admission tests.

## bdobb merge-boundary edits (5dc3971)

- **`workspaceDashboards`.** It encodes `withoutV8State(card)`, then drops the v4 table extras and
  `linkedSource`, as PR #56's v10 does. v8's `heldV8` and its `withNative` are kept.
- **`persistedCard`.** It keeps `statement`, `pinned` and `news` beside `managedSource`.
- **Store and import.**
  - v8's `pinCard` and the walk's `clearManagedSource` (through `mutateOwnerOfCard`) both stand.
  - `runAppsImport` carries v8's `v8Skipped` and `docks` together with v5's dropped-import `issues`.
- **Pinned export.** A pinned worker table exports every row through `collectPresentedExport`. A
  new test in `WidgetCard.workerExport.test.tsx` covers it.
- **Web relay.**
  - v8's relay is kept: the news wire, the socket door and the ticket route.
  - On top of it goes PR #56's own web delta (ba5553d..1382c316), without its `/grid` relay and
    tests. The table exports are named imports from the vendored policy, which is re-vendored from
    X8.
  - `web/README.md` gains the table rows.
  - `security.test.mjs` holds the vendored commit to `openbqDocker`.
- **Harness and smoke.**
  - `ssrm-native-harness*`, `run-ssrm-browser.mjs`, `playwright.ssrm.config.ts`,
    `e2e/ssrm-widget|resources` and `deploy/table-service/runtime-smoke.mjs` are byte-identical to
    PR #56.
  - A scratch check confirmed that v8's `createGateway` takes their minimal config
    (`TABLE_SMOKE_GATEWAY` included). It relays a standard SSRM POST and `/table/healthz` with the
    desktop principal.
- **Help.**
  - The v8 pages are kept.
  - The stack page and `web-preview.md` add `/table` and the v4-over-HTTP preview, and the stack
    page notes that the policy has come from openbq-docker since v4.
  - The troubleshooting widget-type list adds `ssrm_table` and `table_ssrm`.
- **Merge fix.** `package.json` first took v7's `version` (7.0.0) with the pinned conflict. This
  was corrected to 8.0.0 in the merge commit before pairing.

## Web preview

v8's preview keeps its sockets (News) and serves the table routes as well. A scratch interop put
the real `web/server.mjs` in front of the real od 8facc73 `createGateway`, with OpenBB and the table
service mocked. These all passed:
- the catalogue, a data route, and a `/state` PUT then reseed;
- `/table/healthz` and `POST /table/sessions` (the service saw `github:42` and its own token);
- `/api/docs` was refused.

`test:web:browser` covers the News socket path.

## Gates (2026-10-15)

| Gate | Result |
|---|---|
| Rust tests, cargo 1.98.1 `--locked`, shared target | pivot-core 163, pivot-wire 6, pivot-native 8, pivot-native-worker 5, table-service 33 passed, 0 failed |
| Clippy `--all-targets -D warnings` | clean on pivot-wire, pivot-native, pivot-native-worker, table-service and pivot-wasm; pivot-core's `result_large_err` is unchanged from v5 (the crates are identical to v7's) |
| Pivot wasm | built fresh on v8 with wasm-bindgen 0.2.128; `--verify` passes |
| `test:pivot:packaging` | pass |
| `table-ingest` typecheck and test | pass, 28/28 |
| `pnpm typecheck`, `pnpm lint` | pass |
| Full `pnpm exec vitest run` | 8167 passed, 29 skipped. The run before the version fix failed only `version.test.ts` (3 tests). |
| `node --test web/*.test.mjs` | 47/47 |
| `test:web:browser` after `build:web` | pass (News over a ticketed gateway socket included) |
| Browser `ssrm-parity.spec.ts`, fixture and agent halves | 2/2 Chromium |
| od `node --test funnel-gateway/*.test.mjs` | 55/55 (the gateway's `ws` installed with `npm ci` from its lockfile) |
| od `pytest tests`, `check-public.py` | 25 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass (compose run in a scratch export with the example env files) |
| Linux-only Rust tests, browser `ssrm-widget`/`ssrm-resources`, production image | not run: they need Linux and Docker builds |

## Left for later lines

- v9: the Rita aggregation hint (`claude/v9-rita-aggregation-hint`).
- v10:
  - `/grid` and live-grid, with PR #10's `^`/`%5E` and `subscriptionRoute` hunks;
  - `.env.example` `TABLE_*` and `ROLLUP-HANDOFF.md`;
  - PR #56's evidence, handoff and `.superpowers/sdd`;
  - the grid socket ticket branches.
- Re-pin on every forward merge.

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| openbq-docker | 1a71917 | merge od `claude/walk-ssrm-v7` (gateway resolution below) |
| bdobb | 0308d7f | merge `claude/walk-ssrm-v7` (pairing commit Y8) |
| openbq-docker | a81b58c | lock pinned to 0308d7f (X8) |
| bdobb | bfa6047 | policy vendored from a81b58c (Z8) |

Pairing: lock = 0308d7f; between 0308d7f and bfa6047 only `package.json` and `web/policy.vendored.json` change.

- **Gateway.** `server.mjs` keeps v8's socket door and adds `DESKTOP_ORIGINS`; the HTTP Origin check takes the walked rule. The tests keep v8's socket tests in place of v4's every-upgrade-is-refused test, take the two desktop tests, and v8's WS gate test now asserts a desktop-Origin socket gets 403 (desktop sockets wait for v10's ticket). Gateway tests 55 → 57.
- `dashboardRevision.test.ts`: SCOPED keeps v8's `pinCard` and adds `clearManagedSource` after it, in PR #56's order.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 8169 passed, 29 skipped |
| `pnpm typecheck`, `pnpm lint`, `pnpm scrub` | pass |
| Pivot wasm build (fresh) and `--verify`, `test:pivot:packaging` | pass |
| `table-ingest` typecheck, test | pass, 28/28 |
| `node --test web/*.test.mjs` | 47/47 |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| `test:web:browser` after `build:web` | pass |
| od `node --test funnel-gateway/` | 57/57 (Node 26.10.0) |
| od `pytest tests`, `check-public.py` | 25 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass |
| Rust crate tests | not re-run: no Rust changed in this cascade (the wasm build compiles pivot-wasm) |

## v3.0.0 cascade (2026-10-15)

v3.0.0 (bdobb 9e94bc1, od cad5cc9) and the V8-pin fix 94aee52 are carried from v4 (d057cdf / od 466a8e5) by real merges, then the lines are re-paired. Nothing was pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | cfdf157 | Merge claude/walk-ssrm-v7 (v3.0.0 + the V8-pin fix) into the walked v8 |
| bdobb | 34c7470 | feat(v8): vendor the gateway policy from openbq-docker 1256ee4 and pair with it |
| openbq-docker | e81ac6d | Merge claude/walk-ssrm-v7 (v3.0.0 + the V8-pin re-pair) into the walked v8 |
| openbq-docker | f48e5f3 | Merge claude/walk-ssrm-v7 (version fix re-pair) into the walked v8 |
| openbq-docker | 1256ee4 | feat(v8): pin the table service source to BDOBB v8 cfdf157 |

Pairing: od `table-service/source.lock.json` names bdobb cfdf157, and the last bdobb commit vendors the policy from od HEAD and sets `openbqDocker` to it.

- **Merge redone** (the earlier attempt was aborted). `package.json` is v8's own (the aborted resolution had the v4-file loss as well). The v3 port and v8's socket shim both declared `window.__bdobbSocketTickets` (`registry.ts`) and both imported `./socket` (`http.ts`): one of each is kept, with comments naming both targets, `/ref/live_grid_ws` and `/news/ws/news`. `shims.test.ts` keeps v8's tests: v3's differ only in the socket URL, and the shim does not filter paths. The 16 MiB streamed-manifest test replaces the 2 MiB manifest test; data routes stay at 2 MiB.
- od: e81ac6d (the gateway merge) stands; od v7's re-pair is merged after it (f48e5f3), so od v7's head is an ancestor.
- **CSP:** v4's object form, identical to v4 (ruling 2026-10-15).
- **One environmental failure, re-run.** The first full vitest run had 1 failure (8170 passed): `backend.test.ts` "same fiscal labels ... (parity)" got the as-reported labels. The test gives the whole ingest `timeoutMs: 200` against a local server. At load around 386 the abort landed during the widgets.json lookup, whose catch falls back to as reported. The test passes in isolation (14/14), and the full suite was re-run serially at load 486–573: 8171 passed. Open item: the 200 ms deadline makes the test load-sensitive (v5 origin); it was not changed here.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 8171 passed, 29 skipped (8200) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build (fresh), `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 28 passed |
| `node --test web/*.test.mjs` | 50 passed |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| `test:web:browser` after `build:web` | pass |
| od `node --test funnel-gateway/` | 78 passed, 0 failed |
| od `pytest tests`, `check-public.py` | 28 passed, 12 subtests passed, pass |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass, pass |
| Spark Linux tests | not run: they run after v4's final freeze |

## v5.0.0 carry (2026-10-16)

Walk v7's carry of v5.0.0 (through walk v6 dd00aa2 and the re-cut 193b615) is merged into v8, then the lines are re-paired. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 48721e4 | Merge walk v7 (v5.0.0 carry) |
| bdobb | 2826e04 | Merge walk v7 (re-cut v5.0.0 via v6 193b615, v7 fixes) (pairing commit Y8) |
| bdobb | fdd5ec2 | policy vendored from 826a2f7, `openbqDocker` = 826a2f7 (pairing commit Z8) |
| openbq-docker | 980c4ba | Merge walk v7 (v5.0.0 carry) |
| openbq-docker | 7af2dff | fix: the table-service lock carries v4.0.0's Dockerfile hash |
| openbq-docker | 5049399 | Merge walk v7 (v6 re-pin, v7 fixes) |
| openbq-docker | 826a2f7 | lock pinned to 2826e04 (X8) |

Between Y8 and Z8 only `package.json`, `web/policy.mjs` and `web/policy.vendored.json` change.

**Merge resolutions**
- `package.json`, `web/policy.*`, `source.lock.json`: v8's side (version 8.0.0), then re-pinned.
- `runAppsImport`: v8's locked-widget and skipped-v8-data notice parts with v3's singular "1 dashboard" / "1 card". v8's own notice tests (`runAppsImport.test.ts`, `SettingsDialog.test.tsx`) follow the singular rule.
- `dashboardStore`: v8's pinned-edge placement and v4's dropped link on a card copied to another dashboard. `web/config.mjs`: v8's feeds and v4's `SSRM_TIMEOUT_MS`.
- `appsJson.examples.test`: v8's tests and v5's 400-character limit. Every example meets both: v5's short descriptions plus v8's "BDOBB N.0.0 or later" sentence, with the v4 parameters, v5 Treasury, v6 Rita, v7 touch and v8 News/pinned descriptions shortened to fit.
- od gateway: v8's own gateway (`openbq-funnel-gateway:8.0.0`) with v4's `ssrmTimeoutMs`, the vendored default SSRM routes (`ssrm-routes.json`) and both sides' tests. Overlay and key-maint 8.0.0.
- Help: v8's text with the lower-line edits (cron "is not supported"; key-maint cited at `v7.0.0`); `web-preview.md` keeps v8's page, which already says v4.0.0 and HTTP.
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, the socket door at `/ref/live_grid_ws` plus `/news/ws/news`, the desktop Origin rule.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8233 passed, 29 skipped (8262) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 30 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 29 passed, 14 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |
| Linux (Spark, `run.sh v8`, source fdd5ec2, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v6.0.0 carry (2026-10-16)

Walk v7's carry of the frozen v6.0.0 (bdobb ceacb4d, od 6685c87) and of bdobb ad5e139 (`claude/v6-regression-20261016`, on ceacb4d, for the final v6.0.0 re-cut) is merged into v8 in both repositories, then the lines are re-paired. It brings the v6 review fixes, Run/Deny on external MCP calls, Stop aborting an MCP call, sendToAgent filling the draft under Context sharing, ad5e139's `move_widget` push-down and once-named trail chips, and od's Episode 6 Rita and MCP overlay. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 0af35d1 | Merge walk v7 (v6.0.0) |
| bdobb | 1c292a7 | Merge walk v7 (ad5e139) |
| bdobb | f9600f7 | fix: `move_widget`'s push-down leaves a docked card's slot alone (pairing commit Y8) |
| bdobb | cfe06af | policy vendored from 60e4d48, `openbqDocker` = 60e4d48 (pairing commit Z8) |
| bdobb | d420bfc | Merge walk v7's ledger |
| openbq-docker | 4bcfa2e | Merge walk v7 (Rita and MCP overlay), reconciled with v8's serve configs |
| openbq-docker | c1bc210 | Merge walk v7 (re-pin) |
| openbq-docker | 60e4d48 | lock pinned to f9600f7 (X8) |

f24a7da / 0b9c556 are an earlier pairing (before ad5e139), superseded. Between Y8 and Z8 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged (sha256 85cf23a3).

**Merge resolutions**
- `localTools.ts` `cardAndDef`: v6.0.0's `dashboardId` (the card tools act on the card as its dashboard shows it) and v8's explicit card (`pin_card`'s locked widget), as `cardAndDef(cardId, dashboardId?, card = findCard(cardId, dashboardId))`.
- `move_widget` (ad5e139): v8's code equals v6's, but from v8 a card pinned to an edge docks outside the grid and keeps its slot for Unpin. The push-down now passes over docked cards (the first pinned to each edge, DashboardGrid's rule). New test in `localTools.test.ts`, watched fail first. `StatusTrail` equals v6's; merged unchanged.
- `package.json`, `web/policy.vendored.json`, `source.lock.json`: v8's side (version 8.0.0), then re-paired.
- Help (user ruling 2026-10-16): v8's text with v6.0.0's Run/Deny, Stop and row-send wording. The Rita/MCP overlay is cited at openbq-docker `v8.0.0` wherever v8 named `claude/v7-rita-mcp`, and `tailscale-networking` says `serve-v6.json` also publishes rss-ticker on 8088.
- od overlay, reconciled with v8: `serve-v3.json` publishes rss-ticker on tailnet 8088 from v8, and the overlay replaces `TS_SERVE_CONFIG` with `serve-v6.json` (or `serve-v6-keys.json`), so both now carry 8088 (`AllowFunnel` false). `test_web_profile.py` checks they are `serve-v3.json` plus Rita and MCP, tailnet-only (fails on the unreconciled files). `serve-v6.json` has no Funnel door; the README's "add the port 10000 entries from `serve-v3-funnel.json`" holds. Rita and MCP keep the 6.0.0 digests (`test_images.py` pins 6.0.0; key-maint is 8.0.0).
- Rules checked in force: object-form CSP, `TICKET_SKEW_MS`, the 16 MiB cap, prune `until < now()`, sockets `/ref/live_grid_ws` and `/news/ws/news`, the desktop Origin rule, web preview over HTTP. The gateway stays `openbq-funnel-gateway:8.0.0`.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8267 passed, 29 skipped (8296) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 30 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 31 passed, 16 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet`; with the v3 + v6 overlays | pass, pass; pass |
| Linux (Spark, `run.sh v8`, source cfe06af, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |

## v7.0.0 carry (2026-10-16)

The frozen v7.0.0 (bdobb 96670d6, od ebafc5c) is merged into v8 in both repositories, then the lines are re-paired. Since walk v7's 199305a it brings the iPad env-prefix fix (96670d6: `envPrefix` `"TAURI_ENV_"`, so the `TAURI_ENV_PLATFORM === "ios"` paths run), the mobile monitor guard (290863a: `nativeMonitors()`, no `current_monitor` panic on iOS), the rail/touch fixes (3a63372), the backends.json import/export fixes (1febd2d, 6372bc2, fe00043), the iOS `$DOCUMENT/*` scope (d008513), the Help gesture and label fixes (586ab6a, 4ce66be, 6372bc2's "Collapse widget controls") and od's touch-example wording (ebafc5c). Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | 727c47e | Merge v7.0.0 (pairing commit Y8) |
| bdobb | edf8dca | policy vendored from d0e8c2d, `openbqDocker` = d0e8c2d (pairing commit Z8) |
| openbq-docker | 6ddbf3d | Merge od v7.0.0 |
| openbq-docker | d0e8c2d | lock pinned to 727c47e (X8) |

Re-paired because the od head changed (ebafc5c). No native path changed. Between Y8 and Z8 only `package.json` and `web/policy.vendored.json` change; the policy bytes are unchanged (sha256 810f9547).

**Merge resolutions**
- `package.json`, `web/policy.vendored.json`: v8's side (version 8.0.0), then re-paired.
- `LeftRail.test.tsx`: both tests kept, v8's File-menu docks-guard test and v7.0.0's folded-rail notice test (U3).
- The touch example (`docs/examples/v7.0.0-touch.apps.json`, od `examples/bdobb/apps.json`): v7.0.0's corrected wording plus v8's "Opens in BDOBB 7.0.0 or later." sentence (within the 400-character limit).
- `OPEN-QUESTIONS.md`: v7.0.0's open item (the Connections export writes stored credentials in plain text) replaces v8's "None.". It is still open on v8.

**Line checks**
- `vite.config.ts` `envPrefix` is `["VITE_", "TAURI_ENV_"]`; `screenFit.ts`, `vite.config.ts` and `envPrefix.test.ts` equal v7.0.0's.
- Monitor calls (`currentMonitor`, `availableMonitors`, `primaryMonitor`, `current_monitor`, whole tree): only `screenFit.ts`, all behind `nativeMonitors()` (`readLaunchScreen` returns null on iOS/Android first). The browser shim's stubs aside, v8–v10 add none.
- `TAURI_ENV_PLATFORM` branches: `LeftRail`, `chatExportFile`, `saveTextFile`, `screenFit`, all v7.0.0's own; v8–v10 add none. v8's `useReconnectingSocket` `reconnectOnForeground` is an option, not a platform branch.
- Help: no "…behind a chevron" label remains; the merge applies "Collapse widget controls" to every page (v8's "the widget-controls chevron" in `settings-export-and-import.md` describes the control, not its label).

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` (default isolation) | 8284 passed, 29 skipped (8313) |
| `pnpm typecheck` / `lint` / `scrub` | pass / pass / pass |
| Pivot wasm build, `--verify`, `test:pivot:packaging` | pass, pass, pass |
| `table-ingest` typecheck, test | pass, 30 passed |
| `node --test web/*.test.mjs` | 55 passed |
| `test:web:browser` after `build:web` | pass |
| Browser `ssrm-parity.spec.ts` | 2 passed (Chromium) |
| Rust, Mac (`--locked`) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 6, table-service 36; 0 failed |
| Clippy `--all-targets -D warnings` | clean except pivot-core's `result_large_err`, unchanged from v5 |
| od `node --test funnel-gateway/` | 84 passed |
| od `pytest tests`, `check-public.py` | 31 passed, 16 subtests; PASS |
| od `prepare-source.mjs`, `docker compose --profile web --profile table config --quiet` | pass, pass |
| Linux (Spark, `run.sh v8`, source edf8dca, no test skipped) | pivot-core 164, pivot-wire 7, pivot-native 8, pivot-native-worker 18, table-service 76; 0 failed |
