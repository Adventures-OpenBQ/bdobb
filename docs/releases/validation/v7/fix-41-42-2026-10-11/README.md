# v7 #41 and #42 re-freeze 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v7`, on top of the v7 freeze `e02c578` (`v7-freeze-2026-10-11/`).

| Commit | What |
|---|---|
| `60c0c21` | Real merge of the v6 #41 freeze `d919921`, with no conflicts. v7 changes no store and adds no dashboard writer, so `dashboardRevision.test.ts` needs no v7 additions. The fix is in `docs/releases/validation/v4-integration/fix-41-2026-10-11/`. |
| `e99ab3e` | bdobb#42. The touch example's gesture note said "**Escape**/again to restore", while `help/topics/ipad.md` says double-tap again restores the card. The note now reads "**Double-tap** a card title to maximize, and again to restore." `src/help/guide.test.ts` checks both texts, and failed first (`red-guide-test.log`). openbq-docker serves a copy of this example; it needs `pnpm apps:sync` and a commit in that repo. |
| `e6ca878` | Real merge of the v6 full-suite freeze `b9a893f`, with no conflicts. It brings the `pivot-group-durable.spec.ts` update: a durable Pivot Undo restores content at a higher revision. |

Every gate is v7's full set (`v7-freeze-2026-10-11/run-gates.sh`) plus the revision test. `run-gates.sh` is the script that was run.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7105 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 271 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 72 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the v6 and v7 receipts. |
| notices-check | up to date |
| dashsync | 7 passed (includes "removing a tab reaches the server") |
| ios-check | toolchain complete |
| ios-sim | built, installed and launched on the iPad simulator |
| diff-check | `git diff --check e02c578 HEAD`, excluding receipt logs and `src-tauri/vendor/`: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
