# v4 scope-ruling provenance 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v4-18-first-open`, on top of the freeze `35b33ef` (`coverage-backports-2026-10-11/`).

| Commit | What |
|---|---|
| `cdca460` | `provenance.md` records the user's approval of dev v8+ items found in the clean lines. The Calendar view stays in v4, because it shipped in v4.0.0, on condition that readers first meet the calendar grid in Episode 5 (a v5 example). The Pivot aggregation suggestion and typed fold keys are approved. Rita's round setting (v6) and vendored swift-rs (v7) are recorded on their own lines. |

Every gate is v4's full set plus the revision test and dashsync.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 5815 passed, 7 skipped |
| revision-test | 34 passed |
| build | pass |
| e2e | 219 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 54 passed |
| cargo-test | 15 passed, 0 failed |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check 35b33ef HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
