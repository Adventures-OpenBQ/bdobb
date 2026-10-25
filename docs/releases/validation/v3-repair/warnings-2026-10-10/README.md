# v3 OBBject warnings 2026-10-10 — receipts (FREEZE)

Branch `codex/clean-v3-repair`, on top of `c944889`. User ruling 2026-10-10: BDOBB shows OBBject `warnings` as a card notice from v3.0.0 on. This is the only change on v3.

| Commit | What |
|---|---|
| `13ee51a` | `obbjectWarnings` reads an OBBject's `warnings` (`[{category, message}]`) as text. `fetchWidgetData` reports them through an optional callback, before it unwraps `results`. `useWidgetData` keeps the last successful fetch's warnings and clears them on error. WidgetCard shows them in the existing `.card-notice` (`role="status"`) while the card is ready. No settings. Tests: hook over real HTTP (with and without warnings), card notice, parser edge cases; each failed before the change. |

Review: one pass, verdict "Ready to merge: Yes". Minor items not done:
- the warnings notice and the export notice can both be `role="status"` at once;
- there is no length cap on warning text;
- a non-OBBject payload's top-level `warnings` strings would also show;
- the notice hides during a same-key refetch.

`run-gates.sh` ran every gate once at HEAD `13ee51a` (see `head.txt`), with e2e ports 4813/4814.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 150 files passed, 1 skipped; 3083 tests passed, 7 skipped |
| build | pass |
| e2e | 91 passed, 1 skipped |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | **FAIL, pre-existing.** `web/browser-smoke.mjs:219` waits for the AAPL cell in the quote card and times out. Same failure on a rerun at `13ee51a` (`web-browser-rerun-head.log`) and at the untouched baseline `c944889` in a clean worktree (`web-browser-baseline-c944889.log`). This is D-002: its smoke fix `3e4630d` was carried to v4 from a v3 fixbatch branch and is not on `codex/clean-v3-repair`. The ruling scopes this v3 change to the warnings feature, so it is not fixed here. |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 51 passed |
| cargo-test | 15 passed, 0 failed |
| diff-check | `git diff --check c944889 HEAD` exit 0 |

Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `13ee51a`. Delivery: nothing pushed, no tag moved.
