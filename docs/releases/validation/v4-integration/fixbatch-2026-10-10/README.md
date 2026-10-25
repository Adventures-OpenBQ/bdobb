# v4 fix batch 2026-10-10 — receipts (FREEZE)

Branch `codex/clean-v4-integration`, on top of `8e91662`. Each fix has a test that failed first. #16, #27 and V4-004 are proof tests of code that was already correct; each was mutation-checked against its fix.

| Commit | Issue | What |
|---|---|---|
| `5c052c5` | #18 | A new measure (Move to Data Columns, Add measure) starts on Total, or Count when sum is illegal. The compatible-export notice names the profile it wrote (v3/v4). |
| `c45b30b` | #20 | An integer in a column whose name ends in "year" prints as 2024, not 2.02K. |
| `6a8d5fe` | #21 | A linked table fed by a non-worker card (e.g. a backend table) says it cannot feed a linked table, not "Unknown source". |
| `2f3f1db` | V4-004 | Proof test: backend-card-sourced linked table → compatible export → re-import → identity remapped. Fails if the remap is removed. |
| `2933622` | #16 | Proof test on the issue's CSV: AAPL 1400/280/5, MSFT 1900/316.67/6, no #ERROR. Fails without D-011's null fill. |
| `9785736` | #28 | Worker-table Excel export writes date columns as yyyy-mm-dd date serials (UTC arithmetic). |
| `8b36ed1` | #29 (= D-021) | Statement export writes the displayed Section / Line item labels, relabels included, not internal ids. |
| `cf2eb84` | #30 | reference-acceptance CORS route ignores only "Route is already handled" / closed page. Not reproduced locally (0/12 against reference-final-source); the RED evidence is the c7836fd regression trace, where call@221 and call@224 fulfill the same response. |
| `d7e9fc3`, `62be9df` | D-020 | Input filters keep a local draft and save after a 250 ms pause, one at a time and only while nothing is pending. Key-by-key typing no longer loses keys. New e2e `source-filter-typing.spec.ts` and a fake-timer unit test. |
| `77fdb03` | D-019 | Not fixed: the export format is a product decision. See [../../../OPEN-QUESTIONS.md](../../../OPEN-QUESTIONS.md). |

#27 needed no change: `75b8781` (#19) already gives an optional line a blank with no reason, and `missingLines.test.ts` pins both cases.

D-020 and D-021 were filed against v6 (run 5 GUI), but their home line is v4, per `PROPOSAL-d019-d020-d021.md` on v6. They land here and carry to v5 and v6.

**Behaviour notes from review** (one reviewer pass found no Critical or Important issues):
- Input filters stay editable while the table recomputes; the save waits.
- The year rule is a name heuristic (`/year$/i`, integers only). It runs after any explicit `formatterFn`.
- #28 covers the worker-table export path only. Backend-table Excel export is unchanged.
- One invalid link still blocks every worker table on its dashboard. That predates this batch.

`run-gates.sh` ran every gate once at HEAD `62be9df` (see `head.txt`), with e2e ports 4683/4684. Every gate exited 0, with no reruns. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 312 files passed, 1 skipped; 5641 tests passed, 6 skipped |
| build | pass |
| e2e | 217 passed, 1 skipped (opt-in reference acceptance) |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 51 passed |
| cargo-test | 15 passed, 0 failed |
| diff-check | `git diff --check 8e91662 HEAD` exit 0 |

Additionally, `e2e/reference-acceptance.spec.ts` passed 3/3 against `openbq-regression:reference-final-source` on 127.0.0.1:7780.

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `62be9df`. Delivery: nothing pushed, no tag moved.
