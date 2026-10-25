# v5 side branch: #18 first-open + D-019 generic Statement 2026-10-10 — receipts

Branch `claude/v5-18-first-open`, off the frozen v5 `43f888d`; the frozen head is not moved. On top of the #18 first-open receipts (`../fix18-first-open-2026-10-10/`), this adds:

| Commit | Item | What |
|---|---|---|
| `8bfff55` | D-019 (#32), regression V5-032 | A generic (no-template) Statement used to drop a line with a worker calculation error (e.g. gross = revenue − cost_of_revenue with cost "n/a"), because `isNumericLine` rejected the `"#ERROR"` string. `statementRows` now takes an optional `isError(row, field)`, and `projectGenericStatementDataset` passes the rows' `cellErrors`. The line is kept, including one that is an error in every period, and exports `"#ERROR: <reason>"`. The new test reproduces the case (Gross 40 / #ERROR / 50) and failed before the fix. |

Review: one pass, verdict "Ready to merge: Yes". Minor item, pre-existing since `8988979` and the same for template Statements: `StatementRenderer` shows an error cell as a bare `#ERROR` with the reason as a `title` tooltip, not the shared `⚠ #ERROR` ErrorCell (with its `aria-label`).

`run-gates.sh` ran every gate once at HEAD `8bfff55` (see `head.txt`), with a real `pnpm install --offline` and ports 4893/4894. Every gate exited 0, with no reruns: typecheck, lint, unit, build, e2e, web, build-web, web-browser, cargo, scrub, help, cargo-test, `git diff --check 43f888d HEAD`. Counts are in the logs.

Nothing pushed, no tag moved.
