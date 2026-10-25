# Clean v6 assembly ledger

Base clean v5 89889791bad5b44c857f3efe4b528231dd299560 (codex/clean-v5-reconciled). Branch codex/clean-v6, local only.
Donors: bdobb-v2 v6.2.1 3debd899eaea47a303319d4907f41075ff49f2b1 (base v5.7.2 c8188ff3a3cc0a479dbe5bd3e87fbd3836fa036c); a5229ea595eb7019c85cca7412d1b1e034755961 (tool rounds).
Dispositions: docs/releases/v6-delta-manifest.tsv. Receipts: docs/releases/validation/v6/.

## Steps (every commit of Parts A-C)
| Commit | Part | Subject | Donor commits named ("none named" = authored here, not donor code, except the five listed under Known deviations) |
|---|---|---|---|
| 23a0e7f | plans | docs(v6): implementation plans for the clean v6 client (parts A-C) | none named |
| a198a76 | A | chore(v6): version 6.0.0, delta manifest and assembly ledger | 3debd899e, a5229ea59, c8188ff3a |
| 7e19bd4 | A | feat(v6): carry Rita library layer from v6.2.1 | 071753d70, 2a35dad39, 3debd899e, 4bc3ba7c8, a29c4b169, c8188ff3a, ddaa0a201 |
| 84414d2 | A | feat(v6): carry Rita stores and local tools; gate table tools to worker tables | 3debd899e, 4ece1b7f1, c5b032a72 |
| 8a149c5 | A | docs(v6): add Part A Task 17 (proxied MCP tool names) and spec addendum | none named |
| fda3207 | A | feat(v6): get_widget_data reads the card's effective inputs (adaptation 2) | 3debd899e |
| 34d3be2 | A | fix(v6): get_widget_data uses the fiscal months the card shows (adaptation 2 review) | 3debd899e |
| c85fe05 | A | feat(v6): remove_widget undo restores the whole clean card (adaptation 3) | 3debd899e |
| 4f28d9a | A | test(v6): pin byte-exact markdown tool persistence (adaptation 4, #326) | none named |
| 755d41b | A | feat(v6): configurable Rita tool rounds, default 40, range 1-40 (adaptation 5) | 3debd899e, a5229ea59 |
| 1918ac6 | A | fix(v6): carry ritaMaxFunctionRounds in the settings bundle (adaptation 5 review) | none named |
| c10477b | A | test(v6): MCP 2.0.1 initialize/tools-list fixtures and protocol pins (adaptation 7) | none named |
| f638d88 | A | feat(v6): seed Rita/MCP defaults from optional build variables | none named |
| 45f1ae0 | A | fix(v6): enhance Task 9 tests and add .env.example variables | none named |
| 6ea6eb4 | A | feat(v6): carry AI Library and Rita pane UI; rail/library/shortcut hunks | 3debd899e, 77e4d32e0, bd95e91e2 |
| cb5233e | A | feat(v6): mount Rita pane, AI Library and app MCP import in App | 3debd899e |
| e4587a6 | A | feat(v6): per-card Rita sharing; availableViews extracted from clean modes | 3debd899e |
| 759cf11 | A | fix(v6): satisfy exhaustive-deps for availableViews memo; move chart comment into cardViews | none named |
| 3329231 | A | feat(v6): sendToAgent cell action on leaf rows | 3debd899e |
| 4f2d68a | A | feat(v6): AI Library tool-round control (a5229ea59, bounds 1-40) | a5229ea59 |
| 392747f | A | feat(v6): generated share-folders capability and .env scrub exclusion | 3debd899e |
| 6091523 | A | test(v6): Rita, AI Library and agent-options browser specs; v6.0.0 Rita sample (PR #179 a616a7a87) | 3debd899e, a5229ea59, a616a7a87 |
| 3e753ca | A | feat(v6): per-tool disable and display see proxied MCP tool names (call_tool, run_pipeline) | none named |
| 939ee3c | A | fix(v6): drop a failed Rita undo entry and show its message in the edit bar | none named |
| 298fa3d | A | test(v6): carry the live Rita and real-endpoint integration gates from 3debd899e | 3debd899e |
| d478282 | A | docs(v6): manifest .env.example row; log settingsBundle and key-maint warnings | none named |
| b5e08b2 | A | fix(v6): record proxied names only on success; chat export shows effective tool names | none named |
| 20da7b7 | A | fix(v6): keep the logger out of the table worker's import graph | 3debd899e |
| abcb33e | A | chore(v6): Part A assembly gate receipts | none named |
| 0e0227e | B | feat(v6): strict table-model/1 envelope parser | none named |
| de0d615 | B | fix(v6): table-model/1 parser handles inherited keys, nested alias refs, empty strings | none named |
| 361531b | B | feat(v6): table runtime access and revision witness for Rita | none named |
| 2260527 | B | feat(v6): table capability descriptors from shared validators | none named |
| aa858d3 | B | feat(v6): describe_table summary over the shared table runtime | none named |
| 5dc3d4b | B | feat(v6): describe_table member and formula sections with bound cursors | none named |
| ba07188 | B | fix(v6): guard describe_table section worker calls and tighten cursors | none named |
| 74d7268 | B | feat(v6): table-model/1 candidate builder for categories, measures, layout and controls | none named |
| e0cb850 | B | fix(v6): candidate seed keyed on stored measures; refuse statement ops; copy presentation arrays | none named |
| 1427cff | B | feat(v6): formulas via the drawer binder; stage-aware filters and Page | none named |
| 581c2e3 | B | fix(v6): report cycle affected_ids; strengthen formula and result-filter tests | none named |
| bccd3d7 | B | feat(v6): Statement template, override, reset and update operations for Rita | none named |
| 234e72b | B | fix(v6): pass Statement update conflicts through buildCandidate; order errors | none named |
| 32b2fca | B | fix(v6): restore guard so an applied Statement is not overwritten by the old table model | none named |
| 30a217b | B | feat(v6): arrange_table transaction: witness, shared validation, preview, guarded commit | none named |
| 1948d64 | B | fix(v6): arrange_table returns a settled revision, re-resolves the card at the write boundary, bounds the preview | none named |
| 94df54f | B | fix(v6): type the settled revision in the arrange test | none named |
| 2ca0c98 | B | test(v6): a refused Rita Undo is dropped and surfaced, older entries stay undoable | none named |
| feb1a14 | B | feat(v6): viewer-scope controls for Rita, session only, with Undo | none named |
| 5f84251 | B | fix(v6): keep the stuck-view mock referentially stable so the mounted table does not loop | none named |
| 9c1cc2b | B | fix(v6): drop dead group branch in arrangeViewer, reuse refusalCode, test no-op/keyless reset/rollback | none named |
| e55b709 | B | feat(v6): describe_table/arrange_table take the table-model/1 contract | none named |
| 7b687c3 | B | test(v6): Rita/drawer parity, failed write and source-change guards on the real worker | none named |
| 9ce7dcf | B | test(v6): linked tables compute only from the immediate presented source | none named |
| 58fc199 | B | test(v6): make the parity, failed-write and source-change assertions non-vacuous | none named |
| ec3095b | B | feat(v6): arrange-table skill: inspect, interpret, arrange once, explain (#324) | none named |
| 8459603 | B | test(v6): browser Rita arrange round trip on a CSV table with one Undo | none named |
| f6e2cf1 | B | fix(v6): arrange_table errors name the {id}/{alias} shape for reference fields | none named |
| 957dd93 | B | fix(v6): describe_table capabilities list each operation's fields | none named |
| 77da627 | B | test(v6): rita-live get_widget_data round trip asserts the contract runAgentQuery has | 3debd899e |
| 7a72766 | B | test(v6): live Rita gate that fails on skip; table-model live acceptance; Part B receipts | none named |
| e4193c4 | B | fix(v6): teach Rita the field/category/measure roles for arrange_table | none named |
| e264bd8 | B | fix(v6): live gate fails a test file that cannot load | none named |
| df33486 | B | test(v6): table-model live test 2 asserts the never-sum-text invariant | none named |
| ec4710b | B | docs(v6): Part B live receipts after the Rita teaching fix | none named |
| 0f55c2f | B | fix(rita): register arrange Undo before the settle wait | none named |
| 1bf031a | B | test(rita): live tool-round test also rejects a round-limit WARNING | none named |
| 09bb140 | B | test(rita): name the contract test for what it checks (declared-before-use) | none named |
| 59e3003 | B | fix(rita): live-check strips id= precisely and keeps the credential out of argv | none named |
| 4ffc916 | B | test(rita): the live no-WARNING check targets the round-limit WARNING only | none named |
| 2c36057 | B | docs(v6): Part B final-HEAD gate receipts, live run A/B, assembly wording fixes | none named |
| 6568c93 | C | docs(v6): Reference Manual pages for Rita setup, chat and the AI Library | 3debd899e |
| 6bfa08b | C | docs(v6): Quick Help topics for Rita and the AI Library; tables cross-reference | 3debd899e |
| 99ccb19 | C | docs(v6): troubleshooting and guide hunks for Rita, MCP and the AI Library | 3debd899e, c8188ff3a |
| e938d64 | C | docs(v6): fix Part C review findings (apps-sync owner, AI Library paths, wording) | none named |
| 532c86d | C | docs(v6): regenerate Rita and AI Library help screenshots in both themes | none named |
| 67095c0 | C | docs(v6): user guide and v6 reference manual | 3debd899e |
| 029bd17 | C | docs(v6): provenance for the v6 assembly | none named |
| 084e0ef | C | docs(v6): correct provenance descriptors for donor commits | none named |
| 49bf207 | C | chore(v6): final gate and native QA bundle receipts | none named |
| 216dfab | C | docs(v6): migration and rollback receipts on QA profiles | none named |
| 8faf0a5 | C | docs(v6): live Rita gate receipts (run 1 failed 21/22, extra run 22/22) | none named |
| 0bd62b0 | C | docs(v6): replace home paths in validation receipts with <home> | none named |
| 6a85b92 | C | docs(v6): state the verified scope of migration and rollback in the manual | none named |
| d80ca3b | C | test(v6): guard the table worker's static import graph from the logger and Tauri | none named |

The table is complete through d80ca3b. The one commit it omits is the one that adds the last rows (the Part C final-fix ledger commit, the last commit of the branch); `git log --reverse --format='%h %s' 0f93e7e..HEAD` reproduces the full list. Task 18 receipts are the commit after 20da7b7 (abcb33e).

## Task 2 notes (library layer)
- R4: `toPivot` stays private/absent. Its only consumer, `arrangeTable.ts`, is EXCLUDED; clean's widgetsJson has no pivot preset, so the donor's `toPivot` block and `pivotPresetIssues` hunk were not re-applied (only the `storage.mcpUrl` block and `mcpUrl,`).
- Deferred to Task 3 (they import `chatStore` / `mcpTokensStore` / `skillsStore`, which do not exist yet; typecheck gate): `src/lib/chatExport.ts` + `.test.ts` (ADD) and `src/lib/bootstrap.ts` + `.test.ts` (CLEAN-APPLY, same-base verified). Carry both in Task 3 with the stores.
- `appsJson.examples.test.ts`: clean's expectations kept; donor's `v5.7.0-parameters-and-pivot` (not in clean) and `v6.0.0-rita` example names NOT added yet because the example file is a later NON-SRC ADD; add the name when `docs/examples/v6.0.0-rita.apps.json` lands.
- `appsJson.ts`: `mcpServers` read from the same `JSON.parse` result as clean's envelope decoder (wrapped in clean's AppExtensionError try/catch); `mcp_servers` is never added to v4/v5 profiles or exports.
- `types.ts`: eight Settings fields added; the donor's rewritten `workspaceOrder` comment dropped (clean wins).
- `params.test.ts`: donor settings defaults added; its duplicate `numberShortcutTarget` omitted (clean already has it).
- Added isolation test block to `appsJson.test.ts` (brief step 5); its third case needed `description` on the sample server because `parseMcpServers` requires it.

## Task 3 notes (stores, local tools, table-tool gate)
- Carried the Task 2 deferrals: `chatExport{,.test}.ts` (ADD), `bootstrap.ts` (same-base, donor verbatim), `bootstrap.test.ts` (3-way merge, 0 conflicts).
- `.env.example` (root) was missing from the delta manifest; it is required by the carried `mcpPort.test.ts` (reads it) and is clean (placeholders only), so it was carried verbatim from v6.2.1. Added to the manifest as ADD (manifest now 255 data rows).
- `LocalToolDeps` is now `Record<string, never>`; `chatStore` passes `undefined` and its `runAgentTool` callback dropped the unused `signal` parameter.
- `describe_table` / `arrange_table` route to `tableModel/tools.ts`; past the gate they answer `adapter-pending` until Part B wires table-model/1.

## Task 7 notes (tool-round setting)
- `query.ts` no longer exports `MAX_FUNCTION_ROUNDS`; it lives in `limits.ts`. Mechanics from a5229ea59 at bounds 1-40, default 40.
- `settingsBundle.ts`: `ritaMaxFunctionRounds` is in `BUNDLE_SETTINGS_KEYS` (integer 1-40 validated, legacy import without it keeps the current choice), per the spec; it also travels in `ai-library.json`.
- `params.test.ts` settings fixture gained `ritaMaxFunctionRounds: 40` (type completeness only).

## Rulings applied
- 2026-10-07: table-model tools cover CSV/XLS and linked tables only; backend tables return `unavailable` / `server-execution-pending`; no backend registration with the client worker; no second calculator; v4/v5 untouched.
- NAS endpoints are tailnet-only without auth (funnel off). Rita gets no client auth.
- Step-1 services PARTIAL/FAIL items are accepted differences pending the services pairing-A results.
- Tool-round setting: default 40, range 1-40.

## Review warnings (removed or weakened assertions)
- `src/lib/skillsFiles.test.ts` (donor test, not a clean assertion): the two `bundledSkills`/`loadSkills` slug lists no longer expect `arrange-table`, and the no-copyright check reads `build-dashboard` instead. Reason: the `arrange-table` skill is ADAPT/Part B (table-model/1) and is not carried in Task 2. Restore both when Part B adds the skill. Restored in Part B Task 15.
- `src/lib/agent/localTools.test.ts`, describe "describe_table and arrange_table" removed whole (donor calculator not carried, adaptation 1). Deleted tests: profiles a backend table card; refuses an unknown card, a non-table card, and a local-file card, each with its reason; refuses without a fetcher wired; names the card and the error when fetchRows rejects, instead of a generic tool_failed; arranges in one patch, with one undo entry that restores table and view; restores an absent table state and a changed view on undo; returns every problem and touches nothing; refuses a non-object arrangement; applies with exactly one write to table, not a delete-then-set that flashes the table empty; never stores the literal view \"table\" — it clears the field, matching the default. The backend-table refusal path is covered by `tableModel/target.test.ts`; the happy paths return in Part B against table-model/1.
- `src/lib/agent/localTools.test.ts`, key-maint test: the table-tool refusal for a keys card now matches `{ message: "unknown card <id>" }` (new gate shape) instead of `{ error: ... }`, and the `fetchRows`-not-called check is dropped (there is no fetcher any more). The model still learns nothing about the card.
- `src/lib/agent/query.test.ts`: "gives up after MAX_FUNCTION_ROUNDS function rounds" (expected a thrown `exceeded N function rounds`) replaced by two cases: stops at the configured limit (final response allowed, no further tool, WARNING, history returned) and defaults to 40 rounds (41 calls). Deliberate contract change from adaptation 5 (V6-006): exhausting the cap returns history instead of throwing, so completed tool history persists. The 41-call count is preserved by the default case.
- Task 10, `src/components/LeftRail.test.tsx`: no clean assertion removed or weakened. Clean's file was kept; every `<LeftRail>` render gained the new required `onOpenAI` prop (donor does the same), and the donor's two new cases were ported unchanged: "keeps the import's notice when only its MCP servers fail to save" (now in its own describe, rendering LeftRail itself) and "AI Library row ... sits directly after Widget Library".
- Task 10, `src/components/RailIcon.test.tsx`: one conflict (the `NAMES` list). Resolved to the donor list (adds `ai`, and also `workspace`, which clean's RailIcon already had but clean's test did not cover). A superset of clean's list; nothing weakened.
- `src/components/DropZone.test.tsx`, "dropping a settings bundle" (clean assertion changed): the fixture's unknown field `ritaUrl` became `nosuchPref`, and the expectation `Ignored unknown fields: ritaUrl.` became `... nosuchPref.`. Reason: `ritaUrl` is a real setting on v6 (AI Library), so it imports instead of being ignored. The behaviour under test (unknown fields are reported) is unchanged.
- REVIEW WARNING, `src/lib/agent/localTools.test.ts` "fails visibly once another removal superseded it" (Task 5 assertion changed) and `src/stores/agentEditsStore.test.ts` "keeps the entry and propagates the error when undo() rejects" (replaced): after a rejected undo the stale entry is now DROPPED (`entries` length 0 / older entries remain) instead of kept. Reason: a kept stale entry sat on top and blocked every older Rita edit's Undo, and the only escape cleared them all. The rejection (`rejects.toThrow`) still propagates, the message is stored in `undoError` and shown by `AgentEditBar` as `role="alert"`; the older-entry-still-undoable and bar-message cases are new tests.

## Final-wave notes
- Carried the three live gates `src/test/integration/{rita-live,rita-authoring-live,real-endpoints}.test.ts` verbatim from 3debd899e, with two type-only adaptations to clean's signatures: `LocalToolDeps = {}` (clean has no `fetchRows` dep; table tools are Part B) and `groups`/`fiscalYearEnd` stubs on the `makeWidgetDataFetcher` deps. They are not run in Part A.
- REVIEW WARNING, `src/lib/settingsBundle.test.ts` (clean assertion changed): the unknown-field fixture `ritaUrl` became `nosuchPref` (same reason and change as `DropZone.test.tsx` above: `ritaUrl` is a real setting on v6). Behaviour under test unchanged.
- REVIEW WARNING, `src/lib/agent/localTools.test.ts` key-maint case: the refusal assertion now uses `toMatchObject` with the reason `unknown card <id>` instead of the donor's exact `{ error }` shape (new gate shape; see the key-maint entry above). The model still learns nothing about the card.

## Task 11 notes (App shell)
- Merged with clean winning: kept clean's conflict-dialog `openApp` flow and `<CardRemovalUndo /><PivotGroupUndo />`; `App.test.tsx` kept clean's 10 s help-chunk timeout (donor's 15 s dropped); `shims.test.ts` kept clean (donor's comment-only hunk dropped, event-shim test still present).
- Re-applied v6: Rita/AI Library imports, `aiOpen`, `ritaUrl`/`useAgentDiscovery`/`ritaPinned`, shell classes, `onOpenAI`, `<AgentEditBar />`, `RitaPane` and `AILibrary` boundaries, and `openApp(app, backendId)` with its own MCP-save try/catch. `pnpm typecheck` is fully clean.

## Task 13 notes (TableRenderer sendToAgent)
- `TableRenderer.tsx` (3 conflicts) and `TableRenderer.test.tsx` (1) merged with clean winning: kept `CellFormat` import, clean's `classes` line (execution pin-left-last / cell-error), and clean's `error` and `ExecutionGroupLabel` branches ahead of the new `activate` branch. Re-applied v6: `fillRowTemplate` import, `onSendToAgent` prop + destructure, `activate` (send-to-agent first, then cell click, both leaf-only).
- Donor test block ported whole; it already includes the group-row guard ("offers a sendToAgent cell on a leaf row only, not on a group row"), so no extra test was added. No clean assertion removed or weakened.
- CLEAN-WINS, no edit (verified in Task 10): `src/lib/pivotConfig.ts`, `src/lib/pivotConfig.test.ts`, `src/components/renderers/PivotPanel.tsx`.

## Task 14 notes (AI Library tool-round control)
- REVIEW WARNING, `src/components/ai/AgentsTab.test.tsx` (clean assertion narrowed): "renders even when no agent is discovered ... offers no model options" now asserts `queryByRole("combobox", { name: /model/i })` is absent instead of no combobox at all. Reason: the new "Maximum tool rounds" select is a legitimate combobox on the tab; the behaviour under test (no model-option select) is unchanged. Same change as donor a5229ea59.
- Donor tests adapted to bounds 1-40/default 40 (40 options, "40 (default)", persisted value 12 instead of 20/12 default); the tab has no Done/Cancel buttons of its own, so staging/commit/discard are driven through the settings store as the donor test does.

## Task 15 notes (share-folders capability and build hooks)
- Carried from 3debd899e: `scripts/generate-capabilities.{mjs,test.mjs}`; `.gitignore` and `scripts/scrub-check.sh` clean-apply (same base). `package.json` and `tauri.conf.json` merged with clean winning (version 6.0.0, `openbbDocker` v3.0.1 kept); only the `capabilities` script and the two before-commands were added. Cargo files untouched. No clean assertion removed or weakened.

## Task 16 notes (browser harness, e2e specs, Rita sample)
- Carried from 3debd899e: `e2e/rita.spec.ts`, `e2e/agent-options.spec.ts`, `docs/examples/v6.0.0-rita.apps.json`; `e2e/ai-library.spec.ts` plus a5229ea59's tool-rounds case adapted to 40 options / default 40. `scripts/browser-fixtures.mjs` and `e2e/fixtures.ts` merged cleanly; `/rita-arrange/*` routes and their round counter deliberately left out (Part B).
- `src/lib/appsJson.examples.test.ts`: `v6.0.0-rita.apps.json` added to the known-examples list, plus a case asserting the sample uses only clock, markdown and note.
- REVIEW WARNING, `e2e/ai-library.spec.ts` (donor assertion weakened): the Skills-tab case expected five skills including `arrange-table`; clean ships four (`src/skills/` has no `arrange-table`, which belongs to Part B's rewritten arrange tools), so it now expects four and the `arrange-table` text assertion is dropped. Restore both when Part B lands the skill. Restored in Part B Task 15 (five skills, arrange-table assertion back).
- Playwright note: `reuseExistingServer` silently attaches to any server on 4173; another session's stale vite (different worktree) was there and made 8 specs fail. Ran with `BDOBB_BROWSER_PORT=4373 BDOBB_MOCK_PORT=4374`.

## Task 17 notes (proxied MCP tool names; user-approved scope beyond the donor)
- REVIEW WARNING, `src/stores/chatStore.test.ts` ("refuses a call to a tool the user turned off, without reaching the server"): the expected error code changed from `tool_disabled` to `TOOL_DISABLED`. Reason: enforcement moved from chatStore's runAgentTool wrapper (which threw `McpError("tool_disabled")`) into `runAgentTool` itself so one check covers advertised and proxied names; the spec fixes the new code and a typed `{ error }` result. The behaviour under test is unchanged (refused, `callMcpTool` never reached, tool-error card shown).
- `src/lib/params.test.ts`: the `Settings` literal gained `mcpSeenProxiedTools: {}` (type completeness only).
- `src/lib/agent/mcp.test.ts`: the Task 8 schema-pin test's `as any` replaced by a local type (it failed `eslint`); assertions unchanged.


## Part A gate (Task 18)
Receipts and per-gate load: `docs/releases/validation/v6/part-a/summary.md`. HEAD 20da7b7.
- typecheck 0, lint 0, build 0, web 0 (31 pass), cargo check 0, scrub 0.
- unit 0, ONE green run: 370 files passed / 4 skipped, 6462 tests passed / 26 skipped (reference-backend needs Docker; rita-live, rita-authoring-live and real-endpoints skip without `OPENBB_*` env, skipped by design here, run live in Part B's gate).
- e2e: COMPOSITE EVIDENCE, not a single green run. Full run 257 passed / 1 failed / 1 skipped; the one failure, `e2e/table-toolkit.spec.ts:27` (30 s timeout under host load 70-97), passed when the whole file was rerun with the same flags (7 passed). An earlier run before the fix below had 117 failures.
- Product fix: `src/lib/tableColumns.ts` imported the logger statically, which pulled the plugin-fs shim into the table worker (`window is not defined`, `Worker failed`). The logger is now loaded lazily; commit 20da7b7. No assertion removed or weakened in this task.

## Part B Task 4 notes (describe_table summary)
- No Part A assertion changed: `target.test.ts` and `localTools.test.ts` only asserted `server-execution-pending` for describe_table on a backend table (still true); nothing asserted `adapter-pending` for a worker table. `arrange_table` stays adapter-pending until Task 9.
- `describeTable` on a worker table now answers `unavailable/runtime-not-ready` when the table is not open, else the table-model/1 summary. The summary carries no row values; it carries only the widget's OWN page/checklist `member_keys`, never a linked source's excluded records; `completeness` is passed through unchanged; labels/names are clipped to 200 chars and the note marks them as untrusted data.
- Spec/brief delta: added `field_count`; `modelSummary` is typed with the brief's `ModelSummary`; `describeSection` is a private stub returning `unknown-section` until Task 5.

## Part B gate (Task 17)
Receipts and per-gate load: `docs/releases/validation/v6/part-b/summary.md`; the final-HEAD gates are in `docs/releases/validation/v6/part-b/final/`. Final code HEAD 4ffc916 (gates ran at 59e3003, then one test-only commit; typecheck and lint were re-run at 4ffc916).
- typecheck 0, lint 0, build 0, `pnpm test:web` 0 (31 pass), cargo check 0, scrub 0; unit 0, ONE green run (380 files + 5 skipped, 6564 passed + 28 skipped); e2e 0, ONE green run (259 passed, 1 skipped). No composite evidence in these gates.
- Live gate (NAS openbq node, R2/R6), `pnpm test:live`: 20 passed, 0 skipped, 2 failed. `rita-authoring-live` 12/12, `real-endpoints` 5/5, `rita-live` 3/3 passed; `rita-table-model-live` 0/2 FAILED (live Rita needs several arrange_table calls and declines the text-sum in text without a tool call). Not an availability failure. Settled by the controller ruling (see the ledger summary and the Task 17 fix line below).
- Product fixes: f6e2cf1 (arrange_table errors name the `{id}`/`{alias}` shape), 957dd93 (describe_table `capabilities.operation_fields`).
- Task 17 fix (teaching, per the controller ruling): skill, `capabilities.how_to_arrange`, tool descriptions, the field-as-category refusal and the local_table widget description; the live gate now fails a test file that cannot load. Live after the fix: full `pnpm test:live` 22/22, 0 skipped, exit 0 (one run, run 13); on the final teaching, table-model test 1 passed 5/5 and test 2 passed 4/5, with at most two full passes in a row (the three-in-a-row goal is not met). Runs: `validation/v6/part-b/summary.md`.
- Final live gate after the review fixes: run A FAILED (20/22: a too-broad WARNING check I had just added to `rita-live`, since narrowed to the round-limit message, and the table-model test 1 quoted-number flake); ONE extra run B passed 22/22, 0 skipped. The gate is LLM-driven and flaky, so green is not repeatable on demand. Logs: `validation/v6/part-b/final/`.
- REVIEW WARNING, `src/test/integration/rita-table-model-live.test.ts` test 2 (assertion restated to its invariant by controller ruling). Original: "Sum the Region column" → the tool result is `refused` with `validation-failed`, Rita's reply says so, and the model is unchanged (it required at least one arrange_table call, and the last one refused with validation-failed). Now: no arrange_table call is applied and the persisted definition is unchanged, AND EITHER an arrange_table call was refused with `validation-failed` (and the reply says so, original regex) OR Rita's reply says it cannot sum and that the column is text. Reason: declining in prose from the advertised aggregations is the desired behaviour, and the original wording would fail a better model. Cost: the live run no longer forces the engine's text-sum refusal path; unit/arrange tests still pin it.
- REVIEW WARNING, `src/test/integration/rita-live.test.ts` "round-trips get_widget_data" (carried assertion changed): last history role `ai` became `tool` plus a non-empty streamed answer, because `runAgentQuery` returns history ending on the tool message and streams the text; the donor assertion could not hold after a tool round.

## Review warning index (removed, weakened or restated assertions)
Details are in the sections above and in the commit named. Status is `restored` (the assertion is back), or `justified` (the change is a deliberate contract change; reason given).

| # | Assertion | Status | Justification |
|---|---|---|---|
| 1 | `skillsFiles.test.ts` slug lists lost `arrange-table` | restored | Part B Task 15 added the skill and restored both lists. |
| 2 | `e2e/ai-library.spec.ts` Skills case: 4 skills, `arrange-table` text assertion dropped | restored | Part B Task 15: five skills, assertion back. |
| 3 | `localTools.test.ts` "describe_table and arrange_table" block (10 donor calculator tests) removed | justified | Adaptation 1: no second calculator; the backend refusal is pinned by `tableModel/target.test.ts`, the happy paths by the Part B suites. |
| 4 | `localTools.test.ts` key-maint refusal: `{error}` to `toMatchObject({message:"unknown card <id>"})`, `fetchRows`-not-called check dropped | justified | New gate shape; no fetcher exists any more; the model still learns nothing about the card. |
| 5 | `query.test.ts` "gives up after MAX_FUNCTION_ROUNDS" (threw) replaced by limit and default-40 cases | justified | Adaptation 5 (V6-006): exhaustion returns history with a WARNING instead of throwing; the 41-call count is kept. |
| 6 | `DropZone.test.tsx` and `settingsBundle.test.ts` unknown field `ritaUrl` to `nosuchPref` | justified | `ritaUrl` is a real v6 setting; behaviour under test unchanged. Donor-identical. |
| 7 | `localTools.test.ts` "fails visibly once another removal superseded it" and `agentEditsStore.test.ts` "keeps the entry and propagates the error when undo() rejects" | justified | A kept stale Undo entry blocked every older Rita edit (939ee3c). The rejection still propagates and is shown as an alert; new tests cover older-entry Undo and the bar message. |
| 8 | `AgentsTab.test.tsx` "no combobox" narrowed to `/model/i` | justified | The new Maximum tool rounds select is a legitimate combobox; donor a5229ea59 makes the same change. |
| 9 | `chatStore.test.ts` error code `tool_disabled` to `TOOL_DISABLED` | justified | Enforcement moved into `runAgentTool` so one check covers advertised and proxied names (user-approved addendum). |
| 10 | `rita-table-model-live.test.ts` test 2 restated to the never-sum-text invariant | justified | Controller ruling: declining in prose is the desired behaviour; the live run no longer forces the engine's text-sum refusal, which unit tests still pin. |
| 11 | `rita-live.test.ts` "round-trips get_widget_data": last history role `ai` to `tool` plus streamed answer | justified | `runAgentQuery` returns history ending on the tool message; the donor assertion could not hold after a tool round. |
| 12 | `RailIcon.test.tsx` NAMES list resolved to the donor list | justified | A superset of clean's list; nothing weakened. |
| 13 | `appsJson.cleanV4.test.ts` "reference pivot-v1 layout overlays become editable analytical definitions in v4" → asserts `table.pivot` | justified | User-approved 2026-10-08 (D-007, home v4; logged in v4-integration.md): the old expectation was the defect. |
| 14 | `web/browser-smoke.mjs` dropped quote-card, grid-socket, news and Rita-turn assertions | justified | D-002: this line never had those features; the smoke is scoped to what this line seeds. Plan-approved 2026-10-08. |

`LeftRail.test.tsx` (new `onOpenAI` prop), the Task 11 `App.test.tsx`/`shims.test.ts` merges and Task 13 `TableRenderer.test.tsx` removed nothing and are not warnings.

## Rulings
User rulings (authoritative):
- R1: the articles repository is untouched; Part C writes `docs/reference-manual/v6/README.md` only. Outcome: applied (Task 5).
- R2: live backend is the NAS `openbq-api` node, tailnet-only; the hostname lives in shell environment only. Outcome: applied; the live gate ran against it (Part B), no hostname is tracked.
- R3: formulas via the drawer text and binding map. Outcome: applied (Part B Task 7).
- R4: `toPivot` stays private. Outcome: applied (Task 2 notes).
- R5: native QA is copy-and-swap only. Outcome: exercised at file level on QA profiles only (v5 QA profile restored byte-identical); GUI observations BLOCKED, see Part C below.
- R6: `/mcp` was exercised live on the NAS node in Part A Task 8 (initialize and tools/list; serverInfo "OpenBB MCP" 4.0.11 against the 2.0.1 fixtures); the Mac stack was not needed. Outcome: applied.
- R7: `runtime-not-ready` plus `navigate`. Outcome: applied (Part B; documented in Help and the manual).
- 2026-10-07: table-model tools cover CSV/XLS and linked tables only; backend tables answer `server-execution-pending`.
- User-approved scope (not a ruling): proxied MCP tool names (Part A Task 17).

Controller rulings (from the three SDD ledgers):
- Part A: Help text for proxied tools lands in Part C Task 1/2 (cost: Help one part late). Seen proxied names persist as new key `mcpSeenProxiedTools`; the disabled choice keeps `mcpDisabledTools`. The Task 5 stale-Undo finding was parked and then un-parked and fixed in the final wave (drop the entry, show the message). The Part A whole-branch review ran before the Task 18 gate. History is not rewritten for the wrong trailers or missing donor names; recorded below. Future commits use Sonnet implementers.
- Part B: Task 1, `table-model/1` operations cover only what the shared model holds (no member groups, ranges or explicit reorder ops). Task 6, a table with no stored `pivot.measures` starts with no measures (cost: first arrangement omitting `layout.values` shows no value columns). Task 10 reduced to Undo tests against the existing store. A separate re-review of Task 11's fix round was waived (deletion plus tests, controller verified). Live table-model gate: a teaching problem, not availability; assertion 2 restated (warning 10).
- Part C: `apps:sync` maps `v6.0.0-rita` to `workspace_apps.json` exactly as the donor does (cost: openbb-docker would serve the example from every install once synced; nothing here writes to openbb-docker).
- Accepted differences pending the services pairing-A results: MCP initialize lacks the experimental/ui capability, stale-session reply id is null, the provider-grouped catalog with `--default-categories equity` is likely inert, the local-tool round trip did not reproduce.

## Known deviations (history not rewritten)
- Commits f638d88 and 45f1ae0 carry `Co-Authored-By: Claude Haiku 4.5` instead of `Claude Opus 5.5`.
- Commits 759cf11, 45f1ae0, f638d88, 1918ac6 and 4f28d9a carry or adapt donor code (or pin donor behaviour) but do not name the donor commit in their messages. Other "none named" rows are authored here.
- Both are recorded rather than fixed because the branch hashes are cited in receipts and reports; a reword rebase needs the user's approval.
- Part B live gate: at most two full passes in a row, not three; run A of the final gate failed (20/22) and one extra labelled run B passed 22/22. The gate is LLM-driven and not repeatable on demand.
- Part A e2e is composite evidence (one load-induced timeout rerun green), stated in the Part A gate section.

## Deferred items (minor, carried)
- Test that a malformed `sendToAgent` logs once. (The worker import-graph guard shipped as `workerGraph.test.ts`.)
- `get_widget_data`: unresolved or in-flight fiscal months read December; `WireContext` calendars, exchange and bounds are not sent by Rita's fetch; `turnDashboard` is captured once per turn.
- Proxied names: names are recorded only on success (done in b5e08b2); remaining nits are the 500-name cap keeping the alphabetical head, a typed-add race on the `mcpSeenProxiedTools` snapshot, duplicated host-label helpers, UPPER_CASE new error codes against snake_case `McpError`, and a comment above `MCP_201` explaining the 2.0.1 label against serverInfo 4.0.11.
- Rita Undo and bar: identity check outside the store queue; viewer-mode `refuse()` is silent; edit-bar alert CSS; `hostnameOf` drops the port in the `TOOL_DISABLED` message; `chatStore` display not directly tested.
- Table tools: `describe_table` summary lacks schema or source identity and filter stage labels; arrange preview-timeout and busy paths are untested; the engine preview excludes the grand total although a new model defaults to a visible one (taught around in the skill); `catalog.ts` template version literal is duplicated.
- Tests: "no startup warning" test spies on `withDefaults` only; no test for MCP save on the replace-only conflict path; AI Library Done with a rounds value is not tested through the dialog.

## Part C: final gates, native QA, live gate
- Final gates at 084e0ef (`docs/releases/validation/v6/final/`), all exit 0, each ONE run: typecheck, lint, build, unit (380 files passed / 5 skipped; 6576 tests passed / 28 skipped, by design: Docker and `OPENBB_*` env), e2e (259 passed / 1 skipped), web (31), help (63), cargo check, scrub.
- Native QA bundle built (`validation/v6/native/bundle.txt`): id com.artcashin.bdobb.clean.v6, version 6.0.0, ad-hoc signed.
- Task 8 (`validation/v6/native/migration.md`): PARTIAL. File-level migration and rollback PASS on QA profiles and the v5 QA profile was restored byte-identical. Every GUI observation is BLOCKED because desktop access was denied. The settings keys (`ritaUrl`, `ritaMaxFunctionRounds`) were SIMULATED by script. `chat.json`, `mcpTokens.json` and `ai-library.json` were never produced.
- Task 9 live gate (`validation/v6/live/`): first run FAIL 21/22 (`rita-table-model-live` test 2, setup-turn conduct); ONE labelled extra run PASS 22/22. This is "passed on extra run after a failure, not a clean pass". The native QA-app Rita session was NOT performed.
- Home paths in all `docs/releases/validation` receipts were replaced with `<home>` (0bd62b0).
- D1 (deferred item from Part A) is done: `src/lib/tableExecution/workerGraph.test.ts` walks the worker's static import graph and fails if the logger, `@tauri-apps/*` or `browser-shim` is reachable (proved red by re-adding the static logger import to `tableColumns.ts`, then reverted). The malformed-`sendToAgent` log test remains deferred.

## Open
- Native GUI verification of migration and rollback (all GUI rows BLOCKED), and the native live Rita session on the QA app.
- Live LLM gate flakiness: best streak 2 of the requested 3; the final gate passed only on an extra run.
- User decision on rewording the two Haiku-trailer commits and the five commits without a donor name (the 2+5 deviations).
- Branch placement (coordinator); nothing is pushed or tagged.
- Part A e2e is composite evidence (one load-induced timeout rerun green).
- Services pairing-A results for the accepted differences above.

## Fix batch 2026-10-08 (user-approved)
- Merged `codex/clean-v5-reconciled` as `50b6c0b` (v3 D-005/D-008/D-002, v4 D-007, v5 Window ▸ Keep Sidebar Open). No hand resolutions: the merge was clean.
- Window ▸ Keep Rita Open (home v6, `ec603a4`): native check item, accelerator `CmdOrCtrl+Shift+A`, bound to `chatStore.pinned`. In the native app the JS ⌘⇧A handler no longer toggles; the browser build keeps it. Behaviour change: in the desktop app ⌘⇧A now works while typing or behind a dialog (Help updated; flagged to the user).
- `485ed5f`: the native shortcut handler returns before `preventDefault`, so the macOS menu accelerator receives the key (wry hands command-key events to the webview first and forwards only unhandled ones to the main menu).
- D-002 closed: `test:web:browser` passes and is in ci.yml's e2e job after `build:web`.
- Native QA bundle rebuilt: see `validation/v6/fixbatch-2026-10-08/bundle.txt`. The native Window-menu check is PARTIAL (see `native-menu.md`): menu items were read through the menu bar, but the enabled/checked behaviour and ⌘⇧A toggling were not run. The desktop ⌘⇧A behaviour is unverified in a packaged build.
- Receipts: `validation/v6/fixbatch-2026-10-08/`.

## Fix batch 2026-10-09 (run 3 defects, user-approved)
Plan: `docs/superpowers/plans/2026-10-09-run3-defect-fixes.md` (Tasks 3 and 5). Receipts: `validation/v6/fixbatch-2026-10-09/`.

Fixes at home on v6:
- D-010, `search_widgets`, `d6f64f0` and `27fd4df`: results rank by how many query words match, searched across name, category, subcategory, description and source. `matched_words` and `all_words_matched` are returned. The yahoo→yfinance synonym adds to the word rather than replacing it.
- D-015, `navigate`, `e37e93d`: tabs match exact, then case-insensitive, then by a unique prefix or word. A refusal lists the tab names.
- D-012, `arrange_table` `mode: "preview"`, `a97e746` and `54a3eaa`: a preview validates and calculates but never writes or adds Undo. Unknown arguments and bad modes are refused with `invalid-arrangement`. Rita quotes only the source table's exact `completeness.totalRowCount`.
  - Follow-up `e65514b`: SKILL.md now says one applying call per change and only preview calls for a read-only ask, which reconciles line 11 with section 0. The Rita help guide says read-only asks preview and never change the table.
- D-013, edit bar, `3cfc3fc` and `9fe674d`: the agent edit bar's Undo stays clear of an open Rita pane. The e2e hit test asserts that the pane is open.
- D-009, `f4ee449`: Keep Rita Open is disabled, and does nothing, without a Rita URL. `App.tsx` adds `rita-pinned` only when a URL is set.
  - Follow-up `20e842c`: `chatStore.togglePinned` is a no-op with no Rita URL. It is the one function every caller goes through (⌘⇧A in the browser build, the pane's Lock, the Window menu), so ⌘⇧A no longer leaves a stale pin.

Carried by merge:
- Merged v5 at exactly `4cf5663` as `e5a78ce`, which carries D-011 (`datasetFromBytes` fills missing keys with null) and D-014 (`'M'` is a first-class category transform, from v4 `9d23239`). Later v5 commits are not included.
- One hand resolution, in `src/lib/tableModel/validation.ts`. v6 had moved the inline transform enum into `CATEGORY_TRANSFORMS` (`0e0227e`). The resolution keeps v6's line and adds `'M'` to `CATEGORY_TRANSFORMS`.
  - The agent `contract.ts` and `capabilities.ts` read `CATEGORY_TRANSFORMS`, so they pick up `M` with no edit.
  - No other v6 transform list lacked `M`. The worker validation, both type unions, `categories.ts`, `CategoryEditor` and `ArrangePanel` arrived with it.
- D-014 on v6, `fe1dd1c`: `HOW_TO_ARRANGE` adds "first/last become available when the arrangement has date categories (Y/Q/M) on exactly one field; add that category in the same call."
  - New hermetic test `arrangeMonthly.test.tsx`: `arrange_table` builds monthly first open, max high, min low, last close and sum volume from an `M` category over rows out of date order. The result is "applied", and both months' numbers are checked. The test was proved red with `M` removed from `CATEGORY_TRANSFORMS`.
  - A capabilities test checks that `category_transforms` lists `M`.
- Review follow-ups, `00db955`:
  - SKILL.md says "Y/Q/M are calendar".
  - The desktop ⌘⇧A test seeds a Rita URL. Before, it passed on the empty URL a sibling test left behind; it now fails if the native guard is removed (proved).

Changed assertions (none weakens kept behaviour):
| Commit | Test | Change | Why |
|---|---|---|---|
| `e37e93d` | `localTools.test.ts` navigate | The refusal `{ error: "unknown tab Ghost" }` became the new text, which lists the tab names | D-015: a refusal names the choices |
| `27fd4df` | `localTools.test.ts` search_widgets yahoo | `["w_a"]` / `all_words_matched` 1 became `["w_a", "w_d"]` / 2, with a new fixture widget literally named "Yahoo" | D-010: the synonym adds to the word |
| `f4ee449` | `useWindowMenuPins.test.tsx` | `beforeEach` seeds `ritaUrl`, and new cases clear it | D-009: Keep Rita Open needs a URL; the existing tests keep their meaning |
| `fe1dd1c` | `contract.test.ts:75` | The enum alternatives gained `"M"` | D-014; the one change the plan pre-approved |
| `20e842c` | `useDashboardShortcuts.test.tsx` ⌘⇧A toggle test | Seeds `ritaUrl` | Follow-up: the toggle needs a URL |
| `00db955` | `useDashboardShortcuts.test.tsx` desktop ⌘⇧A test | Seeds `ritaUrl` | Isolation; the test is stronger, not weaker |

`skill.test.ts` must-contain strings: unchanged by this batch's follow-ups. `a97e746` only added strings.

Gates at `00db955`: all 11 `run-gates.sh` gates exit 0, each ONE run, under host load of 232 to 744.
- unit: 388 files / 6624 tests passed.
- e2e in Chromium: 262 passed / 1 skipped.
- WebKit (rita, rita-arrange, layout, rail, drop, smoke, rita-edit-bar, rita-no-url): 22 passed / 1 failed. The failure is `rail.spec.ts:109`, which is PRE-EXISTING: it also fails at base `131e4fe`. It was not fixed.

A first gate run was stopped after typecheck and lint to apply review fixes. It is not counted.

Native QA bundle rebuilt (`com.artcashin.bdobb.clean.v6`, through the overlay):
- Main binary SHA-256 `97a4a254…9137`; bundle tree SHA-256 `47f58481…190e` (full values in `bundle.txt`).
- Not installed or launched.

Open from review:
- The hint names Y/Q/M, but the rule (`measureEligibility`) counts every non-native category, including FY/FQ and legacy buckets, and allows at most one fiscal company field. The hint was kept verbatim as dictated; widening it is the user's call.
- In the browser build with no URL, ⌘⇧A is still `preventDefault`ed although it does nothing.

## Fix batch 2026-10-09b (user-approved): v5 carry, D-017, D-016a trace

Receipts: [validation/v6/fixbatch-2026-10-09b](validation/v6/fixbatch-2026-10-09b/).

**v5 carry.** Merged `codex/clean-v5-reconciled` at exactly `f5e09a9` (the SHA, not the branch) as `5f81217` (parents `438f52a`, `f5e09a9`). That brings in the Workspace connection (v5 merges `2d55644`, `0417e57`), the BDOBB2 → BDOBB rename (`f7ac8f0`) and the widgetGap sync (`1597f84`). Conflicts and how each was resolved:

| File | Resolution |
|---|---|
| `src-tauri/tauri.conf.json` | v5's rename (`productName` BDOBB, identifier `com.artcashin.bdobb`), v6's version `6.0.0` |
| `src-tauri/Cargo.toml` | v5's crate name `bdobb` and description BDOBB, v6's version `6.0.0` |
| `src-tauri/Cargo.lock` | `bdobb` at `6.0.0` (`cargo check --locked` accepts it) |
| `src/lib/settingsBundle.ts` | both exclusions: v6's `agentPromptSuggestions` and v5's `settingsStorage`; v6's AI Library comment plus v5's settingsStorage sentence (v5's "v5 has no Rita settings" sentence dropped, false here) |
| `src/lib/settingsBundle.test.ts` | both sides' tests kept |
| `src/lib/settingsFile.ts` | v6's fields kept; v5's `settingsStorage` added, read from v6's `merged` (seeded) object like every other field on this line |
| `docs/user-guide.md` | v5's User Settings sentence plus v6's status line |
| `src/help/shots/connections-{dark,light}.png` | regenerated on the merged tree with `pnpm help:shots --only connections`: byte-identical to v5's, so v5's copies stand. `settings-and-logs` and `workspace-account` (auto-merged to v5's) also regenerated byte-identical |

Auto-merged and checked: `lib.rs` keeps v6's Window ▸ Keep Rita Open item and gains v5's data migration and deferred main-window build; `main.rs` calls `bdobb_lib`. After the merge no BDOBB2 reference remains outside `docs/releases`, `docs/superpowers`, `docs/specs`, `migrate.rs` (on purpose) and the guide test that forbids the name. The gitignored QA overlay `.superpowers/qa-v6-overlay.json` (`identifier` + `productName` only) needed no change; it still overrides both keys.

Hazard carried from v5 (not changed, needs a ruling): `migrate.rs` runs for whatever identifier the app is built with. On first launch the QA bundle (`com.artcashin.bdobb.clean.v6`) finds `com.artcashin.bdobb.clean.v3.repair` on this machine and no marker in its own folder, so it would rename the existing v6 QA data folder aside to `com.artcashin.bdobb.clean.v6.v1-backup` and replace it with a copy of the v3-repair data. Nothing is deleted. Writing the marker file `.migrated-from-clean-v3-repair` into the v6 folder before launch avoids it.

**D-017 (`96a5af1`).** `add_widget` takes an optional `params` object and applies it by calling `set_widget_params` itself (one validator, one persistence path, its own Undo entry). Success reports `params.applied`; a refusal leaves the card added and reports `params.refused` (the reasons) and `valid_params`. Since `set_widget_params` refuses all-or-nothing, one bad param means none were applied, and the description says so. The tool description, the build-dashboard skill and the Rita help row tell the model to pass required params such as `symbol` in this call. Home line: v6. Tests: params applied on add; a bad param reported with the card kept; the schema advertises `params`.

**D-016a (traced, not fixed).** `workspace_options` is built in `chatStore.send` by `workspaceOptionsFor(agent, settings.agentOptions[agent.id])` (`src/lib/agent/workspaceOptions.ts`). Two causes:
1. `agentPromptSuggestions` is client presentation only by design (`types.ts`, `settingsBundle.ts`); `chatStore` uses it only to keep or drop the suggestions event. The AI Library shows two pills labelled "Follow-up Suggestions"/"Follow-up suggestions": the agent's own agents.json feature toggle (sent) and BDOBB's display pill (not sent).
2. `agentOptions` is keyed by agent id, then feature id. A flat `{"prompt-suggestions": false}` makes `coerceAgentOptions` treat `prompt-suggestions` as an agent id whose value is not an object, and drop it; the feature then falls back to its agents.json default `true`. The nested form `{"openbb_agent_rita": {"prompt-suggestions": false}}` sends `false` (probed against the real functions).

Proposed fix (not implemented): make BDOBB's pill drive the agent's `prompt-suggestions` feature (or remove the duplicate pill), and have `coerceAgentOptions` log rather than silently drop a non-object entry.

Changed assertions:
| Commit | Test | Change | Why |
|---|---|---|---|
| `5f81217` | `version.test.ts` "is the clean v6 development version" | Cargo.lock crate name `bdobb2` became `bdobb` | The v5 rename; the version assertion `6.0.0` is unchanged |
| `25cde14` | — | none changed; one test added | Review: `params.refused` always holds strings |

Gates at `25cde14` (one `run-gates.sh` run plus `cargo test --lib`, under load from about 105 to 330): everything exits 0 except unit. Unit had one failure, `LocalTableRenderer.execution.test.tsx` "keyboard Show formula…", in code this batch does not touch; that file alone passed 39/39 on a rerun, which is composite evidence. Chromium e2e: 262 passed / 1 skipped. WebKit, 8 specs: 22 passed / 1 failed, `rail.spec.ts:109`, which is PRE-EXISTING. The QA bundle `com.artcashin.bdobb.clean.v6` has main binary SHA-256 `e05c55cd…3839`; it was not launched.

Open from review: an `add_widget` call with params leaves two Undo entries (the params, then the add), so the first Undo resets the params and leaves the card. `docs/superpowers` v6 spec and plan rows still say identity `BDOBB2`/`com.artcashin.bdobb2`. After the rename, chat history written by bdobb-v2 6.x under `com.artcashin.bdobb2` is no longer read, which affects the V6-003 premise and needs a ruling.

## Merge v5 bde9c6f (user-instructed: "merge v5 into v6 when it lands")

Receipts: [validation/v6/merge-v5-bde9c6f](validation/v6/merge-v5-bde9c6f/).

**Merge.** Merged `codex/clean-v5-reconciled` at exactly `bde9c6f` (the SHA, not the branch) as `482d0e9`, with parents `9cf34a5` and `bde9c6f`. Since the previous v5 carry (`5f81217`, which took `f5e09a9`), it brings:
- numberShortcutTarget sync (`c5be527`, receipts `fed77d6`);
- v4 `1f788b8`: D-018 worker-table Export, plus v4 fixes #13 (narrow-card param controls), #14 (Help), #15 (reference-acceptance expects `table.pivot`), #17 (object Pivot categories, including the user's `value` ruling) and #19 (missing optional Statement lines are blank unless required);
- v5 fixes #23 (Put in panel shows the recorded tab) and #26 (the rail collapses before the workspace row menu opens its dialog).

**Conflicts and resolutions.** Git found no textual conflicts. It auto-merged `LeftRail.tsx`, `LeftRail.test.tsx`, `WidgetCard.tsx`, `help/topics/tables.md` and `styles.css`.

| File | Kind | Resolution |
|---|---|---|
| `src/components/WidgetCard.tsx` | expected D-018 against Statement export; auto-merged | Checked against v5: the result is v5's resolution exactly. `workerExport = isWorkerTableProducer(card) && dashboard !== undefined && !isStatement`, and `canExport = isStatement \|\| workerExport \|\| …`. The JSON item uses `disabled={isStatement ? exportRows === null : !workerExport && (…)}`, and CSV/Excel use `!workerExport && exportRows === null`. A Statement-view local or linked table exports the Statement, not the worker rows. The v6-only parts are unchanged: Rita card sharing (`useChatStore`, `contextSharing`, `isAgentOffLimits`), `availableViews`, and the edit-bar paths. |
| `src/components/LeftRail.test.tsx` | semantic: the merged tree failed typecheck with TS2741 | v5's #26 test rendered `LeftRail` without `onOpenAI`, which is a required prop only on v6. I added `onOpenAI={vi.fn()}` the same way every other v6 render in that file does. No assertion changed. |
| `src/components/LeftRail.tsx` | auto-merged | v5's `panel.close()` before `onOpenWorkspace` (#26), placed inside v6's menu. The v6 rail items are kept. |

The rest of the v6-only work is untouched by this merge: the Rita rail, agent tools, edit bar, the D-009..D-017 fixes, and Keep Rita Open in `lib.rs`.

**Changed assertions.** None. One test call site gained a required prop (`LeftRail.test.tsx`, #26 test). It came in from v5 as new tests, with no changed assertions: `WidgetCard.workerExport.test.tsx`, `workerExport.test.ts`, `missingLines.test.ts`, the `linePolicy`/`pivotTable`/`analytical`/`workspaceFocus`/`workspaceAccount` additions, and `e2e/periods.spec.ts`. The v4 assertion changes (#15 reference-acceptance and the #17 analytical undeclared `{value, url}` case) and v5's 13-key `mergeUpload` change were approved on their own lines. They are recorded in those lines' receipts.

**Gates at `482d0e9`.** One `run-gates.sh` run on ports 4611/4612, then `cargo test --lib`. Load (1-minute) was about 150 to 280, with a 15-minute average of about 450 at the start.
- Every gate exited 0 on a single run, so there is no composite evidence.
- Unit: 394 files and 6833 tests passed.
- Chromium e2e: 263 passed, 1 skipped.
- Help: 65 tests passed. `cargo test --lib`: 15 passed.
- WebKit, 8 specs: 22 passed, 1 failed. The failure is `rail.spec.ts:109`, which is PRE-EXISTING.

**QA bundle.** `com.artcashin.bdobb.clean.v6`, version 6.0.0, ad-hoc signed, not launched. The main binary SHA-256 is `5fad2155e47621a5a0d28db4f4d2d966d05094913cb5443480ed0439fd56e86e`. The `migrate.rs` first-launch hazard (fix batch 2026-10-09b) still applies.

**Open.** No test covers export of a Statement-view worker producer; v5 flagged the same gap. v4's #11 and #25 are not in this head; they come with the next v4 merge through v5.

## Merge v5 c7836fd (#11 and #25 carry)

Receipts: [validation/v6/merge-v5-c7836fd](validation/v6/merge-v5-c7836fd/).

**Merge.** Merged `codex/clean-v5-reconciled` at exactly `c7836fd` as `16ca0f8`, with parents `b0cf254` and `c7836fd`. Through v4 `8e91662` it brings:
- #11: the "no source acquisition" e2e checks skip discovery requests (`isDiscoveryRequest` in `e2e/fixtures.ts`) and follow `MOCK_URL` instead of a hardcoded `4174`.
- #25: `workspaceAccount.ts` loses its trailing blank line, and `.gitattributes` exempts `docs/releases/validation/**` from whitespace checks.
- the v4/v5 receipts.

**Conflicts and resolutions.** There were no conflicts, textual or semantic.

| File | Resolution |
|---|---|
| `e2e/table-execution.spec.ts` | A conflict was expected here, but git merged it cleanly. The result matches v5: it imports `isDiscoveryRequest` and uses v4's filter. No v6-only lines in this file differ from v5. |
| `e2e/fixtures.ts` | Auto-merged. v4's `isDiscoveryRequest` is added, and v6's `openAILibrary` helper is kept. |
| `e2e/statement-model.spec.ts` | Taken from v5 (`MOCK_URL` with `isDiscoveryRequest`). |

After the merge, no e2e spec filters requests with a hardcoded `127.0.0.1:4174` or a `widgets.json` exclusion.

**Changed assertions.** None in v6. #11 changes which requests the "no source acquisition" checks count: discovery (`/`, `/widgets.json`, `/apps.json`, `/keys`) is excluded, and the mock origin now follows `BDOBB_MOCK_PORT`. That change is in two v4 tests, `table-execution.spec.ts` (XLS importer, dark and light) and `statement-model.spec.ts` (normal Statement import). It was approved on the v4 line and is recorded in its receipts.

**Gates at `16ca0f8`.** Ports 4611/4612, load about 90 to 160.
- Every gate exited 0 on a single run, so there is no composite evidence.
- Unit: 6833 tests passed. Chromium e2e: 263 passed, 1 skipped.
- WebKit, 8 specs: 22 passed, 1 failed. The failure is `rail.spec.ts:109`, which is PRE-EXISTING.

**QA bundle.** Rebuilt, because `src/lib/workspaceAccount.ts` (non-test source) changed, even though the change is whitespace only. `com.artcashin.bdobb.clean.v6`, main binary SHA-256 `97c6bc282f775f1581b0e21bcdd08cd7b6f1ee2aba6b39ddc0ac8692a0f8be77`; not launched. It replaces the `5fad2155…` build.

## Fix batch 2026-10-10 (FREEZE for the release regression)

- Merged frozen v5 `1ff1c91` (which contains frozen v4 `a4439c4`) as `b87eda7`. No conflicts. `9781a7b` adds the carried LeftRail test's `onOpenAI` prop.
- D-016a fixed (`5c9e2a1`). D-016 is fixed in agent-rita (patch 0011), not the client. D-017 was already fixed (`96a5af1`). D-020 and D-021 came through v4. D-019 is open (OPEN-QUESTIONS.md).
- Assertions changed: none.
- Receipts: [validation/v6/fixbatch-2026-10-10](validation/v6/fixbatch-2026-10-10/). Every gate passed at `5c9e2a1` except WebKit `rail.spec.ts:109`, which is pre-existing: WebKit's Tab skips buttons.

## Fix batch 2026-10-10b (FREEZE; supersedes 0c75ffc)

- Merged the shipped v5 `21ebe45` (release/v5, v5.0.0) as `ba1d15c`; conflict resolutions are in the receipts.
- #31 (D-016a) is fixed (`5c9e2a1`).
- #35: the live test now follows `arrange_table`'s contract (`0d29e86`). Assertions widened to the contract.
- #37 verified; it was already implemented and tested.
- Out of scope pending a user ruling: #38.
- Receipts: [validation/v6/fixbatch-2026-10-10b](validation/v6/fixbatch-2026-10-10b/). Every gate passed except WebKit `rail.spec.ts:109`, which predates this batch.

## Fix batch 2026-10-10c (FREEZE; from the live regression of 565d3c6)

- #39 fixed (`66f5921`): the table tools' `{status: refused | unavailable}` counts as a failed call.
- #37 fixed (`0856b66`): a proxied call's status step is labelled from the following function call. The faked-`server_id` test was replaced with the live shape.
- #40 ruled option (a) and built (`3751979`): `add_widget` and `set_widget_params` take `view`.
- Assertions changed: the #37 status test's input shape (stated in its commit). No assertion weakened.
- Receipts: [validation/v6/fixbatch-2026-10-10c](validation/v6/fixbatch-2026-10-10c/). Every gate passed except WebKit `rail.spec.ts:109` (pre-existing) and one Chromium load timeout, `grouping.spec.ts:122`, which passed when rerun.
