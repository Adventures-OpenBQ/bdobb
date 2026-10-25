# v6 Calendar range merge and bdobb#43 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v6`, on top of the freeze `88d297f` (`coverage-backports-2026-10-11/`).

| Commit | What |
|---|---|
| `02f9c28` | Real merge of the v5 freeze `0594494`, with no conflicts. It brings v4's fix (a Static calendar draws a date-expression range instead of crashing), the corrected Calendar help, and the Episode 5 Treasury example with its results card Static. |
| `1d567ad` | bdobb#43, audit ruling (a). `refusalOf` classifies every not-completed tool result in one place: any `error_type` (`user_declined`, `unsupported`, `fetch_failed`); status `refused`, `unavailable` or `error`; an `{ error }`; and agent-rita's `$rita_kind: "error"` item. A thrown failure is not counted twice. Deny shows "<tool> — Denied", counted as an error and ledgered "Denied". Stop mid-call shows an uncounted "<tool> — Stopped" step instead of a red transport failure. Failed first: `red-43-unit.log` (each shape and Stop), `red-43-chatstore.log` and `red-43-e2e.log` (Deny gives Denied and 1 error; Stop gives Stopped and 0 errors). |

Every gate is v6's full set plus the revision test and dashsync.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7097 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 273 passed (includes the Deny and Stop e2e) |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 77 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the earlier v6 receipts. |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 88d297f HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
