# Clean v8 assembly ledger

Base clean v7.0.0 8eb9ff6ab046c4aa382175547b84947017981de8 (`main` / `release/v7`). Branch `claude/clean-v8`, local only.
Donor: bdobb-dev/bdobb-v2 v8.1.2 5badcf352c128f6053fa1071377027e89389e8c9 (includes v8.0.0–v8.0.2); delta measured from v7.0.2 8be52e7ab9007d3cf6ffba24a8f86fd26fece4e7.
Clean and donor share no Git ancestor, so every carry is a port; donor commits are named per step and no donor Git objects are kept.
Dispositions: `docs/releases/v8-delta-manifest.tsv` (161 donor-changed files).

## Status: 8.0.0 -- frozen 2026-10-12 (de951a1d), then the v7 rebuild merged and re-frozen (see the last section)

Parts A and B are pushed; Part C, the Web relay, the Release 8.0.0 step and the FREEZE (de951a1d) are committed locally. The v7 overnight rebuild (`main` = `release/v7` = `v7.0.0` = ba935b53) is merged in by 0ff3b8bd so `main` can fast-forward to v8; its cloud gate is recorded under "Merge of the v7 rebuild (ba935b5)" and in `docs/releases/validation/v8/v8-refreeze-2026-10-14/`. The Mac half (WebKit e2e, native macOS and iPad builds, the live openbq-docker web profile) is pending. No tag, push or release branch.

## Earlier release lines

`release/v3` (bcc11c7), `release/v4` (42cf50e), `release/v5` (9519924), `release/v6` (b9a893f) and `release/v7` (8eb9ff6) are all ancestors of the v8 base. No post-freeze fix on an earlier line is missing.

## Donor delta already in clean (KEEP, nothing carried)

| Donor work | Donor commits | Clean evidence |
|---|---|---|
| iframe credential only to its own origin | 1f5975cc | `WidgetCard.tsx` origin check before `authHeaders` |
| widgets.json discovery deadline | 8bc19b63 | `dataClient.ts` `WIDGETS_TIMEOUT_MS` |
| never save over an unreadable file | 1ffd39cc | `jsonStore.ts` `unreadable` set |
| pdf.js viewer abort; unchanged refetch keeps page; pdf.js 5.7.284 legacy, iOS 16.4 | cf199a8d, 623338bd, b91193f7 | `PdfView.tsx`, `pdfLegacy.test.ts`, `tauri.conf.json` |
| table dotted field, missing-last sort, keyboard sort | 2f95cd90, 2dbf298d, 26a72762 | shared `accessorFor`, collator sorts in TableRenderer, engine and pivot (better) |
| chart keeps zoom; params change resets extent | 296f4fcb, f83c4621 | `plotly.ts` uirevision; `WidgetCard` `paramsKey` |
| library overlay focus; row menu focus target | d27bd138, ead81e52 | `WidgetLibrary`, `useModalDialog`, `RowContextMenu` (better) |
| scrub GitHub-token / PEM; design docs scanned | 3be68cb3 | `scripts/scrub-check.sh` |
| release in place; local sign + notarize; ESLint baseline; iOS signing team | 99ddd674, cb52f8d2, 7af849e8, ed4e8c8f, c7927c28, a20b8560 | `scripts/release.sh`, `scripts/ios.sh`, `eslint.config.js` |
| bdobb-settings.json export / import / drop | 2937239b, 50b14751, 889ea310, ab9d1d89, d4d86a4d, 48d4ee1e, 46860b6f | `settingsBundle.ts` (superset) |
| Quick Help and Reference Manual dialogs | 449514c3 | `HelpDialog.tsx` SETS |
| private-network MCP warning; settings-bundle MCP import gate | 41a0c6af, c5c6729c, dd3a7bce carries | `privateHost.ts`, `importedMcp.ts` (byte-identical) |
| Rita key-maint live read; fail-closed agent guard | a41a337a, 0c91bb9b carries | `chatStore.ts`, `providerKeys.ts` `isAgentOffLimits` |
| Rita pin is a lock | part of 5ee2e8b4 | `ChatPane` lock glyph |
| Apache-2.0, SecretoftheUniverse.com LLC, SPDX headers | a1392d14, 59b90942, ebf7ffc3, 6e4959ce | `LICENSE`, `NOTICE`, header guard |

Not carried: donor `productName`/`identifier` (BDOBB2 / com.artcashin.bdobb2); the donor's vendored help snapshot (clean authors its own Reference Manual); `docs/protocol-gaps.md`.

Low-risk follow-ups noticed during review (not donor gaps): no iOS-floor drift test; `OmniRenderer` chart passes no uirevision.

## Missing from clean (to carry)

1. Pinned cards — pinned edge, bands, Pin widget submenu, apps.json round trip. Donor 0d579f3a, 83d7ab70, 18b0e290, 0fc33060, 058b5e73, 3187f854, 3341e1c5; 8acf4d61, 5f6c5226, 5b2b2a02 (carried as f53066cf, fff3fdfb).
2. News widget (`builtin:news`) — lib/news, newsFile, useNewsWire, NewsRenderer, NewsFeedsDialog, strip, drag/touch, [-N], decoding, foreground re-subscribe, gateway path prefix. Donor e58e577a squash and later news commits; 93093129; bb1c11fe; example d40396b4.
3. News web relay and socket tickets — donor a7772b2b (needs the openbbDocker pin raised). Done: Web relay, below.
4. Locked widgets and docks — DockBand, dockLayout, docksImport, docks dashboard, Settings ▸ Locked Widgets, export/import. Donor 5ee2e8b4 squash; b0cb040d … 747d83e2 (carried as 5e952d3d).
5. Rita `pin_card` — donor 85841963; clean's 18th local tool.
6. Help topics for News, pinned and locked, authored for clean; screenshots re-shot. Done: Release 8.0.0.
7. Version 8.0.0 everywhere. Done: Release 8.0.0 (9c92eefa).

## Clean comments and tests that defer these (to be updated by the carry)

- `docs/releases/provenance.md:70` "No provider activation or later News/pinned-widget code carried."
- `src/lib/agent/localTools.test.ts:30-34` pin_card absent "until v8.1". Done in Part C (9f708d67).
- `src/components/dialogs/SettingsDialog.test.tsx:178` "no Locked Widgets tab". Done in Part C (bf2de27b).
- `src/browser-shim/http.ts`, `web/config.mjs`, `web/server.mjs:227`, `web/security.test.mjs:144` — no socket/news route at this line. Done in the Web relay step.
- `web/README.md` already describes a News relay that this line lacks (doc fix either way). Done in 665610d5.

## Rulings (user, 2026-10-11)

- R1 apps.json: pinned edge, News state and docks go in a new **v8 profile of the `extensions.bdobb` envelope**, not the donor's plain fields. v3–v7 profiles stay strict; v8 files import on v8+ only.
- R2 Workspace sync: a card's pinned edge and News feeds **sync** through the Workspace server inside the v8 envelope.
- R3 Web News relay **in scope**: carry a7772b2b (socket shim, server, config, bootstrap, policy). Needs an Adventures-OpenBQ/openbq-docker release whose gateway serves `/news` (none exists: v1–v7 have no socket or /news route). The `openbbDocker` stack pin moves to that release.
- R4 **Single release 8.0.0**: News + relay, pinned cards, locked widgets and pin_card together. Pinned/locked were never moved to v5 on either line; they are v8 here.
- R5 **Remove the rail's "Add widget (⌘K)" row** as the donor did (0d25ee2b); rewrite the help that mentions it (the left rail, getting started, widget library, iPad topic, guide pages).
- R6 Docks dashboard **syncs** to the Workspace server, **hidden via an openbq-docker flag** so Workspace's own web app does not list it; **one docks dashboard per server account, newest revision wins** (no keep-both-with-suffix for docks).
- R7 Episode 5 third tab (40489df8 / dd3a7bce): **dropped**; not a v8 feature.

## Cross-repo dependency: openbq-docker v8

R3 and R6 need Adventures-OpenBQ/openbq-docker changes (checked at main f3bf3d4, release/v7 tag v7.0.0): a gateway `/news` relay with socket tickets matching `web/policy.mjs`, and a hidden/system flag on the Workspace dashboard routes. The client's `openbbDocker` pin and `policy.vendored.json` follow that release.

## Rulings (user, 2026-10-11, second round)

- R3a: the web News relay comes from a **gateway ported into Adventures-OpenBQ/openbq-docker as an opt-in `web` compose profile**: the donor funnel-gateway (openbb-docker v8.0.3 775354f) and rss-ticker (`ghcr.io/artcashin/rss-feedhandler:8.0.0`), a public Funnel port 8443 and `GATEWAY_TOKEN`. The user approved the two images, the Node toolchain and the public port. Routes: `/news`, `/api`, `/state` only; **no `/ai`** (Rita).
- R3b: the vendored policy header names **openbq-docker**. The client's `web/security.test.mjs` header regex follows it, and provenance cites openbb-docker v8.0.3.
- R6a: the docks revision is the **client's last docks edit time (epoch ms)**. The server refuses an older revision with 409, and the client then takes the server copy.
- R6b: **DELETE of the docks is revision-checked** too (409 when the server copy is newer).
- R6c: the docks also sync in **Workspace login mode**, via a new `workspace/patches` change to the upstream dashboard routes (hidden flag, reserved id `docks`).
- R6d: openbq-docker v8 is based on **release/v7 (v7.0.0)**, merged into the v8 branch, not on `main`.
- openbq-docker branch `claude/openbq-docker-v8` (local): e58ccb3 merge v7.0.0; 9d17953 hidden docks routes `/pro/dash/sync/system/docks` (GET/PUT/DELETE, `hidden: true`, `/owned` excludes it); 067c5e4 survey `docs/v8/news-relay-and-hidden-dashboards.md`.

## Part A — envelope, sync, pinned

