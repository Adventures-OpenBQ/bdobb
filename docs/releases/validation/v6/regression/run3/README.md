# Regression run 3: full-screen GUI, driven by the top-level session (2026-10-08)

- **Candidate:** codex/clean-v6 at 040cb87. The QA bundle `BDOBB Clean v6.app` (com.artcashin.bdobb.clean.v6, version 6.0.0) has an executable sha256 beginning 347b6881dd97deab.
- **Profile:** the original was backed up to `<home>/QA-profile-backups/bdobb-clean-v6-regression-r3-*` and hash-verified. The live directories were moved aside, so the app starts on a disposable empty profile, which is restored at the end.
- **Control:** full-screen computer use from the top-level session. Subagents could not use it in runs 1 and 2.

## Setup, through the native UI
- **Connections:** OPENBQ_API (`https://<openbq-node>`), test "Reachable — 995 widgets". REFERENCE_CURATED (`:8443`), "Reachable — 72 widgets", 2 apps. REFERENCE_BASELINE (`:9443`), "Reachable — 70 widgets".
- **OPENBQ_API apps.json:** "could not be read". This is a backend problem (D-004 recurred): at 17:55 EDT the container was at about 104% CPU, `/apps.json` timed out at 30 s three times, and the log shows `AttributeError: 'str' object has no attribute 'get'`. Another party restarted the container at 17:39 EDT; this run sent no sweep. I did not restart it again, because it is a shared service.
- **AI Library ▸ Agents:**
  - The Rita endpoint `https://<openbq-node>:10443` shows "Agent Rita · Online".
  - Maximum tool rounds shows "40 (default)", which passes the V6-006 default check.
  - Context sharing is off by default.
- **AI Library ▸ MCP Servers:** `https://<openbq-node>:11443/mcp`. Check reports "10 tools". The new "Tools called through proxies" section (call_tool/run_pipeline) is present.
- **Rita pane header:** "Rita · openai:qwen3.6-35b".

## Native Window-menu check (fix batch, Task 12, steps 1–5)

| Step | Result | Observation |
|---|---|---|
| 1. Menu contents | PASS | The stock items, then a separator, then "Keep Sidebar Open" (greyed: no workspace active) and "Keep Rita Open" with the ⇧⌘A glyph, unchecked. |
| 2. Choosing Keep Rita Open | PASS | Item checked; pane pinned. |
| 3. Checkmark follows the pin | PASS | Unpinning with the pane's Lock button closed the pane and unchecked the item. |
| 4. ⌘⇧A toggles once (native) | PASS | With the dashboard focused, one press pinned the pane and the item is checked (single toggle; fix 485ed5f confirmed in the packaged build). |
| 5. Sidebar item outside or inside a workspace | PARTIAL | Greyed outside a workspace (PASS). The toggle inside a workspace is pending V5 cases. |

## New defect
- **D-009 (client, minor):** with no Rita URL set, "Keep Rita Open" still reserves the pane's width (the `rita-pinned` class), leaving an empty strip, because `RitaPane` renders only when `ritaUrl !== ""` (`src/App.tsx:643`). This matches the fix batch's deferred item "Keep Rita Open always enabled". Fix: disable the item and ignore the pin while `ritaUrl` is empty.

## Rita payload capture
The app's Rita endpoint was set to a local logging proxy (`http://127.0.0.1:18777`) that forwards to the NAS Rita. Sanitized transcripts are in `transcripts-*.jsonl`.

- **Smoke:** "Reply with exactly V6_READY" got `V6_READY`.
- **Captured request:**
  - keys: context, messages, selected_skills, skills_catalog, timezone, tools, urls, widgets, workspace_options
  - `tools`: all 17 bdobb-local tools plus the 10 MCP discovery tools (call_tool, run_pipeline, search_tools, …)
  - `skills_catalog`: the 5 bundled skills
  - `widgets`: empty, because context sharing is off by default
  - `workspace_options.model`: `openai:qwen3.6-35b`

## Case results (run 3)

| Case | Status | Evidence |
|---|---|---|
| V6-004 Yahoo authoring | FAIL (client, plus backend metadata) | Fresh Main dashboard, one prompt. Rita called `search_widgets` twice, with "Yahoo Finance historical price AAPL" and "Yahoo Finance AAPL historical price chart". Both returned `{"total":0}`, so Rita asked to "connect a Yahoo Finance widget" and no card was added. The dashboard still has 0 cards. Root cause D-010. `transcripts-v6-004.jsonl` |

