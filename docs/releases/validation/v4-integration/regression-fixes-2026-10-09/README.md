# v4 regression fixes 2026-10-09 — receipts

Branch `codex/clean-v4-integration`. Base `1fffdd0`, then:
- D-018 (`8b1e99b`), merged under the fixes as `6147dea`.
- #14 Help (`ab4d38d`): import/export, provider keys, table counts.
- #15 stale reference-acceptance assertion (`4522246`). The spec is opt-in and was not run here.
- #17 object Pivot categories (`4979d4f`, plus `2efc324` for the user's `value` ruling).
- #19 missing optional Statement lines are blank (`75b8781`, user ruling "blank unless required").
- #13 narrow-viewer header controls (`486068e`).

USER RULINGS 2026-10-09: #19 blank unless required. #17: an undeclared object category groups by its scalar `value`.

TEST CHANGES:
- The #17 analytical test's undeclared `{value, url}` case now groups.
- The reference-acceptance curated assertion now expects `table.pivot` (D-007).

`run-gates.sh` ran every gate once at HEAD `2efc324` (see `head.txt`), with e2e ports 4683/4684, followed by `cargo test --lib`. Every gate exited 0; there were no reruns, so there is no composite evidence. Load per gate is in `gates.tsv`. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 23s |
| lint | pass | 20s |
| unit | pass | 312 files passed, 1 skipped; 5627 tests passed, 6 skipped; 392s |
| build | pass | 24s |
| e2e | pass | 216 passed, 1 skipped; 626s |
| web | pass | 31 pass, 0 fail |
| build-web | pass | 18s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.` |
| cargo | pass | `cargo check --locked --offline -j 2` finished |
| scrub | pass | `scrub-check: clean` |
| help | pass | 6 files, 51 tests passed |
| cargo-test | pass | 15 passed, 0 failed |

Not fixed here: #11 (e2e specs hardcode mock port 4174) and #25 (blank line at EOF).

Delivery: nothing pushed, no tag moved.
