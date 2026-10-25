# Fresh release provenance

## Local assembly

No remote configured. All builds and tags remain local until v3, v4 and v5 qualify. Cron deferred by the user. Existing repositories and tags preserved.

## v3 candidate

- Maintained pre-model tree: bdobb-dev/bdobb-v2 local v3.3.3, 94f98be47d4b60fa8809995b424622d481570b35. Exported tracked files without source Git objects.
- Apps source donor: maintained bdobb-v2 v4.0.5, 58f9985e4db0fdeb6dbfb11ff3dc68088494f56b.
- Apps discovery: PR32 c035aa47692148cec1f6391e3ecdc470c196a7c8, adapted from maintained v4.0.5 contracts/components to preserve import conflicts and dark/light v3 boundary. Original work credits retained in source; PR https://github.com/bdobb-dev/bdobb-v2/pull/32.
- Apps conflict fix donor: 1a3608efd28b0e1355e835e397cec6d54573f39f; modal/latency fixes included in maintained v4.0.5 donor. No System theme, advanced library or model scope copied.
- Modern compatibility donor: published Adventures-OpenBQ/bdobb v3.0.0, 23a776383f447a58d9975a66214a589d86a3b8ef; ordinary-state PR339 scope adapted; analytical runtime excluded.

## Verification ledger

- Original exported donor: typecheck, lint, production build pass.
- Initial sandbox unit run aborted after real loopback-server tests timed out. No product change made.
- Isolated unrestricted retry: ParamControls and discovery, 43 tests pass.
- Full unrestricted baseline: 2741 passed; one subprocess timeout passed on isolated retry (all 6 release-script tests).
- Apps focused suite: 301 passed; existing app/rail regression: 107 passed; new Apps real-store integration: 11 passed.
- Compatible export/account suite: 323 passed, 5 account-placement failures; corrected General placement and all 64 settings tests then passed.
- Analytical layout-overlay no-write regression: failed before fix, then 114 import/export tests passed.
- Reference conformance: 6 passed against OpenBQ reference on loopback port 7780, source a6293707576e16edda8305adda95b07b6a4b968b, image sha256:70f9290e99bfa3a32b10f3c47eeb57c53f325b5f38484adc97ecf6d4128c516f. This advertises 71 widgets and includes a later Pivot example; v3 refuses that analytical app.
- Web/security: 31 passed. Native check interrupted to reduce concurrent compilation load; resume with two jobs.
- Initial cumulative unit run: 2896 passed; six subprocess test timeouts under concurrent build/native load. Final post-fix run limits worker concurrency.
- No release qualified; no local tag yet.

Original source copyright and Apache-2.0 licensing retained. Carried source PRs include contributions credited to Claude in their original commits; the new repository records source provenance rather than retaining historical Git objects.

## Reference qualification procedure

Ruling: use the October 6 earlier-session curated reference pin a6293707576e16edda8305adda95b07b6a4b968b rather than the historical baseline pin named in the initial plan. This preserves the already repaired PDF fixtures and measures this fresh client against the same reference used earlier today. Cost if wrong: repeat qualification against the older baseline separately.

Use new per-widget render receipts, interactive PDF and Omni checks, Apps import/group controls, export round trips, screenshots and browser error capture. Browser requests use a test-only CORS adapter with unchanged reference responses, matching the earlier rehearsal; native transport does not use that adapter. Never reuse earlier passing widget results for this source tree.

- Post-guard unit run with default five-second timeout: 2,898 passed, five mocked release-script timeouts, six opt-in skips. All six release-script tests passed on isolated retry. Repeating the full gate with the earlier session's two workers and fifteen-second test timeout.
- Browser regression: 90 passed, one stale repository-link expectation failed; all three Help tests passed after updating the expected final repository URL.
- Initial reference Apps browser check failed because browser CORS blocked discovery. Repeated with the earlier rehearsal adapter; no product change made for this transport restriction.

