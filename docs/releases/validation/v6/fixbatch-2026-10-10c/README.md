# v6 fix batch 2026-10-10c — receipts (FREEZE)

Branch `codex/clean-v6`, built on the frozen `565d3c6` (fix batch 2026-10-10b). The fixes come from the live Rita regression of `565d3c6`: NAS Rita patch 0011, MCP, Qwen and openbq-docker v6.0.0. Evidence is in `output/regression/v6-565d3c6-20261010T083405Z/results/features/v6/rita/`. Each fix is TDD from the live payload shapes.

| Commit | Item | What |
|---|---|---|
| `ec40daa` | #35 (live test) | Already on the branch after `565d3c6`. `rita-table-model-live` test 1 asks for an explicit change. |
| `66f5921` | #39 (V6-008) | `refusalOf` also reads a top-level `{status: "refused" \| "unavailable"}`, the shape `arrange_table` and `describe_table` refuse with. Live V6-008 showed 5 rejected calls as "22 steps · 0 errors". Those calls now lead with Rita's typed error item and count as errors. `previewed`, `applied` and `unchanged` stay successes. The test uses the two live tool results verbatim. |
| `c4f8691` | #35 | Docs only (defects.md D-006). Another session committed it to this branch; no product code. |
| `0856b66` | #37 (partial → fixed) | Live agent-rita 0011 status steps carry `{tool_name, input}` with no `server_id`. The next `copilotFunctionCall` now labels the latest unlabelled proxy step, so the trail reads "OpenBQ MCP · cboe_equity_historical (via call_tool)". **Test replaced, stated:** the old test faked `server_id` on the status event; the new one uses the live two-event shape. |
| `5442e37`, `3751979` | #40 (V6-004) | Recorded as an open question, then **ruled option (a)** by the user. `add_widget` and `set_widget_params` take `view` (default, chart, statement, calendar, raw or transposed), checked against `possibleViews` (`src/lib/cardViews.ts`), with all-or-nothing refusal and Undo. The descriptions say Chart and Calendar draw only when the data has a date or time column. Help and OPEN-QUESTIONS.md are updated. |
| `a3efd29` | #39 (review) | Comment only: `refusalOf` counts that shape from any tool. |

Review: two passes, both "Ready to merge: Yes".
- **Pass 1** (`ec40daa..5442e37`). Notes:
  - Comment overstated scope: fixed in `a3efd29`.
  - Successful proxied calls never reach the persisted `calls` ledger, because only status steps with a `server_id` are logged. This predates the batch; follow-up below.
- **Pass 2** (`5442e37..a3efd29`). Minor notes, left as they are:
  - `params: {}` plus a valid `view` is refused whole with MISSING_PARAMS.
  - No direct `possibleViews` unit test; it is covered through the localTools tests.
  - `retry_with` for PARAMS_NOT_NESTED drops a passed `view`.
  - A view-only Undo summary reads "set 0 param(s) and the view".

`run-gates.sh` ran every gate once at HEAD `a3efd29` (see `head.txt`). e2e used ports 4721/4722 and WebKit 4793/4794. Load averages ran 200–800 during the run (`gates.tsv`). `$HOME` is written `<home>`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6865 passed, 28 skipped |
| build | pass |
| e2e (Chromium) | 267 passed, 1 skipped, 1 failed: `grouping.spec.ts:122`, a 30 s timeout at load ~500, in code this batch does not touch. **Rerun alone at the same HEAD: 7/7 passed** (`e2e-grouping-rerun.log`). |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | pass |
| cargo-test | pass |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. **Pre-existing**, as in the `fixbatch-2026-10-10b` receipts: Playwright WebKit on macOS never Tabs onto buttons. |
| diff-check | `git diff --check 565d3c6 HEAD` exit 0 |

**Not run here:** the live Rita/MCP gate, and native GUI checks. The regression session owns the live re-test of #39, #37 and #40.

Follow-up, not in this batch: write successful proxied calls to the `calls` ledger (Help says the call log shows effective names).

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `a3efd29`. Delivery: nothing pushed, no tag moved.