## D-010 (client, plus backend metadata): `search_widgets` finds no Yahoo widget
- **Client:** `src/lib/agent/localTools.ts:779` requires EVERY query word to appear in the widget's id, name, description or category (`words.every`). It returns `total: 0` with no near-miss hint and doesn't search the provider/backend name. Natural queries carry words such as "AAPL", "price" and "chart", which no widget metadata contains.
- **Backend metadata:** the OpenBQ yfinance widgets are named "Historical", with category "Yfinance" and descriptions like "Get YfinanceEquityHistorical data from the public yfinance API". None of them contains "yahoo" or "price". The v6.2.1 runs used the openbb-docker v6.0.2 catalog, which named Yahoo widgets differently.
- **Proposed fix (v6):**
  - Rank results by the number of matched words, including the provider and backend names, instead of requiring all of them.
  - When no widget matches every word, return the best partial matches and list which words matched.
  - Separately, ask openbq-yfinance to use "Yahoo Finance" in its widget names and descriptions.
| V6-007 step 1, summarize without mutation (attempt 1: context sharing OFF) | precondition | `widgets` was empty in every request, as designed for privacy. Rita ran `search_widgets` and `list_resources`, made no change (dashboard hash unchanged, fc349493), and said the table is "not loaded". A product behaviour note, not a failure: the summary case needs context sharing on and the card shared. |
| V6-007 step 1, summarize without mutation (attempt 2: sharing on, card shared via ⋯ ▸ Share with Rita, "Rita" chip shown) | **FAIL** | Rita called `arrange_table`. Two calls were refused (`invalid-arrangement`, nothing changed) and one was **applied** (a Company category plus Amount count and sum measures). The dashboard changed (fc349493 → e1e1454f). Rita then tried MCP `read_resource` with the card's stored file name (refused: unknown resource) and `get_widget_data` (refused: local file, by design), and ended after 23 steps / 1 error with no summary. Classification: model conduct plus a product gap (D-012). `transcripts-v6-007.jsonl` |
| V6-007 Undo of the applied arrangement | PARTIAL (D-013) | The edit bar showed "Rita arranged practice.csv · 1 change · Undo". Mouse clicks on Undo (three attempts at measured coordinates) had no effect: the entry stayed and no error appeared. Tab-focusing Undo and pressing Return worked: the table went back to its raw 12 rows and the bar cleared. The stored card is semantically restored (no model), but not byte-identical to the pre-test file. It now carries default `table:{}`, `tableDefinition:{search:'',table:{}}` and `tableSelection:{kind:'none'}`, which the hand-seeded card lacked, so seeding may account for the byte difference. |