- Fresh reference rendering: 71/71 passed with zero captured page errors. Interactive multi-PDF Open, SQL Omni submit, Live Grid, Highcharts and Vega-Lite included. Cron examples qualify rendering only.
- Reference contracts plus real onboarding import/export: seven tests passed, preserving 14 tabs, all source cards and three groups. Analytical app refusal verified.
- Reference browser Apps/grouping: passed with linked Toyota→Tesla requests and no-write analytical refusal.
- Reference live numeric refresh/Run: passed after startup discovery settled. Numeric 5,000 ms widget refreshed; Run widget did not poll and one click issued one additional request.
- OpenBQ Docker smoke: nine of nine passed against image sha256:f88fe41f131878ebb08508084dc34afb359cdac9443b99f0dd28f10aefd852c8, catalogue 995 widgets. Includes eight representative live tables and historical chart view; not whole-catalogue certification.
- Typecheck, lint, production build, cargo check --locked --offline -j 2 and scrub passed.
- Ruling: serial full regression with a sixty-second per-test bound after repeated subprocess startup timeouts at five/fifteen seconds; no assertion was removed or changed. Cost if wrong: slow tests remain slow, requiring separate performance investigation.

- User documentation updated: Quick Help, 31-page in-app Reference Manual, standalone v3 manual and user guide. Apps discovery, conflict choices, compatible/plain exports, optional account preferences and deferred cron documented. Legacy analytical/manual recipes labeled as historical source checkpoints assigned to clean v4/v5.
- Refreshed light/dark rail and General screenshots, plus blank-credential Workspace account screenshots (superseded 2026-10-08: the Workspace account panel moved to Connections, so `workspace-account-*.png` now show the Workspace connections group and the General shots show User Settings). Visually checked; help/index/search/image/generator checks passed (46 tests), standalone relative links verified.
- Final Chromium regression: 91 passed, one opt-in reference skip; reference Apps browser acceptance separately passed.

- Actual onboarding saved chart views: categorical and time-series views both rendered with SVG evidence and zero page errors; separate fresh receipt preserved.

- Native macOS app bundle built successfully; Info.plist reports version/build 3.0.0. No signing submission or native profile launch performed.
- Final serial unit run: 2,900 passed, seven opt-in reference skips, three release-fixture launch timeouts. Launcher isolation measured env/Bash at 4–10 seconds versus direct Bash at 0.07–0.53 seconds; fixture stubs now invoke /bin/bash with all guard assertions unchanged. Retry pending.

- Final release-fixture retry passed all six assertions (155 seconds total, each under 60 seconds), using direct Bash launchers. Cumulative unit coverage: 2,903 passing assertions and seven opt-in reference skips; final fixture-only change lint passed. Qualification uses the full run plus isolated corrected fixture rerun, not a claimed single all-green run.

## v4 assembly in progress

- BASE clean v3 root 93bf263386c7de59c11c76303aceb6ab08c1bde1; local tag v3.0.0.
- Frozen modern analytical donor 23a776383f447a58d9975a66214a589d86a3b8ef, carrying PR337/338/341 maintained scope. Exported tracked source only; never copied live sibling modifications.
- Analytical persistence boundary test failed on v3: commitTableDefinition absent. Modern runtime and owning tests introduced on codex/clean-v4 only.

- Frozen legacy core-improvement donor f8fadb62f766a42dcd461dddb517e03030bad8fb (maintained v5.5.3). 175 scoped source paths integrated by three-way comparison against v3.3.3; 16 overlaps resolved explicitly. Worker runtime, definitions, persisted projection and symbolic selections retained alongside fiscal/calendar/dock features.
- Ruling: retain each conflicted owning test suite independently as modern and legacyV4 suites rather than discard either set of assertions. Cost: some duplicated baseline assertions during regression.
- Bundled NYSE data relocated from historical docs/specs into docs/data/nyse-calendar.json; source JSON content unchanged. Frozen legacy dependency lock installed with ignore-scripts; calendar packages require the maintained Vite6 lock.

- Calendar card presentation PR78 8a29e09325ff53240890a62d61f7cd22965ee323 ported by scoped paths. Pure view helper renamed calendarView.ts to avoid collision with trading calendar service. Original work credited Art Cashin and Claude Fable 5.1; https://github.com/bdobb-dev/bdobb-v2/pull/78. No provider activation or later News/pinned-widget code carried.
- Persistent projection regression: fiscal/dock choices were lost by the worker donor whitelist; RED observed, explicit durable fields added. Calendar view state included in the same projection.

