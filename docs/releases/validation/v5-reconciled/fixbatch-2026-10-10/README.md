# v5 fix batch 2026-10-10 — receipts (FREEZE)

Branch `codex/clean-v5-reconciled`, on top of `c7836fd`.

| Commit | Issue | What |
|---|---|---|
| `29a90b8` | — | Merge of frozen v4 `a4439c4` (#16 #18 #20 #21 #27 #28 #29 #30, V4-004, D-020). No conflicts. |
| `731a3ef` | #26 | The rail expands for keyboard focus (`data-keyboard-focus`, set from the last input), not `:has(:focus-visible)`. |
| `4eab8b9` | #24 | One set of aggregation names (`AGGREGATION_NAMES`): the submenu says "Unique count" like the pill tag; the Measures picker shows names, not codes. |
| `1f7c164` | #24 | Statement labels made from field names keep EBIT / EBITDA / EPS upper case. |
| `32ec98b` | #24 | Browser mode no longer subscribes to the native New Workspace menu, so it logs no `transformCallback` error at start. |
| `091ec31` | #23 | Confirmed with the issue's own steps (B2 → Gamma → Beta via Put in panel). Fails when `34f349a` is reverted. |

**#26 root cause** (systematic debugging; reproduced in Playwright WebKit, the desktop app's engine). `.left-rail:has(:focus-visible)` widened the rail. When the workspace dialog closes, `useModalDialog` hands focus back to the rail row. WebKit marks that restored focus `:focus-visible` even after a mouse click; Chromium does not. Measured after Edit… ▸ Done by mouse: WebKit rail 240px, Chromium 48px. `5146b99` cleared only `data-expanded`, which was never the cause. Escape (keyboard) leaves the rail open in both engines, and still does: that is keyboard reach. New spec `e2e/rail-after-dialog.webkit.spec.ts` runs in WebKit. Before the fix the mouse case failed (240px); it now passes. **The native check is still owed**: this session had no full-screen computer use.

Review: one pass, verdict "Ready to merge: Yes". Minor follow-ups were not done, to keep the gated head:
- `styles.css` comments at about lines 413/450 still mention `:has(:focus-visible)`.
- `AGGREGATION_NAMES` and `LABELS` differ only in "Unique count" vs "Unique Count" (column headers are pinned by an e2e).
- The WebKit spec inherits the chromium project's device descriptor.

`run-gates.sh` ran every gate once at HEAD `091ec31` (see `head.txt`), with e2e ports 4693/4694.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 333 files passed, 1 skipped; 5988 tests passed, 6 skipped |
| build | pass |
| e2e | 253 passed, 1 skipped (includes the WebKit spec) |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | **COMPOSITE.** Failed in the gate run (`web-browser.log`) and on an immediate rerun (`web-browser-rerun1-fail.log`): `fill` on the echo card's Ticker timed out after the session-lapse step. Both ran while a review agent was also running Playwright in this worktree, at load about 100. It then passed 3 of 3 here, each after `build:web` at load 70–77 (`web-browser-rerun2..4.log`). The same commit also passes in a clean worktree. A bisect of every commit in this batch (29a90b8, 731a3ef, 1f7c164, 32ec98b, 091ec31) passed in a clean worktree, so no commit introduces it. |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 52 passed |
| cargo-test | 15 passed, 0 failed |
| diff-check | `git diff --check c7836fd HEAD` exit 0 |

Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `091ec31`. Still open on this line: D-019 ([OPEN-QUESTIONS.md](../../../OPEN-QUESTIONS.md)). Delivery: nothing pushed, no tag moved.
