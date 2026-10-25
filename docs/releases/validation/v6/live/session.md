# Live Rita gate (Part C Task 9), HEAD 216dfab, branch codex/clean-v6

Endpoints: NAS openbq node (kind only; see env.txt). Preflight 2026-10-08: Rita /agents.json 200, MCP POST initialize 200, backend /widgets.json 200 (no auth).
Model offered by agents.json: default `openai:qwen3.6-35b` (the select lists OpenAI GPT-5.5/5.4/5.4-mini/5.4-nano/5/4.1/4o/4o-mini and Ollama gpt-oss:20b, qwen3.5:9b, gemma4:e4b). The gate does not change the model.
Skipped counts: 0 in both runs. The script prints "2 files failed to load" on run 1; that is vitest's failed-suite count (the one file with a failed test), not a load error: the report shows 4 files ran.

## Run 1 (first run, headline): FAIL, exit 1, 21 passed / 22, 0 skipped, 1 failed
Log: gate.log. Start 2026-10-08T17:07:19Z, load 250.03 242.21 214.90, duration 115 s.
- rita-authoring-live 12/12 passed.
- rita-live 3/3 passed (answers a plain turn; round-trips get_widget_data against the reference backend; third test passed).
- real-endpoints 5/5 passed.
- rita-table-model-live: 1 passed ("totals Amount by Region in one applied arrange_table, quoting only engine numbers"), 1 FAILED ("never sums the Region text column: the engine refuses it or Rita declines, and the model is unchanged").

Failure classification: model conduct (known flake), not product and not provider availability. The model answered and every tool call returned normally. In the setup turn of test 2 ("Show total Amount by Region") Rita called describe_table (ok, ready) and then ended the turn with an EMPTY reply and no arrange_table call, so the test's precondition at rita-table-model-live.test.ts:141 (the setup turn made an arrange_table call) failed before the text-sum assertion was reached. The same Rita conduct (describe then stop / empty reply) is recorded in Part B runs 02 and 04. No test or assertion was changed.

## Run 2 (ONE extra run after the failure): PASS, exit 0, 22/22, 0 skipped, 0 failed
Log: gate-extra.log. Start 2026-10-08T17:09:31Z, load 245.42 244.76 220.00, duration about 2 min.
Result: passed on extra run after failure. This is NOT a clean pass; the first run failed. rita-authoring-live 12, rita-table-model-live 2, rita-live 3, real-endpoints 5.

Load after both runs: 103.53 194.99 204.32.

## Step 3 (native session on the QA app)
Not performed by this run (shell-only gate task).
