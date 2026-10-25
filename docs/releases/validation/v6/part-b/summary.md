# Part B gate receipts (branch codex/clean-v6)

Load is the 1/5/15-minute average at the start of each gate (`results.txt` has the raw lines). Logs sit beside this file; hostnames are scrubbed to `<your-tailnet>.ts.net`. Playwright ran with `BDOBB_BROWSER_PORT=4373 BDOBB_MOCK_PORT=4374`, unsandboxed.

| Gate | Exit | Duration | Load at start | Counts |
|---|---|---|---|---|
| typecheck | 0 | 13 s | 19.39 24.42 30.77 | clean |
| lint | 0 | 11 s | 20.74 24.48 30.68 | clean |
| scrub | 0 | 2 s | 19.94 24.19 30.50 | clean |
| unit | 0 | 205 s | 18.25 23.68 30.25 | 380 files passed, 5 skipped (385); 6554 tests passed, 28 skipped (6582) |
| e2e (playwright) | 0 | 564 s | 41.67 30.88 31.69 | 259 passed, 1 skipped, 0 failed (ONE green run) |
| typecheck-final / lint-final / unit-final (re-run at the final HEAD) | 0 / 0 / 0 | 12 / 9 / 188 s | 44.72 / 40.25 / 36.58 (1 min) | unit again 380 passed + 5 skipped files, 6554 passed + 28 skipped |
| live-all, first pass (now `pre-fix/live-all.log`) | 1 | 196 s | 160.67 118.41 85.37 | 20 passed, 0 skipped, 2 failed (of 22) |
| live-table-model, first pass (now `pre-fix/live-table-model.log`) | 1 | 42 s | 86.23 104.90 86.84 | 0 passed, 0 skipped, 2 failed (of 2) |

No composite flag: unit and e2e are each one green run. typecheck/lint/unit were re-run at the final HEAD because the last commits touched only the integration test files and contract/capabilities.

The 5 skipped unit files are `reference-backend` (6, Docker), `real-endpoints` (5), `rita-live` (3), `rita-authoring-live` (12) and `rita-table-model-live` (2): skipped by design without `OPENBB_*` env, and run in the live gate below.

