<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. SPDX-License-Identifier: Apache-2.0 -->

# Clean v9 assembly ledger

Base clean v8.0.0 FREEZE de951a1d (handoff commit cfd63d7 on top). Branch `claude/clean-v9`, local only.
Donor: bdobb-dev/bdobb-v2 v9.6.3 5cfe1395; delta measured from v8.1.2 28aeb65a (the v8 donor, an ancestor of v9.6.3): 261 commits, 105 files.
Server facts: bdobb-dev/openbb-docker v9.6 line (`openbb-eodhd/`, read at v9.6.3 99864f2 and v9.6.6); the server port itself is on openbq-docker `claude/openbq-docker-v9`, in parallel, and is not recorded here.
Clean and donor share no Git ancestor, so every carry is a hand port; donor commits are named per step and no donor Git objects are kept.
Dispositions: `docs/releases/v9-delta-manifest.tsv` (105 donor-changed paths: 87 EXCLUDE, 10 MERGE, 1 ADD, 7 PROVENANCE). Status column as v8's: SAME-BASE, DIVERGED, NEW, and ABSENT for a path the donor modified that clean never had (v8's manifest used it once).

## Status: 9.0.0 candidate -- every v9 carry made, help and example written, version 9.0.0; gate not run; not frozen (superseded: frozen 2026-10-12, rebased onto release/v8 and re-frozen 2026-10-14, below)

Commits are local. The full gate (unit, e2e, web, build) is the next agent's; this step ran typecheck, lint, the affected vitest files, `src/help` and `pnpm scrub` (receipts below). No FREEZE commit, tag, push or release branch. Live EODHD checks: **NOT_RUN** (`EODHD_API_KEY` absent; 0 of the 5,000-call cap used).

## What the delta is

The donor's v9 line was cut from before v8.1.2 and then re-received v8.1.2's work commit by commit (the `carry: merge v8.1.2 into cut/v9.x` series and the cherry-picked fixes). Those commits net to nothing between v8.1.2 and v9.6.3, and clean v8 already has each of them (v8-assembly, KEEP). The net delta is:

