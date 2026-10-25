# v5 Workspace connection carry 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`. The v4 line at `2bbde09` (v4 merge `f155836` of `refs/integration/v3-workspace-2026-10-09` = v3 `3ff64a6`, plus its receipts) was merged as `2d55644` (parents `4cf5663`, `2bbde09`). Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `2d55644` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`, once each. Every gate exited 0; there were no reruns, so there is no composite evidence. Host load was very high, from about 200 to above 700 (per-gate load is in `gates.tsv`). `$HOME` is written as `<home>` in the logs.

Conflicts, each resolved by keeping both sides: `src/lib/bootstrap.ts` (v5 `workspaces` and `layouts` loaders plus the v3 `workspace connections` loader; v5's `workspacesStore`/`workspaces/` and v3's `workspaceStore`/`workspace.json` are separate), `src/lib/settingsFile.ts` (`workspaceOrder` and `settingsStorage`), `src/lib/settingsBundle.ts` (both excluded from the bundle), `docs/user-guide.md` (v5 text plus the User Settings sentence).

Help shots `connections`, `settings-and-logs` and `workspace-account` were regenerated on v5 with `pnpm help:shots --only <slug>`; they came out byte-identical to the merged copies, since v5 never changed those dialogs, so no shot changed.

No assertion was changed on this line.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 68s |
| lint | pass | 45s |
| unit | pass | 330 files passed, 1 skipped; 5940 tests passed, 6 skipped; 747s |
| build | pass | 35s |
| e2e | pass | 247 passed, 1 skipped; 739s |
| web | pass | 31 pass, 0 fail; 2s |
| build-web | pass | 18s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 5s |
| cargo | pass | 1s |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |

Not verified: a live Workspace server and the native packaged app.

Delivery: nothing pushed, no tag moved.
