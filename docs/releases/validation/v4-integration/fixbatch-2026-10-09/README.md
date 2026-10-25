# v4 fix batch 2026-10-09 — receipts

Branch `codex/clean-v4-integration`. The D-011 and D-014 fix is `9d23239` (parent `1a97fcf`). Gates were run by `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh` at HEAD `9d23239` (see `head.txt`), with `BDOBB_BROWSER_PORT=4393 BDOBB_MOCK_PORT=4394`. Host load (1/5/15 min) per gate is in `gates.tsv`. `$HOME` is written as `<home>` in the logs.

No existing assertion was changed on this line. The new tests are listed in v4-integration.md.

| Gate | Result | Notes |
|---|---|---|
| typecheck | pass | 12s |
| lint | pass | 10s |
| unit | pass | 306 files passed, 1 skipped; 5426 tests passed, 6 skipped; 199s; first run, no rerun |
| build | pass | 13s |
| e2e | pass (composite) | Full run: 214 passed, 1 skipped, 1 failed (`e2e.log`). The failure was `documents.spec.ts:252`, the PDF find bar: `.pdf-page-count` did not appear within 5s at load average about 65. Rerunning `e2e/documents.spec.ts` alone passed 10/10 in 27s (`e2e-rerun-documents.log`). The spec does not touch the table engine. |
| web | pass | 1s |
| build-web | pass | 9s |
| web-browser | pass | `PASS: HTTPS login form, ... no external requests.`; 6s |
| cargo | pass | 2s |
| scrub | pass | `scrub-check: clean` |
| help | pass | 6 files, 51 tests passed |

Delivery: nothing pushed, no tag moved.
