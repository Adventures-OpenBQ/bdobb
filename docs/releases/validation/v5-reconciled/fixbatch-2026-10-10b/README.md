# v5 fix batch 2026-10-10b — receipts (RE-FREEZE)

Branch `codex/clean-v5-reconciled`, on top of the withdrawn freeze `1ff1c91`. Batch `fixbatch-2026-10-10` still applies to everything up to `1ff1c91` (#26, #24, #23). This batch adds:

| Commit | Item | What |
|---|---|---|
| `8d3df8c` | — | Merge of re-frozen v4 `c1df908`. No conflicts. It brings frozen v3 `1c50899` (OBBject warnings card notice), the #17 gap fixes and D-019's worker Default-view export. |
| `9d7178a` | D-019 (#32) | The Statement view's export rows (template and generic) write `"#ERROR: <reason>"` through the same `errorCell`. The screen is unchanged: it reads `sections`. **ASSERTION CHANGED (approved by the 2026-10-10 ruling):** `statementExecution.test.ts:75` changed from `'#ERROR'` to `'#ERROR: Upstream calculation refused this value'`. New template-path test. |

#26 is proven by a browser-mode e2e that runs in WebKit and failed before the fix (`e2e/rail-after-dialog.webkit.spec.ts`; both tests pass in this run's e2e gate). **Native check owed — morning** (V5-002 R2; needs the user). Also interactive and NOT_RUN: E05-053, the D-020 slow-typing reorder.

Review: one pass over `1ff1c91..9d7178a`, verdict "Ready to merge: Yes". One Minor item: `errorCell` has no cap for an empty or very long message.

`run-gates.sh` ran every gate once at HEAD `9d7178a` (see `head.txt`), with e2e ports 4693/4694. Every gate exited 0, with no reruns. Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 333 files passed, 1 skipped; 5996 tests passed, 6 skipped |
| build | pass |
| e2e | 253 passed, 1 skipped (includes the WebKit #26 spec) |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | `scrub-check: clean` |
| help | 52 passed |
| cargo-test | 15 passed, 0 failed |
| diff-check | `git diff --check c7836fd HEAD` exit 0 |

**Frozen.** The freeze is the commit that adds these receipts; its product source equals `9d7178a`. Delivery: nothing pushed, no tag moved.
