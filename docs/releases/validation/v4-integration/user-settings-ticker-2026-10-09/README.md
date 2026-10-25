# v4 ticker fix + v3 User Settings carry 2026-10-09 — receipts

Branch `codex/clean-v4-integration`, on top of `2bbde09`:
- `3325bd5` is the v4 ticker fix: no false "defaultTicker changed elsewhere" at Done after a server connect. It is adapted for this line, which stages the ticker only at Done.
- `fea9132` merges `refs/integration/v3-user-settings-2026-10-09` = v3 `e8ab841`. That brings v3 `f2da5db` (User Settings first in General) and v3's ticker fix. Conflicts resolved to this line's `done()` and tests; the settings-and-logs shots were regenerated here.
- v3 `b6c0ce7` (product rename and data migration) is deliberately NOT carried, pending the user's choice of v4/v5 identifiers.

`run-gates.sh` ran every gate once at HEAD `fea9132` (see `head.txt`), with e2e ports 4683/4684, under extreme host load (1-minute load 222–784; see `gates.tsv`). Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

COMPOSITE EVIDENCE: unit and e2e each had one failure in the full run. Neither is in an area this change touches:
- **Unit:** `useFiscalYearEnd.test.tsx`, which counts log lines (expected 3, got 1).
- **e2e:** `pivot-page-runtime.spec.ts`, where Chromium reported "page.evaluate: Resulting promise was garbage collected".

Both were rerun in isolation at the same HEAD at load ~206 and passed: `rerun-unit.log` (17/17) and `rerun-e2e.log` (8/8).

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 103s |
| lint | pass | 39s |
| unit | pass (composite) | full run: 308 files passed, 1 failed, 1 skipped; 5602 tests passed, 1 failed, 6 skipped. Failed file rerun 17/17 |
| build | pass | 23s |
| e2e | pass (composite) | full run: 214 passed, 1 failed, 1 skipped. Failed spec rerun 8/8 |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 10s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished |
| scrub | pass | `scrub-check: clean` |
| help | pass | 6 files, 51 tests passed |

Delivery: nothing pushed, no tag moved.
