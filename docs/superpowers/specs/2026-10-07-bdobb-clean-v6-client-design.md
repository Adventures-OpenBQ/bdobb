# Clean BDOBB v6 client — design

Date: 2026-10-07. Status: design for review. Program step 2 of 4 (services → **client** → qualification/docs → research/archive). Holding location; moves into `bdobb-clean-v6/docs/superpowers/specs/` when that repository is created.

## Purpose

Build clean BDOBB v6.0.0 by adding the Rita agent to qualified clean v5. The v6 work comes from the bdobb-v2 tag v6.2.1 and is adapted to clean v5's analytical table model. The client targets the OpenBQ Rita and MCP services from step 1. Clean v3–v5 behavior stays authoritative wherever the donor differs.

## Source, identity, location

| Item | Decision |
|---|---|
| Base | Clean v5 `89889791bad5b44c857f3efe4b528231dd299560`, branch `codex/clean-v5-reconciled` |
| Checkout | `openbq-relaunch/bdobb-clean-v6`, a local copy of the base. Branch `codex/clean-v6`. No remote, no tag, no push. The v5 checkout is not modified. |
| Primary donor | bdobb-v2 v6.2.1 `3debd899eaea47a303319d4907f41075ff49f2b1`, whose base is v5.7.2 `c8188ff3a3cc0a479dbe5bd3e87fbd3836fa036c`. Only frozen git objects are read, never a working tree. |
| Second donor | bdobb-v2 `a5229ea595eb7019c85cca7412d1b1e034755961` ("configure bounded tool rounds in AI Library"). It first ships in v12.4.15 and is absent from v6.2.1. See Adaptation 5. |
| Version | Version 6.0.0 in `package.json`, `src-tauri/Cargo.toml`, the bdobb2 entry in `Cargo.lock` and `tauri.conf.json`. `src/lib/version.test.ts` enforces this. `src/help/guide/VERSION` reads "v6.0.0 clean development candidate; qualification pending". |
| Identity | These stay as clean v3–v5 has them: package name `bdobb`, productName `BDOBB2`, identifier `com.artcashin.bdobb2`, Cargo crate `bdobb2`. `openbbDocker` stays `v3.0.1`, because v6 needs no new openbq-docker. |
| QA builds | Build with `tauri build --config <tmp overlay> --bundles app`, setting identifier `com.artcashin.bdobb.clean.v6` and the name "BDOBB Clean v6". This is the pattern v5 used, so testing never touches a production `com.artcashin.bdobb2` profile. |

## Scope

