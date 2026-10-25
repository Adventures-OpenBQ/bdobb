#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""All case records for this run (source of truth); writes results.json then rec.py --render renders ledger.md."""
import json, os, subprocess
D = os.path.dirname(os.path.abspath(__file__))
S = "screenshots/"
def r(cid, st, exp, act, arts="", cls=None, issue=None, lim=None, rerun=None, mand=True, inp=None):
    return {"case_id": cid, "widget_id": None, "app": None, "tab": None, "card_id": None, "input": inp or {},
            "expected": exp, "actual": act, "status": st, "artifacts": [a for a in arts.split(",") if a],
            "issue": issue, "limitation": lim, "rerun_of": rerun, "failure_class": cls, "mandatory": mand}
R = [
# ---------- v3 ----------
r("V3-001","PARTIAL","Baseline 70 widgets/1 app/14 tabs/70 cards, ID-set compared, every ID through the widget protocol",
  "Served REFERENCE_BASELINE (revision a6293707 = recorded pin): 70 widgets, 1 app, 14 tabs, 70 cards. Native import 70/70 cards, IDs and groups 3/3 match; Types tab coordinates compacted (D-005). Backend GET sweep 70/70 (60×200, 5 POST-only 405, intentional 500, 3 transient/upstream). Native render 64 PASS/2 PARTIAL/4 not captured. Per-widget parameter-class changes mostly BLOCKED (B-TEXT/B-MENU).",
  "services/REFERENCE_BASELINE-widgets.json,backend-sweep/baseline.jsonl,coverage/baseline-cards.tsv,import-compare/baseline-onboarding-first-display.json", lim="B-TEXT,B-MENU,B-HOVER"),
r("V3-002","PARTIAL","Entire curated corpus independently; reconcile with baseline; explicit Python Omni exclusion",
  "Served REFERENCE_CURATED (sha-998d08c): 71 widgets, 2 apps. Curated vs baseline: +openbq_demo_nulls, +openbq_demo_prices, −omni-python-widget (explicit). Backend sweep 71 (62×200). Curated apps discovered in native Apps gallery but not imported or rendered (stopped, B-WINDOW).",
  "services/REFERENCE_CURATED-widgets.json,backend-sweep/curated.jsonl,screenshots/004-apps-gallery-baseline-curated.jpg", lim="B-WINDOW"),
r("V3-003","FAIL","All tabs visited; layouts equal before first interaction (#317); Toyota→Tesla 2023 1.55M; MSFT cell updates; copy keeps independent groups",
  "All 14 baseline tabs visited. Types tab first display compacted −2 rows vs exported (D-005, #317 class); Grouping y=2/11 retained. MSFT cell click updated group + details (PASS). Toyota→Tesla dropdown and copied-dashboard groups BLOCKED.",
  "import-compare/baseline-onboarding-first-display.json,screenshots/014-E05-003-msft-cell-click-updates-group.jpg", cls="CLIENT", issue="#317 / D-005", lim="B-MENU"),
r("V3-004","PARTIAL","All parameter classes, Run/refresh, polling opt-out, one Run = one request, no stale overwrite",
  "Boolean toggle → 'Toggle: disabled' and persisted across restart; Run button advanced timestamp 19:36:25→19:36:33. Text/number/date/dropdown/multi/dependent BLOCKED; request counting not instrumented.",
  "screenshots/011-baseline-settings.jpg,screenshots/012-baseline-input-params-defaults.jpg,restart/", lim="B-TEXT,B-MENU"),
r("V3-005","PARTIAL","Sort/filter/hide/resize/reorder/pin/transpose; table/chart switching; Q3 filter; CSV/JSON/XLSX readback",
  "Sort PASS (AAPL 150.25/MSFT 340.5/GOOGL 2.8K; numeric order on grouping table). Quarterly chart renders Q1–Q4 value/target bars. Filter/hide/pin/transpose/view switch/exports BLOCKED; resize/reorder not run.",
  "screenshots/016-E05-006-oracle-table-sort.jpg", lim="B-TEXT,B-MENU"),
r("V3-006","PARTIAL","Every renderer variant against current widgetTypes",
  "Rendered: metric, markdown (+intentional error), table (+render fns, hover-card table), PDF base64, PDF URL error state (upstream S3 403), plotly ×5 seen, heatmaps, highcharts, vega ×3, advanced chart/TradingView (UDF), live grid, newsfeed, sparklines, YouTube (one upstream 'Video unavailable'), omni (sql/python blocked by design). Not captured: html_widget, one plotly config variant, 2 sparkline cards; multi-file selection BLOCKED.",
  "coverage/baseline-cards.tsv,screenshots/", lim="B-HOVER"),
r("V3-007","PARTIAL","Discovery/gallery, stalled requests, modal stack, Keep/Replace, source pinning, malformed manifests, no stale resurrection, export privacy",
  "Apps gallery discovers BASELINE (1 app) and CURATED (2 apps) per backend; OPENBQ_API apps.json unreadable shown as an explicit Connections notice (D-003). Keep/Replace, malformed manifests, export privacy NOT_RUN.",
  "screenshots/002-connections-three-backends-openbq-apps-unreadable.jpg,screenshots/004-apps-gallery-baseline-curated.jpg", lim="B-WINDOW"),
r("V3-008","PARTIAL","Fresh profile no settings warning (#316); controls/tabs survive restart; themes; narrow headers; Help matches v3",
  "Fresh empty profile: no banner, settings.json written with defaults (PASS). Quit/relaunch: every profile file byte-identical, boolean edit and sorts persisted (PASS). Themes, narrow headers, Help NOT_RUN.",
  "screenshots/001-fresh-profile-launch.jpg,restart/profile-hashes-before.txt,restart/profile-hashes-after-relaunch.txt"),
r("V3-009","NOT_RUN","Archived analytical export imported → explicit refusal, no writes","Import needs a native Open panel or drop.", lim="B-FILE"),
r("V3-010","BLOCKED","Every OpenBQ API widget default + non-default; nine named smoke checks supplemental",
  "995 widgets / 38 apps enumerated. Backend sweep reached 265/995 before OPENBQ_API degraded (D-004, likely aggravated by this sweep); apps.json then never answered; native Apps lists no OPENBQ apps.",
  "services/OPENBQ_API-widgets.json,services/OPENBQ_API-apps.json,backend-sweep/openbq.jsonl", cls="BACKEND", issue="D-004", lim="B-OPENBQ"),
# ---------- v4 ----------
r("V4-001","PARTIAL","All v3 acceptance on this binary","Same evidence as V3-001..010 (same binary).", "ledger/ledger.md"),
] + [r(c,"BLOCKED",e,a,arts,lim=l) for c,e,a,arts,l in [
("V4-002","Worker Pivot groups/measures/null vs zero/formulas/page sets/linked charts","Pivot drawer needs menus and text entry.","", "B-MENU,B-TEXT"),
("V4-003","Hover Card assets grouped Ethereum/Bitcoin/Solana, never [object Object] (#315); TVL 35B/45B/8B","Hover-card table renders 45B/35B/8B; grouping requires the Pivot chooser.","coverage/baseline-cards.tsv","B-MENU"),
("V4-004","PR344 templates create/edit/save/reopen","Needs text entry and menus.","","B-TEXT,B-MENU"),
("V4-005","PR345 drawer Saved/Arrange, Undo","Needs menus.","","B-MENU"),
("V4-006","Frozen clock; relative/fiscal dates; probes","v4 example apps are files (docs/examples), not served; import needs a file panel; values need text entry.","","B-FILE,B-TEXT"),
("V4-007","Live calendar, XNYS fallback, Jul 3 closed, Nov 27 13:00","Backend oracle verified via MCP calendar_trading_table: 2026-07-03 Official holiday, 2026-11-27 EarlyClose 13:00. Client date-probe cards not exercised (B-FILE).","protocol/mcp-calendar-xnys-2026.json","B-FILE"),
("V4-008","Library/badges/probes, docked panel, key management, masked credentials","Not exercised (menus/text).","","B-MENU,B-TEXT"),
("V4-009","Worker view exports, roundtrips, overlay refusal","Not exercised.","","B-MENU,B-FILE"),
]] + [
r("V4-010","NOT_RUN","Themes, narrow/coarse headers, Help v4 scope","Not exercised.", lim="B-WINDOW"),
r("V5-001","PARTIAL","All v3/v4 on this binary","See V3/V4 rows.", "ledger/ledger.md"),
] + [r(c,"BLOCKED",e,a,arts,lim=l) for c,e,a,arts,l in [
("V5-002","Workspaces 2/8 dashboards, focus, maximize, single exit (#320)","Migrated workspace 'Native v5 regression' is listed in the v6 rail; creating/editing workspaces needs dialogs with text entry.","screenshots/031-migration-v6-rail-shows-v5-workspace-dashboards.jpg","B-TEXT,B-HOVER"),
("V5-003","Arrange swap/Cancel/Done; geometry persists","Needs drag in Arrange dialogs reached through menus.","","B-MENU"),
("V5-004","Synthetic Statement Q3 12/-5, TTM 33/-18","v5-financial-demo fixture is not served by any bound service; local import needs a file panel.","","B-FILE,B-EXAMPLE"),
("V5-005","Statement template projection","As V5-004.","","B-FILE"),
("V5-006","Revision-qualified transfers; malformed rejection; compatible Apps","Needs file import.","","B-FILE"),
("V5-007","Provider Statement checks frozen rows","No provider statement service selected; needs menus.","","B-MENU"),
("V5-008","Physical CSV/XLSX drop (#321), Excel dates (#319)","Native drop not drivable; DropZone (24) and localFiles (18) unit suites pass at HEAD.","checks/unit.log","B-FILE"),
("V5-009","Practice fixture Sum/Mean/Count, month totals","Needs CSV import + Pivot.","","B-FILE,B-MENU"),
]] + [
r("V5-010","NOT_RUN","Native Help, Statement images, themes, first-display coordinates; fresh full gates","Repo gates rerun at HEAD (see checks/). Help/themes not exercised.", "checks/gates.tsv"),
# ---------- v6 ----------
r("V6-001","PARTIAL","All v3–v5 on same binary; Rita/MCP pins and hashes; protocol comparison; migration and rollback on disposable state",
  "Service image ids/digests/revisions recorded and matched to the brief (RITA ff90afee…, MCP d76fbbac…). Protocol probed on the new services (V6-002); old/new comparison cites step-1 receipts. Migration GUI: v6 on a copied v5 profile shows v5 workspace/dashboards, no banner, changes nothing but log + adds skills/; rollback GUI: v5 on the post-v6 profile shows the same, rewrites nothing. v3–v5 matrices only partially exercised.",
  "manifests/services.md,migration/README.md,screenshots/030-migration-v6-on-v5-profile-launch.jpg,screenshots/032-rollback-v5-on-post-v6-profile.jpg"),
r("V6-002","FAIL","Rita discovery; MCP initialize/session reuse/stale rejection/tools/list/categories/calendar; SSE order, keepalive, two turns, cancel+recovery, malformed body/unknown/unreachable model, unknown tool/bad args",
  "MCP: initialize (OpenBB MCP 4.0.11, 2025-06-18), session reuse, stale 404 'Session not found', missing session 400, 10 tools with object schemas, available_categories incl. calendar, calendar tools return XNYS data, unknown tool and bad args → isError. Rita: agents.json, statusUpdate→messageChunk order, 2 keepalive comments in a 31 s turn, two-turn history recalled ZEBRA-41, cancel then RECOVERED, malformed shape 400, unknown and unreachable model → ERROR status + explanation. FAIL: non-JSON body → HTTP 500 (D-001, backend, pre-existing on old and new Rita). Client: AI Library shows Rita Online with model openai:qwen3.6-35b.",
  "protocol/mcp-probe.json,protocol/mcp-calendar.json,protocol/rita-probe.json,protocol/rita-keepalive.json,screenshots/003-ai-library-agents-rita-online-rounds-40-default.jpg", cls="BACKEND", issue="D-001"),
] + [r(c,"BLOCKED",e,"Every step needs a typed Rita prompt (B-TEXT); full-screen control not approved." + extra,"",lim=l) for c,e,extra,l in [
("V6-003","#322 local tools envelopes; search/add/describe/set; save/reload/Undo; contaminated old chat"," Automated live gate (not native): rita-authoring-live 12/12 incl. 'authors from an empty board under /skill:build-dashboard, persists, and undoes (#322)' (checks/live-run2.log).","B-TEXT"),
("V6-004","Yahoo authoring: one AAPL daily chart renamed 'AAPL — Yahoo Finance'"," Yahoo widgets live on OPENBQ_API, also degraded (D-004).","B-TEXT,B-OPENBQ"),
("V6-005","Context sharing/permissions, skills create/rename/invoke/disable, Stop then next turn",""," B-TEXT"),
("V6-007","Practice table summary/apply/Undo on CSV/XLS copies + backend refusal"," CSV/XLS copies also need file import (B-FILE). Automated live gate (not native): rita-table-model-live 1/2 in both runs (D-006, model conduct).","B-TEXT,B-FILE"),
("V6-008","Fixed 60-row AAPL monthly OHLCV; refusals (#323/#324)"," Independent oracle available: reference-manual/v6/demos/expected.json.","B-TEXT,B-FILE"),
("V6-009","Twelve Market Kit tabs fresh answers; unattended (#326)"," EXAMPLE_DATA not served (B-EXAMPLE). Automated live gate (not native): 'writes an answer into the note on each of twelve tabs: every card saved exactly once (#326)' passed (checks/live-run2.log).","B-TEXT,B-EXAMPLE"),
("V6-010","AAPL/MSFT comparison oracle values"," EXAMPLE_DATA not served.","B-TEXT,B-EXAMPLE"),
]] + [
r("V6-006","PARTIAL","Tool-round default/range; Done persists, Cancel discards, legacy import; snapshot; exhaustion behaviour",
  "Fresh settings.json has ritaMaxFunctionRounds 40; AI Library shows 'Maximum tool rounds 40 (default)'; migrated v5 profile gains no key without a UI change. Range/Done/Cancel need the select (B-MENU); exhaustion needs Rita prompts (B-TEXT). Unit query.test.ts covers default-40/limit (unit gate PASS).",
  "screenshots/003-ai-library-agents-rita-online-rounds-40-default.jpg", lim="B-MENU,B-TEXT"),
r("V6-011","BLOCKED","Complete example-service catalogs; every widget/app/tool/failure path; licensing/rollback manifest",
  "EXAMPLE_DATA not served by any bound service (RITA/MCP apps.json & widgets.json 404; no practice/prices/market_* IDs in 995+71+70). MCP catalog discovered (10 tools, categories).", "manifests/services.md,protocol/mcp-probe.json", lim="B-EXAMPLE"),
r("V6-012","BLOCKED","Deferred research/archive suite","BLOCKED by ruling (deferred; ARCHIVE not configured).", mand=False, lim="ruling"),
]
E = {
1:("PARTIAL","Native import 14 tabs/70 cards with resolved IDs (baseline 70); export, duplicate-name and Keep/Replace not run.","import-compare/baseline-onboarding-first-display.json","B-WINDOW"),
2:("BLOCKED","Company/year are dropdowns.","","B-MENU"),
3:("PASS","MSFT cell click set Group 3 to Microsoft Corporation on both cards; details show Microsoft (MSFT), Sector Technology, $2.9T.","screenshots/014-E05-003-msft-cell-click-updates-group.jpg",None),
4:("NOT_RUN","Second independent import not performed.","","B-WINDOW"),
5:("NOT_RUN","param_echo built-in app is a file example, not served.","","B-FILE"),
6:("PASS","Column-definitions table: Price ascending AAPL 150.25, MSFT 340.5, GOOGL 2.8K; persisted as sorting price asc across restart.","screenshots/016-E05-006-oracle-table-sort.jpg,restart/baseline-dashboard-before-restart.json",None),
7:("BLOCKED","Header Hide is a column menu.","","B-MENU"),
8:("NOT_RUN","Header resize drag not attempted.","",None),
9:("BLOCKED","Pin is a column menu.","","B-MENU"),
10:("NOT_RUN","Header drag not attempted (native gesture gate remains open).","",None),
11:("BLOCKED","Filter needs text.","","B-TEXT"),12:("BLOCKED","Param filter needs text.","","B-TEXT"),
13:("BLOCKED","Table/Chart switch is a dropdown; chart Q1–Q4 values/targets render.","screenshots/016-E05-006-oracle-table-sort.jpg","B-MENU"),
14:("BLOCKED","Same; Jan–Jun two-line chart renders.","","B-MENU"),15:("BLOCKED","Transpose is a menu.","","B-MENU"),16:("BLOCKED","Exports via menus/Save panel.","","B-MENU"),
17:("PARTIAL","Boolean → disabled PASS (and persisted); number 250 / text Rehearsal BLOCKED.","screenshots/012-baseline-input-params-defaults.jpg","B-TEXT"),
18:("BLOCKED","Date needs text.","","B-TEXT"),19:("BLOCKED","Dropdown.","","B-MENU"),20:("BLOCKED","Dropdown.","","B-MENU"),21:("BLOCKED","Dropdown.","","B-MENU"),22:("BLOCKED","Text.","","B-TEXT"),23:("BLOCKED","Dropdown.","","B-MENU"),
24:("BLOCKED","v4 probe apps not served; file import.","","B-FILE"),25:("BLOCKED","As E05-024.","","B-FILE"),26:("BLOCKED","As E05-024.","","B-FILE"),27:("BLOCKED","As E05-024.","","B-FILE"),28:("BLOCKED","As E05-024.","","B-FILE"),29:("BLOCKED","As E05-024.","","B-FILE"),30:("BLOCKED","As E05-024.","","B-FILE"),31:("BLOCKED","As E05-024.","","B-FILE"),
32:("PARTIAL","Quit/relaunch: all profile files byte-identical, no banner, boolean edit rendered after restart; groups/sorting persisted in file, not all re-checked on screen.","restart/profile-hashes-before.txt,restart/profile-hashes-after-relaunch.txt",None),
33:("NOT_RUN","Save panel not opened.","","B-MENU"),
34:("NOT_APPLICABLE","No EODHD statement backend is bound for this v6 run (services manifest); provider statement alignment is out of the selected service set.","manifests/services.md",None),
35:("BLOCKED","Workspace creation needs text.","","B-TEXT"),
36:("BLOCKED","Pivot menus.","","B-MENU"),37:("BLOCKED","Pivot menus.","","B-MENU"),38:("BLOCKED","Pivot menus.","","B-MENU"),39:("BLOCKED","Pivot menus.","","B-MENU"),
40:("BLOCKED","Statement fixture not served.","","B-FILE"),41:("BLOCKED","As E05-040.","","B-FILE"),42:("BLOCKED","Pivot exports via menus.","","B-MENU"),
43:("NOT_RUN","apps.json export/import roundtrip not run.","","B-WINDOW"),
44:("BLOCKED","Requires stopping the reference container; the brief forbids stopping NAS services.","","B-RULE"),
45:("NOT_RUN","Save panel not opened.","","B-MENU"),46:("NOT_RUN","Option-N/Escape not attempted (window shortcuts do reach the app: ⌥2 switched dashboards).","",None),
47:("BLOCKED","Research-desk EODHD widgets: no EODHD backend bound; ticker change needs text.","","B-TEXT"),
48:("BLOCKED","As E05-024.","","B-FILE"),
49:("PASS","Automated: src/lib/dateExpressions.test.ts 91 tests passed in the HEAD unit gate (historical 88). No native clock manipulation.","checks/unit.log",None),
50:("BLOCKED","Native drop gesture not drivable.","","B-FILE"),51:("BLOCKED","CSV/XLSX seeding + import.","","B-FILE"),52:("BLOCKED","As E05-051.","","B-FILE"),53:("BLOCKED","As E05-051.","","B-FILE"),54:("BLOCKED","As E05-051.","","B-FILE"),55:("BLOCKED","As E05-051.","","B-FILE"),56:("BLOCKED","Card menu.","","B-MENU"),
57:("PASS","Automated suites at HEAD: localFiles 18, pivotTable 32, pivotConfig 21, DropZone 24, transpose 12 = 107 tests passed. Does not close native drop.","checks/unit.log",None),
58:("BLOCKED","Workspace.","","B-TEXT"),59:("NOT_RUN","Laptop manual screenshots not produced.","",None),60:("BLOCKED","Pivot chooser.","","B-MENU"),61:("BLOCKED","Pivot chooser (#315).","","B-MENU"),
62:("PASS","Empty profile launch: no settings failure banner; settings.json created with defaults; log has only the expected Local discovery error.","screenshots/001-fresh-profile-launch.jpg",None),
63:("FAIL","Grouping keeps exported y=2/11 (the historical oracle), but the same import compacts the Types tab by −2 rows (D-005): #317-class first-display coordinate loss persists.","import-compare/baseline-onboarding-first-display.json","CLIENT"),
64:("BLOCKED","Workspace Arrange.","","B-MENU"),65:("BLOCKED","Workspace.","","B-TEXT"),66:("BLOCKED","Workspace (#320).","","B-HOVER"),
67:("PASS","Intentional HTTP 500 renders 'HTTP 500: Error that just occurred' with Retry; neighbouring markdown cards render.","screenshots/010-baseline-types-top.jpg",None),
68:("PASS","Current widgetTypes contract: the TradingView card renders an advanced chart through the UDF feed ('Rendered by TradingView'); the legacy 'unsupported' expectation is obsolete per V3-006.","screenshots/025-baseline-tradingview-renders.jpg",None),
}
for n,(st,act,arts,lim) in E.items():
    cls = "CLIENT" if st=="FAIL" else None
    R.append(r(f"E05-{n:03d}", st, "See legacy-case-allocation.md historical oracle", act, arts, cls=cls, lim=None if lim in (None,"CLIENT") else lim, issue="#317 / D-005" if n==63 else None))