1. the Calendar view's 9.x backport (c8ad6a77 and its follow-ups) -- clean has the view since v4;
2. the Pivot provider suggestion (a385fdef PR #164, 16d3ead3 PR #165) -- clean has the pill, not the widgets.json parse;
3. the calendars example (4121eb9e, a145640a) and its apps-sync row (fb4517e7);
4. the donor's rename of `lib/calendar` to `lib/tradingCalendar` (import paths only);
5. version bumps, web-layer pairing comments (od v9.6.4), help vault snapshots, regenerated shots, design docs, and the arrangeTable/tableProfile suggestion fields clean does not have.

## Donor delta already in clean (KEEP, nothing carried)

| Donor work | Donor commits | Clean evidence |
|---|---|---|
| News strip: horizontal strip, auto-scroll, drag, double-tap, [-N], headline decode, rail menu no-wrap | 6893daef, f88a222c, fdcac6ac, 9c5b7f96, f011d592, d8f6aa58, a98194df, 9043a5da, 01487b38 (and their re-cuts) | `NewsRenderer.tsx` is byte-identical to the donor tip; `news.ts` `decodeEntities`, `[-N]`; menus are clean's portalled `MenuPanel` (v8 Part B) |
| bdobb-settings.json Export / Import / drop | e7c3b8e1 … 9dc490e4, 23521e5d, ab21ffa4 (and re-cuts) | `settingsBundle.ts` (superset, v8 KEEP). It writes no Connections: `backends.json` stays out, so v6's help ("Connections have no export") stays true and no credential export is added |
| apps-sync per-backend routing with an EPISODE ceiling | fb4517e7, 4121eb9e | `scripts/apps-sync.mjs` OWNER and `EPISODE` (v8); only the v9 row is new (a0ddc85) |
| library overlay focus | 7cc78a52, 72c180d3, 6744e03a | `WidgetLibrary.tsx` focus in and back to the opener |
| chart keeps zoom; a params change restarts from full extent | 20908c53 / 6dc4b41c / f86d6a07, c61fdc00 / a7743a0c / 14fe07ec | `plotly.ts` `uirevision`; `WidgetCard` keys it by `paramsKey(query)` |
| scrub patterns (GitHub token, PEM, design docs) | d45a0a59, ea232146, 89cfb90c | `scripts/scrub-check.sh` |
| row context menu is a valid focus target | 95f42bea, b0bc4b60, 1506d853 | `RowContextMenu.tsx` (`role="menu"`, `tabIndex={-1}`, better) |
| private-network warnings: MCP servers, backend apps, settings bundle | 2b010cc5 … 8def7781, a4863897, dfe6a5a6 (carries of main ac2d3475) | `privateHost.ts`, `importedMcp.ts` byte-identical; `App.tsx` logs the warning when opening a backend app; `aiLibraryFile.ts`, `settingsBundle.ts` |
| iframe origin, widgets.json deadline, unreadable-file guard, pdf.js abort/page, table dotted field and sorts, saveTextFile test, Quick Help / Reference Manual | e56498d4 … bb2eecef, da80cd32 (and re-cuts) | as v8-assembly's KEEP table |
| Calendar view (modes, Type / Series, Source → Release → Statistic tree, logos, business days, range write) | c8ad6a77, 028e32d2, 7717f3f8, fd8daafc | `calendarView.ts` byte-identical to the donor's `calendar.ts`; `CalendarRenderer.tsx` better (only an amount abbreviates, full amount in the tooltip, overrides read every row's keys, logos keyed by URL); `cardViews`, `types`, `dashboardStore` merge, v4 envelope `calendar` |
| calendar filter is a group, surfaces named | 8276661f | back-ported in 1588a8e; clean names the grid `role="grid"` "Calendar dates" |
| Pivot suggestion pill, `pivotSuggestion.ts`, `TableColumn.hint`, `AggregationHint` | a385fdef | `pivotSuggestion.ts` and its test byte-identical; `PivotPanel` pill and tests (provenance: approved into v4). See V9-P1: no surface mounts that panel |
| Apache-2.0, SecretoftheUniverse.com LLC headers | 3192d20e, b352183b, feb5142d, 666ddcbb, ab845223 | `LICENSE`, `NOTICE`, header guard |
| release in place, local sign/notarize, iOS signing, ESLint baseline | b1914efb … 5cc49969, 0f98cb4e, e4c48c47 | `scripts/release.sh`, `scripts/ios.sh`, `eslint.config.js` (clean's WidgetCard needs no third memo suppression) |

Not carried: the donor's 9.6.x version numbering; `openbbDocker` v9.6.4 and the web pairing comments (V9-P3); `lib/tradingCalendar` (clean's `lib/calendar.ts` is the same module with a `parseTime` guard); the plain `state.calendarView` / `pivotView` apps.json fields (clean's v4/v5 envelope carries both, as v8 R1); `arrangeTable` / `tableProfile` and the arrange-table SKILL.md paragraph (V9-P2); help vault snapshots and shots; `docs/specs/v9.0.0-features.md` and the five calendar plans and specs (PROVENANCE).

## Rulings applied (user, handoff 2026-10-12)

- Method is v8's: manifest columns, REVIEW notes when a clean assertion changes, hand ports naming donor commits.
- Keep ours where equal or better, notably the Calendar and Pivot: the Calendar is KEEP throughout; the Pivot keeps clean's drawer, and only the widgets.json parse it lacked is carried.
- Example: the donor's v9.6.2 calendars example carried as `v9.0.0-calendars`, description naming its minimum BDOBB, covered by `appsJson.examples.test`, OWNER-routed, dry run into scratch only.
- Version 9.0.0 in v8's places. Help pages for the EODHD features.
- Conflicts: the recommended option, recorded PROVISIONAL in `OPEN-QUESTIONS.md` (V9-P1 to V9-P4).

## Steps (every commit)

| Commit | Part | Subject | Donor commits named ("none named" = authored here) |
|---|---|---|---|
| fd2081d | 1 | docs(v9): the v9 delta manifest -- every donor-changed path, v8.1.2..v9.6.3 | 28aeb65a..5cfe1395 (survey) |
| 686891a | 2 | feat(v9): widgets.json keeps a column's provider aggregation hint | a385fdef, 16d3ead3 |
| 70adcb8 | 2 | test(v9): the donor's Calendar view card and store cases on clean's card | c8ad6a77, 3284a765 |
| a0ddc85 | 3 | feat(v9): Episode 9's calendars example, carried into clean's envelope | 4121eb9e, a145640a, fb4517e7 |
| 7b17b7f | 6 | docs(v9): the handoff writes its checkouts as ~/..., so the scrub passes | none named |
| 2ebad48 | 4 | docs(v9): help for EODHD data as BDOBB uses it | 6fe7b712 / adc0b325 / 9d4c99ba (the donor's eodhd-data-provider page), c8ad6a77 (calendar help) -- rewritten |
| 1378c53 | 5 | chore(v9): version 9.0.0 everywhere | 750627a3, 68b1a217, 477fd26f (the donor's bumps) |
| ee21164 | 5 | docs(v9): 9.0.0 release notes and a README section | none named |

The table leaves out only the commit that adds it (this ledger, the open questions and provenance); `git log --reverse --format='%h %s' cfd63d7..HEAD` lists every commit.

## Example (Part 3)

- `docs/examples/v9.0.0-calendars.apps.json`, *Example Dashboard - Version 9.0.0 - Calendars*: written by `exportCompatibleApp` from the donor's layout (a scratch generator, not committed), tab ids renamed `markets` / `calendars`, then the description. Envelope v5 (the Statement card), calendar state in the v4 extras.
- Ids: the EODHD cards use openbb-eodhd's Platform 5 mirror ids; the donor's OpenBB 4 Treasury card becomes clean's `ustreasury_auction_results_us_treasury_obb` with Episode 5's `auction_date` / `security_term` / `security_type` (V9-P4).
- Clean wins: the candlestick chart type is not carried (clean's import and export write `chartType: "line"` and its chart view chooses its own); the donor's `pivotView` becomes clean's `statement` view.
- `scripts/apps-sync.mjs`: OWNER `v9.0.0-calendars` -> `workspace_apps.json` (openbb-api serves the extension and the Treasury widget). Dry runs into scratch dirs: `EPISODE=9` wrote 11 apps (the v9 example last), `EPISODE=8` 10. Nothing written to openbq-docker; the filtered sync into openbq-docker `examples/bdobb/apps.json` (as its 41bc742 did for v8) waited for the server port's served ids (V9-P4).
- Id check (2026-10-12, V9-P4 resolved; the example is unchanged, so it is not regenerated): the ids were derived from code, not from either agent's list. openbq-docker `claude/openbq-docker-v9` 12aea38 mounts openbb-eodhd's `eodhd_router` under its `openbb_core_extension` entry point `eodhd` (one command per `MIRRORS` row at the standard path) and openbb-government-us's `ustreasury` router; openbb-platform-api 2.0.1 names a widget `<route without /api/v1, / -> _>_<provider>_obb`. `build_json(app.openapi(), [])`, run offline on the port's environment (lock, provider-fixes overlay, openbb-eodhd identical to `v9/eodhd/source`, no standard routers, no key), serves 52 `eodhd_*` widgets and all six card ids of the example at the expected endpoints; every saved param is a widget param, and `auction_results` has `auction_date` / `security_term` / `security_type`. `ustreasury_treasury_auctions_us_treasury_obb` (the port ledger's suggestion) is served too, but only while openbb-fixedincome is absent; clean keeps Episode 5's `auction_results`. `appsJson.examples.test.ts`: 41 passed.
- Sync (2026-10-12): `EPISODE=9 OPENBB_DOCKER_DIR=<scratch> node scripts/apps-sync.mjs` wrote 11 apps; filtered as openbq-docker 41bc742 did for v8 (keep an app only if every card is a BDOBB built-in or a widget that backend serves), 9 go into openbq-docker `examples/bdobb/apps.json` on `claude/openbq-docker-v9`: the eight v8 apps unchanged and the v9.0.0 Calendars example. Dropped as at v8: *Demo providers* (econdb, alpha_vantage, EIA STEO, BLS search and the videos widget are not served) and *Video Library* (no openbb-videos extension).

## Help (Part 4)

- Quick Help: **EODHD data** (`topics/eodhd.md`, after Provider keys); Calendar view points to it. It reuses the `calendar-view` shot (no Playwright in this step; a dedicated EODHD shot is a follow-up for the help-shots run).
- Reference Manual: **EODHD Data** (`guide/eodhd-data-provider.md`) under *Integrations*; Calendar View, Example Dashboards (v9 section; no longer "every example opens keyless"), home and About This Guide updated.
- Every app claim was checked against this line's code; server claims against openbb-docker v9.6.6's `openbb-eodhd` (README, `eodhd_router.py`, `aggregation.py`, `models/_fundamentals.py`, `models/fundamental.py`, `models/calendar.py`). Not carried from the donor page: the live-grid websocket feeds (v10), the NAS and od-pairing history, and "the pill appears once a provider sends a hint" (false here, V9-P1).

## Review notes (clean assertions changed; none weakened)

- REVIEW, `src/help/index.test.ts` "is the v8 topic set…" -> "is the v9 topic set…": the exact list gains `eodhd` after `provider-keys` and nothing else (2ebad48).
- REVIEW, `src/help/guide.test.ts` "starts at home and lists every page in exactly one section": exact count 42 -> 43, the EODHD page (2ebad48).
- `src/help/guide.test.ts` "guide pages mention v9.0.0 consistently" and `src/lib/version.test.ts` "is the clean v9 development version": the version bump, as v8's (1378c53).
- Added, nothing changed: `widgetsJson.test.ts` hint block (5 cases), `WidgetCard.test.tsx` three calendar cases, `dashboardStore.test.ts` calendar facet case, `appsJson.examples.test.ts` v9 case and known-list entry, `guide.test.ts` v9 example and EODHD page blocks, `index.test.ts` v9 topics block.

## Validation receipts (2026-10-12)

- `pnpm typecheck`: clean at 686891a, 70adcb8 and ee21164. `pnpm lint`: clean at ee21164; eslint on each commit's changed files clean. `git diff --check cfd63d7 HEAD`: clean.
- Affected vitest files (`--maxWorkers=2 --minWorkers=1`; `--maxWorkers=2` alone makes tinypool refuse its own min/max): widgetsJson, pivotSuggestion, PivotPanel, tableColumns 214 passed; WidgetCard, dashboardStore 419 passed; appsJson.examples 41 passed; version + `src/help` 93 passed; `scripts/help-shots.test.mjs` 9 passed. At the head (before this ledger commit), one run over all of them plus CalendarRenderer, calendarView, appsJson.cleanV4/cleanV5, cardViews, `src/help` and help-shots: 20 files, 903 passed.
- `pnpm scrub`: failed at cfd63d7 on the handoff's home-directory paths; clean from 7b17b7f.
- Not run here (next agent's gate): the full unit suite, Playwright, web, build, notices. EODHD live: NOT_RUN.

## Rebase onto release/v8 (2026-10-14)

User instruction (relayed by the v8 session, confirmed by the user in this session): rebase v9 and v10 onto `origin/release/v8` = `origin/main` = 88267ba5, which holds the v8 freeze with the tailnet scrub replayed over its history and the merged v7 rebuild (its ledger: `v8-assembly.md`, "Merge of the v7 rebuild (ba935b5)"). Local only: no push, tag or PR.

- `git rebase --onto origin/release/v8 de951a1d claude/clean-v9`: the twelve v9 commits only, no merges. The pre-rebase head is kept as `backup/clean-v9-pre-rebase` (62d1aae).
- Tailnet scan before re-gating: no commit message or added line in de951a1d..62d1aae names a `*.ts.net` host, so nothing was rewritten.
- Conflicts, resolved by keeping both sides' behaviour (each commit's message records its own):
  - `scripts/apps-sync.mjs` (ea13514): the v7 rebuild replaced `OWNER` with `SERVED` and writes openbq-docker's `examples/bdobb/apps.json`. `v9.0.0-calendars` is listed as served (`true`): openbq-docker v9 serves all six card ids (V9-P4).
  - `src/help/guide/example-dashboards.md` (ea13514): v8's openbq-docker wording stays; the v9 section, the `EPISODE=9` sync and the paid-key sentence are added. "each opens with nothing entered" goes, as the v9 test requires.
  - `src/help/guide/home.md` (ea21c6e): v8's Integrations list gains the EODHD line. The EODHD guide page and topic name `openbq-api`, openbq-docker's API service, and link `openbq-docker-stack`, which replaced `openbb-docker-stack` in the v7 rebuild.
  - `docs/releases/provenance.md` (1c99e8f): v8's "v7 rebuild merged in" section, then v9's.
- Old export menu items: no v9 file names *Export BDOBB-compatible / Export OpenBB apps.json…*; v7's **Save…** needs no v9 change.
- No assertion changed by the rebase.

### Second rebase, onto main d2c3dce3 (v8.0.0), 2026-10-14

User instruction (relayed by the v8 session, confirmed in this session): catch up to `main` = `release/v8` = tag `v8.0.0` = d2c3dce3. That is 88267ba plus the release review's six commits: release/v7 merged into the v8 line; `openbqDocker` pinned to the openbq-docker `v8.0.0` tag; the funnel gateway moved to Funnel port 10000 (openbq-docker v8.0.0 re-cut); and the freezes and merges.
- `git rebase --onto origin/main 88267ba5 claude/clean-v9`. The previous head is `backup/clean-v9-pre-rebase2` (39991ca).
- Conflicts:
  - `src/help/guide/example-dashboards.md` (the example commit). v8.0.0 says openbq-docker serves all eight examples and drops the 8.0.0 sync sentence; the v9 intro, sync sentence, section and sources are added to that wording again.
  - `src/help/guide/home.md` (the EODHD commit). v8.0.0's stack line plus the EODHD line.
- v9 names no gateway port, so nothing moves to 10000. The pins stay v8.0.0's: `openbqDocker` `v8.0.0` (V9-P3: v9 changes no gateway route) and `openbbDocker` `v3.0.1`.
- No `*.ts.net` host in any v9 message or added line. No assertion changed.
- openbq-docker: `claude/openbq-docker-v9` lacked the `v8.0.0` tag (ebd3b85, the port-10000 re-cut). It is merged in as e393e13, with no conflicts.
- Gate then: `docs/releases/validation/v9/v9-refreeze-2026-10-14/` in d51b3f0, superseded by the third rebase.

### Third rebase, onto main d92a863, 2026-10-14

User instruction (in this session): apply v9 to `main`, then release it as 9.0.0 and make it the new `main`; then do the same for v10. `main` = `release/v8` had moved on from d2c3dce3 to d92a863: the v4–v8 re-cuts that run backend tables on the worker, merged up through v7.0.0 `2dff408` into v8. `git rebase --onto origin/main d2c3dce3 e89cb79`: the fourteen v9 commits applied with no conflicts. The receipts of the d2c3dce3 RE-FREEZE (d51b3f0, `backup/clean-v9-pre-rebase3`) are replaced by this rebase's. No assertion changed; no tailnet host. Gate then planned at d92a863, superseded below.

### Rebase onto main c0fb324, re-pin to openbq-docker v9 and openbq-eodhd (2026-10-14)

User instructions, in this session:
- release v9 on top of `main` and make it the new `main`;
- "openbq-docker v9 should have openbq-eodhd", relayed by the v8 session and confirmed here;
- "it should be Adventures-OpenBQ/openbq-eodhd".

What was done:
- **Rebase.** `main` moved to c0fb324: d92a863's backend tables on the worker, plus v8 closing the Connections open question. `git rebase --onto origin/main d92a863 claude/clean-v9` replayed the commits. The pre-rebase head is `backup/clean-v9-pre-rebase3` (d51b3f0).
- **OPEN-QUESTIONS conflicts.** v8 closed Connections, so `Open` is "None"; v8's Resolved entry and v9's entries are both kept.
- **Pin.** `openbqDocker` is openbq-docker `claude/openbq-docker-v9` d66e4d0. That commit vendors openbq-eodhd 9.0.0 from Adventures-OpenBQ/openbq-eodhd (8da2435, tag `v9.0.0`), the donor's openbb-eodhd renamed. `pnpm gateway:vendor v9.0.0 d66e4d0ae5596d81c1e46a1f87d1d8f5769d4c30` re-vendored `web/policy.mjs`: the body is byte-identical to v8.0.0's (sha256 dfa61dd…), the header names `v9.0.0`, and `policy.vendored.json` records the commit. `web/security.test.mjs` passes unchanged. V9-P3 is resolved by the ruling.
- **Rename.** `openbb-eodhd` → `openbq-eodhd` in:
  - the EODHD help page and topic, Home, Example Dashboards and README;
  - the example's description, which matches openbq-docker v9's synced `examples/bdobb/apps.json` byte for byte;
  - code comments in `CalendarRenderer`, `calendarView`, `pivotSuggestion`, `types` and `widgetsJson` (and their tests).
- **Pairing text.** The stack page (9.0.0 pairs with openbq-docker v9.0.0, `d66e4d0`, `gateway:vendor v9.0.0 <commit>`), Web Preview and `web/README.md`.
- **REVIEW, two assertions changed for the rename, not weakened.** `src/help/guide.test.ts` (the v9 EODHD page block) and `src/help/index.test.ts` (the v9 topics block) pin `` `openbq-eodhd` `` where they pinned `` `openbb-eodhd` `` (a REVIEW comment in each).
- **Provisional:** RB-4, openbq-eodhd's version is 9.0.0.
- **Checks.** No tailnet host. Help 89, web 42, examples and calendarView 188 passed.
- **Gate:** `docs/releases/validation/v9/v9-release-2026-10-14/` (diff check from c0fb324).

## Open questions

V9-P1 to V9-P3 in `OPEN-QUESTIONS.md` (Provisional, overnight 2026-10-12); V9-P4 resolved by the id check above. Carried in, still open: Connections export/import (`backendsJson`); v9 adds no Connections export.
