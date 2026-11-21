# Shared Acquisition Backport and V10 Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Backport the reviewed shared daily-price refusal fixes to the open v9 PR, then publish the v10 chart changes with test/review evidence and green CI on both PRs.

**Architecture:** Select only acquisition/refusal changes from v10 product commit `750f7831` and the earlier recognized-invalid-receipt guard, adapting them to existing v9 APIs. Preserve the v9 chart admission boundary. Publication follows independent review and verification; choose the v10 PR base using current repository history and the user's answer.

**Tech Stack:** Existing TypeScript, React, Vitest, compiled Rust/WASM, Playwright and GitHub Actions. No dependency upgrades.

**Spec:** Existing approved `2026-11-20-v9-live-observed-returns-design.md` in this directory's sibling `specs/`, plus the user's explicit backport/publication instruction. The implemented v10 approved design and independent review are preserved on local `codex/v10-live-price-views` at `9bbb593a`.

## Global Constraints

- V9 branch `codex/v9-live-observed-returns`, PR #89, targets `release/v9`; initial head `a8d0d5be`.
- V10 implementation branch `codex/v10-live-price-views` initially at `9bbb593a`. Preserve all reviewed code and independent-review records.
- Backport only shared acquisition safety: explicit partial/paging markers, rejected opted-in evidence through table/executor/linked boundaries, and refusal of invalid live-to-snapshot fallback. No v10 live histogram/drawdown/small-multiple admission in v9.
- Refusal-only facts must never grant authority or globally promote completeness; retain ordinary table rows/completeness and legitimate local snapshots. Strip live authority from portable exports.
- Provider/Docker remain unchanged. User authorized pushes and PR metadata, not merging or deploying.
- Current `release/v10` has unrelated history and lacks chart recipes. User input is pending on stacked PR versus expanding to port the foundation; dependent publication waits for that answer. Continue v9 independently.
- Reuse the existing isolated client worktree and available dependencies; preserve prior archived evidence and other workspaces.

## Review Focus

1. Failed HTTP capture must retain a refusal fact rather than becoming an apparently complete snapshot.
2. Refusal must survive actual TypeScript and compiled Rust projections and linked children.
3. Positive qualified live, ordinary tables, and documented local snapshots retain prior behavior.
4. V9 Parameters and worker must agree on refusing rejected evidence.
5. V10 publication must not introduce an unrelated-history merge or an accidental v10 feature backport to v9.

### Task 1: Backport shared safety with independent review

**Files:** Existing `src/lib/{dataClient,localTableData}.ts`, `src/lib/widgetData/chartRecipes/{financialEvidence,chartSourceContracts,dailyPriceEvidence,input,priceSamples}.ts` as needed, relevant existing evidence/engine/controls tests, and `docs/releases/validation/v9/live-observed-returns/acquisition-backport.md`.

**Interfaces:** Retain v9 `prepareLiveReturnPrices`/`admitReturnSummary` signatures and existing saved settings. Adapt the reviewed refusal-only `dailyPriceRejected` metadata and response checks from `750f7831`; no live three-view helpers or sourceMode additions required.

- [ ] Establish RED through the real HTTP acquisition and table path for root partial marker, result-metadata cursor, and nested complete legacy snapshot on the opted-in route. Include positive live and ordinary/local snapshot controls.
- [ ] Apply the smallest shared fix. Retain recognized invalid live receipt refusal, optional-registry compatibility, provider/table omission validation, and projection/export rules. Keep v9 box/violin as the only live consumers.
- [ ] Exercise both actual engines and linked inputs, plus Parameters rejection where affected; run focused tests and existing live/installed return browser checks in Chromium/WebKit on both engines with zero retries.
- [ ] Run required full client tests, type/lint/Knip/scrub, Rust/WASM/package and production build checks. Record commands, failures/reruns and optional skips accurately.
- [ ] Self-review and commit; fresh independent reviewer checks the backport diff against source fixes and preserved v9 behavior. Address blocking findings and verify before publication. Write portable evidence without machine-specific paths.

### Task 2: Publish both PRs and follow CI

**Files:** PR bodies and any necessary integration/CI fixes; portable publication evidence under the corresponding release validation directory.

**Interfaces:** User-authorized Git pushes and GitHub PR update/create operations. Controller performs external writes and CI follow-through; implementation agents do not publish.

- [ ] Update PR #89 with backport test totals and independent review, preserve prior qualification history, and push its branch without force.
- [ ] Apply the user's v10 base choice. If stacked, merge the updated v9 prerequisite locally into v10, resolve only demonstrated conflicts, verify the feature delta, and retain version/release caveats. If the user requests a full release/v10 port, first map and implement the missing foundation on that history with separate validation; no unrelated-history merge.
- [ ] Push v10 without force and create or update its PR with scope, prerequisite, exact tests and independent reviews; attach both PRs to this chat.
- [ ] Check actual-head CI on both PRs to completion. Investigate failures with Superpowers systematic debugging, correct root causes, rerun affected checks, push and continue until required checks succeed or a demonstrated external blocker requires user action.
- [ ] Record final PR URLs, heads and check results; leave PRs open for review.
