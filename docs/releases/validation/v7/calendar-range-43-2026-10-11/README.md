# v7 Calendar range and bdobb#43 merge 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v7`, on top of the freeze `05cd6d7` (`coverage-backports-2026-10-11/`).

| Commit | What |
|---|---|
| `8a36930` | Real merge of the v6 freeze `e0c0a0c`, with no conflicts. It brings v4's fix (a Static calendar draws a date-expression range instead of crashing) and the corrected Calendar help. It also brings v5's Episode 5 Treasury example with its results card Static, checked live against the local stack, and v6's bdobb#43: every not-completed tool result is classified once, Deny reads "Denied" and is counted, Stop reads "Stopped" and is not. See those lines' receipts for the failing-first evidence. |

Every gate is v7's full set plus the revision test.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7157 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 273 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 82 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the v6 and v7 receipts. |
| notices-check | up to date |
| dashsync | 7 passed |
| ios-check | toolchain complete |
| ios-sim | built, installed and launched on the iPad simulator |
| diff-check | `git diff --check 05cd6d7 HEAD`, excluding receipt logs and `src-tauri/vendor/`: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
