# V10 Stacked Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reconcile the implemented v10 live-price views with the latest reviewed v9 fixes, verify and independently review the result, then publish a stacked client PR and finish CI without merging v9.

**Architecture:** Merge the existing v9 feature branch into the local v10 feature branch, resolving overlapping acquisition and browser-fixture changes while retaining both sets of behavior. The new PR targets the v9 feature branch, so its diff contains the v10 extension. Release integration remains a separate operation.

**Tech Stack:** Existing TypeScript, Plotly, Playwright, TypeScript/Rust table engines and pnpm tooling; no dependency upgrades.

**Spec:** User's explicit reconciliation/publication instruction; existing design `docs/superpowers/specs/2026-11-21-v9-live-price-views-design.md` and implementation plan `docs/superpowers/plans/2026-11-21-v10-live-price-views.md` define unchanged v10 scope.

## Global Constraints

- Local v10 starts at `9bbb593ab6726a595cebbaa6620682c60849db1c`; integrate v9 `bf67cf72eb9c926627e30ac6ab166ee5361714bd` and preserve both histories.
- Work only on `codex/v10-live-price-views` in the existing isolated client worktree. Do not move or push the v9 branch.
- Keep client #89, provider #6 and Docker #33 OPEN and unmerged. No release-branch merges, deployment, image publication or provider/Docker source changes.
- Stack the new client PR onto `codex/v9-live-observed-returns`, not the unrelated `release/v10`. State dependency and later integration requirements in its body.
- Preserve v10 histogram, drawdown and small-multiple behavior, closed Parameters examples, real stores/workers, negative-evidence lineage, transport admission and existing assertions. Do not increase retries/timeouts or add skips to obtain a pass.
- Pair verification with provider `75a902664054b3afbd23c5b6328efe7eedcf429c` and Docker `3a9fc20e4b2257e98a0a4cb15ed8e924f2d6fe1d`. Existing captures are replay evidence; do not claim fresh upstream qualification.
- No `.codegraph/` exists; do not index. Preserve older diagnostics, archives and recovery files. Never run the default external catalog generator.

## Review Focus

- Both engines and linked descendants preserve refusals after invalid opted-in acquisition.
- Partial/paged HTTP and insufficient cross-origin header exposure cannot qualify any of the live price views.
- Combined Parameters adapter lookup preserves optional registries, chart disclosures and queued-save protection.
- Refactored installed replay fixtures retain transport and numerical assertions for both return summaries and v10 views.
- Pivot test delivery keeps the reviewed document-owned real-store update and unchanged UI/persistence assertions.

### Task 1: Reconcile and qualify the combined branch

**Files:** Overlapping acquisition contracts, `src/lib/dataClient.ts`, chart recipes, Parameters controls, executor tests, `e2e/fixtures/return-summary.ts`, installed/live return and price-view specs; merge reviewed pivot helper/specs unchanged. Update `docs/releases/validation/v10/live-price-views/verification.md` with a clearly separated reconciliation record.

**Interfaces:** Consume both fixed branch heads. Produce a committed branch containing v9 as ancestor and the original v10 behavior, with raw test evidence and a self-review report.

- [x] Inspect both sides of each overlapping change, then merge the exact v9 head with normal history. Resolve conflicts by preserving both tested contracts rather than selecting one side wholesale.
- [x] Run existing regression tests that distinguish the transport/refusal and optional-adapter behaviors. If a regression is discovered, follow systematic debugging and demonstrate RED/GREEN before its minimal fix.
- [x] Run `pnpm test:run`, typecheck, lint, Knip, scrub, web tests, WASM verification/packaging and both production builds; record counts, warnings and failures honestly.
- [x] Run v10 synthetic and installed-replay price-view suites on Chromium/WebKit and both table engines, plus the affected v9 transport/return-summary tests and 17 pivot inspector/cascade cases with retries disabled. Use isolated ports/servers; preserve first-failure evidence.
- [x] Update portable verification and pairing notes, inspect the stacked diff, commit and report exact heads, commands, results and limitations. Do not push or create PRs; controller owns publication.
- [x] Obtain fresh independent review of the combined source, stacked diff, conflict resolutions and evidence. Address blocking findings and verify corrections before publication.

### Task 2: Publish the stacked PR and finish hosted CI

**Files:** Portable independent-review record and new client PR metadata; no v9 source changes.

**Interfaces:** Consume reviewed combined head. Produce the stacked PR URL, exact-head completed CI and verified unmerged state of the three v9 PRs.

- [ ] Record the independent review and use a normal push for `codex/v10-live-price-views`.
- [ ] Create the client PR against `codex/v9-live-observed-returns` with scope, dependency, test counts, independent review and qualification limits.
- [ ] Follow exact-head hosted CI to completion, inspect browser retry/flake counts and investigate any failures with systematic debugging; independently review new code fixes.
- [ ] Verify the published head, worktree cleanliness and all v9 PRs OPEN/unmerged. Preserve diagnostics and report the new PR and final results.
