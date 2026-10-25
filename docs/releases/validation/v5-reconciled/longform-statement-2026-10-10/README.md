# v5 long-form backend Statement 2026-10-10 — receipts

Branch `claude/v5-18-first-open`, on top of the shipped `21ebe45` (v5.0.0). User ruling 2026-10-10: the Statement view reads long-form statement rows from a backend card.

| Commit | Item | What |
|---|---|---|
| `40af5d3` | #38 | Long-form rows (`symbol, date, period, line_item, value`, as openbq-yfinance serves them) are widened by `widenLongRows` into the per-period rows the view already reads:<br>- one column per served date/period, in served order;<br>- line items in served order (the view then groups taxonomy sections as before; unmatched yfinance names stay in served order under Other);<br>- the first served symbol only;<br>- every line in the widget's `value` column format.<br>Wide rows are untouched. The card's view menu now detects the statement on the widened rows. Local-file generic statements share the function, so the two routes cannot drift. Linked tables stay closed to backend sources (#21). |

Tests use captured OPENBQ API responses (AAPL annual income and balance, `src/test/fixtures/openbq-yfinance/`). They cover:
- detection;
- served column and line order;
- served values;
- first symbol;
- the value-column format;
- the backend projection path;
- the view menu;
- a browser e2e (backend card → Statement → Net Income under 2025-09-30 and 2024-09-30), which failed before the fix.

Review: one pass, verdict "Ready to merge: Yes". Minor items, not done to keep this gated head:
- `widenLongRows` takes the symbol from the first row; a first row without `symbol` followed by rows with one would drop the latter.
- Long-row cell errors are not carried (none arrive from a backend; the ceiling is noted in code).
- The per-period mapping in `projectGenericStatementDataset` keys off headers.length === rows.length.

`run-gates.sh` ran every gate once at HEAD `40af5d3` (see `head.txt`), with ports 4893/4894. Every gate exited 0, with no reruns: typecheck, lint, unit (Tests  6005 passed | 6 skipped (6011)), build, e2e (254 passed (9.7m)), web, build-web, web-browser, cargo, scrub, help, cargo-test, `git diff --check 21ebe45 HEAD`.

Nothing pushed, no tag moved.
