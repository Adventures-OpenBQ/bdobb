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

## Isolated v5 candidate assembly

Branch codex/clean-v5 starts from copied, unqualified v4 candidate c7f59d129055f38d2594c7c9c83c479ec9c9172e. Frozen workspace/financial donor d35a13ecebe78205c5c99454ed627240017fdeb7 contributes scoped workspace and Statement source. Modern worker ownership, complete revision transfers, definitions and linked outputs are preserved. This is an assembly record, not a release qualification.

User confirmed incoming v4 PRs #344 and #345. #344 supplies reusable Statement templates on the analytical engine; #345 changes the Pivot drawer and is stacked on #344. They were open when inspected. Reconcile the post-baseline v5 delta onto final v4 and resolve Statement overlap explicitly. No final tag or push.

The v5 development ledger and candidate validation report carry current evidence. Help, searchable Reference Manual and a synthetic financial demo describe actual candidate behavior. A fresh whole-branch review identified three important issues, now fixed: restoring first-panel saved tabs, signaling stale Statement during complete-transfer refresh, and rejecting duplicate dashboard assignments.

Fresh native launch reproduced the settings startup warning: the app-data root did not exist before the first root-level temp-file write. Donor commit 4ac9cd071857472220000602e3f37a335503fcee already fixes this (references storage issue #316; no PR316 resolved in bdobb-v2). It is absent from frozen d35 donor and was omitted from the clean assembly. Restored its native setup creation and nonfatal error behavior to v5. Propagate this baseline correction into final v4; record the v3 omission without silently moving an existing tag. Fresh-profile native verification is required after rebuild.

## Corrected unpublished v3 local baseline

Explicit user authorization permitted rebuilding unpublished v3 and replacing its local tag after validation. Replacement v3.0.0 targets 03fa7617c21dc9ab2d9718c85efcfba416a4910a. Original annotated tag object 4c110d4c33544dcf919c58113f08ea64cc35bdbb and target 93bf263386c7de59c11c76303aceb6ab08c1bde1 are preserved via refs/archive/v3.0.0-before-baseline-correction. Storage restoration credits donor 4ac9cd071857472220000602e3f37a335503fcee. The separate correction checkout contains native build/fresh-profile, 2,903 unit, 91 browser, seven reference-contract, 71-widget reference, Run/refresh and nine OpenBQ smoke receipts. Local tag import does not change this branch ancestry; final v4 must incorporate that baseline and qualify #344/#345 before v5 reconciliation. No publication or final v4/v5 tag.

## Feature-coverage audit back-ports on v5 (2026-10-11)

A commit-level audit of every bdobb-v2 ref against the clean lines found these v5 features carried in part:
- Dev 7e3f35c2 (v5.6.0), back-ported in f4e08bd: **Settings ▸ Layout ▸ Option-number shortcuts** chooses whether ⌥1–⌥9 select dashboards or workspaces. The setting, the shortcut branch and the rail badges were carried, but the control that changes them was not.
- Dev cae150b88, 49dd61a67 and 30ceb877d (v5.7.0), back-ported in d292ec3: a widget manifest's `data.table.pivot` preset is parsed into `widget.pivot` and reaches the table, where the card's own pivot still wins. A malformed part is dropped and reported on its own `pivotPresetIssues` list.
- Dev Workspaces help (87e46fe7, 0967b55a, 038b9024, b9298885, 35f06cea, 7ac45c3d, 138fb590), back-ported in 1b999bb. It covers the workspace dialog and its ways in, arranging, tile names, Put in panel, ⌥N, the Arrange-mode keys and the Escape rule. Every statement was checked against clean v5 behaviour, and the dev statements clean contradicts were dropped or corrected.

Episode 5 example (81b427b): **Example Dashboard - Version 5.0.0 - Treasury Auctions** (`docs/examples/v5.0.0-treasury-calendar.apps.json`) introduces the Calendar view to readers. It uses the keyless U.S. Treasury upcoming-auctions and auction-results widgets from openbb-government-us. This is the user's condition for keeping the Calendar view in v4 (see v4's approval of dev v8+ items).

## v6 assembly

