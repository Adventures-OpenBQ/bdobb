# v5 Workspace connection carry 2026-10-09 (second merge) — receipts

Branch `codex/clean-v5-reconciled`. The v4 line at `3ef75a3` (v4 ticker fix `3325bd5`; v4 merge `fea9132` of v3 `e8ab841`, which brings `f2da5db` User Settings first in General and the v3 ticker fix; receipts `3ef75a3`) was merged as `0417e57` (parents `06d1e08`, `3ef75a3`), with no conflicts. v3 `b6c0ce7` (BDOBB2 → BDOBB rename) is not included. Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `0417e57` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`, once each. Every gate exited 0; there were no reruns, so there is no composite evidence. Host load was high, about 140 to 210 (per-gate load is in `gates.tsv`). `$HOME` is written as `<home>` in the logs.

Help shots `settings-and-logs`, `workspace-account` and `connections` were regenerated on v5; they came out byte-identical to the merged v4 copies, so no shot changed.

No assertion was changed on this line.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 11s |
| lint | pass | 9s |
| unit | pass | 330 files passed, 1 skipped; 5943 tests passed, 6 skipped; 168s |
| build | pass | 12s |
| e2e | pass | 247 passed, 1 skipped; 564s |
| web | pass | 31 pass, 0 fail; 3s |
| build-web | pass | 20s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 35s |
| cargo | pass | 2s |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |

Not verified: a live Workspace server and the native packaged app.

Delivery: nothing pushed, no tag moved.
