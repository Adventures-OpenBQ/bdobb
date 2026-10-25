# v6 card extensions merge 2026-10-12 — receipts (NOT FROZEN)

Branch `claude/fix-card-extensions-v6`, on top of the freeze `e0c0a0c`.

| Commit | What |
|---|---|
| `6a63fa5` | Real merge of the v5 fix branch `d7a5073`, a clean merge. A saved card keeps its server `extensions` (widget id, storage, unknown sibling keys), so after a restart the next sync uploads the server's own widget record. The fix and its failing-first receipt are in `../../v5/card-extensions-2026-10-12/`. v6 adds no save or export path that rebuilds cards. |

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | 7100 passed, 29 skipped |
| build | pass |
| scrub | scrub-check clean, header-check clean |
| e2e-sync | `dashboard-sync`, `dashboards`, `workspaces`: 32 passed, 7 skipped. The 7 are the opt-in dashboard-sync spec: this machine has no local key-mode server and no `.env.dashsync-test.local`. Chromium 1194 was used through a local config that sets only `executablePath`. That config is not committed. |
| diff-check | `git diff --check e0c0a0c HEAD`, excluding receipt logs: exit 0 |

**Not frozen.** These are gate receipts only. Re-freezing, the v6.0.0 tag and delivery wait for the user. Nothing was pushed to release/* and no tag moved.
