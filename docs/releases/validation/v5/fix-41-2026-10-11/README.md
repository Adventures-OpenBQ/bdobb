# v5 #41 dashboard revision guard 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v5-18-first-open`, on top of the v5 freeze `6c9f676`. Audit ruling 2026-10-11: fix bdobb#41 at v4 and real-merge it up v5 → v6 → v7. See `docs/releases/validation/v4-integration/fix-41-2026-10-11/` for the fix and its failing-first evidence.

| Commit | What |
|---|---|
| `fd30ac7` | Real merge of the v4 freeze `f7158b9`. The one conflict was `addDashboard`: it keeps v5's `activeTabIds` and writes through `saveAsIs`. The store again calls `saveDashboard` only inside `saveEdit` and `saveAsIs`. |

**v5's extra actions.** v5 adds no new store functions; classification still covers 47 functions. Its new forms act on the dashboard they name, or on the one that owns the tab, card or group: `addTab`, `renameGroup`, `deleteGroup`, `savePreset` and `deletePreset` with a dashboard id, plus the owner-routed tab, card and group actions. All of them go through `mutateDashboard`, which bumps the revision. `dashboardRevision.test.ts` now drives 17 of these forms while another dashboard is active. Each must raise the target's revision, with memory and disk agreeing, and leave the active dashboard untouched. They passed on the first run because v5 adds no direct saves; the red run is v4's.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 6187 passed, 7 skipped |
| revision-test | 51 passed |
| dashsync | 7 passed (includes "removing a tab reaches the server") |
| notices-check | up to date |
| diff-check | `git diff --check 6c9f676 HEAD`, excluding receipt logs: exit 0 |
| scrub | scrub-check and header-check clean |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
