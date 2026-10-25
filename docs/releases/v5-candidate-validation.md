# V5 candidate validation

This evidence covers isolated `codex/clean-v5`, copied from unqualified v4 commit `c7f59d129055f38d2594c7c9c83c479ec9c9172e`. It does not qualify the incoming #344/#345 changes or authorize publication. [Integration requirements](v5-v4-integration-checklist.md).

| Gate | Current evidence |
| --- | --- |
| Unit diagnostic | 5,545 passed, 13 failed, 6 skipped; corrected App fixture covered by 38/38 retry and shell launcher timeouts by serial 16/16 retry with 60-second budget |
| Baseline repairs | Six added behavioral cases observed failing before repair; audit/date 174/174 and broader owning regression 631/631 passed |
| Chromium diagnostic | 204 passed, 7 failed, 1 opt-in skip; repaired seven cases and owning Workspace/Statement/Pivot flows covered by 72/72 current retry |
| Reference | 6/6 contracts; 71/71 curated widgets rendered; Run gating and numeric refresh passed |
| OpenBQ Docker | 9/9 rendered |
| Web contracts | 31/31 passed |
| Native | Rebuilt candidate with isolated identity; fresh profile creates settings without warning. File → New Workspace… creates a workspace that survives quitting/restarting |
| Documentation/source checks | Help 17/17; six fresh screenshots generated and Workspace image inspected; typecheck, lint, scrub and diff checks passed |
| Review | One whole-branch review; all three important findings repaired and owning tests passed |

Unit/browser qualification is cumulative across the diagnostic and named retries, not a single all-green full run. Six opt-in reference cases skipped in the ordinary unit run passed separately. Physical iPad qualification belongs to the later release plan.

Reference receipts are retained under [validation/v5-candidate](validation/v5-candidate/reference-render-results.json). [Log hashes](validation/v5-candidate/log-hashes.json) identify local raw logs without publishing their fixture content. Commands use the candidate-local tools: Vitest with 1–2 workers and `--testTimeout=60000` for launcher fixtures; Playwright against stable ports 4273/4274; reference-render/reference-controls/openbq-smoke scripts against the existing local containers; native `tauri build` with local node_modules/.bin on PATH.

Before final v5: integrate qualified v4 on corrected v3, reconcile #344 core Statement templates and #345 controls, obtain successful changed LocalTableRenderer.execution.test.tsx evidence, then rerun cumulative release gates and update screenshots. No push, rename, or final v4/v5 tag performed.