- Ruling for PR339 adaptation: keep strict v3 profile decoding and emit a v4 app envelope only when additional durable state is present. Its v3 base projection preserves ordinary semantics; per-slot portable identities remap links without exporting local card IDs. New tests cover model/selection/fiscal/dock/calendar round trips, missing/duplicate identities, foreign sources and unsupported profiles. Cost if wrong: versioned interchange must be migrated explicitly, not silently downgraded.
- ~~Local curated reference pivot-v1 layout overlays migrate to worker analytical definitions in v4.~~ Corrected 2026-10-08 (user-approved, D-007): those overlays sit on backend tables, which never run on the client worker, so the analytical definition was never executed. They now import as the table's own Pivot (`card.table.pivot`), which TableRenderer applies; backend tables stay off the worker until server execution. Clean v3 remains a no-write refusal for the same source.

- Apps modal regression: Escape closed the underlying Apps dialog because the conflict dialog used a pre-stack listener. RED observed in real-store tests; conflict modal now shares useModalDialog. All 27 Apps/conflict/native-theme assertions pass. Native OS theme pin removed and set-theme permission granted as required by PR35.
- PR168 verified present in maintained f8 donor (ancestor 9fd46235877a505b152c404bd8f7f8ef0d13f718); provider dashboard/details and badge bridge retained. PR169 split: only parameter examples exported from 885ff62050e10032db32483d849dec0dd405d69d, renamed v4; Statement sample/taxonomy deferred to v5.
- Codec audit RED: optional undefined chart category refused. Optional object properties now follow JSON omission semantics; chart enums and Calendar fields validated. Cross-tab links with repeated widget ids retain exact source. Fourteen codec/example checks pass. Historical v3 sample preserved; new built-in coverage lives in v4 sample.

- Layout-only refetch regression RED: widening effective-parameter memo to whole card broke identity during drag. Explicit params/bindings projection now preserves reference while dependencies remain lint-visible; 242 card/group assertions pass.
- Documentation updated for v4 core tools, analytical tables, calendar/dock and versioned persistence; historical v3 manual retained. Added Date Expressions guide page (32 total); 42 help checks pass. Current-tree screenshots pending.

- User ruling: do not make the final v4 tag yet; two incoming Pivot items remain outstanding. Continue fixes, docs and validation, keep candidate untagged and hold the v5 release branch until the v4 boundary is settled. PR identities requested asynchronously.
- Browser regression RED: ordinary Symbol preceded Page in the analytical header after the legacy chip merge. Analytical cards now use PivotParamRow ordinary slot (Page → ordinary → promoted filters); ordinary cards keep titlebar chips and all cards keep the dock.

## Feature-coverage audit back-ports (2026-10-11)

A commit-level audit of every bdobb-v2 ref against the clean lines found dev fixes to features clean already ships. User ruling: a fix belongs to its feature's version, not to the first dev tag that contains it, so these are back-ported even though dev first tagged them v12. Dev v8–v15 features stay out.
- Dev b7b7361 (v12.4.2), back-ported in d00b017: a copied card owns its nested objects. v4 clones every carried field, not only params and table.
- Dev 9fc10c6 (v12.3.0), back-ported in 1588a8e: the Calendar filter is a labelled group, not a tree. The Advanced-chart part is dev v12 work and is not carried.

## Dev v8+ work approved into the clean lines (user ruling 2026-10-11)

Dev v8–v15 stays out of clean v3–v7, judged by each feature's own dev version. A review of the clean lines found these dev v8+ items already in them. The user approved keeping each one:
- The Calendar view for date tables (dev v9.6, PR #78), in v4 and later. It shipped in the published v4.0.0 and v4's apps.json profile carries it. Condition: the calendar grid is introduced to readers in Episode 5 of Adventures, through a v5 example dashboard.
- The Pivot provider-aggregation suggestion pill (dev v9.0.2, PR #164), in v4 and later.
- The Pivot typed fold keys, fold warnings and the column-count refusal (dev v11.3 refinements of the Pivot feature), in v4 and later. Clean's statement-model, table-execution and chart code depend on them.
- Recorded on their own lines: Rita's Maximum tool rounds setting (dev v12.4.15, v6), and the vendored swift-rs for Xcode 27 (v7, part of the approved iPad build).
