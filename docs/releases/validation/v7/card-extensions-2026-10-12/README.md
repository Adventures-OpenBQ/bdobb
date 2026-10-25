# v7 card extensions merge 2026-10-12 — receipts (NOT FROZEN)

Branch `claude/fix-card-extensions-v7`, on top of the freeze `427fd91`.

| Commit | What |
|---|---|
| `ea64ec1` | Real merge of the v6 fix branch `7ee1127`, which carries the v5 fix `d49801d`. It was a clean merge. A saved card keeps its server `extensions` (widget id, storage, unknown sibling keys), so after a restart the next sync uploads the server's own widget record. The fix and its failing-first receipt are in `../../v5/card-extensions-2026-10-12/`. v7 adds no save or export path that rebuilds cards. |

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit (2 workers, 120 s) | First run: 7159 passed, 1 failed, 29 skipped. The failure was `PivotParamRow.viewer.test.tsx` › "viewer Page offers explicit All and empty…": it found no "None" button right after a click, under full-suite load. It does not touch persistence. In isolation it passes 16/16 (`unit-retry-pivot-viewer.log`). A full re-run passed everything: 7160 passed, 29 skipped (`unit-rerun.log`). No assertion was changed. |
| build | pass |
| scrub | scrub-check clean, header-check clean |
| e2e-sync | `dashboard-sync`, `dashboards`, `workspaces`: 32 passed, 7 skipped. The 7 are the opt-in dashboard-sync spec: this machine has no local key-mode server and no `.env.dashsync-test.local`. Chromium 1194 was used through a local config that sets only `executablePath`. That config is not committed. |
| diff-check | `git diff --check 427fd91 HEAD`, excluding receipt logs: exit 0 |

**Not frozen.** These are gate receipts only. Re-freezing, the v7.0.0 tag and delivery wait for the user. Nothing was pushed to release/* and no tag moved.
