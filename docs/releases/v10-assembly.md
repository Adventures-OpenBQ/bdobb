<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# Clean v10 assembly ledger

Base clean v9.0.0 FREEZE 62d1aae (handoff commit 6082e33 on top). Branch `claude/clean-v10`, local only.
Donor: bdobb-dev/bdobb-v2 v10.0.2 93efad8c; delta measured from v9.6.3 5cfe1395: 125 commits, 99 files. The 15 commits on the donor's `origin/release/v10` after v10.0.2 stay out.
Server facts and the web relay's contract: bdobb-dev/openbb-docker v10.1.7 d606169 (`funnel-gateway/`, `live-grid/`). The server port itself is on openbq-docker `claude/openbq-docker-v10`, in parallel, and is not recorded here.
Clean and donor share no Git ancestor, so every carry is a hand port; donor commits are named per step and no donor Git objects are kept.
Dispositions: `docs/releases/v10-delta-manifest.tsv` (99 donor-changed paths: 52 EXCLUDE, 40 MERGE, 3 ADD, 4 PROVENANCE; status 81 DIVERGED, 11 NEW, 7 ABSENT, none SAME-BASE). Columns and vocabulary as v8's and v9's.

## Status: 10.0.0 released, paired with openbq-docker v10.0.0

The gateway policy is the policy vendored from openbq-docker v10.0.0 (sha256 `95e4c9ca483f16684db14a7493461f98c30a0b35fcbb610d14c2677600f9bfb0`, as `web/policy.vendored.json` records). What follows is the ledger as it stood at assembly, when 10.0.0 was a candidate: every v10 carry made, help and example written, version 10.0.0, the example synced into openbq-docker, full gate not run, not frozen.

Commits are local. The assembly step ran typecheck, lint, the affected vitest files, `src/help`, `pnpm test:web`, `pnpm scrub` and one new Playwright spec; the integration step (below) re-vendored the policy, moved the pin, flipped and reviewed the refusal assertions, synced the example into openbq-docker and ran its own receipts. The full gate (unit, e2e, build) is the next agent's. No FREEZE commit, tag, push or release branch. Live checks: **NOT_RUN** (`EODHD_API_KEY` absent; no stack, no kdb+ licence here; 0 EODHD calls).

## What the delta is

The donor's v10 line was cut and then re-received v9.6.3's work (the `carry: merge v9.6.3 into cut/v10.0.2` series and the cherry-picked v8.1/v9 fixes, 5e563133 … a4c34d33, fbc3ef26 … 04da9362, 1b4373f5, 52ff5b3e, e50aee91, 97fb6a27, bc0b3815): those net to nothing against v9.6.3 or are already in clean (v8/v9 KEEP). The net delta is:

1. the live grid, as the donor rebuilt it at v10 (renderer, `useWidgetSocket`, `buildWidgetWsUrl`, the card wiring and four streaming fixes);
2. `/symbol_meta` logos and the 52-week band, with the `logo`, `rangeBar` and `percentKey` column declarations, column `align`, and a stutter fix (fixed layout, tabular digits);
3. the web preview's `/grid` relay (c183f880) and the re-vendored gateway policy (od v10.0.3);
4. the Episode 10 example with 1621cee1's two chart cards, and its apps-sync row;
5. help (7876c86a, then the v10.0 guide snapshot), version bumps, shots, design docs.

## Rulings applied (user, handoff 2026-10-12)

