# v8.0.0 re-cut: backend tables on the table worker (2026-10-14) — receipts (FREEZE)

Branch `claude/v8-recut-backend-tables-20261014`, on top of v8.0.0 `d2c3dce` (= `release/v8` = `main`). The user approved it ("yes, re-cut v8 on the new v7 too"). It supersedes the freeze in `../v8-release-2026-10-14/`.

| Commit | What |
|---|---|
| `1b51f58` | Real merge of the re-cut v7.0.0 `2dff408` (PR #53): the backend-table worker series, the same four commits carried v4→v7. |
| `8d92a03` | README cites the re-cut v7.0.0 `2dff408` and backend tables on the worker. |

**The one conflict (`WidgetCard.tsx`).** v8's read-only, docks and lock guards and its Pin widget ▸ submenu are kept. The worker checks use the series' `workerTable`, which also enforces the WORKER_MAX_CELLS ceiling, instead of `isWorkerTableProducer(card)`. The local-file branch keeps `isWorkerTableProducer(card)`, as on v4–v7.

**v8 invariants, all unchanged by the merge:**
- `openbqDocker: "v8.0.0"` (openbq-docker `ebd3b85`);
- `web/policy.vendored.json` is v8.0.0 / `dfa61ddf…`;
- the Funnel :10000 help pages and `web/` (there is no diff from `d2c3dce` there).

`run-gates.sh` (copied from `../v8-release-2026-10-14/`, diff-check base `d2c3dce`) ran every gate once at `8d92a03` (`head.txt`), on macOS. The logs are scrubbed of local paths.

| Gate | Result |
|---|---|
| pivot-build | pass |
| typecheck | pass |
| lint | pass |
| unit | 438 files passed, 6 skipped; 7951 tests passed, 29 skipped (baseline 7945; the series adds tests) |
| revision-test | 54 passed |
| build | pass |
| smoke | pass |
| e2e | 294 passed, 8 skipped |
| web | 42 pass, 0 fail |
| build-web | pass |
| web-browser | pass |
| pivot-test | pass |
| pivot-packaging | pass |
| cargo | pass |
| scrub | pass |
| help | 94 passed |
| cargo-test | pass |
| notices-check | up to date |
| diff-check | `git diff --check d2c3dce HEAD` (receipt logs excluded) exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Its source equals `8d92a03`. `release/v8` and `main` fast-forward from `d2c3dce` to the freeze, and `v8.0.0` moves there, after the re-cut v4–v7 have landed.
