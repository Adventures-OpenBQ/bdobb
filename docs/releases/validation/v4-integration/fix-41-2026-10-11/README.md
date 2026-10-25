# v4 #41 dashboard revision guard 2026-10-11 — receipts (RE-FREEZE)

Branch `claude/v4-18-first-open`, on top of the v4 freeze `645aac3`. Audit ruling 2026-10-11: fix bdobb#41 at v4, where it starts (v3 stays at `bcc11c7`, unaffected), then real-merge up v5 → v6 → v7.

**#41.** Dashboard edits saved without bumping `revision` never uploaded, and the next sync reverted them. Root cause: v4 added actions that call `saveDashboard` directly instead of going through `mutateDashboard`. Those actions are removeTab, removeCard, undoCardRemoval, addLinkedCard, commitLinkedChartSettings, replaceLinkedSource, commitTableDefinition, and Pivot group apply and undo.

| Commit | What |
|---|---|
| `77bc13f` | The store writes a dashboard file only through `saveEdit(next, prev)`, which writes it one revision on, or `saveAsIs`, which is for new dashboards, imports and the sync's own writes. Every direct save above now uses `saveEdit`, and memory takes the saved revision. |

**Tests (failed first).**
- **`src/stores/dashboardRevision.test.ts`** has three guards:
  1. The store calls `saveDashboard` exactly twice, inside the two helpers.
  2. Every function the store exposes is classified, 32 as content-mutating and 15 as not.
  3. Each mutating action is driven from a seeded dashboard at revision 5 and must raise the revision, with memory and disk agreeing. The Pivot group apply and undo run through the real table coordinator and worker proof.

  Against `645aac3`'s store, 10 of 34 fail: guard 1 and the nine direct-save actions (`red-revision-test.log`).
- **`e2e/dashboard-sync.spec.ts`** gains "removing a tab reaches the server". Against `645aac3`'s store the server kept 2 tabs (`red-dashsync.log`).
- **`tableCommitCoordinator.groups.test.ts`**: the push, edit and create round-trip now expects Undo to restore the content at a higher revision. Undo is an edit and must upload.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 5813 passed, 7 skipped |
| revision-test | 34 passed |
| dashsync | 7 passed |
| notices-check | up to date |
| diff-check | `git diff --check 645aac3 HEAD`, excluding receipt logs: exit 0 |
| scrub | scrub-check and header-check clean |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
