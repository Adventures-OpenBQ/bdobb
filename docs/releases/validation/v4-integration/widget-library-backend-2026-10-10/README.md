# v4 #5 Widget Library backend filter and home-path scrub 2026-10-10 — receipts (FREEZE)

Branch `claude/v4-18-first-open`, on top of shipped v4.0.0 `5eda891`. User rulings 2026-10-10: carry #5 from v3 (frozen at `360b444`), and scrub local paths from committed files in the same freeze.

| Commit | What |
|---|---|
| `f5dc718` | #5: the code of the v6 carry (`6ea6eb4`), same behaviour as v3 `462b850`. **Backend / All backends** select keyed by `backendId`, labelled by Connections name (**Built-in**, or the bare id of a removed backend) and sorted by label. A backend badge comes before the provider and type badges. A removed backend's selection clears. Help (guide and topic) now describes six filters. 13 tests, each failed first. One of them, the clearing test, is not in v6. |
| `70cd1fe` | Scrub: the home prefix becomes `~` in 15 logs under `docs/releases/validation/v4-integration/` and in `docs/superpowers/plans/2026-10-08-workspace-connection.md`; scratch paths become `<scratch>`. The logs are kept. `scripts/scrub-check.sh` refuses `/Users/[A-Za-z]` and `/home/[a-z]`, and skips a worktree's `.git` file and the `.vercel` build output (same as v3 `3b68278`). |

Kept-behaviour assertions changed, as the commit says: "orders the selects" now expects Backend first (and asserts the count); the badge order is backend, source, type. `widget-library.png` was not regenerated.

Review: one pass over v3 and v4, ready, with no Critical or Important issues. The CSS change keeps the provider-tone rules ahead of the neutral backend pill.

Gates: per the ruling, the unit and web gates, plus typecheck, lint, help, scrub and diff-check. `run-gates.sh` ran each once at `f5dc718` (see `head.txt`), one gate after another. After `70cd1fe` (no product source), scrub, the scrub-check tests, lint and diff-check were re-run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass; after the scrub, pass (`lint-rerun.log`) |
| unit | 312 files passed, 1 skipped; 5660 tests passed, 6 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| scrub | clean; after the scrub with the new patterns, `scrub-check: clean` (`scrub-rerun.log`) |
| scrub-check tests | 7 passed (`unit-scrub-check.log`) |
| help | 51 passed |
| diff-check | `git diff --check 5eda891 HEAD` exit 0. After the scrub: exit 0 over everything except the receipt logs, which are raw tool output (`diff-check-rerun.log`). |

Build, e2e and cargo were not run for this change. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is the commit that adds these receipts. Its product source equals `f5dc718`, and its scripts and docs equal `70cd1fe`. Delivery: nothing pushed, no tag moved.