- BASE clean v5 `89889791bad5b44c857f3efe4b528231dd299560` (codex/clean-v5-reconciled). Branch codex/clean-v6, local only; isolated development candidate; qualification pending; nothing published or tagged.
- Frozen donors, read as git objects: bdobb-v2 v6.2.1 `3debd899eaea47a303319d4907f41075ff49f2b1` (base v5.7.2 `c8188ff3a3cc0a479dbe5bd3e87fbd3836fa036c`) and `a5229ea595eb7019c85cca7412d1b1e034755961` (configurable tool rounds; first ships in v12.4.15 and is absent from v6.2.1). Per-path dispositions are in `v6-delta-manifest.tsv` (ADD, CLEAN-APPLY, MERGE, ADAPT, CLEAN-WINS, EXCLUDED). Clean wins every conflict; only the v6 hunk is re-applied. The ledger `v6-assembly.md` lists every commit, review warning and ruling.
- Named donor commits carried: #179 `a616a7a87` (Rita sample `docs/examples/v6.0.0-rita.apps.json`); `a29c4b169` (SSE keepalive comments reset the 45 s idle timeout; the plan calls it the #228 equivalent, but the commit message names no issue, and `ada17f517` is not an ancestor of v6.2.1); #322 `4bc3ba7c8` (`execute_agent_tool` reads Rita's `parameters` and answers with the list Rita iterates) and `2a35dad39` (`set_markdown_content`, recoverable refusals, failed saves counted in the trail; the plan links this to #323, the message does not), `ddaa0a201` (half-nested params refused whole), `071753d70` (a failed tool call leads with Rita's typed error item); #326 `c5b032a72` (multi-card edits: fresh widget refs each round, the 40-round cap, retryable unknown card) and `4ece1b7f1` (per-round refs read key-maint live and stay on the turn's dashboard; UNKNOWN_CARD lists nothing with sharing off); `bd95e91e2`; `77e4d32e0` (Skill editor); #167 fold-back; `a5229ea59` (tool-round mechanics, re-bounded 1-40, default 40). Byte-exact Markdown persistence is clean's own test pin (4f28d9a), not a donor commit.
- Adaptations to clean's model: (1) `describe_table`/`arrange_table` drive the shared table model through the strict `table-model/1` envelope and one guarded transaction; the donor's `tableProfile.ts`/`arrangeTable.ts` calculator is not carried (user ruling 2026-10-07; Part B). (1a) backend tables answer `server-execution-pending`; no second calculator (84414d2 gate, Part B tools). (2) `get_widget_data` reads the card's effective inputs and fiscal months (fda3207, 34d3be2). (3) `remove_widget` Undo restores the whole clean card; CSV/XLS tables cannot be removed (c85fe05). (4) built-ins `note`/`markdown`, byte-exact persistence pinned by a clean test (4f28d9a). (5) tool rounds default 40, range 1-40, on exhaustion keep history and WARN rather than throw (755d41b, 1918ac6, 4f2d68a). (6) the rejected-calls-shown-as-0-errors problem (#323 in the plan) and invented preview numbers (#324) are addressed by `refusalOf` counting (2a35dad39) and by engine-sourced preview numbers. (7) MCP 2.0.1 initialize and tools/list fixtures and protocol pins (c10477b).
- Added by user approval, not from any donor: per-tool disable and display on the effective names of proxied MCP tools (`call_tool` name, `run_pipeline` step tools), the `mcpSeenProxiedTools` settings key and the AI Library list (3e753ca, b5e08b2). Added beyond the donor: the table-model tools (parser, runtime access, candidate builder, transaction, viewer scope, rewritten arrange-table skill; Part B), the live gate script `rita-live-check.sh` with the `rita-table-model-live` acceptance test, and effective-name enforcement inside `runAgentTool` (error code `TOOL_DISABLED`).
- Excluded or kept clean (manifest): `pivot` Help pages (clean folded Pivot into `tables.md`), the donor `arrangeTable`/`tableProfile` modules and tests (adaptation 1), Help screenshots (regenerated, both themes), Help and `pivotConfig`/`PivotPanel` donor churn (CLEAN-WINS: branding, `legalAggregations` already in clean). `scripts/apps-sync.mjs` was first dispositioned EXCLUDED and then corrected to CLEAN-APPLY when the donor's `v6.0.0-rita` owner entry was carried (e938d64). `toPivot` stays private (ruling R4). `.env.example` was added to the manifest in d478282.
- Rulings applied: table-model tools cover CSV/XLS and linked tables only; NAS endpoints tailnet-only and unauthenticated, Rita has no client auth; tool rounds default 40 range 1-40; the articles repository is not edited (R1). The step-1 services PARTIAL/FAIL items (MCP initialize lacks the experimental/ui capability, stale-session reply id null, provider-grouped catalog with `--default-categories equity` likely inert, local-tool round trip not reproduced) are accepted differences pending the services pairing-A results.
- Original authors of the carried donor range (`git log --format=%an c8188ff3a..3debd899e`): the one author, committing as "Art Cashin" and "artcashin". The donor commits carry Claude co-author trailers (Fable 5/5.1, Opus 4.8/5/5.5, Sonnet 5, Haiku 4.5); the v6 commits carry `Co-Authored-By: Claude Opus 5.5` except two Part A commits with a Haiku 4.5 trailer (recorded as a deviation in the ledger). Apache-2.0 retained.

## Feature-coverage audit back-ports on v6 (2026-10-11)

A commit-level audit of every bdobb-v2 ref found dev fixes to Rita, a v6 feature, that dev first tagged v12.3.0 (#91). User ruling: a fix belongs to its feature's version, so these are back-ported to v6:
- Dev da6f4bb, back-ported in 855b12c: a Rita widget fetch sends only the parameters the widget declares.
- Dev 5c05aa5, back-ported in 79b2e10: Stop cancels an MCP tool call that is already running.
- Dev b1e6612, back-ported in 4d7751b: Rita asks before an external MCP tool runs, with Run and Deny. The same commit's untrusted-data bracketing is not carried; this line deliberately does not bracket tool results (`execute.ts`).

Dev's `deploy/spark/README.md` and `rita.env.example` are not carried. They record one private Spark host running a private agent-rita fork at `fab269c`, while this line documents Rita as the OpenBQ service built from `agent-rita` `f673c1f` (`src/help/guide/rita-ai-agent-setup.md`). They are superseded, not missing.

Dev v8+ work approved into this line (user ruling 2026-10-11): Rita's Maximum tool rounds setting (dev v12.4.15), already taken here for its round mechanics.

## Feature-coverage audit on v7 (2026-10-11)

- Dev iPad guide pages "Installing on iPad" and "iPad interface differences" (dev v7.0.x guide snapshots), back-ported in c761815. Every claim was checked against clean v7: its bundle id, `pnpm ios:*` scripts, `scripts/ios.sh` and data folders. Statements that only dev's build supported were dropped, including the `strings` dev-build check, the iOS 16.0 and 16.2 floor rows and the drag-handle plan. The Apple install gates are Apple behaviour carried from dev; the v7 receipts qualify `ios:check` and `ios:sim` only.
- Dev v8+ work approved into this line (user ruling 2026-10-11): the iPad build, ported from the dev v12.1.4 iPad branches, including the vendored `swift-rs` 1.0.8 that Xcode 27 builds need.
