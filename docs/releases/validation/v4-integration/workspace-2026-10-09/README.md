# v4 Workspace carry 2026-10-09 — receipts

Branch `codex/clean-v4-integration`. The v3 line `codex/clean-v3-repair` at `3ff64a6` was merged onto `ae3d540` (the 2026-10-09 D-011/D-014 fix batch) as `f155836` (parent 2 is `3ff64a6`, through `refs/integration/v3-workspace-2026-10-09`). It carries the Workspace connection feature, #7, #8, #9, #10 and the allowed-code-languages removal. `run-gates.sh` (this directory) ran every gate once at HEAD `f155836` (see `head.txt`), using e2e ports 4683/4684. Every gate exited 0; there were no reruns, so there is no composite evidence. Host load average (1/5/15 min) per gate is in `gates.tsv` (for example unit 214/149/106, e2e 243/245/170). Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

USER-APPROVED CHANGES (2026-10-09):
- Ruling A: `e2e/pivot-table-frame.spec.ts` no longer asserts that a 1400 px card fits the worker table. The table is as wide as its columns (bdobb#10). Overflow equals the column sizes minus the visible width, and the chip shows while the table overflows.
- Ruling B: on theme `"system"`, the Workspace upload writes the OS appearance into the top-level `theme`; `extensions.bdobb` keeps `"system"`. Spec Upload step 2 is amended.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 20s |
| lint | pass | 15s |
| unit | pass | 309 files passed, 1 skipped; 5600 tests passed, 6 skipped; 340s |
| build | pass | 20s |
| e2e | pass | 215 passed, 1 skipped; 609s |
| web | pass | 31 pass, 0 fail; 2s |
| build-web | pass | 16s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 35s |
| cargo | pass | `cargo check --locked --offline -j 2` finished; 2s |
| scrub | pass | `scrub-check: clean`; 3s |
| help | pass | 6 files, 51 tests passed; 5s |

Not verified: Workspace connections against a live server (key or login mode); native packaged app. Help shots regenerated on this host: workspace-account, settings-and-logs, connections.

Delivery: nothing pushed, no tag moved.