### Steps (every commit of Part A)
| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| 924fbfc1 | A | feat(v8): v8 profile of the extensions.bdobb envelope for a card's pinned edge (R1) | 8acf4d61, 5f6c5226, 5b2b2a02 (carried as f53066cf, fff3fdfb) |
| fe125bac | A | feat(v8): carry a card's pinned edge through the Workspace sync (R2) | none named |
| 1973076b | A | feat(v8): pinCard in dashboardStore; the pinned edge is saved with the card | 0d579f3a |
| a5bfff5b | A | feat(v8): pinned bands above and below the grid, a resize grip, and .dashboard-scroll | 83d7ab70, 18b0e290, 0fc33060, 2e456bf8 and 9589650e (pin parts; inside squash e58e577a) |
| ad8edf6f | A | feat(v8): Pin widget ▸ submenu on the card menu — Pin to top, Pin to bottom, Unpin | 058b5e73 |
| e0677cd5 | A | test(v8): e2e pinned cards — bands, swap, Rita, maximize and workspace tiles | 3187f854, 2e456bf8 |
| 58d9efa8 | A | test(v8): the maximized-pdf spec scrolls .dashboard-scroll, the grid's region since v8 | none named (donor v8.1.2 hunk of e2e/documents.spec.ts, CLEAN-APPLY) |

The table leaves out only the commit that adds it (the Part A ledger commit, the last of Part A); `git log --reverse --format='%h %s' b5a83cf9..HEAD` lists every commit. 3341e1c5 (inside squash e58e577a) is a donor plan revision: its two points, a locked Rita pane narrowing the band and the maximize inset covering a pinned card, are carried as code and e2e cases, and the plan itself stays PROVENANCE.

