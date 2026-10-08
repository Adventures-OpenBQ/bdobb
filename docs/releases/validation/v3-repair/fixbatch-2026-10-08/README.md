# v3 fix batch 2026-10-08 — receipts

Branch `claude/clean-v3-fixbatch` (worktree `bdobb-clean-v3-fixbatch`), base `3abc906` (D-005). Gates run at HEAD `3e4630d` (see `head.txt`).
Fixes: D-005 `3abc906` (no automatic grid compaction), D-008 (array group default joined), D-002 (browser smoke scoped to this line's seed; `test:web:browser` in CI after `build:web`).

Gates were run once by `run-gates.sh`; every gate exited 0. No reruns, so no composite evidence. Host load average (1/5/15 min) per gate is in `gates.tsv` (e.g. unit 173/370/402, e2e 107/306/375, web-browser 76/243/343).

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 5s |
| lint | pass | 3s |
| unit | pass | 148 files passed, 1 skipped; 2907 tests passed, 7 skipped; 63s |
| build | pass | 8s |
| e2e | pass | 91 passed, 0 failed, 1 skipped; 88s |
| web | pass | 31 pass, 0 fail; 1s |
| build-web | pass | 6s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 3s |
| cargo | pass | `cargo check --locked --offline -j 2` finished; 79s |
| scrub | pass | `scrub-check: clean`; 4s |
| help | pass | 6 files, 51 tests passed; 11s |

Tip-merge check (`tip-merge-web-browser.log`): `codex/clean-v3-repair` at e8bdb7ca181858ff052e4da564bff176ee2df795 merged with this branch cleanly (no conflicts; 5 files changed, including `src/lib/appsJson.ts` and `web/browser-smoke.mjs`) on a throwaway detached worktree, since removed. After the merge `pnpm build:web && pnpm test:web:browser` printed `PASS: ...` and `exit 0`; `appsJson.d008.test.ts` and `DashboardGrid.layout.test.tsx` passed (2 files, 4 tests).

Delivery: these commits are NOT on `codex/clean-v3-repair`. That branch has diverged (Workspace connection programme) and its checkout holds another workstream's uncommitted edits. That workstream merges `claude/clean-v3-fixbatch` when ready. v4, v5 and v6 take this branch by merge (`refs/integration/v3-fixbatch-2026-10-08`). No tag moved.
