# v5 fix batch 2026-10-09 — receipts

Branch `codex/clean-v5-reconciled`. The v4 line (`ae3d540`: D-011 and D-014) was merged as `af73e52` (parents `b386285`, `ae3d540`), with no conflicts. Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `af73e52` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`, once each. Every gate exited 0; there were no reruns, so there is no composite evidence. Host load was high, at times above 350 (per-gate load is in `gates.tsv`). `$HOME` is written as `<home>` in the logs.

No assertion was changed on this line.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 10s |
| lint | pass | 7s |
| unit | pass | 327 files passed, 1 skipped; 5766 tests passed, 6 skipped; 323s |
| build | pass | 22s |
| e2e | pass | 247 passed, 1 skipped; 671s |
| web | pass | 3s |
| build-web | pass | 20s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 36s |
| cargo | pass | 1s |
| scrub | pass | `scrub-check: clean` |
| help | pass | 7 files, 52 tests passed |

Delivery: nothing pushed, no tag moved.
