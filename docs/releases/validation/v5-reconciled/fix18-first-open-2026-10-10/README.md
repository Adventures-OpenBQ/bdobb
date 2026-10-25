# v5 #18 first-open fix 2026-10-10 — receipts (branch `claude/v5-18-first-open`)

Off the frozen v5 `43f888d`; the frozen head is not moved. This carries the v4 branch `claude/v4-18-first-open` by cherry-pick:

| Commit | From v4 | What |
|---|---|---|
| `a395ba7` | `04229b2` | The Pivot's first-open auto layout starts its measures on Total (or Count), so a table with no report model no longer opens with #ERROR measures. New test (it failed before the fix on v4). |
| `3aa866e` | `d9079a3` | The table-execution e2e follows the new pill and select names. The XLS spec clears Cost's aggregation so its missing-aggregation styling check still runs. No assertion removed or weakened. |

Both cherry-picks applied cleanly; the code is identical to v4's. Review: verdict "Ready to merge: Yes" on the v4 commit, and it checked that the cherry-pick is identical.

`run-gates.sh` ran every gate once at HEAD `3aa866e` (see `head.txt`), with a real `pnpm install --offline`, not a symlinked `node_modules`, and ports 4893/4894. Every gate exited 0, with no reruns: typecheck, lint, unit (5997 passed / 6 skipped), build, e2e (253 passed / 1 skipped, including the WebKit #26 spec), web, build-web, web-browser, cargo, scrub, help, cargo-test, `git diff --check 43f888d HEAD`.

Nothing pushed, no tag moved. The regression session decides whether to re-freeze on this branch.