- Method is v8's and v9's: manifest columns, REVIEW notes when a clean assertion changes, hand ports naming donor commits, never weaken an assertion.
- Clean's live grid is the v3 reference-compatibility renderer `LiveGridRenderer.tsx` (83 lines, untouched since v3); v8 only added "reconnect" mode to the shared hook for News. The donor's v10 live-grid work is therefore MERGE/ADD onto that baseline, never KEEP, and v3 reference compatibility (OpenBB's `/live_grid_ws`, no auth) must keep working: proved by extended unit tests and a new e2e spec.
- Client donor through v10.0.2 only. Gateway policy not re-vendored in the assembly step (the server branch was still being built): the relay was written against openbb-docker v10.1.7's funnel-gateway contract. Re-vendored at integration from openbq-docker ebd1622 (V10-P3 resolved; "Integration" below).
- Version 10.0.0 in v9's places. Conflicts: the recommended option, recorded PROVISIONAL in `OPEN-QUESTIONS.md` (V10-P1 to V10-P4).

## Steps (every commit)

| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| 6189d44 | 1 | docs(v10): the v10 delta manifest -- every donor-changed path, v9.6.3..v10.0.2 | 9ab488a9..93efad8c (survey) |
| 8111599 | 2 | feat(v10): the live grid, merged onto the v3 reference-compatibility renderer | 553fa527, 230f3110, 3cf2d837, 8b51a240, 811b7905, fa96f72c, 1171fe15 (not taken), 65f9b782, ac1068e5, b3d7ac4c |
| c42f267 | 2 | feat(v10): /symbol_meta logos and range bars on the live grid | e580d195, 74cafc6f, ecdad3b2, 8b51a240, 8dd46d36, 8ae5a24d, 1c8084ff, 5b444781 (not taken), 24f16e3d (KEEP) |
| 28596b4 | 2 | feat(web): the preview relays live-grid's /grid family, socket included | c183f880, c779b185, 51dc0d9d, 0684f282; contract openbb-docker v10.1.7 d606169 |
| e990841 | 2 | feat(v10): Episode 10's live-grid example, carried into clean's envelope | e69f4155, 1621cee1 |
| dab2192 | 2 | fix(v10): symbol_meta adds only the fields the grid's columns read | 8b51a240 (as merged in c42f267) |
| cde0d9b | 2 | docs(v10): help for the live grid and its column declarations, written for clean | 7876c86a; 143562cc, 38f3bb23, 84768190 (read for facts) |
| e791de5 | 5 | chore(v10): version 10.0.0 everywhere | 83871828, 6b502749, b41e664f (the donor's bumps) |
| 0f50dc5 | 5 | docs(v10): 10.0.0 release notes and a README section | none named |
| 1025a6c | 6 | test(v10): e2e proof of v3 reference compatibility; a snapshot keeps newer ticks | none named |
| c6d53f6 | integration | chore(web): vendor openbq-docker's v10.0.0 gateway policy at ebd1622; openbbDocker pins that commit | policy: openbq-docker ebd1622 (ports openbb-docker v10.1.7 d606169: e8c1239, b9545f5, dc61be8); a7772b2b's method (v8 R3b) |
| 5544aa9 | integration | docs(v10): the preview's /grid family is served -- web README, Web Preview and stack pages, notes | none named |
| 3e92d06 | integration | test(v10): live-grid's /series envelope reaches the card whole, lake read-back keys included | none named (server fact: openbq-docker 724739e `live-grid/app/lake.py`) |

The table leaves out only the commit that adds it (this ledger, the manifest's DONE marks, the open questions and provenance); `git log --reverse --format='%h %s' 6082e33..HEAD` lists every commit.

## Donor delta already in clean (KEEP, nothing carried)

| Donor work | Donor commits | Clean evidence |
|---|---|---|
| resubscribe over the open socket, not a reconnect | 3cf2d837 | `useReconnectingSocket` "resubscribe" mode (v3) |
| a late close of the old socket does not orphan the new one | ac1068e5 | the hook's per-connection `stale()` guard and closure-scoped `closed` (v8) |
| the grid subscribes by the group-bound effective params | b3d7ac4c | WidgetCard hands the grid `query` = `queryParams(effectiveParams(...))` (now asserted, 8111599) |
| ws:/wss: in the packaged CSP | e345ff91 | `tauri.conf.json` `connect-src … wss: ws:`; `csp.test.ts` asserts both |
| fixed table layout so a ticking grid stops re-flowing | 24f16e3d | clean's virtual table is always `.widget-table.sized` (`table-layout: fixed`); only the tabular digits were carried |
| a stable cell component across ticks | ecdad3b2 | `TableCell` is module scope with `columnDef.meta` (v8) |
| a column's `abbreviate: false` | (inside 74cafc6f) | `format.ts`, `widgetsJson.ts` (v8) |
| the pivot label column is never a logo and never flashes | (inside 74cafc6f) | `pivotTable.ts` `isLogo: false`, `flash: false` |
| the streaming chart fixes: keep zoom and pan across a refetch, a params change restarts from full extent | ce405d69, ce00e64f (and their cherry-pick sources 20908c53, c61fdc00) | `ChartRenderer` / `plotly.ts` `uirevision`, `WidgetCard` `paramsKey(query)`; `ChartRenderer.test.tsx` "keeps one uirevision across a refetch and a theme flip…", `WidgetCard.test.tsx` "a chart's zoom follows the card's params". No commit was needed; the Cached Price Chart (`kdb_cache_chart`) is a plain `type: chart` widget and takes this path unchanged |
| the v8.1/v9 carries the cut re-received (News, settings bundle, pdf, table sorts, a11y, private-network warnings, Calendar, Pivot statement view, licence headers) | 5e563133 … 93efad8c `carry:` series | as v8-assembly and v9-assembly KEEP tables |

## Carried (MERGE/ADD), and how clean's version differs from the donor's

### The live grid (8111599, dab2192, 1025a6c)
- **Frames.** One row object per frame (OpenBB's reference `/live_grid_ws`, and openbb-docker v10.1.7's live-grid: `await ws.send_json(row)`) **or** an array of rows (the donor's client, which read only arrays and so would never tick against either). Anything else, or a row without the identity column, is dropped (`frameRows`).
- **Seed.** Kept clean's v3 renderer-owned snapshot fetch (with its error and Retry; `fetchesData` stays false). The donor's card-fetched seed (811b7905, `builtins.ts`) is not taken. A snapshot drops only streamed rows that arrived before it was requested; a row streamed while it was in flight is kept (1025a6c: found by the e2e spec, against the reference's answer-at-once timing).
- **Merge.** Field by field over the seed; a new symbol is appended; a symbol removed from the param loses its streamed row when rows are keyed by `symbol` (fa96f72c).
- **Card.** The grid gets the table card's state and owner, filter row, autosize, cell clicks, sendToAgent, Reset table (remounting the table, not the socket) and Refresh (`SELF_REFRESHING_TYPES` gains `live_grid`; `refreshKey` re-fetches the snapshot).
- **Socket.** Clean's shared `useReconnectingSocket` (default "resubscribe" mode, the 0.5 s … 60 s ladder, the 30 s stable reset) instead of the donor's `useWidgetSocket` (fixed 3 s retry). Its `onDrop` writes `websocket dropped: <url without query>` once per card (65f9b782).
- **Credential.** `buildWidgetWsUrl` unchanged in behaviour (query placement only); 1171fe15 not carried (V10-P1). A test pins that a header or cookie credential never reaches the socket URL.
- `wsRowIdColumn` stays on `WidgetDef` (the donor moved it to `TableSpec`).

### symbol_meta and the column declarations (c42f267, dab2192)
- `fetchWidgetPath` (a sibling GET with the backend's credential placed as for the widget's data), `normaliseMeta` (a list keyed by each row's own `symbol`; `NA` is no logo).
- Deviation: symbol_meta is asked for, and its keys added, only for the fields the grid's columns read (`symbolMetaRead`) -- a v3 reference grid makes no extra request and gains no empty columns, and a logo-only grid gains no 52-week columns (the donor spread all three under every row).
- `logo`, `rangeBar` (the donor's final CSS `RangeBar`, 8dd46d36, file and test unchanged), `percentKey`, `align`, tabular digits. `rangeBar`'s `valueKey` defaults to `price` (V10-P2).
- Not taken: the donor's remount flash (`cell-flash`, 5b444781) and the deletion of clean's v3 `data-flash`, which already honours `colorValueKey` and `enableCellChangeWs`.

### The web relay (28596b4)
- Written against openbb-docker v10.1.7's funnel-gateway: `/grid/widgets.json`, `/grid/apps.json`, `/grid/live_grid`, `/grid/symbol_meta` and the ticketed `/grid/live_grid_ws`, whose frame repeats (`liveGridSubscription` on every frame). The donor's c183f880 was written against od v10.0.3.
- **Inert until the re-vendor; live since c6d53f6.** `server.mjs` imports the policy as a namespace, takes it by injection for tests, and opens the grid socket, its seed tab and its ticket only when `gridSocketServed(policy, origin)`. Under openbq-docker v8.0.0's policy every `/grid` route, ticket and socket was refused; under the vendored v10.0.0 policy (ebd1622) the family is served, and the tests still prove the refusal under the same policy with its grid rules removed.
- Deviation: the gateway's bare 404 for its `OPTIONAL_DOCS` (`/grid/apps.json`, `/grid/symbol_meta`) is passed through as a 404 (the donor relayed a 502 and documented the difference, c779b185 I3); every other non-200 is still a 502, body never relayed.
- Bootstrap: `preview-grid` backend and a **Live quotes** tab only with a gateway AND a grid-serving policy.
- Re-vendored at integration (below).

### The example (e990841)
- `docs/examples/v10.0.0-live-grid.apps.json`, *Example Dashboard - Version 10.0.0 - Live Grid*: written by `exportCompatibleApp` from the donor's layout (scratch generator, not committed): profile v3 (tab order only), five cards `live_grid`, `subscriptions`, `kdb_ticks`, `live_chart`, `kdb_cache_chart`, the donor's params and layout. Description names BDOBB 10.0.0 or later, the live-grid backend, and that `live_chart` opens as raw JSON (V10-P4).
- `scripts/apps-sync.mjs`: OWNER `v10.0.0-live-grid` -> `live-grid/apps.json` (the donor's row; maps to openbq-docker's `live` profile). Dry runs into scratch dirs: `EPISODE=10` wrote 11 apps to `workspace_apps.json` and 1 to `live-grid/apps.json`; `EPISODE=9` the 11 only. Nothing written to openbq-docker.
- The card ids are live-grid's own widget ids at openbb-docker v10.1.7 (`live-grid/widgets.json` declares all five, plus `ta_chart`). Checked at integration against openbq-docker v10 (ebd1622): identical (below).

### Help (cde0d9b)
- Quick Help: Tables gains *Live grids* and the `logo` / `rangeBar` / `percentKey` / `align` / `enableCellChangeWs: false` text; Troubleshooting gains *A live grid shows its first snapshot and never ticks*. Reference Manual: Tables (Live grids, the three declarations), Troubleshooting: Using BDOBB, Running and Refreshing, Backends and Connections, Web Preview (the `/grid` family, off until a v10 policy is vendored), Example Dashboards (the v10 section), EODHD Data (its streaming line points at the live grid). No page or topic added.
- Every claim was checked against this line's code. Not carried from the donor: "a frame is read only if it is an array of rows" and "the stack's grid holds its seed because it sends single rows" (false here), "the socket carries the credential in its URL" (only a query-placed one does here), the 47-page snapshot, `live-quotes.md` and `kdb-tick-cache.md` (server facts the openbq-docker port has not settled), and the od pairing history.

## Websocket auth (task 3): outcome

How the browser authenticates the `/grid` socket, from the donors: **a ticket.** At openbb-docker v10.1.7 the gateway admits `/grid/live_grid_ws` by `Authorization: Bearer <GATEWAY_TOKEN>` with its own `Origin` (a server-side relay: the web layer's own upgrade relay for a plain Node host), or by a single-use, 30-second `?ticket=` the web layer signs for a signed-in session, with `Origin` equal to `previewOrigin`; a query token is refused. live-grid itself reads HTTP Basic from the header only (on by default in that stack). Clean carries: the ticket path (clean's shim was already generic; 28596b4 adds the relay and the grid's ticket, live once re-vendored), the credential-free drop notice, and a pinned refusal to put a header or cookie credential in a socket URL. Not carried: 1171fe15, which forces a header credential into the query, where neither target reads it. The desktop against an authenticated live-grid therefore holds its snapshot: a real product choice, PROVISIONAL **V10-P1**.

## Review notes (clean assertions changed; none weakened)

- REVIEW, `src/components/renderers/LiveGridRenderer.test.tsx`: the v3 file mocked `useReconnectingSocket` and fed messages to its captured callback. It now runs the real hook on `FakeSocket`, so the same v3 assertions (snapshot shown, a row updated by id, an unknown row appended, a failed snapshot's error and Retry) are made through the real wire, and it adds the reference's socket URL (no credential, no params) and its `{"params":{"symbol":"TSLA"}}` frame. No v3 expectation was dropped or loosened.
- `src/help/guide.test.ts` "guide pages mention v10.0.0 consistently" and `src/lib/version.test.ts` "is the clean v10 development version": the version bump, as v8's and v9's (e791de5; both failed first).
- Added, nothing changed: `dataClient.test.ts` (fetchWidgetPath; no header/cookie credential on the socket URL), `tableColumns.test.ts`, `widgetsJson.test.ts`, `TableRenderer.test.tsx` cell cases, `RangeBar.test.tsx` (donor), `WidgetCard.test.tsx` three live_grid cases, `appsJson.examples.test.ts` v10 case and known-list entry, `index.test.ts` "v10 topics", `guide.test.ts` "the v10 live grid in the guide", `shims.test.ts` grid ticket, `web/security.test.mjs` six grid tests, `e2e/live-grid.spec.ts`.
- To review at the re-vendor (they assert today's refusal and will flip, by design): `web/security.test.mjs` "News upgrade authenticates cookies…" (`/grid/live_grid_ws` in its 404 list), "the ticket route issues only to a session, and only for /news/ws/news" (`/grid/live_grid_ws` in its 404 list), "until the re-vendor, the vendored v8.0.0 policy keeps every /grid route, ticket and socket refused" (all of it), and `web/browser-smoke.mjs`'s `/socket-ticket` 404 for `/grid/live_grid_ws`. Each needs a REVIEW note in that commit; the injected `v10Contract` in the grid tests can then give way to the vendored policy.

## Validation receipts (2026-10-12)

- `pnpm typecheck`: clean at every code commit and at 1025a6c. `pnpm lint` (whole tree): clean at 1025a6c; eslint on each commit's files clean.
- Affected vitest files (`--maxWorkers=2 --minWorkers=1`), one run at 0f50dc5 over LiveGridRenderer, RangeBar, TableRenderer (+ frame, execution, selection), WidgetCard, dataClient, tableColumns, widgetsJson, pivotTable, appsJson.examples, version, csp, builtins, widgetTypes, useReconnectingSocket, useNewsWire (+ tickets), `src/browser-shim`, `src/help` and `scripts/help-shots.test.mjs`: 27 files, 1039 passed. After 1025a6c: LiveGridRenderer 16 passed.
- `pnpm exec vitest run src/help`: passed (98 with `version.test.ts`; 103 with `scripts/help-shots.test.mjs` before the version bump).
- `pnpm test:web`: 46 of 46 (40 before this line's grid tests).
- `pnpm scrub` (scrub-check + header-check): clean.
- Playwright, scratch config (`playwright.scratch.config.ts`, git-excluded) with the scratch Chromium preload: `e2e/live-grid.spec.ts` 2 passed. No other spec run; no `playwright install`.
- `src/test/integration/reference-backend.test.ts`: 6 skipped (no reference backend running here), as on every cloud run.
- Not run here (next agent's gate): the full unit suite, the full e2e, `pnpm build`, `pnpm build:web`, `pnpm test:web:browser`, notices. EODHD live: NOT_RUN.

## Integration (2026-10-12): re-vendor, pin, refusal assertions, sync

**Re-vendor and pin (c6d53f6).** `OPENBQ_DOCKER_DIR=~/openbq-docker pnpm gateway:vendor v10.0.0 ebd16228676bb4b624422f53f178fed6cd4647c6`. `web/policy.mjs`'s header names openbq-docker v10.0.0 and sha256 `1e6aa6c684e48194098acc8db2cf990db8d8096b45fdb2a661a89a3590ca5083`, the hash openbq-docker's ledger records for its `funnel-gateway/policy.mjs`; `policy.vendored.json` is `{ tag: "v10.0.0", commit: "ebd16228…", sha256 }`. `package.json` `openbbDocker` moves from `cab61a982b6a892c598f19d829331f1331ca23d6` to `ebd16228676bb4b624422f53f178fed6cd4647c6` (the 40-hex commit format v8 used; the `v10.0.0` tag when cut). The server's later sync commit f18c459 changes no gateway file, so the pin stays at ebd1622. Stale comments in `server.mjs`, `bootstrap.mjs` and `src/browser-shim/socket.ts` now describe the served state. Before the flips, `pnpm test:web` failed exactly the three tests the ledger listed (43/46).

What the vendored policy admits beyond the relay's original contract: `/grid/series`, `/grid/chart`, `/grid/ticks`, `/grid/ta_chart` (each under its grammar) and a ticket for `/grid/ta_chart_ws` with its validated query. The relay forwards all of them through `upstreamPath`/`socketTarget` with no code change; its own upgrade handler still relays only `/grid/live_grid_ws` (a same-origin `/grid/ta_chart_ws` upgrade is a 404).

**Review notes (assertions changed; none weakened).**
- REVIEW, `web/security.test.mjs` "News upgrade authenticates cookies, exact Origin, exact path, no query token": `/grid/live_grid_ws` left the 404 list (it is a route at v10.0.0 and would now upgrade). In its place: `/grid/live_grid_ws?token=x`, `?ticket=1.n.s`, `/grid/live_grid_ws/`, `/grid/ta_chart_ws` and `/grid/ta_chart_ws?symbol=AAPL&interval=5m`, all 404. Every other path is unchanged.
- REVIEW, `web/security.test.mjs` "the ticket route issues only to a session, and only for /news/ws/news" -> "… only for the vendored policy's socket targets": `/grid/live_grid_ws` left the 404 list; it now issues (200), with the URL `wss://gateway…/grid/live_grid_ws?ticket=` (the only key) and a ticket valid for exactly that target. `/grid/ta_chart_ws?symbol=AAPL&interval=5m` also issues, signed over the re-serialised query. Nine grid refusals were added (a query on the grid socket including `?token=` and `?ticket=`, a trailing slash, a `provider` or `token` or `7m` interval on the tick chart, two foreign-origin spellings); the old non-grid targets, the one-`for`, no-extra-key and POST 405 checks are unchanged.
- REVIEW, `web/security.test.mjs` "until the re-vendor, the vendored v8.0.0 policy keeps every /grid route, ticket and socket refused": replaced by "the vendored v10.0.0 policy serves the /grid family; a policy without the grid rules refuses all of it". Every assertion of the old test is kept, run against `withoutGrid` (the vendored policy with every `/grid` rule removed, which is what v8.0.0 admitted, and now also checked to ask nothing upstream). The vendored half asserts the four documents relayed (200, exact upstream URLs), the grid ticket 200 and the seed's `preview-grid`. The injected `v10Contract` (hand-written from od v10.1.7) is gone: the grid relay tests run on the vendored policy, unchanged otherwise.
- REVIEW, `web/browser-smoke.mjs`: `/grid/live_grid_ws` left the ticket route's 404 list; the route is now asserted to issue for it (200) and to refuse `/grid/live_grid_ws?token=x` and `?symbol=AAPL`. The smoke now drives the seeded **Live quotes** tab end to end: `/grid/widgets.json` and the `/grid/live_grid` snapshot through the relay, then a tick over a socket the shim opened on the fake gateway, which admits only a ticket that verifies for exactly its target, once (a nonce set, as the gateway's `admitted` map), and re-validates each grid frame with the vendored `liveGridSubscription`. Its lapsed-session sentinel moved from NVDA to AMZN, because the seeded grid's symbols contain NVDA, so "NVDA is not in the saved store" no longer said anything about that edit; the assertion is otherwise identical (checked absent before and after).
- Added (where a refusal became an acceptance, what the gateway refuses is still refused or carried to it): "the grid socket refuses a token or ticket in its query, a foreign or missing Origin, and no session" (query `token`, `access_token`, `apikey`, the issued ticket, ticket after a param: 404; evil, gateway-own and missing Origin: 403; no cookie: 401; cross-site Sec-Fetch: 403; HTTP `/grid/live_grid` with a foreign Origin 403 and with only a Bearer header 401); "a grid ticket lasts thirty seconds, names one target, and is single-use at the gateway" (expiry 30 s, null one ms past it, null for three other targets and another token; two issues carry different nonces; a gateway-style admission set admits each once); "the gateway's 60-frame cap closes the browser's socket, and nothing past it is answered" (a mock gateway with openbq-docker's `FRAME_CAP` = 60 closes on frame 61; the relay closes the browser, 60 answered); "the example's /grid routes are relayed under their grammars, and nothing outside them is" (5 admitted: the example's ticks/chart/series plus a full series and a ta_chart; 19 refused, including a query token on two routes and `/grid/subscriptions`).
- `src/help/guide.test.ts`: one test added ("the web preview and the stack page describe the openbq-docker v10.0.0 pairing as served, not pending"); no assertion changed. The v8 test's `openbq-docker v8.0.0` checks still hold (both pages keep the v8 pairing as history).

**Docs (5544aa9).** `web/README.md` and the Web Preview guide page lose "off until …": `/grid` is the fourth served family, with the routes the example reads and what the gateway refuses. The stack page names the v10.0.0 pairing and `ebd1622`; README, release notes and provenance drop "pending the re-vendor".

**Example check and unknown keys (3e92d06).** openbq-docker ebd1622 `live-grid/widgets.json` declares all five card ids (`live_grid`, `subscriptions`, `kdb_ticks`, `live_chart`, `kdb_cache_chart`; plus `ta_chart`), and its `live-grid/apps.json` (the donor's) places the same five with the same saved params: no mismatch, the example is unchanged. One served-behaviour finding, documented on the Example Dashboards page: live-grid drops `subscriptions` from `/widgets.json` unless `LIVE_GRID_PUBLIC_URL` is set, which openbq-docker v10 leaves empty (and P3 publishes no live-grid address), so there that card reads *not on any connected backend* (PROVISIONAL V10-P5). With the lake read-back configured, `/series` and `/grid/series` `cache` gains `rows_from_lake` and `lake_days` (openbq-docker C4). The client reads no `cache` field and validates no schema; two new tests pin that the envelope reaches the card whole (`dataClient.test.ts`, with and without a dataKey and with a key no release has) and that the `live_chart` card shows it as raw JSON with no error (`WidgetCard.test.tsx`).

**Sync.** `EPISODE=10 OPENBB_DOCKER_DIR=<scratchpad>/sync-v10 node scripts/apps-sync.mjs`: 11 apps to `workspace_apps.json`, 1 to `live-grid/apps.json`. Carried into openbq-docker by the v8/v9 method (41bc742, 69c907e): filtered against the same served widget set, `examples/bdobb/apps.json` comes out byte-identical to 69c907e (9 kept, Demo providers and Video Library dropped), so only its README changes. The live-grid example goes to `live-grid/apps.json`: live-grid's Dockerfile bakes that file, its `/apps.json` serves it verbatim and the gateway relays it as `/grid/apps.json`, so it is the `live` profile's, never openbq-api's lanes catalogue. Server commit **f18c459** "Sync the v10 BDOBB examples from the v10 candidate 3e92d06"; two server tests select the app by its new exact name (REVIEW notes in openbq-docker `docs/v10/live-grid-kdb-port.md`, "BDOBB examples sync").

**Receipts (2026-10-12, integration).** BDOBB: `pnpm typecheck` clean; `pnpm lint` clean; `pnpm test:web` 50/50; affected vitest files (`--maxWorkers=2 --minWorkers=1`: dataClient, WidgetCard, appsJson.examples, `src/browser-shim`, news, LiveGridRenderer, version) 7 files, 503 passed; `pnpm exec vitest run src/help` 95 passed; `pnpm scrub` clean; `pnpm build:web` then `pnpm test:web:browser` (scratch Chromium preload) PASS. openbq-docker: `tests/` 27 (5 subtests), `v3/tests` 68, `lanes/tests` 22, `workspace/tests` 12, `live-grid` 430 passed (14 network deselected), `check-public.py` PASS, `verify-app-layouts.py` passed for both apps files. Not run: the full unit suite, full e2e, `pnpm build` (the gate's). EODHD calls: 0.

## User rulings during Episode 10

Given in this session, 2026-10-12. These are user rulings, not provisional. They are recorded in full, with the server port they produced, in openbq-docker `docs/v10/live-grid-kdb-port.md`, "Crash recovery and the S3 tier (user rulings, 2026-10-12)" (commits a5e146b, 724739e, ebd1622).

- (a) **v10 includes the S3 tick store and always-on kdb crash recovery**: the tick spool (`kdb-ws/persist.q`'s tick log, always loaded) and its replay when kdb restarts, plus the S3 store for the kdb cache's ticks (eod-dump, openbb-deltalake, live-grid's read-back). These are Episode 11 donor items (openbb-docker v11.0.0 onward), moved into v10 by ruling.
- (b) **RustFS replaces MinIO**, because of MinIO's licence change; no MinIO image, binary or `mc` remains. The S3-compatible contract (`DELTA_S3_*`, path-style, `aws_conditional_put=etag`) is unchanged. Conditional put on RustFS stays **PROVISIONAL** (openbq-docker C2) until the Mac race test (two concurrent delta-rs commits, one must fail with 412) passes.
- Also ruled there: the store format stays Delta Lake (delta-rs). DuckLake is a future decision, not v10 (`OPEN-QUESTIONS.md`).

Client effect: none beyond the read-back's two new `cache` keys, which the client tolerates (3e92d06). The server-side provisional items (C1-C8, P1-P7) are listed by reference in `OPEN-QUESTIONS.md`.

## Left for the integration agent

Items 1-3 are done (Integration, above); item 4 remains.

1. **Re-vendor** once openbq-docker `claude/openbq-docker-v10` carries the `/grid` family: `OPENBQ_DOCKER_DIR=~/openbq-docker pnpm gateway:vendor v10.0.0 <40-hex commit>`; `web/policy.vendored.json` follows.
2. **Pin**: move `package.json` `openbbDocker` from `cab61a9…` to that commit (the tag when cut). Then flip and REVIEW the assertions listed above, rerun `pnpm test:web` and `pnpm test:web:browser` (the seed's Live quotes tab appears), and update the help's Web Preview page and `web/README.md` ("off until …").
3. **Sync**: check the example's five card ids against the port's served `live-grid/widgets.json`, then `EPISODE=10 OPENBB_DOCKER_DIR=<openbq-docker> node scripts/apps-sync.mjs` (or the filtered copy openbq-docker uses) into `live-grid/apps.json` on the server branch.
4. The full gate, the FREEZE commit, and the Mac half (WebKit e2e, native build, live stack).

## Rebase onto release/v8 (2026-10-14)

Same instruction as `v9-assembly.md`, "Rebase onto release/v8": local only. `git rebase --onto claude/clean-v9 62d1aae claude/clean-v10` moved the 21 v10 commits onto the rebased v9; a second pass moved them onto v9's ledger commit. The pre-rebase head is `backup/clean-v10-pre-rebase` (78a6369). No merges, no `*.ts.net` host in any message or added line.

Conflicts, resolved by keeping both sides' behaviour (each commit's message records its own):
- `web/security.test.mjs` (/grid relay): the v7 rebuild's private-Wasm tests stay, and the /grid relay tests follow them.
- `scripts/apps-sync.mjs` (the v10 example): `SERVED` replaced `OWNER` in the v7 rebuild, and `SERVED` now takes a path. `"v10.0.0-live-grid": "live-grid/apps.json"` writes that example as it is into openbq-docker's `live-grid/apps.json`, which live-grid serves (RB-2). A dry run into a copy of openbq-docker `claude/openbq-docker-v10` 2ab8df2 with `EPISODE=10` wrote 9 apps to `examples/bdobb/apps.json` and 1 to `live-grid/apps.json`; the second was byte-identical to the branch's.
- The help pages for the live grid, the /grid family and the series envelope, in four commits: v8's openbq-docker pages and links stay, and the v10 text is added to them.
  - Example Dashboards gains the 10.0.0 section, the intro and its sources.
  - Backends and Web Preview gain their 10.0.0 sources.
  - The v10 pairing edits (10.0.0 pairs with openbq-docker v10.0.0 at `ebd1622`, `gateway:vendor v10.0.0`) go on `openbq-docker-stack`, because the v7 rebuild deleted `openbb-docker-stack`.
  - The EODHD page's live-grid line names `openbq-api`.
- `package.json` (the re-vendor): both pins, `openbqDocker` and `openbbDocker`, moved to `ebd1622`, as v8 kept them equal at the time (RB-3; revised by the second rebase below).
- `docs/releases/OPEN-QUESTIONS.md` (this ledger's commit): v9's, the rebase's and v10's provisional sections are all kept.

REVIEW, one assertion changed by the rebase, not weakened: `src/help/guide.test.ts` "the web preview and the stack page describe the openbq-docker v10.0.0 pairing as served, not pending". Its stack half read `page("openbb-docker-stack")`, a page the v7 rebuild removed. It now reads `page("openbq-docker-stack")` and pins the same three strings (a REVIEW comment in the test says so).

Old export menu items: no v10 file names *Export BDOBB-compatible / Export OpenBB apps.json…*.


Follow-up for openbq-docker (not done here): its v9 and v10 branches already contain `claude/openbq-docker-v8` a95969e, so no merge was needed. Their `examples/bdobb/apps.json` has empty `img` fields and no Date expression tab. A re-sync from this BDOBB would add the v7 rebuild's logo (`/openbq/bdobb-logo.svg`) and that tab, and needs the lanes hook that serves the logo (openbq-docker `claude/v7-bdobb-examples`). So the sync waits until that branch lands in openbq-docker.

### Second rebase, onto main d2c3dce3 (v8.0.0), 2026-10-14

Same instruction as `v9-assembly.md`, "Second rebase". `git rebase --onto claude/clean-v9 39991ca claude/clean-v10` moved the 21 v10 commits and the first rebase's ledger commit onto the re-based v9, then onto v9's second-rebase ledger. The previous head is `backup/clean-v10-pre-rebase2` (35af93d).

Conflicts:
- The live-grid help commit. `example-dashboards.md`: the 10.0.0 intro, sync sentence, section and sources go on v8.0.0's wording (eight examples served). `web-preview.md`: the 10.0.0 sources go on v8.0.0's sources line.
- The re-vendor. `package.json`: v8.0.0 made `openbqDocker` the stack pin, paired by `web/security.test.mjs`, and set `openbbDocker` to openbb-docker's historical `v3.0.1`. So `openbqDocker` is `ebd1622` and `openbbDocker` stays `v3.0.1` (RB-3, revised). `web/policy.vendored.json` is the re-vendor's: tag `v10.0.0`, the commit and the hash. Web tests: 52 passed.
- The /grid-served docs commit:
  - `openbq-docker-stack.md` keeps v8.0.0's paragraph and gains v10's pairing (`ebd1622`, `gateway:vendor v10.0.0 <commit>`, sources);
  - `web-preview.md` takes this commit's 10.0.0 sources;
  - `web/README.md` is this commit's text, with the pin named `openbqDocker` and 8.0.0/9.0.0 pinning the `v8.0.0` tag.
- The series-envelope test commit. `example-dashboards.md`: its sources gain the openbq-docker v10 files.
- The first rebase's ledger commit. `OPEN-QUESTIONS.md`: the rebase section stays after the server provisionals.

Port 10000: no v10 text, help or test names the gateway's Funnel port. The /grid relay reaches the gateway at whatever `BACKEND_GATEWAY_ORIGIN` names, with no port of its own; it is openbq-docker's `funnel-gateway/config.mjs` (v8.0.0) that accepts an origin on `:10000` and refuses `:8443`. The tests use a portless `gateway.example.com`. So nothing moves, and no assertion changed. The one REVIEW from the first rebase (guide.test's stack pin reads `openbq-docker-stack`) stands. No `*.ts.net` host in any message or added line.

openbq-docker: `claude/openbq-docker-v10` lacked the `v8.0.0` tag. It now has it through v9, as dffdee3 (merge of `claude/openbq-docker-v9` e393e13). One conflict, `README.md`'s web-profile paragraph: the tag's port-10000 wording is kept, with v10's `/grid` sentence added. funnel-gateway: 88 passed.

Gate: `docs/releases/validation/v10/v10-refreeze-2026-10-14/` (v8's re-freeze script with pivot-build first, diff check from d2c3dce3).

### Rebase onto main c0fb324, re-pin to openbq-docker v10 and openbq-kdb (2026-10-14)

User instructions, in this session:
- release v10 on the released v9 and make it the new `main`;
- "openbq-docker v10 should have openbq-kdb", relayed by the v8 session and confirmed here;
- "it should be Adventures-OpenBQ/openbq-kdb".

What was done:
- **Rebase.** `git rebase --onto <v9 4f000d1> ff610a6 claude/clean-v10` replayed the 23 v10 commits on v9's re-pin (`backup/clean-v10-pre-rebase3` keeps 3b7517f).
- **Conflicts:**
  - The version bump: `about-this-guide`, `home`. v10's text, with `openbq-eodhd`.
  - The ledger commit: `OPEN-QUESTIONS` header and `provenance` (both sections kept).
  - The re-vendor commit: v10's policy and pin, superseded below.
  - The /grid docs commit: the stack page keeps v9's own pairing sentence (`d66e4d0`) beside v10's; Web Preview and `web/README.md` say 9.0.0 paired with openbq-docker v9.0.0, the same door as v8.0.0's.
  - Two rebase-ledger commits: `OPEN-QUESTIONS` RB-3 and RB-4 kept; the Connections question dropped, because v8 closed it.
- **Pin.** `openbqDocker` is openbq-docker `claude/openbq-docker-v10` 45c6ae1. That commit vendors openbq-kdb 10.0.0 from Adventures-OpenBQ/openbq-kdb (9519bbc, tag `v10.0.0`: kdb-store and kdb-ws renamed, the service `openbq-kdb`) and carries v9's openbq-eodhd 9.0.0. `pnpm gateway:vendor v10.0.0 45c6ae1c84dabe34f4ae9d66625e7d46e13ad19f` re-vendored `web/policy.mjs`; the body is byte-identical to the ebd1622 copy (sha256 1e6aa6c…), and `policy.vendored.json` records the new commit. RB-3 is now ruled.
- **Text.** The stack page, Web Preview, `web/README.md`, Example Dashboards' sources and the `server.mjs` and `security.test.mjs` comments name 45c6ae1. BDOBB's help does not name the kdb service or its packages, so nothing else changed for openbq-kdb.
- **REVIEW, one assertion changed, not weakened.** `src/help/guide.test.ts` (the v10 pairing): the stack page must contain `` `45c6ae1` `` where it pinned `` `ebd1622` `` (a REVIEW comment in the test).
- **Checks.** No tailnet host. Help 95 and web 52 passed.
- **Gate:** `docs/releases/validation/v10/v10-release-2026-10-14/` (diff check from c0fb324).

### Paired with the openbq-docker v10.0.0 tag (2026-10-14)

The user ordered: "tag openbq-docker v10.0.0 and re-pin bdobb". openbq-docker `release/v10` is `c19106a`, which is `claude/openbq-docker-v10` `e6cb490` (`45c6ae1` with v9.0.0 merged in) plus `docs/v10/release-receipt.md`. Its cloud gates passed at `e6cb490`; the Docker gates are for the Mac before the tag is pushed. Following the 9.0.0 re-pin (`f53bb5c`):
- `package.json` `openbqDocker` is `v10.0.0`.
- `pnpm gateway:vendor v10.0.0` re-read the tag. The body and hash (`1e6aa6c…`) are unchanged, so `web/policy.vendored.json` drops its `commit`.
- The stack page, Example Dashboards, Web Preview, `web/README.md` and the `server.mjs` and `security.test.mjs` comments name the tag in place of `45c6ae1`.
- **REVIEW, one assertion changed, not weakened.** `src/help/guide.test.ts` now pins "At 10.0.0 `openbqDocker` is `v10.0.0`" and the tag-only vendor command where it pinned `` `45c6ae1` `` and the `<commit>` form. It also asserts that the "until the tag is cut" wording is gone.

## Open questions

V10-P1, V10-P2, V10-P4 and V10-P5 in `OPEN-QUESTIONS.md` (Provisional (overnight, 2026-10-12) — v10); V10-P3 resolved at integration. Server provisionals C1-C8 and P1-P7 by reference. The future DuckLake decision (not v10). Carried in, still open: Connections export/import; V9-P1 to V9-P3.
