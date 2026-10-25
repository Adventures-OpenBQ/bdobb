# v6 v5 merge + home-path scrub 2026-10-10 — receipts (FREEZE)

Branch `codex/clean-v6`, on top of the frozen `ef51000` (#39, #37, #40) and the #37 call-log follow-up `7a02cec` (from the v6-log-successful-proxied-calls session). This freeze supersedes `ef51000`.

| Commit | What |
|---|---|
| `894079c` | Merge of frozen v5 `5f5aaa5` (on the v5.0.0 re-cut `91d86ed`). Brings in #38 (long-form backend Statement), #30 (reference-acceptance teardown uses `ignoreErrors`), #5 (v6 already had the code from `6ea6eb4`; this adds the clearing test and the help text) and the v3–v5 home-path scrub with its `scrub-check` rule. #38's view-offer step is applied in `src/lib/cardViews.ts` `availableViews()`, where v6 moved the view list. v6's own `.backend-badge` CSS is kept. The 32 conflicting receipt logs are taken from v5, as scrubbed. |
| `b8aa50a` | v6 scrub: 28 logs under `docs/releases/validation/v6/` and the plans part-a (with its scratchpad path), part-c and 2026-10-08-clean-line-fix-batch. The home rules no longer match after a host or path character, so the ECB URL `…europa.eu/home/…` in a captured apps.json passes (new test, failed first). The made-up `/Users/me/Notes` in three share-target test lines carries `scrub-allow`. |

#31 (`5c9e2a1`) was already in v6 and was verified by the regression run.

Review: one pass over `894079c` and `b8aa50a`, ready, with no Critical or Important issues. Minor, not done: `possibleViews()` (#40's pre-data view list) offers Statement for any table without the long-form check. It is a superset of `availableViews()`, so it hides nothing.

`run-gates.sh` ran every gate once at `b8aa50a` (see `head.txt`), one after another, at a load average of about 450–590. Ports: e2e 4397/4398, WebKit 4797/4798.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 394 files passed, 5 skipped; 6878 tests passed, 28 skipped |
| build | pass |
| e2e | 268 passed, 1 skipped, **1 failed**: `documents.spec.ts:159` (maximized PDF scroll-to-top) timed out at 30 s under load. No change in this batch touches it or `src/components/renderers`. Rerun alone with `--repeat-each=3`: 3/3 pass (`e2e-rerun-documents-159.log`). Recorded as composite. |
| web | 31 pass, 0 fail |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed in the run only on this run's own unscrubbed logs. After they were scrubbed: `scrub-check: clean` (`scrub-rerun.log`). |
| help | 65 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the `fixbatch-2026-10-10b` and `-10c` receipts: Playwright WebKit on macOS never Tabs onto buttons. |
| diff-check | `git diff --check ef51000 HEAD` over everything except the receipt logs (raw tool output), exit 0 |

Absolute paths in the logs are replaced with `<worktree>` / `<scratch>` / `~`.

**Frozen.** The freeze is the commit that adds these receipts; its source equals `b8aa50a`. Delivery: nothing pushed, no tag moved.