# ---------- Run 2 (GUI retest, ~16:39-17:30 EDT) ----------
# Each retested case keeps its run-1 record as history (case_id "<ID> (run 1)", non-mandatory)
# and gets a current record with rerun_of pointing at it.
R2 = {
"V3-002": ("FAIL","REFERENCE_CURATED (now sha-1978c19, redeployed by someone else at 15:37) imported natively: Onboarding App for Devs (14 tabs/70 cards, Keep both) and Episode 3 — Pivot examples (4 tabs). Curated cards bind to REFERENCE_BASELINE by widget id while baseline is connected (design D3), so curated widgets are not rendered independently. D-005 on the Types tab. D-007: all four Pivot-example cards render the 5 raw rows; the imported pivot-v1 definitions are stored as analytical models that backend tables never execute.","import-compare/R2-curated-onboarding-first-display.json,profile-snapshots/R2-curated-pivot-examples-after-import.json,screenshots/R2-004-curated-pivot-examples-monthly-ohlc-plain-table.jpg","CLIENT","D-007 / D-005",None),
"V3-003": ("FAIL","D-005 reproduced on a fresh import; E05-004 copy independence PASS; Toyota→Tesla still needs a native select (Return/Down do not change it).","import-compare/R2-baseline-onboarding-first-display.json","CLIENT","#317 / D-005","B-MENU"),
"V3-004": ("PARTIAL","Typed parameters now work via keyboard focus: Number 250 and Text 'Rehearsal' echoed (E05-017). Date/dropdown/multi/dependent still BLOCKED (native selects).","screenshots/R2-003-E05-017-number-250-text-rehearsal.jpg",None,None,"B-MENU"),
"V3-007": ("PARTIAL","Duplicate-name dialog: Replace / Keep both '(2)' / Skip / Cancel. Keep both added '(2)' and left the original byte-unchanged; second import offered '(3)'; Replace kept the dashboard id and regenerated every tab/card id, '(2)' untouched. OPENBQ_API apps now discovered (38) after the restart (D-003 retest). Malformed manifests, stale resurrection and export privacy NOT_RUN.","screenshots/R2-002-duplicate-name-dialog.jpg,screenshots/R2-001-connections-openbq-38-apps-after-restart.jpg,run2/NOTES.md",None,None,None),
"V3-010": ("FAIL","After the OPENBQ_API restart all 38 apps are discovered natively; 6 imported (BLS ×5, Cboe) with first tab rendered (Release Calendar rows, document viewers, Cboe quote/history/chart). File compare: tabs/cards match for all 6, but D-005 on every BLS first tab and D-008 (BLS groups 3 → 2, symbol default lost). 32 apps not imported (GUI cost/flakiness). Backend sweep 284/995 (serial resume stopped; see run2/NOTES.md).","import-compare/R2-openbq-*.json,screenshots/R2-app0*.jpg,backend-sweep/openbq.jsonl","CLIENT","D-005 / D-008","B-WINDOW"),
"E05-001": ("PARTIAL","Native import 14 tabs/70 cards; duplicate name offers Keep both → 'Onboarding App for Devs (2)' (historical oracle '(2)'); Types tab compaction (D-005, #317). Export not reachable (card menu refused).","screenshots/R2-002-duplicate-name-dialog.jpg","CLIENT","#317 / D-005","B-MENU"),
"E05-004": ("PASS","Original dashboard Group 3 → MSFT after a cell click; the '(2)' copy keeps AAPL (files).","run2/NOTES.md",None,None,None),
"E05-008": ("BLOCKED","Header boundary drag produced no width change and no saved width (resize handle appears on hover only).","",None,None,"B-HOVER"),
"E05-010": ("PASS","Native header drag moved Price before Stock; saved columnOrder [price, stock, change]; identical after quit/relaunch and rendered so.","screenshots/R2-005-E05-010-header-drag-price-first.jpg",None,None,None),
"E05-017": ("PASS","Boolean → disabled (run 1); Number 250 → 'Number: 250'; Text Rehearsal → 'Text: Rehearsal' (keyboard-focused entry).","screenshots/R2-003-E05-017-number-250-text-rehearsal.jpg",None,None,None),
"E05-032": ("PASS","Second restart with 10 dashboards: every profile file byte-identical; boolean (run 1) and header order (run 2) rendered after relaunch; group chips show saved values; no banner.","restart/R2-profile-hashes-before.txt,restart/R2-profile-hashes-after.txt",None,None,None),
"E05-002": ("BLOCKED","Retried: company/year selects do not change with keyboard Down/Return.","",None,None,"B-MENU"),
"E05-016": ("BLOCKED","Retried: card ⋯ menu is a pop-up control, refused.","",None,None,"B-MENU"),
"V6-003": ("BLOCKED","Run 2: text entry became possible, but the Rita pane opens only on pointer hover, input focus (input not rendered while closed) or pin (set only by a sendToAgent cell; none served). Raw input produces no mouseenter, so no native Rita turn is possible. Automated live gate evidence unchanged.","run2/NOTES.md",None,None,"B-HOVER"),
}
for cid,(st,act,arts,cls,issue,lim) in R2.items():
    old = next(x for x in R if x["case_id"]==cid)
    hist = dict(old); hist["case_id"] = cid+" (run 1)"; hist["mandatory"] = False
    R.append(hist)
    old.update({"status":st,"actual":"RETEST run 2: "+act,"artifacts":[a for a in arts.split(",") if a],"failure_class":cls,"issue":issue,"limitation":lim,"rerun_of":cid+" (run 1)"})
for cid in ("V6-004","V6-005","V6-007","V6-008","V6-009","V6-010"):
    x = next(y for y in R if y["case_id"]==cid)
    x["actual"] += " Run 2: still BLOCKED — the Rita pane cannot be opened by raw input (B-HOVER), although typing became possible."
    x["limitation"] = (x["limitation"] or "") + ",B-HOVER"
F = os.path.join(D, "results.json")
if os.path.exists(F): os.remove(F)
d = json.load(open(F)) if False else None
open(F,"w").write(json.dumps({"results": R}))
# merge header + summary via rec.py
subprocess.run(["python3", os.path.join(D,"rec.py"), "--render"], check=True)
