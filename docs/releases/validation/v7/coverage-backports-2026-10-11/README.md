# v7 coverage-audit back-ports 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v7`, on top of the freeze `8eb9ff6` (`fix-41-42-2026-10-11/`). A commit-level audit of every bdobb-v2 ref found gaps on every line; v4 through v6 were fixed and re-frozen first. User ruling 2026-10-11: dev v8–v15 stays out, a fix belongs to its feature's version, and the iPad build (with its vendored swift-rs) is approved.

| Commit | What |
|---|---|
| `c761815` | Dev iPad guide pages: **Installing on iPad** and **iPad interface differences**, in a new iPad section of the guide (40 pages). Every claim was checked against clean v7: its bundle id, `pnpm ios:*` scripts, `scripts/ios.sh` and data folders. Failed first (`red-ipad-guide.log`). The Apple install gates are carried from dev, because the v7 receipts qualify `ios:check` and `ios:sim` only. |
| `8746c83` | `provenance.md` records the back-port and the approved iPad build with vendored swift-rs. |
| `f7b89bc` | Real merge of the v6 freeze `88d297f`, which carries the v4, v5 and v6 back-ports. Four conflicts, each resolved by keeping both sides. |

Every gate is v7's full set plus the revision test. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7141 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 271 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 80 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the v6 and v7 receipts. |
| notices-check | up to date |
| dashsync | 7 passed |
| ios-check | toolchain complete |
| ios-sim | built, installed and launched on the iPad simulator |
| diff-check | `git diff --check 8eb9ff6 HEAD`, excluding receipt logs and `src-tauri/vendor/`: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