## Live gate (R2/R6)
Endpoints: NAS openbq node `:10443` (Rita), `:11443/mcp` (MCP) and the NAS backend (widgets.json answered without auth; a placeholder `OPENBB_NAS_AUTH` satisfies `real-endpoints`'s "is set" check). All preflights passed; nothing was unreachable and the model answered (no provider/quota failure).

Per file (first pass, `pre-fix/live-all.log`):
- `rita-authoring-live` 12/12 passed.
- `real-endpoints` 5/5 passed.
- `rita-live` 3/3 passed (see fix 3 below; the first live-all run, `live-all-run1-before-rita-live-fix.log`, had 19/22 with this test failing).
- `rita-table-model-live` 0/2 FAILED. Classified as a product/model-conduct failure, not an availability one: the model answered every time.
  1. "Show total Amount by Region": Rita needed 2-5 arrange_table calls (the test requires exactly one) because she addresses a field as if it were a category (`{"id":"Region"}` in layout.set before any category.add), adds invented fields (`totals`, `groups`, `name` on measure.add) or drops `transform`. The engine refuses each with a precise error and she converges, applied, with correct numbers (East 360, North 210, West 615). In the final run the single call was itself refused.
  2. "Sum the Region column": in 4 of 5 runs Rita answered correctly in text ("a text column cannot be summed") without calling arrange_table, so the required `refused/validation-failed` tool result never occurs; in the other it called a count measure with a malformed layout (`invalid-arrangement`, not `validation-failed`). The model was never changed.
  Prompt variants: the logs use `/skill:arrange-table` (as the #322 authoring test forces build-dashboard); `live-table-model-no-skill-prompt.log` is the plain prompt, where Rita never reaches arrange_table in turn 1. Both variants fail.
  Extra runs: `live-table-model-extra-run1.log`, `-run2.log` (same outcome).
  The Rita final-text-numbers-in-preview assertion was NOT reached in a passing run: in the runs where arrange applied, Rita's reply numbers were the engine's East/North/West totals plus a Grand Total 1,185 (which is in the engine preview as the grand-total row), but the exactly-one-call assertion fails first. Not claimed as verified.

## Fixes made (own commits)
1. f6e2cf1 `contract.ts`: reference fields that fail validation said only `invalid rows`; live Rita looped on it. The message now names the `{id}` / `{alias}` object shape. Test added in `contract.test.ts`.
2. 957dd93 `capabilities.ts`: `capabilities.operations` was names only, so the model guessed field names. Added `operation_fields` (required/optional per operation). Test added.
3. 77da627 `rita-live.test.ts`: the carried round-trip test asserted the last history message was `ai`; `runAgentQuery` streams the answer as chunks and returns history ending on the tool message (query.test.ts "returns the history unchanged"). It now asserts role `tool` and a non-empty streamed answer. REVIEW WARNING: an assertion was changed (the old one could not hold after a tool round).

## Script deviations from the brief (rita-live-check.sh)
- `OPENBB_MCP_URLS` entries are `id=url` in `real-endpoints.test.ts`; the probe strips a leading `id=` (a bare url still works).
- Auth header is `Basic base64(OPENBB_NAS_AUTH)`, matching the test, not the raw value.
- A success line is printed on a clean report. Two extra script tests (accepts a passing report).
- The table-model test reads `RITA_LIVE_NO_SKILL=1` to drop the `/skill:` prefix.

## Task 17 fix: teaching Rita the table model (live re-run)
The first-pass live logs moved to `pre-fix/`. Changes (TDD, unit tests beside each): the arrange-table skill rewritten around the field / category / measure roles with a worked example first, a fixed reply shape and the Task 15 wording minors; `capabilities.how_to_arrange` in describe_table (built from `OPERATIONS`); arrange/describe tool descriptions (Task 12 minors, roles, preview-only numbers); a refusal that names a field used where a category/measure belongs; the local_table widget description Rita reads says describe_table, not get_widget_data; assertion 2 restated (REVIEW WARNING in v6-assembly.md); `rita-live-check.sh` now fails a file that cannot load.

| Run | Load (1/5/15) | Test 1 (one applied arrange, numbers in preview.rows) | Test 2 (text never summed) | Teaching state / cause |
|---|---|---|---|---|
| 01 | 30.72 37.77 55.29 | FAIL | FAIL | both turns called get_widget_data (refused for a local file; Rita ends the turn) |
| 02 | 34.72 37.79 54.12 | FAIL | FAIL | describe then stop; turn 2 went to get_widget_data. Widget description fixed after this |
| 03 | 41.02 39.17 52.46 | FAIL | pass | one applied call; quoted grand total 1,185 (not in preview.rows) |
| 04 | 82.18 51.65 56.17 | FAIL | FAIL | quoted "12 rows"; test 2 turn 1 empty reply |
| 05 | 83.44 56.09 57.61 | FAIL | pass | quoted 12 rows and 1,185 = 360 + 210 + 615. Fixed reply shape after this |
| 06 | 61.82 55.04 57.12 | pass | pass | |
| 07 | 48.18 52.37 56.04 | pass | pass | |
| 08 | 41.64 50.36 55.19 | FAIL | pass | copied the numbered reply shape ("2." counted as a number). Bullets after this (final teaching) |
| 09 | 35.42 47.38 53.83 | pass | pass | final teaching |
| 10 | 45.37 48.70 54.12 | pass | pass | final teaching |
| 11 | 48.02 49.13 54.09 | pass | FAIL | final teaching; setup turn wrote the arrange_table call as JSON text instead of a tool call |
| 12 (full gate) | 36.03 46.06 52.78 | pass | pass | `live-all-fix-run12-mcp-env-error.log`: real-endpoints failed to load (my `OPENBB_MCP_URLS` lacked `id=`) yet the gate printed 17/17 and exited 0; gate fixed |
| 13 (full gate) | 61.13 52.52 54.08 | pass | pass | `live-all.log`: 22/22 passed, 0 skipped, exit 0 (rita-authoring-live 12, table-model 2, real-endpoints 5, rita-live 3) |

On the final teaching (runs 09-13), test 1 passed 5/5 and test 2 passed 4/5. Every applied run used exactly one arrange_table call with East 360, North 210, West 615. The longest unbroken run of full passes is two (09-10 and 12-13). The goal of three in a row is NOT met.

| Gate after the fix | Exit | Duration | Load at start | Counts |
|---|---|---|---|---|
| typecheck (`typecheck-fix.log`) | 0 | 11 s | see log | clean |
| lint (`lint-fix.log`) | 0 | 9 s | see log | clean |
| scrub (`scrub-fix.log`) | 0 | 1 s | see log | clean |
| vitest src/lib/agent, src/skills, src/stores + touched files (`unit-focused-fix.log`) | 0 | 22 s | see log | 51 files passed, 1 skipped (the live suite); 1187 passed, 2 skipped |
| e2e rita-arrange, rita, proxied-tools, ai-library (`e2e-fix.log`) | 0 | 26 s | see log | 11 passed |

## Final review fixes and final gates (HEAD 59e3003 for the build gates, 4ffc916 final)
Fixes (own commits): Undo for `arrange_table` is now registered before the settle wait (a drawer edit inside the window makes Undo refuse; test added and shown red on the old code); `rita-live.test.ts` also fails on a round-limit WARNING; `rita-live-check.sh` strips `id=` only for `[A-Za-z0-9_-]+=http(s)://`, builds a single-line Basic header and passes it to curl through a 0600 temp file (not argv), with loopback-server tests; the contract test was renamed for what it checks.

Logs sit in `final/`; `final/results.txt` has exit codes, durations and the 1/5/15-minute load at the start of each. Playwright ran with `BDOBB_BROWSER_PORT=4373 BDOBB_MOCK_PORT=4374`, all unsandboxed.

| Gate | Exit | Duration | Load at start | Counts |
|---|---|---|---|---|
| typecheck | 0 | 17 s | 47.00 26.41 34.86 | clean |
| lint | 0 | 14 s | 83.67 36.08 38.12 | clean |
| unit (`vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000`) | 0 | 193 s | 88.98 38.78 39.06 | 380 files passed, 5 skipped (385); 6564 passed, 28 skipped (6592) |
| build | 0 | 14 s | 21.52 39.30 40.13 | built |
| e2e (playwright) | 0 | 456 s | 19.29 37.95 39.63 | 259 passed, 1 skipped (ONE green run) |
| `pnpm test:web` | 0 | 2 s | 40.91 39.23 39.86 | 31 pass, 0 fail |
| cargo check (`--locked --offline -j 2`) | 0 | 1 s | 40.91 39.23 39.86 | finished (cached) |
| typecheck-b / lint-b at 4ffc916 | 0 / 0 | 9 / 8 s | 34.53 / 34.17 (1 min) | clean |
| scrub (after the doc edits) | 0 | 1 s | 33.05 38.13 38.99 | clean |

### Live gate at the end (`bash scripts/rita-live-check.sh`, all 22 tests)
| Run | Load (1/5/15) | Result | Notes |
|---|---|---|---|
| A (first) | 34.55 37.87 39.35 | FAIL, exit 1: 20 passed, 0 skipped, 2 failed | `live-run-a.log`. (1) `rita-live` round-trip: my new "no WARNING" check also caught Rita's per-tool status `get_widget_data: no usable data returned`, not a round-limit hit; the check was narrowed to the round-limit message (commit 4ffc916). (2) `rita-table-model-live` test 1: "reply number 12 is in preview.rows" (Rita quoted a row count), the known model-conduct flake. |
| B (ONE extra run, after the narrowing) | 34.12 39.51 39.47 | PASS, exit 0: 22/22, 0 skipped, 0 failed | `live-run-b-extra.log`. Extra run after a failure: the gate is not reliably green in one pass. |

Tally on the final teaching including these runs: table-model test 1 passed 6/7 and test 2 passed 6/7 (runs 09-13, A, B). The three-in-a-row goal remains unmet as a standing property; the live gate is LLM-driven and flaky.
