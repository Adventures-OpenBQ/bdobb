# Part A gate receipts (HEAD 20da7b7, branch codex/clean-v6)

Host: 10 cores. Load is the 1/5/15-minute average at the start of each gate (end-of-gate values are in `results.txt`).
Final run, logs beside this file. Pre-fix first run is kept in `run1-pre-fix/` (see "Fix made").

| Gate | Exit | Duration | Load at start | Counts |
|---|---|---|---|---|
| typecheck | 0 | 9 s | 37.80 37.66 72.75 | clean |
| lint | 0 | 7 s | 36.93 37.48 72.48 | clean |
| unit | 0 | 165 s | 36.28 37.32 72.01 | 370 files passed, 4 skipped (374); 6462 tests passed, 26 skipped (6488) |
| build | 0 | 13 s | 91.23 52.83 71.68 | built |
| e2e (playwright) | 1 | 446 s | 97.06 55.34 72.35 | 257 passed, 1 failed, 1 skipped (see COMPOSITE) |
| e2e rerun, `e2e/table-toolkit.spec.ts` whole file | 0 | 11 s | 68.67 81.29 81.00 | 7 passed |
| web (`node --test`) | 0 | 0 s | 72.97 82.53 81.42 | 31 pass, 0 fail |
| cargo check (`--locked --offline -j 2`) | 0 | 1 s | 70.73 81.91 81.21 | Finished |
| scrub | 0 | 2 s | 70.73 81.91 81.21 | clean |

Unit load was 36 at start, below the 40 threshold, so no wait was needed. Playwright ran with `BDOBB_BROWSER_PORT=4373 BDOBB_MOCK_PORT=4374`, unsandboxed. `e2e-v6.log` is a copy of `e2e.log`.

## Skips (unit)
26 tests in 4 files, all skipped by design in this run: `reference-backend.test.ts` 6 (needs Docker), `real-endpoints.test.ts` 5, `rita-live.test.ts` 3, `rita-authoring-live.test.ts` 12 (these three need `OPENBB_*` env; Part B's gate runs them live). Playwright: 1 skipped.

## COMPOSITE evidence (e2e)
The unit run is ONE green run. The e2e run is NOT one green run:
- Full run: 257 passed, 1 failed, 1 skipped. The failure was `e2e/table-toolkit.spec.ts:27` "columnsDefs reach the browser" (`tbody tr[data-index]` never appeared within the 30 s test timeout) while host load was 70-97.
- Rerun of the whole file `e2e/table-toolkit.spec.ts` with the same flags: 7 passed (load ~68). No assertion changed. Classified as a load-induced timeout, not a product failure; it passed on rerun alone and on the earlier pre-fix run (it was not among the 117 pre-fix failures).

## Fix made (product failure, own commit 20da7b7)
First full run: e2e 117 failed / 141 passed. Root cause: `src/lib/tableColumns.ts` (v6 `sendToAgentOf`, carried from 3debd899e) statically imported `./logger`, which reaches the plugin-fs browser shim (`src/browser-shim/fs.ts`, top-level `window` access). `tableColumns` is in the table worker's import graph (`table.worker.ts` > `localTableData` > `tableColumns`), so in browser mode the worker threw `ReferenceError: window is not defined` and every "actual worker" spec reported `Worker failed`. Fix: load the logger lazily on the malformed-config branch only. No assertion touched. Verified: tsc, eslint, 421 unit tests in the table files, `drop.spec.ts` + `table-final-review.spec.ts` 6/6, then the full gate rerun above.
