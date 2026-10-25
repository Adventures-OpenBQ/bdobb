# v5 card extensions fix 2026-10-12 — receipts (NOT FROZEN)

Branch `claude/fix-card-extensions-v5`, on top of the freeze `0594494`.

| Commit | What |
|---|---|
| `d49801d` | `persistedCard` (from `9e00707`) whitelisted the card fields it writes and left out `extensions`. A card downloaded from a Workspace server lost `extensions.workspace` on its first save: after a restart it had no server widget id, no storage and no unknown sibling keys, and the next sync uploaded a minimal widget record under the card's local id. A dashboard copy (`remapWidgetReferences`) lost it the same way. `extensions` is now written as a detached copy of plain JSON data. Functions, accessors (never invoked), symbols, cycles and non-plain objects are never written. Every other field keeps the whitelist. Failed first (`red-card-extensions.log`: 3 failed, 27 passed). |

**Other paths checked.** `copyCardTo`/`duplicateCard` clone the whole card and already kept `extensions`. apps.json import/export never carries card `extensions`, by design, and `appsExtensionsV3.test.ts` already asserts that. The dashboard-level `extensions` was already persisted.

**Same defect on v4 (not fixed here).** v4's `persistedCard` (from `c7f59d1`) has the same whitelist, and v4 has carried Workspace sync since `049ff5e`. The new save/reload test fails there in the same way. Fixing it is the user's call.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | 6211 passed, 7 skipped |
| build | pass |
| scrub | scrub-check clean, header-check clean |
| e2e-sync | `dashboard-sync`, `dashboards`, `workspaces`: 32 passed, 7 skipped. The 7 are the opt-in dashboard-sync spec: this machine has no local key-mode server and no `.env.dashsync-test.local`. Chromium 1194 was used through a local config that sets only `executablePath`. That config is not committed. |
| diff-check | `git diff --check 0594494 HEAD`, excluding receipt logs: exit 0 |

**Not frozen.** These are gate receipts only. Re-freezing, the v5.0.0 tag and delivery wait for the user. Nothing was pushed to release/* and no tag moved.
