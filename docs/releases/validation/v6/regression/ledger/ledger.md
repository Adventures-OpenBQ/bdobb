# v6 regression case ledger

Generated from results.json by rec.py. Summary: {"mandatory_not_run": 9, "mandatory_blocked": 72, "mandatory_fail": 5, "mandatory_partial": 11, "mandatory_pass": 11, "not_applicable": 1, "certified": false}

| Case | Status | Class | Evidence | Receipts |
|---|---|---|---|---|
| E05-001 | PARTIAL | CLIENT | RETEST run 2: Native import 14 tabs/70 cards; duplicate name offers Keep both → 'Onboarding App for Devs (2)' (historical oracle '(2)'); Types tab compaction (D-005, #317). Export not reachable (card menu refused). | screenshots/R2-002-duplicate-name-dialog.jpg |
| E05-001 (run 1) | PARTIAL |  | Native import 14 tabs/70 cards with resolved IDs (baseline 70); export, duplicate-name and Keep/Replace not run. | import-compare/baseline-onboarding-first-display.json |
| E05-002 | BLOCKED |  | RETEST run 2: Retried: company/year selects do not change with keyboard Down/Return. |  |
| E05-002 (run 1) | BLOCKED |  | Company/year are dropdowns. |  |
| E05-003 | PASS |  | MSFT cell click set Group 3 to Microsoft Corporation on both cards; details show Microsoft (MSFT), Sector Technology, $2.9T. | screenshots/014-E05-003-msft-cell-click-updates-group.jpg |
| E05-004 | PASS |  | RETEST run 2: Original dashboard Group 3 → MSFT after a cell click; the '(2)' copy keeps AAPL (files). | run2/NOTES.md |
| E05-004 (run 1) | NOT_RUN |  | Second independent import not performed. |  |
| E05-005 | NOT_RUN |  | param_echo built-in app is a file example, not served. |  |
| E05-006 | PASS |  | Column-definitions table: Price ascending AAPL 150.25, MSFT 340.5, GOOGL 2.8K; persisted as sorting price asc across restart. | screenshots/016-E05-006-oracle-table-sort.jpg, restart/baseline-dashboard-before-restart.json |
| E05-007 | BLOCKED |  | Header Hide is a column menu. |  |
| E05-008 | BLOCKED |  | RETEST run 2: Header boundary drag produced no width change and no saved width (resize handle appears on hover only). |  |
| E05-008 (run 1) | NOT_RUN |  | Header resize drag not attempted. |  |
| E05-009 | BLOCKED |  | Pin is a column menu. |  |
| E05-010 | PASS |  | RETEST run 2: Native header drag moved Price before Stock; saved columnOrder [price, stock, change]; identical after quit/relaunch and rendered so. | screenshots/R2-005-E05-010-header-drag-price-first.jpg |
| E05-010 (run 1) | NOT_RUN |  | Header drag not attempted (native gesture gate remains open). |  |
| E05-011 | BLOCKED |  | Filter needs text. |  |
| E05-012 | BLOCKED |  | Param filter needs text. |  |
| E05-013 | BLOCKED |  | Table/Chart switch is a dropdown; chart Q1–Q4 values/targets render. | screenshots/016-E05-006-oracle-table-sort.jpg |
| E05-014 | BLOCKED |  | Same; Jan–Jun two-line chart renders. |  |
| E05-015 | BLOCKED |  | Transpose is a menu. |  |
| E05-016 | BLOCKED |  | RETEST run 2: Retried: card ⋯ menu is a pop-up control, refused. |  |
| E05-016 (run 1) | BLOCKED |  | Exports via menus/Save panel. |  |
| E05-017 | PASS |  | RETEST run 2: Boolean → disabled (run 1); Number 250 → 'Number: 250'; Text Rehearsal → 'Text: Rehearsal' (keyboard-focused entry). | screenshots/R2-003-E05-017-number-250-text-rehearsal.jpg |
| E05-017 (run 1) | PARTIAL |  | Boolean → disabled PASS (and persisted); number 250 / text Rehearsal BLOCKED. | screenshots/012-baseline-input-params-defaults.jpg |
| E05-018 | BLOCKED |  | Date needs text. |  |
| E05-019 | BLOCKED |  | Dropdown. |  |
| E05-020 | BLOCKED |  | Dropdown. |  |
| E05-021 | BLOCKED |  | Dropdown. |  |
| E05-022 | BLOCKED |  | Text. |  |
| E05-023 | BLOCKED |  | Dropdown. |  |
| E05-024 | BLOCKED |  | v4 probe apps not served; file import. |  |
| E05-025 | BLOCKED |  | As E05-024. |  |
| E05-026 | BLOCKED |  | As E05-024. |  |
| E05-027 | BLOCKED |  | As E05-024. |  |
| E05-028 | BLOCKED |  | As E05-024. |  |
| E05-029 | BLOCKED |  | As E05-024. |  |
| E05-030 | BLOCKED |  | As E05-024. |  |
| E05-031 | BLOCKED |  | As E05-024. |  |
| E05-032 | PASS |  | RETEST run 2: Second restart with 10 dashboards: every profile file byte-identical; boolean (run 1) and header order (run 2) rendered after relaunch; group chips show saved values; no banner. | restart/R2-profile-hashes-before.txt, restart/R2-profile-hashes-after.txt |
| E05-032 (run 1) | PARTIAL |  | Quit/relaunch: all profile files byte-identical, no banner, boolean edit rendered after restart; groups/sorting persisted in file, not all re-checked on screen. | restart/profile-hashes-before.txt, restart/profile-hashes-after-relaunch.txt |
| E05-033 | NOT_RUN |  | Save panel not opened. |  |
| E05-034 | NOT_APPLICABLE |  | No EODHD statement backend is bound for this v6 run (services manifest); provider statement alignment is out of the selected service set. | manifests/services.md |
| E05-035 | BLOCKED |  | Workspace creation needs text. |  |
| E05-036 | BLOCKED |  | Pivot menus. |  |
| E05-037 | BLOCKED |  | Pivot menus. |  |
| E05-038 | BLOCKED |  | Pivot menus. |  |
| E05-039 | BLOCKED |  | Pivot menus. |  |
| E05-040 | BLOCKED |  | Statement fixture not served. |  |
| E05-041 | BLOCKED |  | As E05-040. |  |
| E05-042 | BLOCKED |  | Pivot exports via menus. |  |
| E05-043 | NOT_RUN |  | apps.json export/import roundtrip not run. |  |
| E05-044 | BLOCKED |  | Requires stopping the reference container; the brief forbids stopping NAS services. |  |
| E05-045 | NOT_RUN |  | Save panel not opened. |  |
| E05-046 | NOT_RUN |  | Option-N/Escape not attempted (window shortcuts do reach the app: ⌥2 switched dashboards). |  |
| E05-047 | BLOCKED |  | Research-desk EODHD widgets: no EODHD backend bound; ticker change needs text. |  |
| E05-048 | BLOCKED |  | As E05-024. |  |
| E05-049 | PASS |  | Automated: src/lib/dateExpressions.test.ts 91 tests passed in the HEAD unit gate (historical 88). No native clock manipulation. | checks/unit.log |
| E05-050 | BLOCKED |  | Native drop gesture not drivable. |  |
| E05-051 | BLOCKED |  | CSV/XLSX seeding + import. |  |
| E05-052 | BLOCKED |  | As E05-051. |  |
| E05-053 | BLOCKED |  | As E05-051. |  |
| E05-054 | BLOCKED |  | As E05-051. |  |
| E05-055 | BLOCKED |  | As E05-051. |  |
| E05-056 | BLOCKED |  | Card menu. |  |
| E05-057 | PASS |  | Automated suites at HEAD: localFiles 18, pivotTable 32, pivotConfig 21, DropZone 24, transpose 12 = 107 tests passed. Does not close native drop. | checks/unit.log |
| E05-058 | BLOCKED |  | Workspace. |  |
| E05-059 | NOT_RUN |  | Laptop manual screenshots not produced. |  |
| E05-060 | BLOCKED |  | Pivot chooser. |  |
| E05-061 | BLOCKED |  | Pivot chooser (#315). |  |
| E05-062 | PASS |  | Empty profile launch: no settings failure banner; settings.json created with defaults; log has only the expected Local discovery error. | screenshots/001-fresh-profile-launch.jpg |
| E05-063 | FAIL | CLIENT | Grouping keeps exported y=2/11 (the historical oracle), but the same import compacts the Types tab by −2 rows (D-005): #317-class first-display coordinate loss persists. | import-compare/baseline-onboarding-first-display.json |
| E05-064 | BLOCKED |  | Workspace Arrange. |  |
| E05-065 | BLOCKED |  | Workspace. |  |
| E05-066 | BLOCKED |  | Workspace (#320). |  |
| E05-067 | PASS |  | Intentional HTTP 500 renders 'HTTP 500: Error that just occurred' with Retry; neighbouring markdown cards render. | screenshots/010-baseline-types-top.jpg |
| E05-068 | PASS |  | Current widgetTypes contract: the TradingView card renders an advanced chart through the UDF feed ('Rendered by TradingView'); the legacy 'unsupported' expectation is obsolete per V3-006. | screenshots/025-baseline-tradingview-renders.jpg |
| V3-001 | PARTIAL |  | Served REFERENCE_BASELINE (revision a6293707 = recorded pin): 70 widgets, 1 app, 14 tabs, 70 cards. Native import 70/70 cards, IDs and groups 3/3 match; Types tab coordinates compacted (D-005). Backend GET sweep 70/70 (60×200, 5 POST-only 405, intentional 500, 3 transient/upstream). Native render 64 PASS/2 PARTIAL/4 not captured. Per-widget parameter-class changes mostly BLOCKED (B-TEXT/B-MENU). | services/REFERENCE_BASELINE-widgets.json, backend-sweep/baseline.jsonl, coverage/baseline-cards.tsv, import-compare/baseline-onboarding-first-display.json |
| V3-002 | FAIL | CLIENT | RETEST run 2: REFERENCE_CURATED (now sha-1978c19, redeployed by someone else at 15:37) imported natively: Onboarding App for Devs (14 tabs/70 cards, Keep both) and Episode 3 — Pivot examples (4 tabs). Curated cards bind to REFERENCE_BASELINE by widget id while baseline is connected (design D3), so curated widgets are not rendered independently. D-005 on the Types tab. D-007: all four Pivot-example cards render the 5 raw rows; the imported pivot-v1 definitions are stored as analytical models that backend tables never execute. | import-compare/R2-curated-onboarding-first-display.json, profile-snapshots/R2-curated-pivot-examples-after-import.json, screenshots/R2-004-curated-pivot-examples-monthly-ohlc-plain-table.jpg |
| V3-002 (run 1) | PARTIAL |  | Served REFERENCE_CURATED (sha-998d08c): 71 widgets, 2 apps. Curated vs baseline: +openbq_demo_nulls, +openbq_demo_prices, −omni-python-widget (explicit). Backend sweep 71 (62×200). Curated apps discovered in native Apps gallery but not imported or rendered (stopped, B-WINDOW). | services/REFERENCE_CURATED-widgets.json, backend-sweep/curated.jsonl, screenshots/004-apps-gallery-baseline-curated.jpg |
| V3-003 | FAIL | CLIENT | RETEST run 2: D-005 reproduced on a fresh import; E05-004 copy independence PASS; Toyota→Tesla still needs a native select (Return/Down do not change it). | import-compare/R2-baseline-onboarding-first-display.json |
| V3-003 (run 1) | FAIL | CLIENT | All 14 baseline tabs visited. Types tab first display compacted −2 rows vs exported (D-005, #317 class); Grouping y=2/11 retained. MSFT cell click updated group + details (PASS). Toyota→Tesla dropdown and copied-dashboard groups BLOCKED. | import-compare/baseline-onboarding-first-display.json, screenshots/014-E05-003-msft-cell-click-updates-group.jpg |
| V3-004 | PARTIAL |  | RETEST run 2: Typed parameters now work via keyboard focus: Number 250 and Text 'Rehearsal' echoed (E05-017). Date/dropdown/multi/dependent still BLOCKED (native selects). | screenshots/R2-003-E05-017-number-250-text-rehearsal.jpg |
| V3-004 (run 1) | PARTIAL |  | Boolean toggle → 'Toggle: disabled' and persisted across restart; Run button advanced timestamp 19:36:25→19:36:33. Text/number/date/dropdown/multi/dependent BLOCKED; request counting not instrumented. | screenshots/011-baseline-settings.jpg, screenshots/012-baseline-input-params-defaults.jpg, restart/ |
| V3-005 | PARTIAL |  | Sort PASS (AAPL 150.25/MSFT 340.5/GOOGL 2.8K; numeric order on grouping table). Quarterly chart renders Q1–Q4 value/target bars. Filter/hide/pin/transpose/view switch/exports BLOCKED; resize/reorder not run. | screenshots/016-E05-006-oracle-table-sort.jpg |
| V3-006 | PARTIAL |  | Rendered: metric, markdown (+intentional error), table (+render fns, hover-card table), PDF base64, PDF URL error state (upstream S3 403), plotly ×5 seen, heatmaps, highcharts, vega ×3, advanced chart/TradingView (UDF), live grid, newsfeed, sparklines, YouTube (one upstream 'Video unavailable'), omni (sql/python blocked by design). Not captured: html_widget, one plotly config variant, 2 sparkline cards; multi-file selection BLOCKED. | coverage/baseline-cards.tsv, screenshots/ |
| V3-007 | PARTIAL |  | RETEST run 2: Duplicate-name dialog: Replace / Keep both '(2)' / Skip / Cancel. Keep both added '(2)' and left the original byte-unchanged; second import offered '(3)'; Replace kept the dashboard id and regenerated every tab/card id, '(2)' untouched. OPENBQ_API apps now discovered (38) after the restart (D-003 retest). Malformed manifests, stale resurrection and export privacy NOT_RUN. | screenshots/R2-002-duplicate-name-dialog.jpg, screenshots/R2-001-connections-openbq-38-apps-after-restart.jpg, run2/NOTES.md |
| V3-007 (run 1) | PARTIAL |  | Apps gallery discovers BASELINE (1 app) and CURATED (2 apps) per backend; OPENBQ_API apps.json unreadable shown as an explicit Connections notice (D-003). Keep/Replace, malformed manifests, export privacy NOT_RUN. | screenshots/002-connections-three-backends-openbq-apps-unreadable.jpg, screenshots/004-apps-gallery-baseline-curated.jpg |
| V3-008 | PARTIAL |  | Fresh empty profile: no banner, settings.json written with defaults (PASS). Quit/relaunch: every profile file byte-identical, boolean edit and sorts persisted (PASS). Themes, narrow headers, Help NOT_RUN. | screenshots/001-fresh-profile-launch.jpg, restart/profile-hashes-before.txt, restart/profile-hashes-after-relaunch.txt |
| V3-009 | NOT_RUN |  | Import needs a native Open panel or drop. |  |
| V3-010 | FAIL | CLIENT | RETEST run 2: After the OPENBQ_API restart all 38 apps are discovered natively; 6 imported (BLS ×5, Cboe) with first tab rendered (Release Calendar rows, document viewers, Cboe quote/history/chart). File compare: tabs/cards match for all 6, but D-005 on every BLS first tab and D-008 (BLS groups 3 → 2, symbol default lost). 32 apps not imported (GUI cost/flakiness). Backend sweep 284/995 (serial resume stopped; see run2/NOTES.md). | import-compare/R2-openbq-*.json, screenshots/R2-app0*.jpg, backend-sweep/openbq.jsonl |
| V3-010 (run 1) | BLOCKED | BACKEND | 995 widgets / 38 apps enumerated. Backend sweep reached 265/995 before OPENBQ_API degraded (D-004, likely aggravated by this sweep); apps.json then never answered; native Apps lists no OPENBQ apps. | services/OPENBQ_API-widgets.json, services/OPENBQ_API-apps.json, backend-sweep/openbq.jsonl |
| V4-001 | PARTIAL |  | Same evidence as V3-001..010 (same binary). | ledger/ledger.md |
| V4-002 | BLOCKED |  | Pivot drawer needs menus and text entry. |  |
| V4-003 | BLOCKED |  | Hover-card table renders 45B/35B/8B; grouping requires the Pivot chooser. | coverage/baseline-cards.tsv |
| V4-004 | BLOCKED |  | Needs text entry and menus. |  |
| V4-005 | BLOCKED |  | Needs menus. |  |
| V4-006 | BLOCKED |  | v4 example apps are files (docs/examples), not served; import needs a file panel; values need text entry. |  |
| V4-007 | BLOCKED |  | Backend oracle verified via MCP calendar_trading_table: 2026-07-03 Official holiday, 2026-11-27 EarlyClose 13:00. Client date-probe cards not exercised (B-FILE). | protocol/mcp-calendar-xnys-2026.json |
| V4-008 | BLOCKED |  | Not exercised (menus/text). |  |
| V4-009 | BLOCKED |  | Not exercised. |  |
| V4-010 | NOT_RUN |  | Not exercised. |  |
| V5-001 | PARTIAL |  | See V3/V4 rows. | ledger/ledger.md |
| V5-002 | BLOCKED |  | Migrated workspace 'Native v5 regression' is listed in the v6 rail; creating/editing workspaces needs dialogs with text entry. | screenshots/031-migration-v6-rail-shows-v5-workspace-dashboards.jpg |
| V5-003 | BLOCKED |  | Needs drag in Arrange dialogs reached through menus. |  |
| V5-004 | BLOCKED |  | v5-financial-demo fixture is not served by any bound service; local import needs a file panel. |  |
| V5-005 | BLOCKED |  | As V5-004. |  |
| V5-006 | BLOCKED |  | Needs file import. |  |
| V5-007 | BLOCKED |  | No provider statement service selected; needs menus. |  |
| V5-008 | BLOCKED |  | Native drop not drivable; DropZone (24) and localFiles (18) unit suites pass at HEAD. | checks/unit.log |
| V5-009 | BLOCKED |  | Needs CSV import + Pivot. |  |
| V5-010 | NOT_RUN |  | Repo gates rerun at HEAD (see checks/). Help/themes not exercised. | checks/gates.tsv |
| V6-001 | PARTIAL |  | Service image ids/digests/revisions recorded and matched to the brief (RITA ff90afee…, MCP d76fbbac…). Protocol probed on the new services (V6-002); old/new comparison cites step-1 receipts. Migration GUI: v6 on a copied v5 profile shows v5 workspace/dashboards, no banner, changes nothing but log + adds skills/; rollback GUI: v5 on the post-v6 profile shows the same, rewrites nothing. v3–v5 matrices only partially exercised. | manifests/services.md, migration/README.md, screenshots/030-migration-v6-on-v5-profile-launch.jpg, screenshots/032-rollback-v5-on-post-v6-profile.jpg |
| V6-002 | FAIL | BACKEND | MCP: initialize (OpenBB MCP 4.0.11, 2025-06-18), session reuse, stale 404 'Session not found', missing session 400, 10 tools with object schemas, available_categories incl. calendar, calendar tools return XNYS data, unknown tool and bad args → isError. Rita: agents.json, statusUpdate→messageChunk order, 2 keepalive comments in a 31 s turn, two-turn history recalled ZEBRA-41, cancel then RECOVERED, malformed shape 400, unknown and unreachable model → ERROR status + explanation. FAIL: non-JSON body → HTTP 500 (D-001, backend, pre-existing on old and new Rita). Client: AI Library shows Rita Online with model openai:qwen3.6-35b. | protocol/mcp-probe.json, protocol/mcp-calendar.json, protocol/rita-probe.json, protocol/rita-keepalive.json, screenshots/003-ai-library-agents-rita-online-rounds-40-default.jpg |
| V6-003 | BLOCKED |  | RETEST run 2: Run 2: text entry became possible, but the Rita pane opens only on pointer hover, input focus (input not rendered while closed) or pin (set only by a sendToAgent cell; none served). Raw input produces no mouseenter, so no native Rita turn is possible. Automated live gate evidence unchanged. | run2/NOTES.md |
| V6-003 (run 1) | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. Automated live gate (not native): rita-authoring-live 12/12 incl. 'authors from an empty board under /skill:build-dashboard, persists, and undoes (#322)' (checks/live-run2.log). |  |
| V6-004 | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. Yahoo widgets live on OPENBQ_API, also degraded (D-004). Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible. |  |
| V6-005 | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible. |  |
| V6-006 | PARTIAL |  | Fresh settings.json has ritaMaxFunctionRounds 40; AI Library shows 'Maximum tool rounds 40 (default)'; migrated v5 profile gains no key without a UI change. Range/Done/Cancel need the select (B-MENU); exhaustion needs Rita prompts (B-TEXT). Unit query.test.ts covers default-40/limit (unit gate PASS). | screenshots/003-ai-library-agents-rita-online-rounds-40-default.jpg |
| V6-007 | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. CSV/XLS copies also need file import (B-FILE). Automated live gate (not native): rita-table-model-live 1/2 in both runs (D-006, model conduct). Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible. |  |
| V6-008 | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. Independent oracle available: reference-manual/v6/demos/expected.json. Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible. |  |
| V6-009 | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. EXAMPLE_DATA not served (B-EXAMPLE). Automated live gate (not native): 'writes an answer into the note on each of twelve tabs: every card saved exactly once (#326)' passed (checks/live-run2.log). Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible. |  |
| V6-010 | BLOCKED |  | Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved. EXAMPLE_DATA not served. Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible. |  |
| V6-011 | BLOCKED |  | EXAMPLE_DATA not served by any bound service (RITA/MCP apps.json & widgets.json 404; no practice/prices/market_* IDs in 995+71+70). MCP catalog discovered (10 tools, categories). | manifests/services.md, protocol/mcp-probe.json |
| V6-012 | BLOCKED |  | BLOCKED by ruling (deferred; ARCHIVE not configured). |  |