### Rulings applied (user, 2026-10-12)
- R1 shape: the v8 apps.json profile follows v5: `{ schemaVersion: 1, profile: "v8", base: <v3|v4|v5 envelope>, cards: [{ tab, index, pinned }] }`. One strict validator holds a card's v8 state (`v8CardState`), so News state joins as another key; app-level state (docks) goes beside `cards`. v3–v5 are unchanged and never see a v8 field; a v8 file stops at their decoders with UNSUPPORTED_EXTENSION. The plain OpenBB export never writes `pinned`.
- R2 / v7 compatibility: a synced widget record keeps its plain v3 card state in `extensions.bdobb` and carries the v8 record `{ schemaVersion: 1, profile: "v8", pinned }` in a sibling key, `extensions.bdobbV8`. Finding: v7.0.0's `workspaceDashboards.ts` (unchanged on this line, `git diff v7.0.0 -- src/lib/workspaceDashboards.ts` is empty) reads only `extensions.bdobb` through the strict v3 decoder and copies every other `extensions` key back on upload. A v7 client therefore syncs normally, does not see the pin, and writes `bdobbV8` back untouched. No v7 fix is needed. Proof: a scratch run of v7.0.0's own module on a v8-written record (read, edit a title and move a card on v7, read back on v8: both pins kept), not committed; the committed test runs v7's decoder path on the v8 record.
- Sync conflicts: a pin goes through `mutateDashboard`, moves the revision one on (bdobb#41) and is an ordinary edit: it uploads, or it raises the usual whole-dashboard conflict.
- `.dashboard-scroll`: carried as the donor reshaped it (2e456bf8), across single-dashboard mode, workspace tiles and maximize (see Layout notes).
- Duplicate and Copy to never carry the pinned edge.
- `PIN_EDGES` lives in `types.ts`; the help topic waits for the help step.

### Layout notes (clean v7 collisions)
- Single-dashboard mode: `.dashboard-area` was the scroll box with a sticky tab bar; it is now a non-scrolling flex column of tab bar, top band, `.dashboard-scroll` and bottom band. It still pads its own bottom by `--safe-bottom`, so on iPadOS a bottom band sits above the home indicator and the background runs to the edge. The sticky tab bar rule stays; it now holds trivially.
- The donor's sticky-band offsets (18b0e290's `--dashboard-top`, 0fc33060's `--tab-bar-height`) were already gone at the donor's 2e456bf8 and are not carried.
- Workspace tiles: the tile's scroll box moves from `.workspace-tile .dashboard-grid` to `.workspace-tile .dashboard-scroll`; the bands are the tile dashboard's own.
- Maximize: `.card-dock.card-maximized` takes every inset `.react-grid-item.card-maximized` takes: base, viewer, pinned rail, Rita on, Rita pinned, and a workspace tile's measured insets. The donor carried only base, viewer and Rita pinned.
- Touch: `.dashboard-scroll` keeps `touch-action: auto` (finger pan, pinch zoom) with `overscroll-behavior: contain`; the grips are `touch-action: none` pointer-event drags, 28px under `(pointer: coarse)`.

### Deviations from the donor
- The pinned edge rides the v8 envelope (apps.json) and `extensions.bdobbV8` (sync), not the donor's plain `pinned` layout-item field (R1, R2).
- `pinCard` goes through `mutateOwnerOfCard` → `mutateDashboard` (revision bump, sync, viewer in memory only), as the donor's final v8.1.2 does; there is no dock-dashboard guard (docks are not carried yet).
- Duplicate and Copy to drop `pinned` (ruling); the donor's copies carried it.
- The grid skips a `pinned` value that is not an edge (renders it in the grid); each band keeps clean's per-card ErrorBoundary; the grip is hidden while the card is maximized; grips are 28px under a coarse pointer.
- `DOCK_EDGES` (donor `dashboardsFile.ts`) is not carried; `PIN_EDGES` in `types.ts` serves.

### Review notes (clean assertions changed, user-approved)
- REVIEW, `src/lib/appsExtensionsV3.test.ts` "refuses later card state rather than dropping it from a v3 export" (clean v3 assertion changed): it used `pinned: "top"` as its example of later state and expected `exportCompatibleApp` to fail. `pinned` is v8 state now (R1). Ruling 2026-10-12, both: the v3 encoder still refuses a pinned card with UNSUPPORTED_V3_STATE; the compatible export carries it as profile v8; and an unknown made-up field (`futureCardState`) is still refused, not dropped, by `exportCompatibleApp`. The same kind of change as v6's `ritaUrl` → `nosuchPref`.
- REVIEW, `src/components/WidgetCard.test.tsx` "lists Rename…, Parameters, Duplicate, Copy to ▸, Maximize, … Export ▸" (exact menu list): gains "Pin widget ▸" after Maximize, as the donor's own test does. Still an exact list; no item removed.
- REVIEW, `e2e/documents.spec.ts` "a maximized pdf card can still be scrolled back to the top of its document": its setup scrolled `.dashboard-area`, which no longer scrolls; it now scrolls `.dashboard-scroll`. This is the donor's own v8 hunk (manifest CLEAN-APPLY), applied verbatim. Every assertion is unchanged.
- `src/stores/dashboardRevision.test.ts`: `pinCard` is classified MUTATING (and in the not-active-dashboard set). Nothing removed.

### Gate receipts (2026-10-12, at 58d9efa8)
- `pnpm typecheck`, `pnpm lint`: clean at every commit; `scripts/header-check.sh`: clean.
- Unit, `vitest run --maxWorkers=2 --testTimeout=120000`: run 1: 1 failed, 7194 passed, 29 skipped (7224). The one failure was `src/components/PivotParamRow.viewer.test.tsx` "viewer Page offers explicit All and empty…" (button "None" not found); alone it passed 3 of 3. Run 2: 409 files passed, 6 skipped; 7195 passed, 29 skipped (7224).
- `pnpm build`: OK (the existing chunk-size warning only).
- Playwright, Chromium. The preinstalled browser is build 1194 and Playwright 1.62 expects 1234; nothing was installed. A scratch config, not committed, pointed `launchOptions.executablePath` at the 1194 headless shell; specs with their own `launchOptions` ran with `PLAYWRIGHT_BROWSERS_PATH` set to a scratch link to the same binary.
  - `e2e/pin.spec.ts`: 6 passed.
  - `e2e/layout.spec.ts`, `e2e/card.spec.ts`, `e2e/workspaces.spec.ts`: 39 passed.
  - Full suite: 274 passed, 8 skipped, 5 failed. Four were environmental (`pivot-table-frame` ×2 overrides launchOptions; `rail-after-dialog.webkit` ×2 needs WebKit). One was the `documents.spec.ts` setup above. After 58d9efa8, `documents.spec.ts` and `pivot-table-frame.spec.ts`: 12 passed.

### Observed, not changed
- `persistedCard` (`src/lib/widgetData/persistence.ts`, since 9e007077) does not keep a card's `extensions`, so a synced card's server widget record (`extensions.workspace`) does not survive a save and reload. After a restart, an edit uploads a minimal widget record, which also drops `extensions.bdobbV8` when the uploading client is v7. This predates v8; raise it separately.

## Part B — the News card (desktop)

### Steps (every commit of Part B)
| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| 6f05c36d | A (ruling Q3) | feat(v8): the sync degrades on a v8 record it cannot read, and carries it back unchanged | none named |
| 9a8b2983 | B | feat(v8): News library — wire URLs, frame validation, merge, tabs, headlines, rss-agg.json | 2ee1ec77, fa698aa6, f9ad86a3, 0e318fb0, f674d2cf, e868331f, 03dcb918, bb1c11fe; 2e456bf8 (within squash e58e577a) |
| 04b84f55 | B | feat(v8): useNewsWire — first-frame subscribe, per-feed REST seed, reconnect, foreground re-subscribe | f06b524c, 8d5bd15f, 38c6e4dc, 2e456bf8 (within e58e577a); 93093129 |
| b315af27 | B | feat(v8): a News card's feeds ride the v8 envelope and the bdobbV8 sync record | 8ebb39e8; the apps.json `news` export carried as f53066cf / fff3fdfb (reshaped, R1/R2) |
| fce32ce5 | B | feat(v8): the News card — rail with no header, feed manager, strip, drag and touch | c0271754, cc9da355, e77bd303, 760fa651, e3f91787, 8ebb39e8, 38c6e4dc, 2e456bf8, e868331f, 03dcb918 (inside e58e577a); 0e318fb0, d2a73ce7, aba4a505, 8ba0efac, 213f6d83, b62a6d0d, edd63322, 57a74af7, f9ad86a3, fa698aa6, f674d2cf, 9589650e; d40396b4 |
| d99aa3b8 | B | test(v8): e2e News card — configure from the rail menu, tabs, live wire, double-click opens | e58e577a (e2e/news.spec.ts), 9589650e, 03dcb918 |

The table leaves out only the commit that adds it (the Part B ledger commit); `git log --reverse --format='%h %s' efbfcdd2..HEAD` lists every commit. 4d196adf (ws:/wss: on connect-src) is already in clean for Live Grid: KEEP, nothing carried.

### Rulings applied (user, 2026-10-12)
- Q3, degrade: a widget's `extensions.bdobbV8` that is invalid or written by a newer schema is skipped for that widget; the plain v3 card and the rest of the sync go ahead. On upload that record goes back exactly as the server had it, never overwritten by the card's own v8 state and never dropped. Q2: the key stays `bdobbV8`. Q1 (`persistedCard` drops card `extensions`): fixed on release/v5–v7 elsewhere and merged in later, not here.
- News state (R1, R2): `cards[].news` in the apps.json v8 envelope and `news` in the `bdobbV8` sync record, validated strictly (feeds of `{ url, name, tab }` strings with an http(s) url, optional `highlights` and `tabOrder` string lists, no unknown keys). Never the donor's plain `state.news`; the plain OpenBB export writes no feeds.

### Wire and socket
- `useNewsWire` keeps the donor's own connect loop instead of clean's `useReconnectingSocket`. The wire takes ONE subscribe frame per connection: openbb-docker's funnel-gateway (`server.mjs`, "One subscription frame, ever") closes a socket that sends a second, and `useReconnectingSocket` re-sends its subscription on the open socket when it changes. The News loop also seeds every subscribed feed over REST after each subscribe reply, reconnects on Refresh and on a return to the foreground (93093129), and retries a malformed subscribe reply, and that hook has no place for any of these. Retry stays the donor's fixed 3000 ms (one attempt per card per 3 s, not the retry storm #222 fixed for backends).
- `src/test/fakeSocket.ts` is deferred to the web relay step: it arrived with a7772b2b, and its only user is `browser-shim/shims.test.ts`. `useNewsWire.test.tsx` keeps its own richer fake, as on the donor.
- `defaultNewsBase` / `window.__bdobbNewsServer` (an empty card falling back to the web preview's own /news relay) goes with the relay; on the desktop an empty card asks for a server.
- Qualification: no rss-ticker server is reachable from this environment (rss-ticker is tailnet-only on `:8088`). The wire is qualified against the hook's fake socket and HTTP mocks (unit) and Playwright's `routeWebSocket` / `route` fakes (e2e), not a live server.

### Touch (#85) and clean v7's touch dialect
- Kept as the donor wrote them: a finger scrolls the list and the strip natively (`touch-action: pan-y` / `pan-x`), a double-tap opens a story (rows and cards take `touch-action: manipulation`, so the tap arrives as dblclick instead of a page zoom), mouse drag-to-scroll ignores touch pointers, and dragging a tab to reorder it is a pointer drag with `touch-action: none` on that tab.
- None of this overlaps the touch dialect: a long press opens the same menus a right-click does, and no News surface adds one; the rail title's double-click renames as every card title's does; pinch zoom stays enabled.

### Deviations from the donor
- The card menu is clean's portalled `MenuPanel`, shared by the header's ⋯ and the rail's chevron; the donor's in-place `.card-export` placement rules for the rail are not carried.
- The rail's Parameters item is clean's saved, docked panel (`paramsOpen`) under its usual name and place in the menu, not the donor's transient "Parameters (N)" at the end; the panel renders above the rail's body, without "Display on title bar".
- The rail menu gains Expand when the card is minimized (a rail has no header ▢).
- `NewsFeedsDialog` uses clean's `useModalDialog` instead of its own showModal, focus and Escape effects.
- `.status-dot` and `.modal-footer` are added with the News CSS (clean had neither).
- The example `docs/examples/v8.0.0-news.apps.json` (donor d40396b4) is written by `exportCompatibleApp` in the v8 envelope; its description says it needs BDOBB 8.0.0 or later.

### Review notes (clean assertions changed)
- REVIEW, `src/lib/appsJson.examples.test.ts` "v4.0.0-builtins: every BUILTIN_WIDGETS id … appears at least once": News's sample is the v8 News example, not a card in the v4 file (a v8 card cannot live in the file a v4–v7 install must still open). Every other built-in still needs its v4 card, and a new `v8.0.0-news` case checks the example's feeds come back from the envelope.
- v8 code from Part A, changed by ruling: the sync test "refuses an invalid or future v8 record" became the Q3 degrade and carry-through cases; an `appsJson.cleanV8.test.ts` case that used `news` as its unknown key now uses a made-up key.

### Gate receipts (2026-10-12, at d99aa3b8)
- `pnpm typecheck`, `pnpm lint`: clean at every commit; `scripts/header-check.sh`, `scripts/scrub-check.sh`: clean.
- Unit, `vitest run --maxWorkers=2 --testTimeout=120000`: 414 files passed, 6 skipped; 7288 tests passed, 29 skipped (7317).
- `pnpm build`: OK (the existing chunk-size warning only).
- Playwright, Chromium 1194 through a scratch `PLAYWRIGHT_BROWSERS_PATH` link and a scratch config (nothing installed, nothing committed): `news`, `pin`, `layout`, `card`, `workspaces`, `library` and `rss` specs: 49 passed.
- rss-ticker: not reachable from this environment; fakes only (see Wire and socket).

## Part C -- two Part B rulings, locked widgets and docks, Rita `pin_card`, the rail row

### Steps (every commit of Part C)
| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| 2d9b01b2 | C1a (ruling, Part B) | fix(v8): useNewsWire runs on the shared useReconnectingSocket's reconnect mode | f06b524c, 8d5bd15f, 38c6e4dc, 93093129 (the behaviour kept; the shared hook is clean's) |
| 9307251e | C1b (ruling, Q3) | fix(v8): an apps.json import degrades on v8 data it cannot read, imports the dashboard and says what it skipped | none named |
| d751f573 | C2 | feat(v8): the docks dashboard -- DOCKS_ID, makeDefaultDocks, hidden and dockRows on disk, firstFreeSpot | 43618f98, 1e75633d, 1fe4ecc0 (items 6, 9) |
| 3cf562a9 | C2 | feat(v8): dashboardStore holds the docks apart; card writes reach them; the edit snapshot, Cancel and OK | 1706dc4d, bd262fe9, 1e75633d, 1fe4ecc0 (items 2, 5, 8, 10) |
| 883f630f | C2 | feat(v8): DockBand and the Locked Widgets editor; a locked WidgetCard is live with nothing that changes it | 57e2c286, 2189fad7, 0887031e, 94795b7e, 0bb5cb4f, ae4c2e2d, df382291, 1fe4ecc0 (items 1, 3, 7) |
| bf2de27b | C2 | feat(v8): the bands mount around the dashboard; Settings ▸ Locked Widgets opens the editor; ⌘K adds to the dock | 5a99e719, d76d2ec6, 8db28801, df8781dc, 1fe4ecc0 (item 2) |
| ffd835a8 | C2 (R6) | feat(v8): the docks sync through the server's system route, newest revision wins | none named (the donor's docks never synced) |
| 8da4487c | C2 | feat(v8): locked widgets in the v8 envelope; Export all dashboards…; Settings' locked-widgets file pair; one import guard in runAppsImport | 5e952d3d (b0cb040d, f5f4664a, 93c6662f, 305e051a, 0543d0b5, 3ca69b78, 99210a83, 747d83e2) |
| cb3f625e | C2 | test(v8): e2e locked widgets -- the band across dashboards, Cancel undoes, the viewer, and the Export all round trip | 71841667, 1fe4ecc0 (e2e/locked.spec.ts, inside squash 5ee2e8b4); 55fe838f |
| 9f708d67 | C3 | feat(v8): Rita's pin_card, clean's 18th local tool | 85841963 |
| 573ccc78 | C4 (R5) | feat(v8): the rail's "Add widget (⌘K)" row goes; the green + adds a widget everywhere | 0d25ee2b |
| 231db3ce | C2 | test(v8): the docks import guard -- none, an empty docks replaced silently, a populated one asks | 305e051a, 0543d0b5, 747d83e2 (carried as 5e952d3d) |
| 8879d2a1 | C2 | test(v8): the settings add-ins spec's tab list gains Locked Widgets | none named (donor v8.1.2 hunk of e2e/settings-addins.spec.ts, CLEAN-APPLY) |

The table leaves out only the commit that adds it (the Part C ledger commit); `git log --reverse --format='%h %s' 85650097..HEAD` lists every commit. All seventeen commits of the locked squash 5ee2e8b4 the brief names are covered above; d8b344aa (Rita's pin is a lock) was already in clean (KEEP, see above). Not carried from the squash: the donor's help topic, shots and help-shots script hunks (the help step), its version bump, and its plan/spec docs (PROVENANCE).

### Rulings applied (user, 2026-10-12)
- C1a, the wire: `useReconnectingSocket` gains a `mode: "reconnect"` for one-frame subscriptions. The subscription goes out once when a socket opens; a changed subscription (compared by its JSON), a changed `reconnectKey` (Refresh) and, with `reconnectOnForeground`, a return to the foreground each open a new connection, and no second frame ever goes out on an open socket. `onConnect` / `onOpen` / `onDrop` hand each connection a handle: `stale()` lets per-connection work (News's REST seed, started from the subscribe reply) drop a superseded result, and `fail()` closes and retries it (the malformed-reply retry). `retryMs` keeps News's fixed 3000 ms. The default mode is Live Grid's, unchanged: its tests (`useReconnectingSocket.test.tsx`'s four, `LiveGridRenderer.test.tsx`) are untouched, and two new default-mode cases pin in-place re-subscribe and no foreground reconnect. `useNewsWire`'s own loop is deleted and `useNewsWire.test.tsx` is unchanged.
- C1b, the import degrade (mirrors Q3): what a v8 envelope carries that this version cannot read is skipped, never refused, and the dashboard imports. An envelope with unknown fields, a newer `schemaVersion` or a `cards` that is not a list loses all its v8 state; a card overlay that cannot be read (unknown field, bad pin, bad News state, foreign or duplicate slot) is skipped for that card alone; an unreadable `docks` member is skipped and the app comes in as an ordinary dashboard. The base profile, its tab order, the tabs and the JSON safety checks are not v8 data and still refuse. runAppsImport's notice names each written dashboard and what was skipped.
- Docks in the envelope (R1): the docks app's v8 envelope carries `docks: { rows: { top, bottom } }` beside `cards`, its tabs keyed by edge; never the donor's plain `dock: true` / `dockRows`. v3-v5 refuse it (UNSUPPORTED_EXTENSION at the v3 decoder), the plain OpenBB export never writes it, and on import it becomes `ImportResult.docks`, never a rail dashboard. An empty docks is not a docks (neither replaced nor a dashboard); the first docks wins.
- Docks sync (R6, R6a, R6b, R6c) on `/pro/dash/sync/system/docks`, the contract in openbq-docker `docs/v8/news-relay-and-hidden-dashboards.md` §3: the docks are never in `dashboards`, so the owned/POST plan never sees them. After the sign-in sync's dashboards, and after a docks edit ends (a write outside the editor, or the editor's OK or Cancel; debounced like dashboard uploads), `syncDocks` GETs; a newer server record is taken whole at its revision (`applySyncedDocks`, no bump); a newer local copy is PUT with exactly `{revision, content}` and a 409's record is taken; equal does nothing; a 404 keeps the docks local and logs it once per session (no notice). `revision` is the last docks edit time in epoch ms, never backwards (`nextRevision` for the docks). Same request path, so Basic in key mode and Bearer in login mode. `content` is `{ schemaVersion: 1, profile: "v8", dashboard }`, the docks as docks.json holds them; a record this client cannot read is left alone and the local docks kept (Q3), quietly. One docks per account; global across local workspaces.
- Export/import through clean's `runAppsImport`: the one docks guard (`lib/docksImport.ts`: an empty docks replaced silently, a populated one asks Replace / Keep mine) runs there, so the rail's Import, a dropped file and Settings ▸ Locked Widgets' Import share it; no DropZone/LeftRail tails.

### Deviations from the donor
- Docks in the v8 envelope and synced on the system route (R1, R6); the donor wrote plain `dock`/`dockRows` fields and never synced the docks.
- The docks' revision is an epoch-ms edit time (R6a), not the dashboards' counter.
- `load` normalises the docks to the two edges under their fixed names; a tab keyed otherwise is not carried (the donor kept it and refused adds to it).
- Duplicate inside a band takes `firstFreeSpot` too; the docks keep their own groups through `ownerOfGroup`.
- A locked card also hides Duplicate, Copy to, linked cards, Choose source, the Pivot toggle and Open file… (clean items the donor had no line for); a docks card never offers Pin widget, in the editor too.
- `removeCard` on a docks card is a plain docks write with no Undo toast (the editor's Cancel is its undo).
- `DockBand` uses `compactType={null}` (bdobb#6) and a per-card ErrorBoundary; the editor's insets follow the pinned rail and Rita's pane.
- Export all dashboards… writes each dashboard BDOBB-compatible (to carry state and the docks), and is refused, naming the dashboard, when one cannot be.
- `pin_card` on a locked card is a no-op with no undo step, answered `pinned: false`; the donor answered `pinned: true` after a store no-op.
- The donor's `DOCK_EDGES` is not carried; `PIN_EDGES` serves.

### Review notes (clean assertions changed)
- REVIEW, `src/components/dialogs/SettingsDialog.tsx` comment: it said clean "always starts a fresh draft" because no flow reopened the dialog mid-edit. The donor's Locked Widgets flow is carried, and the comment now says how every opening still starts fresh: Locked at Top… / Bottom… discards the draft and closes the dialog, and the editor's Cancel reopens Settings as a new mount.
- REVIEW, `src/components/dialogs/SettingsDialog.test.tsx:178` "renders the four app tabs ... with no Locked Widgets tab": now five tabs, Locked Widgets before Logs. Every assertion in `SettingsDialog.test.tsx` (29 counts, 7 lists) and `SettingsDialog.legacyV4.test.tsx` (3 counts, 8 lists) that counts or lists the tabs gains it the same way (+1, after Layout) and nothing else.
- REVIEW, `src/lib/agent/localTools.test.ts:30-34`: the comment that pin_card is absent "until v8.1" now says it lands here; the exact tool list and "all 17" (now "all 18") gain `pin_card` and nothing else.
- REVIEW, `src/components/LeftRail.test.tsx` "opens the library from the rail's Add widget button, after collapsing" is replaced by "has no Add widget row of its own" (the collapse-then-open order stays pinned on the Widget Library row); "rail icons" lists four rows instead of five, and "accents exactly one icon" becomes "accents no icon in the rail", as the donor's.
- REVIEW, `e2e/settings-addins.spec.ts`: the exact Settings tab list gains "Locked Widgets" after Layout; the donor's own v8 hunk, verbatim (manifest CLEAN-APPLY).
- REVIEW, `e2e/layout.spec.ts` collapsed-rail test: one accented icon becomes zero, as the donor's; comments in `e2e/layout.spec.ts`, `dashboards.spec.ts`, `rail.spec.ts` and `parity.spec.ts` follow the removed row.
- v8 code from Parts A and B, changed by ruling: `appsJson.cleanV8.test.ts` "refuses unknown v8 state, a bad edge, a foreign slot and a future schema" and "refuses malformed News state" became degrade cases that still prove the unreadable data is not taken (and that the readable pins, the dashboard and the skip report come through); the base and tab-order refusals stay as their own case.
- `src/stores/dashboardRevision.test.ts`: the six docks actions (`beginDockEdit`, `cancelDockEdit`, `commitDockEdit`, `setDockRows`, `applySyncedDocks`, `importDocks`) are classified in their own `DOCKS` list, and setDockRows and a restoring Cancel are driven to move the docks revision in memory and on disk. Nothing removed.

### Help pages that still describe the rail's "Add widget (⌘K)" row (R5; for the help step)
- `src/help/topics/the-left-rail.md` (lines 16, 20, 74)
- `src/help/topics/getting-started.md` (line 27)
- `src/help/topics/widget-library.md` (line 4)
- `src/help/guide/layout-and-navigation.md` (lines 18, 21, 36)
- `src/help/guide/widget-library.md` (line 8)
- `src/help/guide/installing-and-running.md` (line 41)
- The shots that show the row (the left rail, getting started, widget library, dashboards and folders) are re-shot with the help step.
- Done in e9d7cff3 (every page above; the widget-library shot is the dialog alone and never showed the row). Still showing it: `ipad-light.png` / `ipad-dark.png`, simulator shots (Mac half).

### Open questions
- DELETE on the docks route (R6b) is implemented and tested (`deleteServerDocks`) but nothing calls it: emptying both edges is an edit that goes up as a PUT, which a device holding an older copy then takes, whereas a DELETE would leave that device free to PUT its older copy back. If a "forget the server's docks" action is wanted, it needs a ruling on what a device with an older copy does afterwards. A connection whose credential is query-placed would also add a second query parameter to the DELETE, which the server refuses (key mode uses Basic in the header, so this is moot for openbq-docker).
- The Apps dialog's Open (App.tsx `openApp`) builds dashboards with `planAppsImport` but does not route `plan.docks`; a backend app marked as docks is therefore dropped there rather than offered as locked widgets. Backends do not serve such apps today.
- Ruling by default (provisional, 2026-10-12, release step 1d): DELETE of the docks stays unused in 8.0.0. No "forget the server's docks" action ships; `deleteServerDocks` and its tests stay as the R6b contract for a later ruling. Emptying both edges remains an ordinary docks edit (a PUT).
- Ruling by default (provisional, 2026-10-12, release step 1d): the Apps dialog's Open of a docks app is left as is in 8.0.0 -- the docks member is dropped and the rest opens; documented in the Locked widgets help. Locked widgets reach a device through Settings ▸ Locked Widgets ▸ Import, the rail's Import, a dropped file, or the docks sync.

### Gate receipts (2026-10-12, at 8879d2a1)
- `pnpm typecheck`, `pnpm lint`, `scripts/header-check.sh`, `scripts/scrub-check.sh`: clean at every commit.
- Affected vitest files at each commit (hooks, Live Grid and News; appsJson, runAppsImport; dashboardsFile, dockLayout, the store suites and dashboardRevision; DockBand, WidgetCard, DashboardGrid, WidgetLibrary; App, SettingsDialog (+ legacyV4); the sync suites; localTools, chatStore, skills; LeftRail, railMenu).
- Unit, `vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=120000` (at 573ccc78): 418 files passed, 1 failed, 6 skipped; 7389 tests passed, 1 failed, 29 skipped (7419). The failure was `PivotParamRow.viewer.test.tsx` "viewer Page offers explicit All and empty…", the same intermittent case as Part A's run 1; alone it passed 3 of 3. `docksImport.test.ts` (231db3ce, after that run): 4 passed.
- `pnpm build`: OK (the existing chunk-size warning only).
- Playwright, Chromium 1194 through the scratch `PLAYWRIGHT_BROWSERS_PATH` link and scratch config (nothing installed, nothing committed):
  - `locked`: 2 passed. `locked`, `pin`, `news`, `layout`, `card`, `workspaces`, `settings*`, `rail*`: 62 passed, 3 failed (the two `rail-after-dialog.webkit` cases need WebKit; `settings-addins` needed its tab list, fixed in 8879d2a1, then 1 passed). `layout`, `rail`, `dashboards`, `parity` after C4: 28 passed.
  - Full suite at 8879d2a1: 280 passed, 8 skipped, 2 failed -- both `rail-after-dialog.webkit` (no WebKit here; environmental, as in Parts A and B).

## Web relay -- the News relay, socket tickets and the openbq-docker pin (R3, R3a, R3b)

### Steps (every commit of the Web relay)
| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| 2575de92 | Web (R3b) | chore(web): vendor openbq-docker's v8.0.0 gateway policy at cab61a9; openbbDocker pins that commit | a7772b2b (the re-vendor it did for od v8.0.3); 6c46a2a2 (calendar/trading cases); policy from openbb-docker v8.0.3 775354f via openbq-docker |
| 87aec291 | Web (R3, R3a) | feat(web): the News relay -- approved feeds, socket tickets, the /news/ws/news upgrade, the seeded News tab | a7772b2b |
| 912018c0 | Web | feat(browser-shim): the socket ticket shim -- a same-origin socket opens on the gateway | a7772b2b; 0d960f52 (the socket comment at v8.1.2) |
| 1a378dc3 | Web | feat(news): an empty News card on the web preview uses the preview's own /news relay | a7772b2b |
| 665610d5 | Web | docs(web): the README and the browser smoke describe this line's routes -- /api, /news, /state, no /ai | 4c349e10 (the model), a7772b2b (donor v8.1.2 README and smoke text) |

The table leaves out only the commit that adds it (the Web relay ledger commit); `git log --reverse --format='%h %s' 53cb42d4..HEAD` lists every commit. Not carried from the donor's web delta: Rita's `/ai/agents.json` case and README rows (R3a), the BDOBB2 branding, the donor's YouTube-less `frame-src` and inline `jsonBody` (clean wins), and the deletion of `web/refdemo-pin.test.mjs`.

### Rulings applied
- R3a: the gateway is openbq-docker's funnel-gateway (`web` profile, branch `claude/openbq-docker-v8` at cab61a9). Its routes, and so this layer's: `/api/widgets.json`, `/api/apps.json`, `/api/api/v1/**` (with the calendar/trading grammar), `/news/api/news?feed_id&limit=1..50`, the socket `/news/ws/news`, `/state/...`. No `/ai`: the server comment, the README and a policy test say so.
- R3b: `web/policy.mjs`'s first line is `// vendored from openbq-docker v8.0.0 funnel-gateway/policy.mjs sha256:dfa61ddf8872fe83d1447a62ed2347fe58c6509186e8f3772372d209b8e0bfd0`. The hash is the one the stack's survey recorded (`sha256sum` of the file at cab61a9 matched; the body is byte-identical). `policy.vendored.json` is `{ tag: "v8.0.0", commit: "cab61a982b6a892c598f19d829331f1331ca23d6", sha256 }`.
- The pin: `package.json` `openbbDocker` moves from `"v3.0.1"` to `"cab61a982b6a892c598f19d829331f1331ca23d6"` (ruling: the branch commit for now; it moves to the `v8.0.0` tag when the user tags). What derives from it: the pin test in `web/security.test.mjs` (a 40-hex pin must equal the vendored `commit`; a tag pin keeps the at-or-below rule) and `scripts/gateway-vendor.mjs` (`pnpm gateway:vendor v8.0.0 <commit>`, reading `OPENBQ_DOCKER_DIR`, default `~/Developer/openbq-docker`). When the tag is cut: `pnpm gateway:vendor v8.0.0` and set `openbbDocker` to `v8.0.0`. Not changed: the key's name (`openbbDocker`), the historical validation hash lists under `docs/releases/validation/`, and the help guide `src/help/guide/openbb-docker-stack.md` (help step).

### Wire and tickets
- The browser's socket opens on the gateway: `src/browser-shim/socket.ts` (under `window.__bdobbSocketTickets`) fetches `/socket-ticket?for=/news/ws/news` and opens `wss://<gateway>/news/ws/news?ticket=<13-digit expiry ms>.<22-char nonce>.<43-char sig>`; the ticket is signed by the vendored `socketTicket` (HMAC-SHA256 keyed by HMAC(GATEWAY_TOKEN, "bdobb socket ticket v1") over `<expiry>.<nonce>./news/ws/news`, 30 s, single use at the gateway).
- No second reconnect loop: `useNewsWire` stays on `useReconnectingSocket`'s "reconnect" mode (Part C). The hook reads the `WebSocket` global at connect time, so the shim is the whole integration; a refused ticket is a close the hook retries after `RECONNECT_MS`, and each retry, Refresh or feed change is a new socket on a new ticket with one subscribe frame (`useNewsWire.tickets.test.tsx`).
- `web/server.mjs` also relays `/news/ws/news` itself, for a plain Node host (`web/local.mjs`): Bearer + the gateway's own Origin upstream, which is the gateway's non-ticket admission.
- `defaultNewsBase()` / `window.__bdobbNewsServer`: an empty News card on the web preview uses `<APP_ORIGIN>/news`; on the desktop it is `""` and the card asks for a server. A card's own server wins.

### Deviations from the donor
- The policy is openbq-docker's, not the donor's v8.0.3 copy: the same admission minus `/ai/agents.json`. The donor's Rita test is replaced by one that pins every `/ai` path refused.
- `policy.vendored.json` gains `commit`, and the vendoring script takes an optional commit (a pre-tag pairing the donor never had).
- `src/browser-shim/socket.ts`'s comment names clean's one construction site, `useReconnectingSocket`; the donor named `useNewsWire`'s own loop and Live Grid separately.
- `fakeSocket.ts` gains `FakeSocket.all` and sets `readyState` to 3 on `close()`, for the hook's ticket test.
- The brief's `src/lib/http.ts` does not exist on either line; the donor's change is to `src/browser-shim/http.ts`, carried.
- `web/auth.mjs` and `web/local.mjs` need no change (the donor's delta has none either).
- Tests added beyond the donor's: feeds config fail-closed cases; 503 upgrade and ticket without feeds or gateway; `/preview-feeds.json`; a second frame (even a valid one) and an invalid or binary first frame closing with nothing forwarded; the upstream Origin and no cookie upstream; the seed URL's key order admitted; a 13-digit, 30 s ticket expiry; three more socket-shim cases; the WidgetCard fallback.

### Review notes (clean assertions changed; none weakened)
- REVIEW, `web/security.test.mjs` "web/policy.mjs is the stack's contract, verbatim, at or below the paired stack tag": the header regex names `openbq-docker` instead of `openbb-docker` (R3b; it accepts only the new name). Its hash, tag and sha256 checks are unchanged; a 40-hex pin is held to exactly the vendored commit, which is stricter than the at-or-below rule it replaces for that case, and the tag rule stays for a tag pin.
- REVIEW, `web/security.test.mjs` "path and parameter allowlist…": `/news/api/news?feed_id=7&limit=50` was asserted refused (no /news route at this line). It is now admitted for the approved id, and eight refusal cases take its place (unapproved id, limit 500 and 0, no id, no limit, an extra key, a repeated id, other /news paths), plus no id admitted with no feeds.
- REVIEW, `web/security.test.mjs` "every upgrade is refused -- no socket route exists at this line": replaced by the donor's "News upgrade authenticates cookies, exact Origin, exact path, no query token" (401, 403, and 404 for every non-news path the old test listed plus query, ticket and /ai variants), a new missing-Origin 403, the 503 cases, and the Sec-Fetch case kept as its own test.
- REVIEW, `web/security.test.mjs` "the ticket route always 404s": replaced by the donor's "issues only to a session, and only for /news/ws/news". Every other target the old test listed still 404s, and the one-`for`, no-extra-key and POST 405 checks are unchanged.
- `web/security.test.mjs` "anonymous visitors see login…": gains `/preview-feeds.json` and `/news/api/news` in its 401 list. Nothing removed.

### Gate receipts (2026-10-12)
- At every commit: `pnpm typecheck`, `pnpm lint`, `scripts/scrub-check.sh`, `scripts/header-check.sh` clean; `pnpm test:web` (33 at 2575de92, 40 from 87aec291, all pass; the relay suite three times in a row at 87aec291); affected vitest files (`src/browser-shim`, `src/hooks` incl. `useReconnectingSocket`, `useNewsWire`, `useNewsWire.tickets`, `LiveGridRenderer`, `NewsRenderer`, `news.test.ts`, `WidgetCard.test.tsx`: 26 files, 672 tests at 1a378dc3).
- Unit, `vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=120000` at 665610d5: 421 files passed, 6 skipped; 7410 tests passed, 29 skipped (7439). PivotParamRow's intermittent did not recur.
- `pnpm build`: OK (the existing chunk-size warning only). `pnpm build:web`: OK; the bundle carries the shim.
- `pnpm test:web:browser` (the smoke, through the scratch Chromium 1194 loader, nothing installed or committed): PASS, including the seeded News card's headline over a ticketed gateway socket (Playwright `routeWebSocket` verifying the ticket with `socketTicketValid`) and its `/news/api/news` seed.
- Playwright, Chromium 1194 through the scratch config and `PLAYWRIGHT_BROWSERS_PATH` link (not committed): `news`, `pin`, `locked`: 9 passed. WebKit specs not run (no WebKit here).
- Not qualified against a running gateway or rss-ticker: openbq-docker's gateway was not built or run (no Docker daemon), and rss-ticker is tailnet-only. The contract is pinned by the shared vendored policy, the stack's own 47 gateway tests and the fakes above.

### Open questions
- The `openbbDocker` key keeps its name though the stack is openbq-docker. Rename (e.g. `openbqDocker`) with the tag, or keep for continuity with v3–v7?
  - Ruling by default (provisional, 2026-10-12, release step 1a): **keep `openbbDocker`** for continuity with v3–v7. Its value names openbq-docker (the commit now, the `v8.0.0` tag when cut); the help (`openbb-docker-stack.md`) says the key keeps its historical name. Nothing renamed.
- `NEWS_APPROVED_FEEDS_JSON` must name the same feeds as the gateway's `feeds` setting, by hand. The gateway refuses two feeds sharing an id; this layer (as the donor's) does not. Mirror that check here?
  - Ruling by default (provisional, 2026-10-12, release step 1b): **mirror it.** `readConfig` refuses two approved feeds that share one id with the gateway's wording ("two feeds share one id"); `web/security.test.mjs` "configuration: … fails closed" gains the case (failed first). 6a5cd0f7.
- The seeded News tab appears whenever approved feeds are configured, even with no gateway (the donor's rule), where the card can only show an error. Gate it on the gateway too? Chosen here: the donor's behaviour, unchanged.
  - Ruling by default (provisional, 2026-10-12, release step 1c): **gate it on both.** The News tab is seeded only when approved feeds AND a gateway are configured. `web/security.test.mjs` "bootstrap contains only same-origin routes…" gains two assertions on the no-gateway seed (no News tab; the other built-ins still seeded); no assertion changed, so no REVIEW note. `window.__bdobbNewsServer` still follows the feeds alone (an empty News card on a gateway-less preview names `/news` and shows its 503) -- left as is; see the release section's open questions. bbff1b46.
- `src/help/guide/openbb-docker-stack.md` and `about-this-guide.md` still cite openbb-docker and `scripts/gateway-vendor.mjs` as before; left for the help step (help pages not touched here).
  - Done in 6a9941d9.

## Release 8.0.0 -- relay follow-ups, help, examples, the version, the cloud gate

### Steps (every commit of the release step)
| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| 6a5cd0f7 | R1b (ruling by default) | fix(web): refuse two approved feeds that share one id, as the gateway does | none named (openbq-docker funnel-gateway/config.mjs's own check, mirrored) |
| bbff1b46 | R1c (ruling by default) | fix(web): seed the preview's News tab only with approved feeds AND a gateway | none named |
| e9778d5e | R1a-d | docs(v8): record the relay follow-ups as provisional rulings by default | none named |
| e9d7cff3 | R2 (R5) | docs(v8): help no longer describes the rail's "Add widget (⌘K)" row | 0d25ee2b (its help hunks), 40903cc7 (the v8.1 snapshot of the same pages) |
| 719415a3 | R2 | docs(v8): help for News, pinned cards, locked widgets and Rita's pin_card | 3187f854 (pinned cards), af0a7b0c, ae4c2e2d, df8781dc, 01159479, 157ea078 (Locked widgets topic, shot and apps.json travel), cc502bb5 (pin_card), 9589650e, 98e3e1b9, ddb9d3ee (News in Built-in widgets), aace07e6, 8d6947ce, 40903cc7, 79a3f51b (guide snapshots: news-ticker, locked-and-pinned-widgets, web-preview) -- ported and checked against clean's code; clean's structure wins |
| 6a9941d9 | R2 | docs(v8): the stack page describes openbq-docker v8 -- the web profile and the vendoring source | 8d6947ce, 40903cc7, 1a9df418 (the donor's openbb-docker-stack edits), rewritten for openbq-docker (R3a, R3b) |
| 5c4fb1b1 | R3 | feat(v8): a pinned-cards example in the v8 envelope; every example names the BDOBB it needs | none named (the donor shipped no pinned example) |
| 9c92eefa | R4 | chore(v8): version 8.0.0 everywhere | the donor's 8.0.0 bump (manifest `version` rows), as clean v7's 446734d5 did it |
| fc762455 | R4 | docs(v8): 8.0.0 release notes and a README section | none named |

| e61faf6b | R5 (gate) | test(v8): the News and locked specs fake the wire on the mock's own port, not a literal 4174 | none named |

The table leaves out only the commit that adds it (this ledger commit); `git log --reverse --format='%h %s' bc4ea2c7..HEAD` lists every commit.

### Rulings applied (provisional, by default; recorded under the Part C and Web relay open questions)
- 1a `openbbDocker` keeps its name (continuity v3-v7); the stack help page says so.
- 1b The web layer refuses two approved feeds sharing one id, with the gateway's wording.
- 1c The preview's News tab is seeded only with approved feeds AND a gateway. `window.__bdobbNewsServer` still follows the feeds alone (open question below).
- 1d Docks DELETE stays unused in 8.0.0; the Apps dialog's Open of a docks app stays as is, documented in the Locked widgets topic and guide page.

### Help (R2)
- Quick Help: three new topics, News, Pinned cards, Locked widgets (TOPIC_ORDER: after Widget cards; News after Built-in widgets), and updates to The left rail, Getting started, The widget library, Widget cards, Built-in widgets, Settings and logs, Import and export, Dashboards and folders, Keyboard shortcuts, Rita, Troubleshooting. Every page the Part C list named is rewritten; no topic or guide page names "Add widget (⌘K)" (pinned by a test in each suite).
- Guide: two new pages under Widgets, The News Widget (news-widget) and Locked and Pinned Widgets (locked-and-pinned-widgets), ported from the donor's news-ticker and locked-and-pinned-widgets pages; the donor's rss-feed-sources page is not carried (its facts, rss-ticker on the stack's web profile at tailnet port 8088, sit in the News page and the stack page). Updated: Layout and Navigation, The Widget Library, Installing and Running, Widget Cards, Built-in Widgets, Settings and Logs, Import and Export, App Data and Settings, Dashboards and Folders, Keyboard Shortcuts, Rita AI Agent Setup (pin_card's row), Rita Chat, Troubleshooting (Using BDOBB), Web Preview, Example Dashboards, About This Guide, home, and The openbb-docker and openbq-docker Stacks (renamed title, same slug; openbq-docker v8's web profile: funnel-gateway and rss-ticker, /api /news /state, no /ai; the vendoring source).
- Shots: `pnpm help:shots` (scripts/help-shots.mjs) under Chromium 1194 through the uncommitted scratch launcher (`node --import <scratch>/pw-chromium-1194.mjs`, `chromium.launch` given `executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome`; nothing installed, nothing committed). New entries news, pinned-cards and locked-widgets (the wire faked at the page's edge as e2e/news.spec.ts fakes it); re-taken the-left-rail, getting-started, dashboards-and-folders, widget-cards, import-and-export and settings-and-logs. 9 slugs, 18 PNGs, both themes, each looked at.
- Help suites: `vitest run src/help scripts/help-shots.test.mjs` passed at each help commit.

### Examples (R3)
- `docs/examples/v8.0.0-pinned.apps.json` (new): written by `exportCompatibleApp` (a scratch generator, not committed), then two hand edits (the Clock band 7 rows, a Note sentence); the v8 envelope carries `cards[].pinned` top and bottom.
- Every example's description names the minimum BDOBB it needs; the minimum named is the release line each shipped with (3.0.0 for the v3.x files, which are all on `release/v3`). The Treasury example names 5.0.0 though its v4 envelope's floor is 4.0.0 (not verified on a 4.0.0 build, so the conservative number).
- `appsJson.examples.test.ts`: the pinned case; every file's description names "BDOBB X.Y.Z or later" of its own line and not below its envelope; no file carries docks.
- `scripts/apps-sync.mjs`: OWNER gains `v8.0.0-pinned` -> `workspace_apps.json`. Dry run `EPISODE=8 OPENBB_DOCKER_DIR=<scratch>`: 10 apps, both v8 examples (EPISODE=7: 8). Nothing written to openbq-docker.
- Observed, not changed: the script still names openbb-docker (`OPENBB_DOCKER_DIR`, default `~/Developer/openbb-docker`) and writes `workspace_apps.json`; openbq-docker serves the examples from `examples/bdobb/apps.json`, which at v7 (4cad478) holds that output filtered to the examples whose cards it serves (Demo providers and Video Library left out). The v8 sync into `claude/openbq-docker-v8` is the post-freeze step the overnight plan names.

### Version (R4)
- 8.0.0 in package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, Cargo.lock's bdobb entry (by `cargo metadata --offline`), src/help/guide/VERSION, the guide home and About This Guide; version.test.ts and guide.test.ts failed first.
- `docs/releases/v8.0.0-release-notes.md`: no v7 release-notes file exists on any branch (`release/v3`-`release/v7`, `main`); the notes follow the published v3.0.0 release text and v7's README section. The card-extensions fix is the placeholder line "card extensions kept on save (fix carried from v4–v7)".

### Deviations
- Release notes have no v7 file to model on (above).
- The shots are Linux renders of Chromium 1194; the v7 set was rendered on a Mac, so fonts differ between re-taken and untouched shots. Only shots whose UI the v8 work changed were re-taken.
- `ipad-light.png` / `ipad-dark.png` (the iPad topic, from the iPad simulator) still show the rail's Add widget row; they need the simulator (Mac half).
- The Quick Help "Troubleshooting" raw-JSON section named `live_grid`, news feeds and the Highcharts/Vega-Lite charts as types the app does not draw; this line draws all of them (the guide's own list says so). The sentence is replaced, not extended.
- The left rail's row order in the v7 help (Apps above LIBRARY) never matched the rail; corrected while removing the row.

### Review notes (clean assertions changed; none weakened)
- REVIEW, `src/help/index.test.ts` "is the v7 topic set…" -> "is the v8 topic set…": the exact list gains pinned-cards, locked-widgets and news and nothing else.
- REVIEW, `src/help/guide.test.ts` "starts at home and lists every page in exactly one section": exact count 40 -> 42 (the two new pages).
- REVIEW, `src/help/guide.test.ts` "states the real tool surface and limits": /17 local tools/ -> /18 local tools/ (pin_card, 9f708d67).
- `src/help/guide.test.ts` "guide pages mention v8.0.0 consistently" and `src/lib/version.test.ts` "is the clean v8 development version": the version bump, as v7's; the guide case also pins About This Guide's version.
- `web/security.test.mjs`: the config case and the bootstrap case gain assertions (1b, 1c); nothing changed.
- To keep the help search's pinned "pinning" -> Tables expectation (`search.test.ts`, also typed by the e2e and HelpDialog tests), the Pinned cards topic avoids the word "pinning"; no assertion changed.

### Gate receipts (cloud half)
Run 2026-10-12 at fc762455 (all release commits before the spec fix), by a scratch copy of the v7 gate script (not committed; one log per gate, paths scrubbed), on a 4-core host shared with another session's test runs (load 5-8). Chromium is the preinstalled 1194 build: the e2e and the browser smoke ran through an uncommitted scratch Playwright config (`launchOptions.executablePath` /opt/pw-browsers/chromium-1194/chrome-linux/chrome, WebKit specs ignored) and `NODE_OPTIONS=--import <scratch launcher>`; nothing installed, nothing committed. Ports 4651/4652 (the other session held 4641/4642).

| Gate | Command | Result |
|---|---|---|
| typecheck | `pnpm typecheck` | pass (65 s) |
| lint | `pnpm lint` | pass (50 s) |
| unit | `vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=120000` | 421 files passed, 6 skipped; 7444 tests passed, 29 skipped (7473); 772 s. `PivotParamRow.viewer.test.tsx` passed in the run (16) and again alone (16); its intermittent did not recur. |
| revision-test | `vitest run src/stores/dashboardRevision.test.ts` | 54 passed |
| build | `pnpm build` | pass (the existing chunk-size warning only) |
| e2e | `playwright test` (scratch config, Chromium) | 278 passed, 8 skipped, 2 failed (47 min): `news.spec.ts:53` and `locked.spec.ts:55`. Cause: both specs routed the fake wire at a literal `ws://127.0.0.1:4174` while the card's server follows `BDOBB_MOCK_PORT` (4652 here). Fixed in e61faf6b (URL from `MOCK_URL`): red on 4651/4652 before (2 failed), then `news`, `locked`, `pin` 9 passed on 4651/4652 and `news`, `locked` 3 passed on the default ports. The two `rail-after-dialog.webkit` cases are WebKit-only and were not run (Mac). |
| web | `pnpm test:web` | 40 of 40 pass |
| build-web | `pnpm build:web` | pass; private function built, nothing deployed |
| web-browser | `pnpm test:web:browser` | PASS, including the seeded News card's wire over a ticketed gateway socket and its `/news/api/news` seed |
| scrub | `pnpm scrub` (scrub-check + header-check) | clean |
| help | `vitest run src/help scripts/help-shots.test.mjs` | 94 passed |
| notices-check | `pnpm notices:check` | exit 1, environmental: the generator lists the platform's `@napi-rs/canvas` binary, `-darwin-arm64` in the committed file and `-linux-x64-gnu` here; that is the only diff (regenerated, compared, reverted). Mac half. |
| diff-check | `git diff --check 8eb9ff6a HEAD` | clean |

Not run here (as in Parts A-C): `cargo check` / `cargo test --lib` (the Tauri crate needs GTK/WebKitGTK on Linux), `pnpm test:dashsync` (needs the local key-mode server container), `ios:check` / `ios:sim`. After e61faf6b: `pnpm typecheck` and eslint on the two specs clean.

### The Mac half (pending; not run here)
- WebKit e2e: `pnpm exec playwright test -c .superpowers/playwright.webkit.config.ts` over the WebKit set v7 ran (drop, layout, rail, rita-arrange, rita-edit-bar, rita-no-url, rita, smoke, rail-after-dialog.webkit), plus the v8 specs (pin, news, locked).
- Native macOS build (`pnpm tauri:build`), `cargo check` / `cargo test --lib` (the Tauri crate needs GTK/WebKitGTK on Linux, absent here), and `pnpm notices:check` (it lists the platform's `@napi-rs/canvas` binary, so only the Mac matches the committed file).
- iPad: `pnpm ios:check` and `pnpm ios:sim` on the iPad simulator; re-take `ipad-light.png` / `ipad-dark.png` (they still show the rail's Add widget row).
- Live openbq-docker web profile: `docker compose --profile web up -d` on the v8 branch, the gateway's preflights, the Funnel swap, and the web preview against it (`/api`, `/news` with approved feeds, the ticketed socket, `/state`); the docks sync against the live key-mode and login-mode routes (`pnpm test:dashsync` and the docks route); the News card against a live rss-ticker on tailnet port 8088.

### Open questions (release step)
- ~~`window.__bdobbNewsServer` follows the feeds alone~~ Ruling by default (provisional, 2026-10-12): gated on feeds AND a gateway, like 1c's tab, so a gateway-less preview's empty News card asks for a server instead of showing the relay's 503. `web/security.test.mjs` gains one assertion on the no-gateway bootstrap (failed first); none changed.
- The Treasury example could name 4.0.0 (its envelope's floor) if a 4.0.0 build imports it; not verified here.
- `scripts/apps-sync.mjs` still targets openbb-docker by name and file; for openbq-docker the output is copied, filtered, into `examples/bdobb/apps.json`. Teach the script openbq-docker's target (and its filter), or keep the manual step?

## Merge of the v7 rebuild (ba935b5)

`git merge origin/main` (no rebase) into `claude/clean-v8` at de951a1d, as 0ff3b8bd "Merge v7 rebuild ba935b5 into v8". `origin/main` = `origin/release/v7` = tag `v7.0.0` = ba935b53, the v7 overnight rebuild (PR #49), which carries the v6.0.0, v5.0.0 and v4.0.0 re-cuts (PRs #48, #47, #46). v8 was built on v7 427fd918 and had already merged the v7 card-extensions re-freeze 4a464c9e (27d3191d), so the merge base is 4a464c9e; 147 commits of `427fd918..origin/main` are new here (133 after 4a464c9e). The card-extensions fix from `origin/claude/fix-card-extensions-v7` (9457c38d) merged clean against v8's 27d3191d, as expected.

What v7 brings (receipts on `main` under `docs/releases/validation/{v4-integration,v5,v6,v7}/overnight-rebuild-2026-10-14/`): PR #45's Rust Pivot foundation (`crates/pivot-core`, `crates/pivot-wasm`, the Wasm worker, the SSRM-ready provider contract, `pnpm pivot:*`); the v4 RC click-test fixes (backend-table Pivot button, leaf Count); the 10-12 v3 repair fixes (Save… with its Format pop-up, date filter boxes, Clear on one line, headerName exports, Library scroll, Apps Backend filter, OpenBB logo); PR #44 (Workspaces: minimum resolution, uniform zoom, Open at launch, the Workspaces dialog); Connections Export…/Import…; File ▸ Import apps.json…; the rail-notice timeout; apps-sync into openbq-docker; keysave via openbq-api; the Date expression tab; the help relaunch for openbq-docker; the Run tooltip hard refresh; CI (WebKit install, 6 GB heap, the pivot job); `web/server.mjs` (`.wasm` MIME, `'wasm-unsafe-eval'`) and its two `web/security.test.mjs` cases.

### Conflicts and their resolution
| File | Resolution |
|---|---|
| `package.json` | Version 8.0.0 (v8). `openbbDocker` keeps v8's full pin `cab61a982b6a892c598f19d829331f1331ca23d6` (the web policy's vendoring source; `web/security.test.mjs` holds it to `policy.vendored.json`'s commit). v7's new `openbqDocker` key (the stack BDOBB pairs with; v7 `"v7.0.0"`) is kept and names the same openbq-docker v8 commit (provisional, see Open questions). v7's `pivot:*` scripts auto-merged. |
| `scripts/apps-sync.mjs` | v7's script (target openbq-docker `examples/bdobb/apps.json`, `SERVED` map, logo, `OPENBQ_DOCKER_DIR`) wins; v8's two examples are added as `"v8.0.0-news": true` and `"v8.0.0-pinned": true` (built-ins only). Dry run into a scratch tree: `EPISODE=7` 6 apps, `EPISODE=8` 8 apps (both v8 examples). Nothing written to openbq-docker. |
| `src/components/LeftRail.tsx` | v7's `saveDashboard` (Save…) replaces v8's `exportDashboard`; v8's `exportAllDashboards` stays. Only `exportAll` is still imported from `appsJson`. |
| `src/components/railMenu.test.tsx` | Combined: the section menu offers Import apps.json… and Export all dashboards… and no Save…; a dashboard row offers Save… and not Export all dashboards…. |
| `src/components/LeftRail.test.tsx` | Both sides kept: v8's Export all dashboards… case and v7's Save… cases (the #18 case under v7's title). Two interaction cases added (below). |
| `src/components/WidgetCard.tsx` | v7's backend-table **Pivot** button (v4 RC be665778) is kept and gated `!locked`, matching v8's gate on the worker `PivotToggle`; a locked card's `TableRenderer` gets no `onPivotOpen`, so its pivot strip offers no edit. |
| `src/components/WidgetCard.test.tsx` | Both appended suites kept (v8's pin, News, rail chrome and locked; v7's "Pivot on a backend table"); one case added (below). |
| `src/help/guide/openbb-docker-stack.md` (deleted on v7, modified on v8) | Deleted, as v7's relaunch (12ec4514) did. Its v8 content (BDOBB 8.0.0 pairs with openbq-docker v8.0.0, the `web` profile table, the three families and no `/ai`, the Funnel swap, the hidden docks route, the vendored gateway policy) moves into v7's `openbq-docker-stack.md`, whose intro now names both keys. The openbb-docker lineage section is not carried (v7 dropped it). |
| `src/help/guide/{backends-and-connections,card-parameters,connecting-a-backend,date-expression,provider-keys,troubleshooting-infrastructure}.md` | v7 wins: v8 had only retitled the stack link; v7 rewrote the text for openbq-docker and links `openbq-docker-stack`. |
| `src/help/guide/tailscale-networking.md` | v7 wins, plus one sentence: the `web` profile's Funnel on 8443 (after the `serve-funnel.json` swap) is the one exception to "Funnel is off"; 443 stays tailnet-only, 8088 is never funnelled. |
| `src/help/guide/web-preview.md` | v8's page (the preview against openbq-docker v8's gateway) wins, since v8 brings the gateway back; v7's facts are kept as a paragraph: the preview needs the gateway, openbq-docker v7 had none and Funnel off, so 7.0.0 shipped no preview; nothing in the desktop app depends on `web/`. Links to `openbq-docker-stack`. |
| `src/help/guide/home.md` | v7's stack line, extended with v8's web profile and vendored policy; v8's Web Preview line (v7's "not available" is no longer true); the Example Dashboards line names the iPad and the two 8.0.0 samples. |
| `src/help/guide/example-dashboards.md` | v7's openbq-docker intro and sections, plus v8's two "Every example names the BDOBB it needs" and "No example carries locked widgets" paragraphs and its two 8.0.0 sections; the intro says openbq-docker v8 takes them by `EPISODE=8 pnpm apps:sync`. |
| `src/help/guide/about-this-guide.md` | v7's companion-repository list (openbq-docker overlays, agent-rita) plus v8's v8-stack sources and the vendoring sentence; Integrations row combined (v7's "web preview not available" clause replaced by v8's web sources). |
| `src/help/guide/installing-and-running.md` | v7's step 1 (openbq-docker publishes no host port for its API) with v8's step 2 (no Add widget row); v7's stack link. |
| `src/help/guide/layout-and-navigation.md`, `src/help/topics/the-left-rail.md` | The Add widget (⌘K) row stays removed (R5); v7's Apps text (grouped by backend, **Search apps** and the **Backend** select) moved onto the Apps row that remains. |
| `src/help/guide/import-and-export.md`, `src/help/topics/import-and-export.md` | v7's Save… row/sentence plus v8's Export all dashboards…, locked-widgets and `rss-agg.json` rows; File ▸ Import apps.json… added to the ways in. |

Auto-merged but changed for the merge: `src/help/guide/news-widget.md` (stack link); `src/help/topics/{news,pinned-cards,locked-widgets}.md` and `src/help/guide/locked-and-pinned-widgets.md` (the old **Export BDOBB-compatible apps.json…** / **Export OpenBB apps.json…** names become **Save…** in the **BDOBB Workspace** / **Strict OpenBB Workspace** format; File ▸ Import apps.json… joins the import paths that run the docks guard).

### Interaction of v7's rail and menu features with v8 (checked, fixed where needed, tested)
- **Save… and the v8 envelope.** Save…'s **BDOBB Workspace** format is `workspaceApp` → `exportCompatibleApp`, which wraps in the v8 profile whenever a dashboard holds a pin or News state; **Strict OpenBB Workspace** is `exportApp`, which writes neither. Save… is per dashboard, so it never carries the docks (they are not in `dashboards`); every dashboard plus the docks still go by **Export all dashboards…** (section menu, unchanged). New case `LeftRail.test.tsx` "Save… as BDOBB Workspace carries the v8 envelope (pins, News feeds); Strict writes neither, and no docks": profile `v8`, `cards[]` with `pinned: "top"` and the News feeds, no `docks`, notice *Exported Main with BDOBB v8 state.*; the Strict file has no `extensions`, no pin, no feed, no locked widgets. No code change was needed.
- **File ▸ Import apps.json… and the docks guard.** v7's menu event `menu://import-apps` runs the rail's own `importAppsFile`, which ends in `runAppsImport`, where v8's one docks guard (`resolveDocksImport`) lives. New case `LeftRail.test.tsx` "File ▸ Import apps.json… goes through the docks guard": an `exportAll` file holding only locked widgets fills empty bands without asking, the notice ends *and replaced your locked widgets*, and no dashboard is added. No code change was needed.
- **The backend-table Pivot button and locked widgets.** Fixed in the merge (above): hidden on a locked card. New case `WidgetCard.test.tsx` "is not offered on a locked backend table (v8 locked widgets)" (the table still renders).
- **The rail-notice timeout.** v8's notices on the rail (Export all dashboards…, the import's docks outcome) are ordinary `setNotice` calls, so they clear after ten seconds or on fold like v7's; nothing to change.
- **Workspaces zoom and v8 bands.** v7's uniform zoom scales the workspace grid with CSS `zoom` and divides a tile's measured maximize insets by it (`WorkspaceTile.tsx`); v8's `.card-dock.card-maximized` reads the same tile insets, and the bands live inside each tile's dashboard, so they zoom with it. Covered by `e2e/workspaces.spec.ts`, `workspace-resolution.spec.ts`, `pin.spec.ts` and `locked.spec.ts` in the gate; no code change.
- **News card and pin_card.** v7 changes no News, docks or agent code: Rita's local tools stay 18 (`pin_card` the 18th); `localTools.test.ts` unchanged.
- **The web layer.** v7's `web/server.mjs` CSP gains `'wasm-unsafe-eval'` in `script-src` and `.wasm` MIME; v8's per-response `connect-src` widening for the gateway's `wss:` origin applies to the merged CSP string unchanged. `pnpm test:web`: 42 (v8's 40 plus v7's 2).

### Review notes (assertions changed by the merge; none weakened)
- REVIEW, `src/help/guide.test.ts` "describes openbq-docker v8's web profile and the vendoring source": reads `openbq-docker-stack` instead of the deleted `openbb-docker-stack` (v7's relaunch). Every string is still required, and `` `openbqDocker` `` is added.
- REVIEW, `src/components/railMenu.test.tsx` "offers Import apps.json… only on the section menu": v8's "no Export OpenBB apps.json… on the section menu" became v7's "no Save… on the section menu" (the old item no longer exists anywhere, so its absence would prove nothing); v8's "Export all dashboards… is on the section menu" is kept.
- REVIEW, `src/components/railMenu.test.tsx` "offers Open in a new window and Save… only on a dashboard row": v7's renamed row, plus v8's "no Export all dashboards… on a dashboard row".
- REVIEW, `src/components/LeftRail.test.tsx` "names the profile the compatible export actually wrote (#18)" became v7's "names the profile the BDOBB Workspace save actually wrote (#18)", driven through Save…; the same `v4` profile and notice are asserted.
- Added, nothing changed: the three interaction cases above.
- Counts and lists both sides touch, checked: rail rows (v7 adds none; v8's four rows and "accents no icon" stand), Settings tabs (v7 adds none; five), Rita's local tools (18), Quick Help topics (v7 adds none; v8's set), guide pages (42: v7 swapped `openbb-docker-stack` for `openbq-docker-stack`, v8 added two), shots (v7 changed none).

### Shots
- `dashboards-and-folders` (both themes) re-taken: the dashboard-row menu now shows **Save…** where it showed the two export rows. Taken with `pnpm help:shots --only dashboards-and-folders` under the scratch Chromium 1194 launcher (not committed), a browser-mode render, so the row reads **Save… ▸** (the browser build's format flyout; the desktop shows **Save…** and the Save panel's Format pop-up).

### Gate receipts (cloud half, 2026-10-14, at cf4e6e65)
`docs/releases/validation/v8/v8-refreeze-2026-10-14/` (README, `run-gates.sh`, `gates.tsv`, one log per gate, `head.txt`; paths scrubbed). The script is the v8 freeze script plus the v7 rebuild's Linux-runnable gates (smoke, the build's 6 GB heap, `pivot:test`, `pivot:verify`, `test:pivot:packaging`, the Pivot browser specs on Chromium), with the diff check from the merge base 4a464c9e. Chromium 1194 through the scratch config and preload (not committed, deleted after); Rust 1.98.1 + `wasm32-unknown-unknown` and wasm-bindgen 0.2.128 (`.pivot-tools/`, gitignored) installed for `pnpm pivot:build`, as `scripts/pivot-toolchain.json` pins them.

| Gate | Result |
|---|---|
| typecheck, lint | pass |
| unit | 437 files passed, 6 skipped; 7946 tests passed, 29 skipped (PivotParamRow's intermittent did not recur) |
| revision-test | 54 passed |
| build | pass (6 GB heap) |
| smoke | clean |
| e2e (Chromium) | 286 passed, 8 skipped (opt-in dashboard-sync ×7, reference-acceptance), 0 failed, on the rerun; see below |
| web | 42 of 42 |
| build-web | pass |
| web-browser | PASS (News over a ticketed gateway socket) |
| scrub + header | clean |
| help | 94 passed |
| notices-check | pass (v7's 105ca581 dropped the per-platform canvas binary; the 10-12 environmental diff is gone) |
| pivot-test | crates and `wireCodec.test.ts` (17) pass |
| pivot-verify, pivot-packaging | pass |
| pivot-browser | 8 passed (`pivot-chromium`) |
| diff-check | clean |

The first e2e run failed 14 cases, all from the scratch Playwright config: it replaced the repository config's `testIgnore` (v7 ignores `rust-pivot*.spec.ts` there, which run under `playwright.pivot.config.ts` and passed as `pivot-browser`) and its WebKit pattern missed v7's `date-filter-webkit.spec.ts` (WebKit-only, Mac half). With the scratch config corrected (base ignores kept, `[.-]webkit.spec.ts` left out) the full e2e ran again: 286 passed. Not run here: the Tauri crate's `cargo check` / `cargo test --lib` (GTK/WebKitGTK), `pnpm test:dashsync`, and every WebKit project (Mac half, listed in the receipts README).

`git merge-base --is-ancestor origin/main HEAD`: true (`main` fast-forwards to v8).

### Open questions (decided by the recommended option; provisional)
- `openbqDocker` at 8.0.0: keep v7's `"v7.0.0"` or name the v8 stack? Ruling by default (provisional, 2026-10-14): **the same openbq-docker commit as `openbbDocker`** (`cab61a9…`), because 8.0.0 needs v8's gateway and docks route; both move to the `v8.0.0` tag together when it is cut. Nothing reads the key in code.
- The stack page's slug: v7's `openbq-docker-stack` replaces v8's `openbb-docker-stack`, and the openbb-docker lineage section v8 kept is dropped with v7's relaunch. Ruling by default (provisional): v7's slug and scope, v8's web-profile and vendoring sections inside it.
- The two 8.0.0 examples are mapped in apps-sync but not yet synced into openbq-docker's v8 branch (this session does not touch openbq-docker); the example page says they open from their files until that sync. Ruling by default (provisional): the sync stays the post-freeze step the overnight plan names.
