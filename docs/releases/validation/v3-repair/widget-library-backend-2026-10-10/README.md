# v3 #5 Widget Library backend filter and home-path scrub 2026-10-10 — receipts (FREEZE)

Branch `codex/clean-v3-repair`, on top of shipped v3.0.0 `1c764d8`. User ruling 2026-10-10: fix #5 in v3 and carry it to v4, v5 and v6. This is the only change on v3.

| Commit | What |
|---|---|
| `462b850` | Restores bdobb-v2 PR #44 (`853151c`), lost in the v3.0.0 consolidation, with the behaviour of the v6 carry (`6ea6eb4`). The Widget Library gets a **Backend / All backends** select keyed by `backendId`. Options are labelled with the Connections name (**Built-in** for builtins, or the bare id of a removed backend) and sorted by that label. Only backends that discovered widgets are listed. Each card shows a backend badge before the provider and type badges. If the selected backend's widgets leave the registry, the selection clears. Help (guide and topic) describes the five filters and the badge. 13 tests, each failed before the change. |

Kept-behaviour assertions changed, as the commit says: "orders the selects" now expects Backend first and also asserts the count; the badge order is backend, source, type. The help screenshot `widget-library.png` predates the badge and was not regenerated.

Review: one pass, verdict ready, with no Critical or Important issues. Minor, not done: `filterOptions`' unit test does not assert `backendIds` directly (the select tests cover it).

Gates: per the ruling, the unit and web gates, plus typecheck, lint, help, scrub and diff-check. `run-gates.sh` ran each once at HEAD `462b850` (see `head.txt`). Build, e2e and cargo were not run for this change.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 3093 passed, 7 skipped, **1 failed**: `scripts/reference-backend.test.mjs` › "re-clones a checkout whose origin is not REPO" (20 s, load average about 200 from concurrent sessions). The script and its test are untouched since `1c764d8`. Rerun alone: 5/5 pass (`unit-rerun-reference-backend.log`). Recorded as composite. |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| scrub | `scrub-check: clean` |
| help | 51 passed |
| diff-check | `git diff --check 1c764d8 HEAD` exit 0 |

## Home-path scrub (same freeze)

User ruling 2026-10-10: scrub local paths from committed files and guard against them, in the same freeze as #5.

| Commit | What |
|---|---|
| `3b68278` | `docs/superpowers/plans/2026-10-08-workspace-connection.md`: the home prefix becomes `~` (15 lines). No v3 receipt log carried one. `scripts/scrub-check.sh` refuses `/Users/[A-Za-z]` and `/home/[a-z]`. It now also skips a worktree's `.git` file and the gitignored `.vercel` build-web output, as it already skips `dist/`. Two tests, each failed first. |

Gates re-run for that commit, which changes no product source:

| Gate | Result |
|---|---|
| scrub | `scrub-check: clean` with the new patterns (`scrub-rerun.log`) |
| scrub-check tests | 7 passed (`unit-scrub-check.log`) |
| lint | pass (`lint-rerun.log`) |
| diff-check | `git diff --check 1c764d8 HEAD` over everything except the receipt logs (raw tool output), exit 0 (`diff-check-rerun.log`) |

Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `462b850`, and its scripts and docs equal `3b68278`. It supersedes the first freeze `a1223c3`. Delivery: nothing pushed, no tag moved.
