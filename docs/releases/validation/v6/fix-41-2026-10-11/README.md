# v6 #41 dashboard revision guard 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v6`, on top of the v6 freeze `ee24ca2`. Audit ruling 2026-10-11: fix bdobb#41 at v4 and real-merge it up v5 → v6 → v7. The fix and its failing-first evidence are in `docs/releases/validation/v4-integration/fix-41-2026-10-11/`, and the v5 additions are in `docs/releases/validation/v5/fix-41-2026-10-11/`.

| Commit | What |
|---|---|
| `415603a` | Real merge of the v5 freeze `5b031db`, with no conflicts. |

**v6's extra actions.** None in the store: v6's `dashboardStore.ts` is v5's. Nothing outside the store writes `dashboards/<id>.json`; `migrate.rs` only copies the data folder. Rita's tools call only store actions that `dashboardRevision.test.ts` already classifies and drives: addCardTo, applyCardParams, patchCardField, removeCard, removeDashboard, removeTab, renameDashboard, renameTab, undoCardRemoval and updateLayouts. So the test needs no v6 additions.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7047 passed, 29 skipped |
| revision-test | 51 passed |
| dashsync | 7 passed (includes "removing a tab reaches the server") |
| notices-check | up to date |
| diff-check | `git diff --check ee24ca2 HEAD`, excluding receipt logs: exit 0 |
| scrub | scrub-check and header-check clean |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
