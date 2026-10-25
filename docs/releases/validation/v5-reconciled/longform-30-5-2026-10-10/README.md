# v5 re-cut batch 2026-10-10 — #38 long form, #30 teardown, #5 Widget Library backend, home-path scrub — receipts (FREEZE)

Branch `claude/v5-18-first-open`. v5.0.0 was re-cut at `91d86ed` (#38) by the regression session on the user's order. This freeze adds the commits after it, for a second re-cut. The product range is `91d86ed..1a0d875`, plus the docs and scripts in `ebad5fd`.

| Commit | Issue | What |
|---|---|---|
| `40af5d3` (receipts `91d86ed`) | #38 | A backend card's Statement view reads long-form rows `{symbol, date, period, line_item, value}`. Already in v5.0.0 `91d86ed`; listed here because these gates cover it again. |
| `3e8a6d7` | #30 | Test only. The reference-acceptance `afterEach` uses `unrouteAll({behavior: 'ignoreErrors'})` instead of `'wait'`, which blocked for as long as an in-flight `route.fetch()` hung (more than 90 s in the v6 565d3c6 run). 3/3 pass against `openbq-regression:reference-final-source` on 7780. Its home line is v5: the hook came in with `8988979` and was never on v4. |
| `1a0d875` | #5 | Widget Library **Backend** filter and per-card backend badge, as v4 `f5dc718` and v3 `462b850` (code of v6 `6ea6eb4`). Help describes six filters. 13 tests, each failed first. |
| `ebad5fd` | scrub | The home prefix becomes `~` in 17 v5-reconciled logs, the 15 v4-integration logs and `docs/superpowers/plans/2026-10-08-workspace-connection.md`. `scripts/scrub-check.sh` refuses `/Users/[A-Za-z]` and `/home/[a-z]`, and skips a worktree's `.git` file and the `.vercel` output. |

Kept-behaviour assertions changed (#5), as the commit says: "orders the selects" now expects Backend first (and asserts the count); the badge order is backend, source, type.

Reviews: #30, one pass, ready (minor: the commit message also names `9e00707`, but the hook came only with `8988979`). #5, one pass over v3 and v4, ready; v5 applies the same v4 patch. #38 was reviewed in `91d86ed`.

`run-gates.sh` ran every gate once at `1a0d875` (see `head.txt`), with e2e ports 4395/4396 and a load average of 400–600. After `ebad5fd` (no product source), scrub, the scrub-check tests, lint and diff-check were re-run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass; after the scrub, pass (`lint-rerun.log`) |
| unit | 6015 passed, 6 skipped, **1 failed**: `scripts/release.test.mjs` › "replaces an existing release's files in place…" timed out at 60 s under load. The script is untouched since `21ebe45`. Rerun alone: 6/6 (`unit-rerun-release.log`). Recorded as composite. |
| build | pass |
| e2e | 254 passed, 1 skipped (opt-in reference acceptance) |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | clean; after the scrub with the new patterns, `scrub-check: clean` (`scrub-rerun.log`) |
| scrub-check tests | 7 passed (`unit-scrub-check.log`) |
| help | 52 passed |
| cargo-test | 15 passed, 0 failed |
| diff-check | `git diff --check 21ebe45 HEAD` exit 0. After the scrub: exit 0 over everything except the receipt logs, which are raw tool output (`diff-check-rerun.log`). |

Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is the commit that adds these receipts. Its product source equals `1a0d875`, and its scripts and docs equal `ebad5fd`. Delivery: nothing pushed, no tag moved.
