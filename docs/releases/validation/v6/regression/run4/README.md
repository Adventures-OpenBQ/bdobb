# Regression run 4: retest of the run 3 fixes (2026-10-09)

- **Candidate:** the `codex/clean-v6` working tree, which includes `cf292cf`. The QA bundle is `BDOBB Clean v6.app` (`com.artcashin.bdobb.clean.v6`, version 6.0.0), with executable sha256 `46fd96448640a95bb844b11b0d7869d3c5cbd6df64b55682dbbcfedc7aefccf4`.
- **Rita:** NAS `openbq-rita` running `sha256:f9aee8aa…` (recipe `08cf458`, patch 0010). The model is the Spark `qwen3.6-35b`, unchanged since run 3.
- **Profile:** the original was backed up to `<home>/QA-profile-backups/bdobb-clean-v6-regression-r4-*` and moved aside, so the app ran on a disposable profile. Afterwards the original was restored byte-identical (`restored-hashes.txt` matches the run 3 restore).
- **Setup:** `settings.json` and `backends.json` were seeded from the run 3 disposable profile, whose UI setup run 3 already verified. Rita points at the logging proxy `127.0.0.1:18777` in front of the NAS Rita. The `practice.csv` and `prices.csv` cards were seeded exactly as in run 3. Each card was shared with Rita through ⋯ ▸ Share with Rita.
- **Control:** full-screen computer use from the top-level session. The window was at its normal size, not filled.
- **Transcripts:** sanitized copies are in `transcripts-*.jsonl`.

## Results

| Case or defect | Status | Evidence |
|---|---|---|
| V6-004 Yahoo authoring (defaults) | **FAIL (D-016)** | Two sends, and Rita returned an empty answer both times: `"\n\n"` plus follow-up suggestions, with no tool call. |
| V6-004 Yahoo authoring (variant: `agentOptions.prompt-suggestions=false`) | **PARTIAL** | This attempt went through, although the flag never reached Rita (`workspace_options.prompt-suggestions` stayed `true`). D-010 is fixed: `search_widgets` returned 391 ranked partial matches with `matched_words`, and Rita chose `yfinance_equity_historical_yfinance_obb`. Rita then called `add_widget` and renamed the card to "AAPL — Yahoo Finance". She never set `symbol` (`add_widget` takes no params, and no `set_widget_params` call followed), so the card shows "Enter Symbol". She still reported the task done. Model conduct; see D-017. Evidence: `v6004-dashboard-after.json`. |
| V6-007 step 1, read-only summary | **PARTIAL** | D-012 is fixed: every `arrange_table` call used `mode:"preview"`, and the dashboard hash was unchanged (`0139d3d8`). Three previews were refused as invalid (operations missing `op`, and one undeclared alias). `get_widget_data` then refused the local card, as designed. Rita ended with no summary after 25 steps. |
| V6-007 step 2, suggest only | **PASS** | No tool calls and the hash was unchanged. The suggestion was correct (Company, Desk, Amount sum). |
| V6-007 step 3, apply | **PASS** | Rita applied it on the first try (`describe_table`, then one `arrange_table` apply), with no hint prompt. The card shows AAPL 900/500 and MSFT 1.2K/700; the column totals are 2.1K/1.2K. Rita stated a total of 3,300. **D-011 is fixed** (AAPL Trading was `#ERROR` in run 3). |
| V6-007 Undo, mouse, pane pinned | **PASS** | One mouse click restored the raw table. The card is field-for-field identical to the seeded card; the file hash changed only because the app re-serialized the hand-seeded file. |
| V6-008 monthly first/max/min/last/sum | **PASS** | The suggestion used `M`, first/last, max/min/sum, and placeholder numbers, with no invented figures. On "apply", 5 calls were refused with nothing changed, then one was applied. The applied cells match `expected.json` for all three months: Jan 248.93/249.10/219.38/236/1,200,176,400; Feb 229.99/250/225.70/241.84/862,272,300; Mar 241.79/244.03/208.42/222.13/1,115,239,500. **D-014 is fixed.** Rita's prose had two inaccuracies: it mentioned a "fiscal binding" on M and called first/last "formula functions". |
| D-013 Undo, mouse, pane open and unpinned (message box focused) | **PASS** | Undo and × sat clear of the overlay, and one mouse click undid the monthly arrangement. |
| D-009 with no Rita URL | **PASS** | Window ▸ Keep Rita Open is greyed out and unchecked. ⌘⇧A on the dashboard reserves no strip; the card is full width. |
| ⋯ Chat menu, native | **PASS** | With the window at normal size, Export… and Clear are fully visible and Clear works. Run 3's "clip" was not reproduced, which is consistent with the mis-click explanation. |
| v3–v5 matrix | **NOT_RUN** | Out of this run's time box; see the next steps. |

## New defects

- **D-016 (Rita prompt and model; upstream agent-rita `src/agent/prompt.ts:142`)**
  - **Symptom:** on a first turn with follow-up suggestions on, Qwen often writes the `<suggestions>` block and stops without making the tool call it had just reasoned about.
  - **Replay of the V6-004 request:** with suggestions on, 7 of 8 replies were empty. With `workspace_options.prompt-suggestions=false`, all 8 called `search_widgets`.
  - **Model check:** Rita running locally from the same tree, with the model call logged, showed the model reasoning "Let me start by searching…" and then emitting only `\n\n<suggestions>…`. Direct calls to the model without Rita's prompt made the tool call 12 of 12 times.
  - **Contributing factor:** the longer tool descriptions in this batch raise the failure rate (run 3's tools with today's message: about 50% empty).
  - **Fix options:**
    - (a) a Rita patch so the suggestions block is required only on the final answer and never in a turn that calls a tool;
    - (b) a client default of `prompt-suggestions=false` for this model;
    - (c) both.
- **D-016a (client, minor):** AI Library's "Follow-up suggestions" setting (`agentPromptSuggestions`) only hides the chips. The request still asks Rita for suggestions, through the agent feature flag in `agentOptions`. Setting `agentOptions["prompt-suggestions"]=false` in `settings.json` did not change the request either; it needs a trace.
- **D-017 (tool affordance):** `add_widget` cannot set parameters, and nothing in its description prompts a follow-up `set_widget_params`. Rita added an AAPL card with no symbol and reported success. Fix options: accept `params` on `add_widget`, or say in its description that required parameters must be set next.
