# v5 #11 + #25 carry 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`, on top of `bde9c6f`. `b02c67f` merges v4 `8e91662`, bringing #11 (the e2e "no source acquisition" filter on `MOCK_URL`, skipping discovery) and #25 (v3 EOF fix, plus `.gitattributes` exempting committed receipts from whitespace checks).
- Conflict in `e2e/table-execution.spec.ts`: this line already filtered on `MOCK_URL`; v4's `isDiscoveryRequest` filter was taken.
- `git diff --check d333753 HEAD` exits 0.

`run-gates.sh` ran every gate once at HEAD `b02c67f` (see `head.txt`), with e2e ports 4683/4684, followed by `cargo test --lib`. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

COMPOSITE EVIDENCE (e2e):
- The full run had 247 passed, 1 failed and 1 skipped.
- The failure was `statement-clean-v5.spec.ts:31`, a 30 s timeout waiting for the View combobox, under 1-minute load around 200–540 (`gates.tsv`). This merge does not touch it, and it passed in the previous v5 run at `e7b557e`.
- Rerun alone at the same HEAD: 3/3 passed (`rerun-e2e.log`).

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 172s |
| lint | pass | 68s |
| unit | pass | 333 files passed, 1 skipped; 5971 tests passed, 6 skipped |
| build | pass | 22s |
| e2e | pass (composite) | full run 247 passed, 1 failed (load timeout), 1 skipped; failed spec rerun 3/3 |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 16s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Delivery: nothing pushed, no tag moved.