**In (v6-native only):**
- Rita rail and chat: `components/rita/*` and `chatStore`.
- Local tools: all 17 tools in `src/lib/agent/localTools.ts`.
- Agent protocol: `query`, `sse`, `events`, `request`, `execute` and `agents-json`.
- MCP: settings, discovery, tokens (`mcpTokens.json`), import from apps.json `mcp_servers`, widget `storage.mcpUrl`, and per-tool disable.
- Skills and the AI Library: `components/ai/*`, the bundled `src/skills/*` and the Skill editor.
- AI settings, plus the settings-bundle and `ai-library.json` fields.
- Sharing: chat export and share targets, share folders, the `sendToAgent` cell action and per-card "Shared with Rita".
- Native: the generated `share-folders` capability (`scripts/generate-capabilities.mjs` and its test, `tauri.conf.json` before-commands, `.gitignore`).
- Fixtures and tests: the Rita and MCP SSE fixtures, unit tests, env-gated live tests (`rita-live`, `rita-authoring-live`, `real-endpoints`) and e2e specs (`rita`, `rita-arrange`, `ai-library`, `agent-options`, plus fixture hunks).
- The v6.0.0 Rita sample, `docs/examples/v6.0.0-rita.apps.json` (a616a7a87, PR #179). It uses only the clock, markdown and note built-ins, all present in clean.
- The help topics listed under Help.

**Required donor fixes, each confirmed an ancestor of v6.2.1 (they arrive with the files):**
- #322: 4bc3ba7c8 (`parameters` decoding, list envelope) and 2a35dad39 (save recovery, refusals counted).
- ddaa0a201 (half-nested params refused whole).
- 071753d70 (typed error item first).
- #326: c5b032a72 (fresh refs each round, 40-round cap) and 4ece1b7f1 (refs read live, turn stays on its dashboard).
- bd95e91e2 (multiSelect stored as validated, 40-column grid).
- 77e4d32e0 (Skill editor).
- The top-level tool-message shape in `executeFunction`.
- The SSE keepalive fix. ada17f517 (PR #228) is not an ancestor, but its equivalent a29c4b169 is: v6.2.1's `sseEvents(stream, onBytes)` re-arms the 45 s idle timer on every chunk. It is required, and pinned by its test "keepalive comments hold the idle timeout open while Rita thinks".

**Explicit requirements for widget inspection:**
- `describe_widget`: the widget descriptor and its params with options.
- `search_widgets`.
- `describe_table` (new `table-model/1` contract, adaptation 1).
- The `get_widget_data` round trip in `execute.ts`. It resolves `data_sources[].widget_uuid` against the active dashboard, refuses unknown, foreign and key-maint cards identically ("unknown widget"), and returns `[{items:[{content, data_format:{parse_as:"table"}, citable:true}]}]` per source.
- All 17 tool names. Schemas are unchanged except `describe_table`/`arrange_table`, which take the `table-model/1` contract (adaptation 1); the bundled skills are updated to match.

**Out:**
- Walk carries already in clean v3–v5 (dialog shell, iframe origin, widgets.json deadline, pdf, chart uirevision, table, library focus, row menu, settings drop).
- The Quick Help/Reference two-dialog rework 3d036a4.
- Release tooling, scrub and gateway vendoring. One exception: the 7-line `.env*` exclusion in `scrub-check.sh`, because v6 introduces `.env.local` use.
- The import-conflict dialog and TradingView carries.
- `pin_card` and `propose_chart_levels`.
- The `apps-sync.mjs` owner entry, which targets openbb-docker.
- Donor help screenshots: they are regenerated, not copied.
- Recreating `pivot.md`. Clean folded Pivot into `tables.md`, which gets the one cross-reference line.

## Approach

The file classification in the measured delta (`v6-delta.txt`, 240 entries) is copied into the repo as `docs/releases/v6-delta-manifest.tsv`. A disposition column records ADD, CLEAN-APPLY, MERGE, CLEAN-WINS, ADAPT or EXCLUDED, with the reason. Each step is one commit whose message names its donor commits.

1. **Copy and bump.** Copy the base, create the branch and make the version-only commit.
2. **Add files (124 plus non-src).** Copy the donor blobs verbatim, plus `scripts/generate-capabilities*.mjs`, the e2e specs and the sample. PNGs are excluded.
3. **Clean-apply (22).** Apply the donor diff v5.7.2→v6.2.1 to the files where clean equals v5.7.2: `settingsFile`, `settingsStore`, `settingsBundle`, `dataClient`, `bootstrap`, `providerKeys`, `runAppsImport`, `RailIcon`, `LibraryFilters`, `useHoverPanel`, `dialogs.css` and the tests that go with them.
4. **3-way merges (18 product files plus diverged tests).** Use `git merge-file` with base v5.7.2, ours clean and theirs v6.2.1. On every conflict clean wins, and only the v6 hunk is re-applied on top. The donor's v6 hunks are small; the line counts are from `--stat`:
   - `App.tsx` (+79): RitaPane, AI Library and menus.
   - `WidgetCard.tsx` (117): share chip and sendToAgent.
   - `styles.css` (+304).
   - `appsJson.ts` (+24): `mcp_servers` read from the raw parsed array beside clean's v3/v4/v5 envelope decoding. It is never added to an extension profile and never written on export.
   - `types.ts` (+37): Settings fields and `WidgetDef.mcpUrl`.
   - `widgetsJson.ts`: `storage.mcpUrl` and an exported `toPivot`.
   - `tableColumns.ts`: `sendToAgent`.
   - `TableRenderer.tsx`: the cell action on leaf rows only.
   - `PivotPanel.tsx`: menu via `legalAggregations`, already present in clean.
   - Also `LeftRail`, `WidgetLibrary`, `useDashboardShortcuts`, `workspacesFile`, `package.json` (adds the `capabilities` script), `Cargo.*` and `tauri.conf.json`.

   Diverged tests keep every clean assertion and add the donor's v6 cases. A deleted or weakened assertion is a review warning.
5. **Adaptations** (below). Each comes with a failing test first.
6. **Help and docs** (below).
7. **Provenance.** Add a "v6 assembly" section to `docs/releases/provenance.md` in the v4/v5 style:
   - the base SHA and both donor SHAs;
   - every named donor commit with its PR or issue (#179, #228, #322, #326, #167 fold-back) and what was taken or adapted;
   - exclusions with reasons;
   - the original authors and the Claude credit in each carried commit, with Apache-2.0 retained.

   The ledger is `docs/releases/v6-assembly.md`. Receipts go in `docs/releases/validation/v6/`.

## Adaptations to clean's model

**1. Table tools drive the shared table model (user ruling 2026-10-07).** The authority is [Rita configures the shared table model](2026-10-07-rita-table-model-tools-design.md); it supersedes the donor's `describe_table`/`arrange_table` behaviour. The donor's `tableProfile.ts`/`arrangeTable.ts` (refetch rows, grouping/split/buckets/aggregationFns, local-file refusal) are **not** carried as a calculator; the tool names stay, their contracts change:
- `describe_table(card_id, section?, cursor?, search?)`: read-only, bounded, paginated; revision witness; fields by stable ID; canonical model summary; capability descriptors derived from the shared validators/operator registries; worker member inspection.
- `arrange_table(card_id, expected_revision, arrangement)` with the strict `table-model/1` envelope: categories, duplicate measures, aggregates, formula ASTs, staged filters, the single Page, sorting/visibility/totals, Statement templates/overrides, and viewer controls in session scope. App-allocated IDs with request-local aliases.
- Execution is the design's 7-step transaction: check witness → build candidate → shared validation → `TableExecutor.previewDefinition` → recheck → guarded commit through the table runtime (`replaceModel`/`TableCommitCoordinator`) with downstream cascade → one Undo. No-op = `unchanged`, no Undo. Undo restores the previous configuration against current input and refuses over intervening edits (the Undo reporting surface may be extended to report a failed restore).
- Applies to CSV/XLS and linked tables (backend tables: adaptation 1a); linked tables compute only from their immediate presented source. Authoring vs viewer scope as in the design.
- The seeded `arrange-table` skill is rewritten to inspect → interpret → single arrange → explain, with the design's arithmetic guidance (aggregate ratios, unweighted vs weighted means, FY/FQ only from fiscal metadata, filter stages).
- **Views.** `cardViews.ts` (`availableViews`) is extracted from clean's own `WidgetCard` modes: table, chart, raw, transposed, calendar and statement. The donor's `pivot` view does not exist in clean.

**1a. Backend tables: worker tables only in v6 (user ruling 2026-10-07).** Backend tables stay off the client worker on purpose: they are reserved for the later SSRM/server executor (pandas or DuckDB, to be revisited with the v11 query library). In v6 the `table-model/1` tools cover CSV/XLS and linked tables. On a backend table, `describe_table` reports the card as `unavailable` with reason `server-execution-pending` and an actionable alternative (inspect it with `describe_widget`/`get_widget_data`, or use a CSV/XLS table). `arrange_table` refuses with the same code and makes no change. No second calculator is kept for backend tables. v4 and v5 are unchanged; the server executor can later be added behind `TableExecutor` without changing Rita's operations.

**2. Rita reads what the card shows.** `makeWidgetDataFetcher` and the table tools' `fetchRows` sent raw `card.params`. In clean they use the card's effective inputs: `paramGroups.effectiveParams` with the bindings and groups, plus the card's fiscal year end, which is the input `useWidgetData` sends.

**3. `remove_widget` Undo restores the whole card.** The donor rebuilt the card from 5 fields. Clean cards carry bindings, table definition and selection, links, calendar, statement, fiscal and dock state. Undo re-inserts the full `structuredClone` at its original tab and index, using clean's `pendingCardRemoval` and `undoCardRemoval` while that entry is still current. Rita may not remove `local_table` cards, because removal deletes the stored file.

**4. Built-ins.** `add_note` and `set_markdown_content` target clean's `note` and `markdown` built-ins. Persisted Markdown must equal the successful tool input byte for byte (#326).

**5. Tool-round setting (gap closed).** v6.2.1 has a fixed `MAX_FUNCTION_ROUNDS = 40` and throws when it is exhausted. That fails V6-006. Carry a5229ea59's mechanics:
- an AI Library ▸ Agents control, persisted on Done and discarded on Cancel;
- `ritaMaxFunctionRounds` in settings, `ai-library.json` and the settings bundle, where a legacy import without the field keeps the current choice;
- a snapshot taken at turn start;
- on exhaustion, a final response is allowed but no further tool runs, completed tool history is kept, and a WARNING status and chunk say the workflow may be incomplete.

Bounds: **default 40, range 1–40**, not a5229ea59's 12 and 1–32. The default keeps v6.2.1's proven #326 behavior, and the setting can only tighten it.

**6. #323 and #324.**
- #323 (rejected calls shown as 0 errors) is addressed in v6.2.1's `refusalOf` counting (2a35dad39). V6-008 verifies it.
- #324 (invented preview numbers) is addressed structurally by adaptation 1: every number Rita reports about an arrangement comes from the engine's `previewDefinition` or applied result, and the skill forbids agent-side arithmetic. V6-008 verifies it.

**7. MCP 2.0.1.**
- The client speaks only `initialize`, `notifications/initialized`, `tools/list` and `tools/call`, and re-discovers tools each turn.
- No client code names `activate_category` or `activate_tools`. Only help text describes the 1.4.1 discovery tools, and it is rewritten for 2.0.1's ten tools (`search_tools`/`call_tool` proxying, provider-grouped catalog).
- The client never reads MCP resources or `io.modelcontextprotocol/ui`, so the missing capability has no effect. It appears only in an old fixture.
- Sanitized 2.0.1 `initialize` and `tools/list` captures are added as fixtures.
- Per-tool disable works on effective names; see the addendum below. Disabling `call_tool` or `run_pipeline` still disables that proxy wholesale. Help states this.
- `extra_state` is echoed unchanged, which covers new Rita's `turn_usage`.

**Addendum: proxied MCP tool names** (user-approved scope, 2026-10-07).
- Verified from the live 2.0.1 schema: `call_tool` takes `{name: string (required), arguments?: object|null}`; `run_pipeline` takes `{steps: [{tool: string, arguments?: object, id?: string|null, inputs?: object}], outputs?: string[]|null}`.
- Effective names: for `call_tool` it is the call's `name` argument; for `run_pipeline` it is every `steps[].tool`; for any other tool it is the tool's own name.
- Enforcement: a call is refused before anything is sent to the server when any effective name is disabled for that server (`mcpDisabledTools`, keyed by normalized URL). The refusal is a typed error in the existing array/items envelope, names the disabled tool, and is counted through `refusalOf` (#323). A malformed proxy call (missing or non-string `name`/`tool`, `steps` not an array) is refused with a typed error and never forwarded.
- Display: the approval prompt, activity trail and tool chips show the effective names, for example `openbq-mcp · equity_price_historical (via call_tool)`, or the pipeline's step list.
- AI Library: each MCP server row lists the effective names seen in this profile's past calls to that server (de-duplicated, persisted as `mcpSeenProxiedTools`) and accepts a typed name; disabling uses the existing `mcpDisabledTools` shape. Done persists and Cancel discards. The settings bundle round-trips both keys; a legacy import without the keys keeps the current values.
- Help (Part C) explains proxied tools and how to disable one, and no longer says per-tool disable covers only advertised tools.

## Settings, migration, rollback

- **Defaults.** New settings keys default through `withDefaults`: Rita off (`ritaUrl: ""`), context sharing off, no MCP servers, 40 rounds.
- **New files.** `chat.json`, `mcpTokens.json` and `skills/` are created on demand. Bundled skills are seeded only when `skills/` is absent, so a v5 profile gets them on first v6 launch.
- **Rollback to v5.** Clean v5's `withDefaults` spreads the loaded object and ignores files it does not know, so a v5 binary keeps v6 data inert. Rollback is reinstalling the v5 build; no data is removed.
- **Older v6 data.** The production identifier is shared with legacy BDOBB2 installs, so v6 must also read chat history written by bdobb-v2 6.x. V6-003's contaminated-chat case covers that.

Verification copies a clean v5 QA profile (`com.artcashin.bdobb.clean.v5.reconciled`) into the v6 QA profile, launches v6, checks that it migrates, edits AI settings, then runs the v5 QA binary on a copy of the result and checks that it rolls back.

## Service configuration

Source names no tailnet host. Defaults are seeded the way `VITE_DEFAULT_BACKEND_URL` is:
- `VITE_DEFAULT_RITA_URL` and `VITE_DEFAULT_MCP_URL` are optional build-time variables, set in the gitignored `.env.local`.
- They apply when `settings.json` lacks the key, which covers fresh and v5-upgraded profiles. A user's later `""` or `[]` is never reseeded.
- The seeded MCP entry is named "OpenBQ MCP" and has `install_skill` pre-disabled.
- The user's build sets the NAS node `openbq` with Rita at :10443 and MCP at :11443 (path confirmed at integration).
- Help uses `<your-tailnet>` placeholders.

## Help, user guide, reference manual

All reader-facing names are BDOBB. Storage identifiers stay literal. Pages:

- `guide/rita-ai-agent-setup.md` is rewritten for the OpenBQ services. It covers:
  - Rita: f673c1f, with the keepalive, Chat Completions and base-URL patches and the queue.
  - MCP: 2.0.1 on openbq-local 3.0.0, with the trading calendar, `--default-categories equity --tool-discovery`, and `install_skill` neutralised.
  - The model: `qwen3.6-35b` on the Spark.
  - URLs and Check.
  - What the 17 local tools can and cannot do, which replaces the stale "four tools" text.
  - The tool-round limit.
- `guide/rita-chat.md` covers context sharing and what is transmitted, Stop and the next turn, and Undo.
- `guide/ai-library.md` covers MCP servers and tokens, per-tool disable, skills lifecycle and editor, and share targets and folders.
- `topics/rita.md` and `topics/ai-library.md` are added.
- Troubleshooting entries go into clean's existing troubleshooting pages: stale or contaminated chat (start a fresh chat), rejected tools, round-limit warning, keepalive and timeouts, unreachable MCP, and the private-network warning.
- `tables.md` gets the Rita cross-reference, including that analytical and linked tables are read-only to Rita.
- Screenshots of Rita and the AI Library in both themes are regenerated through `pnpm help:shots`.
- Also updated: `docs/user-guide.md`, the new `docs/reference-manual/v6/README.md`, and the articles' `reference-manual/clean-v6/README.md`.

## Verification

1. **Repo gates on the final tree, logs saved separately:**
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000`
   - `pnpm build`
   - `pnpm exec playwright test`
   - `pnpm test:web`
   - `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2`
   - `pnpm scrub`
   - the native QA bundle
   - `pnpm help:shots` with its help tests
2. **Live Rita integration.** Run the live tests against the NAS services with `OPENBB_RITA_URL`, `OPENBB_MCP_URLS` and `OPENBB_BACKEND_URL` set. A skip counts as not run. Then exercise one native session in the QA app: discovery, one streamed turn with a keepalive-only think over 45 s, one real local-tool round trip, one `get_widget_data` round trip, one MCP `call_tool`, Stop and then a next turn, and Undo.
3. **The V6 handoff cases, run later in step 3 on the same binary** (every v3–v5 case is rerun on this binary as well):

| Case | What it checks |
|---|---|
| V6-001 | All v3–v5 cases on the same binary, plus migration and rollback |
| V6-002 | Rita/MCP protocol, keepalive, cancellation, error envelopes |
| V6-003 | The #322 tool envelope: real descriptors, save/reload/Undo, a contaminated old chat compared with a fresh one |
| V6-004 | One AAPL Yahoo chart titled "AAPL — Yahoo Finance", with unsupported options reported honestly |
| V6-005 | Context sharing, permissions and skills lifecycle, checked on transmitted payloads |
| V6-006 | The round-setting contract above |
| V6-007 | Practice table loaded as a CSV/XLS table (same 12 rows): totals 3300/1400/1900, Research/Trading 900/500 and 1200/700, exact Undo. A backend copy checks the `server-execution-pending` refusal |
| V6-008 | 60-row AAPL loaded as a CSV/XLS table: monthly first/max/min/last/sum, refusals counted (#323), no invented values (#324) |
| V6-009 | Twelve-tab kit unattended, persisted Markdown equal to the tool input (#326) |
| V6-010 | AAPL/MSFT comparison figures |
| V6-011 | Example-service catalogs |
| V6-012 | Research/archive: BLOCKED, deferred |

## Open questions

1. **Auth on the NAS endpoints.** Are :10443 (Rita) and :11443 (MCP) tailnet-only without auth? The client can send a bearer token to MCP, from `mcpTokens.json`. It cannot authenticate to Rita. If Rita needs auth, v6 needs a client addition this spec does not include.
2. **Step-1 rulings.** The step-1 ledger's PARTIAL and FAIL rulings (stale-session id, provider-grouped catalog, the local-tool round trip that did not reproduce) should be settled before the live integration in Verification step 2, or recorded as accepted differences.