## New defects (run 3)
- **D-011 (engine, needs a trace):** Rita's applied arrangement (Company × Amount count and sum) shows `#ERROR` for AAPL and for the grand total, while MSFT shows 6 / 1.9K. AAPL is the group containing the missing Amount (an empty CSV cell, shown as "—" in the raw table). The fixture expects AAPL's sum to be 1400 and the total 3300. Possible causes: CSV empty cells parse as "" instead of null, or sum/count don't skip nulls in a group. Rita and the drawer share the same engine, so this would affect the drawer too.
- **D-012 (product gap):** v6 gives Rita no read-only way to get calculated values from a worker table. `describe_table` returns structure, `get_widget_data` refuses local files, and the only path to computed numbers is `arrange_table`, which commits. That invites a mutation during "summarize/suggest only" requests. Fix options: a read-only `preview` operation on `arrange_table` (the engine's `previewDefinition` without commit, as the #324 fallback anticipated), or summary statistics in `describe_table`. The arrange-table skill should also forbid arranging for read-only requests.
- **D-013 (client):** the AgentEditBar Undo button doesn't respond to mouse clicks, while it works by keyboard. Cause not yet traced; perhaps the pinned Rita pane or a neighbouring element intercepts hits near the right end of the bar.
- **Privacy note:** Rita sent the local table's stored file name (a uuid) to the external MCP server's `read_resource`. Not the content, but a local detail left the machine.
- **UI note:** AI Library ▸ Agents shows two "Follow-up suggestions" toggles: the agent-declared feature and the setting.

## Case results, continued (run 3)

| Case | Status | Evidence |
|---|---|---|
| V6-007 step 2, suggest only | **PASS** | Rita made no tool calls; the dashboard hash was unchanged (f037ed17). The suggestion was correct: Company rows, Desk columns, Amount sum. |
| V6-007 step 3, apply Company/Desk/Amount Sum | **PARTIAL** (one labelled rerun used) | **Attempt 1:** the engine refused twice (`name is required`, then `alias Company is not declared by an earlier operation`), correctly and with nothing changed. Rita said she'd retry, then ended the turn (model conduct). **Labelled rerun:** applied. AAPL Research = 900 ✔, MSFT Research = 1.2K (1200) ✔, MSFT Trading = 700 ✔, **AAPL Trading = #ERROR** (expected 500), see D-011. |
| V6-007 exact Undo | **PASS** (keyboard) | Undo restored the dashboard byte-identical (f037ed17 before and after). The mouse click on Undo does nothing (D-013). |
| V6-008 monthly AAPL Pivot (CSV copy, 60 rows) | **FAIL, capability gap D-014** | The suggestion request (#324) invented no numbers. Rita reported that the table model has no monthly transform and no `first`/`last` aggregation, and proposed min(open) and max(close) as labelled substitutes, which is the wrong semantics. `describe_table` confirms: category transforms native/Y/Q/FY/FQ only; numeric aggregations sum/mean/median/min/max/count/uniqueCount; `first`/`last` only as formula functions; `chronology: false`. The expected monthly first/max/min/last/sum (expected.json) can't be produced. Not applied; hash unchanged. |

- **D-014 (table model capability, v4 home):** the shared analytical model behind CSV and linked tables lacks (a) a monthly (M) category transform and (b) `first`/`last` measure aggregations for a source without declared chronology. The v6.2.0 historical pass used the legacy in-thread Pivot on a backend table, which had month buckets and first/last. A curated `pivot-v1` month bucket survives only as `legacyBucket` on migration. Decision needed: add M plus chronology-aware first/last to the v4 model (carried to v5/v6), or rescope V6-008 to what the model supports.
| V6-006 tool-round setting | **PASS** (legacy import and turn-start snapshot NOT_RUN) | **Default:** 40 shown as "40 (default)". **Range:** the native menu lists 1–40. **Cancel:** choosing 2 then Cancel left 40 on reopen. **Done:** choosing 2 then Done persisted `settings.json` `ritaMaxFunctionRounds: 2`. **Exhaustion at 2:** exactly 2 tools executed (`describe_table`, `search_widgets`). Rita's third requested call (`search_widgets`) was NOT executed and no further request was sent. The pane showed "Stopped at the 2-round tool limit. Completed tool results have been retained, but the requested workflow may be incomplete. Review those results before retrying actions." The closing message is the client warning rather than a final text answer from Rita. **Legacy-import-keeps-choice** needs a settings-bundle drop (Finder drag), so it is not run natively; unit-covered. |
| Context sharing persistence (part of V6-005) | PASS | The `contextSharing: true` toggle survived dialog reopen and is in `settings.json`. |
| V6-005 context sharing (payload-verified) | **PASS** (partial scope) | **Sharing off:** `widgets` empty in every request (V6-007 attempt 1). **Sharing on, two cards shared via ⋯ ▸ Share with Rita:** `widgets.primary` holds exactly those two card ids; the card menu then offers "Stop sharing with Rita". |
| V6-005 disabled and unknown skills (payload-verified) | **PASS** | After disabling `openbb-html-report` in AI Library ▸ Skills and pressing Done, `skills_catalog` has 4 entries without it. A message forcing `/skill:openbb-html-report /skill:openbb-html-table /skill:imaginary-quasar-meter` sent `selected_skills` with only `openbb-html-table` (`forced_slash`, 1728 chars); the disabled and unknown slugs were dropped. No tool calls. |
| V6-005 Stop, then next turn | **PASS** | A long essay prompt was stopped about 6 s in with the Stop button: no answer rendered and Send returned. The next turn, "Reply with exactly AFTER_STOP_READY", returned `AFTER_STOP_READY`. |
| V6-005 denied tool (proxied MCP name, new in v6) | **PASS** | `cboe_equity_historical` typed into AI Library ▸ MCP Servers ▸ "Tools called through proxies" and saved with Done persisted `mcpDisabledTools` (and `mcpSeenProxiedTools`). Asking Rita to run it through `call_tool` produced the activity line "Tool call failed: <mcp-host> · cboe_equity_historical (via call_tool) — TOOL_DISABLED: … turned off … the call was not sent." Rita relayed the refusal. |
| V6-005 synthetic skill lifecycle | **PASS** | **Create:** AI Library ▸ Skills ▸ Create skill `rehearsal-skill` wrote `skills/rehearsal-skill/SKILL.md` (enabled). **Invoke:** `/skill:rehearsal-skill go` returned `REHEARSAL_SKILL_READY`; the payload had `skills_catalog` with `rehearsal-skill` and `selected_skills` [(`rehearsal-skill`, `forced_slash`)]. **Rename:** Edit ▸ slug `rehearsal-skill-renamed` ▸ Save changes renamed the directory. **Disable:** toggled Off and pressed Done, giving `enabled: false`. |
| V6-005 quit/relaunch persistence | **PASS** | Quit via the app menu, then relaunch. Every state file (12, logs excluded) is byte-identical before and after: `restart-before.sha256` = `restart-after.sha256`. After restart, `settings.json` has `ritaMaxFunctionRounds 40`, `contextSharing true`, `mcpDisabledTools [cboe_equity_historical]`, and the skill is renamed and disabled. The Rita pane pin and the window size are session state and are not restored (expected). |
| V6-003 #322 local tools with a real descriptor | **PASS** (the contaminated-old-chat sub-case NOT_RUN) | The prompt named words present in the OpenBQ metadata (to avoid D-010). Every tool message carried `input_arguments.parameters`, and every result was the `[{items:[…]}]` list envelope. **search_widgets** "yfinance equity historical" returned total 1 (`yfinance_equity_historical_yfinance_obb`). **add_widget** added card 15681725 to Main ("matched via id"). **describe_widget** returned the real descriptor: symbol, start_date, end_date, interval (1d plus options), period (1y plus options), auto_adjust, prepost, repair, timeout, provider. **set_widget_params** {symbol: MSFT} returned `{updated:true, applied:["symbol"]}`. Persisted: the card has `symbol: "MSFT"` and the descriptor defaults (stored as strings, e.g. `"false"`, `"30"`). **Undo ×2** (keyboard; the edit bar showed "2 changes") reverted the parameter, then the add; the dashboard is byte-identical to before (f037ed17). Model noise: Rita also tried `search_widgets` through MCP `call_tool` (MCP refused: unknown tool) and repeated `search_widgets`. `transcripts-v6-003.jsonl` |

### EXAMPLE_DATA (Market Kit), provisioned by the test unit
`reference-manual/v6/market-kit/demo` was served read-only from a copy (`<home>/QA-fixtures-v6/market-kit-serve`, tree hash 3accc9da1447aa19) at `http://127.0.0.1:16950`. Its `apps.json` holds both Market Kit apps: Independent Comparisons and the Rita Tab Runner seed. Connections reports "EXAMPLE_DATA · 43 widgets · 2 apps · Online". The Rita Tab Runner was opened through Apps: 12 tabs, 60 cards.

| Case | Status | Evidence |
|---|---|---|
| V6-009 twelve-tab Market Kit, unattended (#326) | **PASS on the labelled rerun.** Attempt 1 FAIL (D-015). | **Attempt 1** (the chat already held 94 messages from earlier cases): tab 01 was saved (`updated:true`). Then `navigate {"tab_name":"02"}` was refused as "unknown tab 02" (the tabs are named "01 Desk", "02 Read", …). Rita repeated it and ended in a text loop: 1/12 saved. **Labelled rerun** (fresh chat; the old chat.json was set aside as the equivalent of Clear, because the pane's ⋯ menu is clipped off-screen at this window size): the same instruction finished unattended in 13 requests, with **12 distinct confirmed saves, 0 refused** and no operator follow-ups. **Persisted == successful `set_markdown_content` input: 12/12, byte-equal.** Every card has the "Rita output NN" heading and the `V6-RUN3` marker. **No other card changed:** 60/60 cards, the same tab names, and prompts, independent answers, support widgets and layouts identical (`v6009-runner-dashboard-before/after.json`). Minor: tab 10 is 224 words against the 220 limit. |
| V6-010 company comparison | **PASS** | Rita's fresh tab 05 (Compare) states AAPL/MSFT returns −8.91%/−10.32%, sample daily volatility 1.81%/1.63% and closing-peak drawdown −15.14%/−16.06%, matching −8.9071/−10.3182, 1.8092/1.6276 and −15.1437/−16.0577 to 2 dp. Tab 06 (Portfolio) states the losses of 1,600 (existing, at 20%) and 2,000 (cash-funded purchase). Tab 12 (Event) uses data through 2025-01-29 only. It was **independently recomputed** from `demos/prices.json`: 18 rows, close 239.36, −1.84%, max/min daily return +3.65%/−4.04%, sample SD 1.9979%, low/high 219.38/249.10, closing drawdown −9.13%, all equal to Rita's figures. |

- **D-015 (client, usability):** `navigate` accepts only an exact tab name, so "02" is refused although a single tab starts with it. Fix: accept a unique number or prefix match (and say so in the tool description), or include tab names in the refusal message.
- **UI note:** at Window ▸ Fill on a 1568-px-wide display, the Rita pane's ⋯ (Chat menu) is clipped at the right edge, so Clear is unreachable by mouse.
| V6-011 example-service catalogs (EXAMPLE_DATA) | **PASS** (one sub-case not run) | **Catalog:** 43 widgets and 2 apps (`widgets.json`/`apps.json` 200). **Apps:** "Independent Comparisons" (12 tabs, 60 cards) and "Rita Tab Runner" (12 tabs, 60 cards) both opened through Apps; every tab of Independent Comparisons was visited. **Widgets:** 42 of 43 catalog endpoints were fetched by the apps; the remaining `market_prices` ("AAPL — frozen daily rows") was added from the Widget Library and rendered its table. **43/43 endpoints fetched, every request 200** (`example-data-access.log`), with no client errors in the app log. **Failure paths** (service down, malformed payload) NOT_RUN for this static catalog. REST-only routes omitted by the MCP design are not asserted. The licensing and source manifest is in agent-rita `MIGRATION.md`. |

## Native retests of the fix-batch defects (run 3)

| Defect / case | Status | Evidence |
|---|---|---|
| D-005 coordinates (V3-003, E05-063, V3-001) | **PASS** | REFERENCE_BASELINE "Onboarding App for Devs" opened through Apps, with the Types tab displayed first, then Settings and Grouping. **14 tabs, 70/70 cards, every tab's saved (widget, x, y, w, h) equals the served `apps.json`.** Types ys 2, 7, 11, 15, 23…; Grouping 2, 2, 11, 11. Groups: Group 1 TM, Group 2 2024, Group 3 AAPL. |
| D-007 curated pivot examples (V3-002, V4-001/002) | **PASS** | REFERENCE_CURATED "Episode 3 — Pivot examples": all four tabs render pivots on the backend tables. **Monthly OHLC:** "Pivot on · asset › date · Month" (AAA 2025-01: open 10 first, high 15 max, low 9 min). **Asset cross-tab:** "date · Month × asset". **Mean and Count:** AAA volume average 200. **Null handling:** AAA average "—", count 0; BBB average 15, count 2 (missing values skipped correctly). |
| D-008 BLS array group default (V3-003/007, V6-011) | **PASS** | OPENBQ_API "U.S. Bureau of Labor Statistics" (after a Connections ▸ Refresh, because apps.json had been unavailable during D-004) imported with groups `BLS Survey Category = nfp` and **`Group 3 (symbol) = CES0500000023`** (previously `""`). The unjoined `BLS Symbol` group is dropped per spec. No coordinate drift on its tabs. |
| D-004 backend instability | recurring (backend) | The OPENBQ_API container was restarted by other parties at 17:39 and 20:03 EDT. Between restarts `/apps.json` timed out at about 100% CPU, with `AttributeError: 'str' object has no attribute 'get'` in the log. Not caused by this run (no sweep). |

**Contrast with D-011:** the in-thread Pivot on backend tables skips missing values correctly (Null handling tab), while the worker engine shows `#ERROR` for the AAPL × Trading group, which contains a missing Amount (V6-007).
