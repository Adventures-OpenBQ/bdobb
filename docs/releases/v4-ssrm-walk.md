# v4 SSRM walk

User rulings of 2026-10-15: walk PR #56 (bdobb `codex/table-ssrm-v10`, reviewed 1382c316) and
openbq-docker PR #10 (reviewed 41641c6) down to their home lines, and move the gateway down to v4.
Nothing here is pushed, tagged or deployed.

## Commits

| Repo | Commit | Subject |
|---|---|---|
| openbq-docker | 4c66ace | the funnel-gateway down from v8, with PR #10's table routes |
| openbq-docker | 8bf2741 | the native table service from PR #10 |
| openbq-docker | fbc8cdc | `table-service/source.lock.json` pinned to BDOBB 07bc91f |
| openbq-docker | edf7447 | `upstreamPath` drops its unused `config` parameter (pairing commit X) |
| bdobb | 07bc91f | native and client (pairing commit Y) |
| bdobb | 59c854f | web relay, vendored policy, `openbqDocker` = edf7447 (pairing commit Z) |

Pairing: the lock names 07bc91f, tree 2cc86115, Dockerfile sha256 41c59cdc (unchanged from PR #10).
The native paths do not change between Y and Z. `web/policy.mjs` is byte-identical to edf7447's
`funnel-gateway/policy.mjs`, and `web/security.test.mjs` holds the vendored commit to `openbqDocker`.

## Ported

Groups A, B, C, D, E, H, I and the v4 half of J from the WALK.md map. In od: the gateway minus the
later-line routes (the list is in openbq-docker `docs/v4/gateway-down.md`), PR #10's table routes,
tests, `control-admission.test.mjs`, `table-service/*` and the compose service, networks and volume.

## Adapted for v4

- `clearManagedSource` writes through `mutateActive`. No Statement: `eligibility`, `WidgetCard`, the
  help section and the managed-Statement test leave it out.
- Workspace sync strips a plain copy before `encodeV3CardExtension` (no `withoutV8State`).
  `withNative` takes the extension key.
- `e2e/ssrm-parity.spec.ts` keeps its fixture half. The Rita half (`describe_table`,
  `arrange_table`, `resolveTableTarget`) is v6.
- The web relay imports the table exports from the vendored policy, and vendors from od v4 instead of
  openbb-docker v3.0.1. It has no `/news`, `/grid`, docks or pinned context.
- README and the deploy guide no longer link the evidence directory, which is v10 only. Two new files
  get the licence header.
- od: PR #10's `control-admission.test.mjs` tailnet name and the `settings.example.json` token
  placeholder both failed `check-public.py`, and both are fixed here. The gateway stays on
  `node:22-alpine`: its tests pass 40/40 on Node 22 and Node 26.

## Left for later lines

- v5: group F (Statement), and `clearManagedSource` switches to `mutateOwnerOfCard`. Re-pin the
  source, since pivot-core changes at v5.
- v6: group G (Rita table-model tools, the `cardViews.ts` move, the Rita help sentence, the agent
  half of the parity spec).
- v8: the gateway's own `/news` wire, socket door and rss-ticker apply on top in the merge.
- v10: PR #10's `^`/`%5E` and `subscriptionRoute` hunks, `.env.example` `TABLE_*`,
  `ROLLUP-HANDOFF.md`, and PR #56's evidence, handoff and `.superpowers/sdd`.
- Resolved after the walk: the troubleshooting and importing help said `ssrm_table` is refused. They
  now describe v4 (managed and standard SSRM served; standard SSRM is LIVE only) in 64b5df8. The
  troubleshooting shot was never taken (still `[shot-pending]`); its `help-shots.mjs` scenario no
  longer stages a refused card. PR #56 carries the same stale text at v10.
- Resolved after the walk (user ruling 2026-10-15): the web preview is offered from v4, over HTTP.
  No code change was needed. The v4 relay and od v4's gateway already serve `/api`, `/state` and
  `/table`, and every upgrade is refused. A scratch interop run put the real `web/server.mjs` in
  front of the real od edf7447 `createGateway` (OpenBB mocked): `widgets.json`, a data route and a
  `/state` PUT then reseed all passed, and `/api/docs` was refused. `previewOrigin` and the socket
  door stay at v8, because they serve sockets only. The docs (`web-preview.md`, the stack page,
  `web/README.md`) now describe the v4 preview. `package.json` still carries the legacy
  `openbbDocker: v3.0.1` key; nothing reads it.

## Gates (2026-10-15)

| Gate | Result |
|---|---|
| Rust tests, cargo 1.98.1 `--locked` | pivot-core 161, pivot-wire 6, pivot-native 8, pivot-native-worker 5, table-service 33 passed, 0 failed |
| Clippy `--all-targets -D warnings` | clean on all six crates |
| Linux-only Rust tests (`cfg(target_os = "linux")`) | not run on macOS: 39 in table-service plus the worker's lifecycle and protocol suites |
| `test:pivot:packaging`, `pivot:build` | pass |
| `table-ingest:typecheck`, `table-ingest:test` | pass, 22/22 |
| Focused vitest sets | 2628/2628 |
| `pnpm typecheck`, `pnpm lint` | pass |
| Full `pnpm exec vitest run` | 6347 passed, 7 skipped |
| `node --test web/*.test.mjs` | 38/38 |
| od `node --test funnel-gateway/*.test.mjs` | 40/40 (Node 26 and Node 22) |
| od `pytest tests`, `check-public.py` | 23 passed, PASS |
| od `docker compose --profile web --profile table config --quiet`, `prepare-source.mjs` | pass |
| Browser `ssrm-parity.spec.ts` (fixture) | 2/2 Chromium |
| Browser `ssrm-widget`/`ssrm-resources` (native harness) | not run: they need a Linux root and target, and Docker |
| Production table-service image | not built: the Docker VM disk is 100% full and `docker system df` errors. Nothing was pruned. |

## Catch-up cascade (2026-10-15)

The v3.0.0 re-cut, the desktop Origin rule (user ruling 2026-10-15), the SCOPED `clearManagedSource` step and the Rita managed-table help, carried by real merges. Nothing pushed, tagged or opened.

| Repo | Commit | What |
|---|---|---|
| bdobb | eab0ca1 | merge `origin/release/v3` (v3.0.0 re-cut 34cc789) |
| openbq-docker | 2be3c6c | the desktop Origin rule (V10-P1's HTTP half), tests, README, `docs/v4/gateway-down.md` |
| openbq-docker | 67d3fd9 | lock pinned to eab0ca1 (pairing commit X4) |
| bdobb | 1205900 | policy vendored from 67d3fd9 (pairing commit Z4) |

Pairing: lock = eab0ca1; between eab0ca1 and 1205900 only `package.json` and `web/policy.vendored.json` change.

- **v3.0.0 re-cut.** `origin/release/v3` (34cc789, 7 commits) is merged. v4's own help relaunch (85139ad) keeps its v4 facts. v3 corrections that also hold at v4 are taken: the key-save message names `openbq-api` (v4's code already did), the demo keys are EIA and Congress.gov loaded *before* `credentials.env` (od v4 matches), and `/providers.json` on the stack page (ruled into v3 with key-maint; not checkable here, no key-maint branch is reachable locally). A duplicated key-maint paragraph in the provider-keys topic is removed. Conflicting shots keep v4's; the left-rail shots take v3's retake.
- **Desktop Origin (user ruling 2026-10-15).** od v4's gateway admits `tauri://localhost` and `http://tauri.localhost` beside its own origin on Bearer-authenticated HTTP, every route, `/table` included. Without the token they still get 401; `:1420` gets 403; desktop-Origin upgrades are still refused. The code is v10's 76fd6a3 (`DESKTOP_ORIGINS` and the Origin check). `policy.mjs` is unchanged, so the vendored body is unchanged (sha256 e6e66ba1); only the pin moves. Gateway tests 40 → 42.
- **`clearManagedSource` revision step.** Not ported here, by decision: v4's test has no `SCOPED` table, and its `STEPS` entry already drives `clearManagedSource` through `mutateActive`. The PR's step is a `SCOPED` (owner-scoped) step, so its home is v5.

| Gate | Result |
|---|---|
| Full `pnpm exec vitest run` | 6347 passed, 7 skipped |
| `pnpm typecheck`, `pnpm lint`, `pnpm scrub` | pass |
| Pivot wasm build (fresh) and `--verify`, `test:pivot:packaging` | pass |
| `table-ingest` typecheck, test | pass, 22/22 |
| `node --test web/*.test.mjs` | 38/38 |
| Browser `ssrm-parity.spec.ts` | 2/2 Chromium |
| od `node --test funnel-gateway/` | 42/42 (Node 26.10.0) |
| od `pytest tests`, `check-public.py` | 23 passed, PASS |
| od `prepare-source.mjs`, `docker compose --profile web, table config --quiet` | pass |
| Rust crate tests | not re-run: no Rust changed in this cascade (the wasm build compiles pivot-wasm) |
