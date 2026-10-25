# v5 regression fixes 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`, on top of `fed77d6`:
- `34f349a` fixes #23: Put in panel shows the workspace's recorded tab.
- `5146b99` fixes #26: the rail collapses before the workspace row menu opens its dialog.
- `e7b557e` merges v4 `1f788b8`: D-018 worker-table Export, plus v4 fixes #13, #14, #15, #17 and #19 (user rulings 2026-10-09).
  - ParamControls conflict: this line's `role="presentation"` span keeps #13's class.
  - WidgetCard conflict: Statement export stays first. D-018's worker export applies only outside the Statement view, because v5 counts a Statement-view linked/local table as a worker producer. No test covers that combination.

`run-gates.sh` ran every gate once at HEAD `e7b557e` (see `head.txt`), with e2e ports 4683/4684, followed by `cargo test --lib`. Every gate exited 0; there were no reruns, so there is no composite evidence. Load per gate is in `gates.tsv`, up to about 600. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 56s |
| lint | pass | 40s |
| unit | pass | 333 files passed, 1 skipped; 5971 tests passed, 6 skipped; 1052s |
| build | pass | 31s |
| e2e | pass | 248 passed, 1 skipped; 711s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 11s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Not in this head: #11 and #25. They come with the next v4 merge.

Delivery: nothing pushed, no tag moved.
