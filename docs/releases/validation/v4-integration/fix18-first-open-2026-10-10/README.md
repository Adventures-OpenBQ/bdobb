# v4 #18 first-open fix 2026-10-10 — receipts (branch `claude/v4-18-first-open`)

Off the frozen v4 `c1df908`; the frozen head is not moved. The regression on `c1df908` found #18 only partly fixed. Move to Data Columns and Add measure started on Total, but the Pivot's **first-open auto layout** (the draft `migratePivot`/`resolveMeasures` build for a table with no report model) still created measures with no aggregation, so the grid read #ERROR.

| Commit | What |
|---|---|
| `04229b2` | LocalTableRenderer's first-open draft gives each unaggregated measure `initialAggregation`: Total when the field allows sum, else Count. Stored models and legacy configs are not rewritten. New test: open the Pivot on a raw CSV, move `region` to Row Groups, and the saved measures carry `revenue: sum` and no unset aggregation. It failed before the fix. |
| `d9079a3` | Two table-execution e2e specs assumed the old unaggregated draft. Changes: pill names `Region` → `Region — Count` and `Volume` → `Volume — Total`. The XLS spec clears Cost's aggregation so its missing-aggregation cell styling check still runs. No assertion removed or weakened. |

Review: one pass, verdict "Ready to merge: Yes". Follow-up, not #18: the backend in-thread PivotPanel's move-to-data still creates an unset measure. That path shows the "needs an aggregation" warning, not #ERROR.

**Gates.** A first run at `04229b2` had 13 e2e failures:
- 10 in `documents.spec` (pdf.js worker). This worktree's symlinked `node_modules` resolved outside the Vite root. With a real `pnpm install --offline`, `documents.spec` passed 10/10.
- 3 in `table-execution.spec`. These were the two specs fixed in `d9079a3`. After the fix the spec passed 8/8.

The receipts here are the clean rerun at `d9079a3` (see `head.txt`), with ports 4883/4884. Every gate exited 0: typecheck, lint, unit (5649 passed / 6 skipped), build, e2e (217 passed / 1 skipped), web 31/0, build-web, web-browser, cargo, scrub, help, cargo-test, `git diff --check c1df908 HEAD`.

Nothing pushed, no tag moved. The regression session decides whether to re-freeze on this branch.
