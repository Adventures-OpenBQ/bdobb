# Shared Acquisition Backport and V9 PR Updates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Backport the reviewed shared daily-price refusal fixes to the existing v9 PRs, update their evidence, and check CI. The user subsequently deferred v10 publication and explicitly requested leaving all PRs unmerged.

**Architecture:** Select only acquisition/refusal changes from v10 product commit `750f7831` and the earlier recognized-invalid-receipt guard, adapting them to existing v9 APIs. Preserve the v9 chart admission boundary. Update the existing v9 PRs after independent review and verification, and leave them open for review.

**Tech Stack:** Existing TypeScript, React, Vitest, compiled Rust/WASM, Playwright and GitHub Actions. No dependency upgrades.

**Spec:** Existing approved `2026-11-20-v9-live-observed-returns-design.md` in this directory's sibling `specs/`, plus the user's explicit backport/publication instruction. The implemented v10 approved design and independent review are preserved on local `codex/v10-live-price-views` at `9bbb593a`.

## Global Constraints

- V9 branch `codex/v9-live-observed-returns`, PR #89, targets `release/v9`; initial head `a8d0d5be`.
- V10 implementation branch `codex/v10-live-price-views` initially at `9bbb593a`. Preserve all reviewed code and independent-review records.
- Backport only shared acquisition safety: explicit partial/paging markers, rejected opted-in evidence through table/executor/linked boundaries, and refusal of invalid live-to-snapshot fallback. No v10 live histogram/drawdown/small-multiple admission in v9.
- Refusal-only facts must never grant authority or globally promote completeness; retain ordinary table rows/completeness and legitimate local snapshots. Strip live authority from portable exports.
- Provider receipt/source stays unchanged. A verified browser transport gap additionally requires explicit Link, Content-Range and Access-Control-Expose-Headers exposure in the paired Docker API overlay; preserve origins/auth/credentials. User authorized existing v9 PR updates, not merging or deploying.
- Current `release/v10` has unrelated history and lacks chart recipes. The user superseded the pending base question by limiting this run to v9 shared-issue updates. Do not publish or integrate v10 in this run.
- Reuse the existing isolated client worktree and available dependencies; preserve prior archived evidence and other workspaces.

## Review Focus

1. Failed HTTP capture must retain a refusal fact rather than becoming an apparently complete snapshot.
2. Refusal must survive actual TypeScript and compiled Rust projections and linked children.
3. Positive qualified live, ordinary tables, and documented local snapshots retain prior behavior.
4. V9 Parameters and worker must agree on refusing rejected evidence.
5. Updates stay on the existing v9 PRs, with v10 implementation and review preserved on its local branch.

### Task 1: Backport shared safety with independent review

**Files:** Existing `src/lib/{dataClient,localTableData}.ts`, `src/lib/widgetData/chartRecipes/{financialEvidence,chartSourceContracts,dailyPriceEvidence,input,priceSamples}.ts` as needed, relevant existing evidence/engine/controls tests, and `docs/releases/validation/v9/live-observed-returns/acquisition-backport.md`.

**Interfaces:** Retain v9 `prepareLiveReturnPrices`/`admitReturnSummary` signatures and existing saved settings. Adapt the reviewed refusal-only `dailyPriceRejected` metadata and response checks from `750f7831`; no live three-view helpers or sourceMode additions required.

- [ ] Establish RED through the real HTTP acquisition and table path for root partial marker, result-metadata cursor, and nested complete legacy snapshot on the opted-in route. Include positive live and ordinary/local snapshot controls.
- [ ] Apply the smallest shared fix. Retain recognized invalid live receipt refusal, optional-registry compatibility, provider/table omission validation, and projection/export rules. Keep v9 box/violin as the only live consumers.
- [ ] Exercise both actual engines and linked inputs, plus Parameters rejection where affected; run focused tests and existing live/installed return browser checks in Chromium/WebKit on both engines with zero retries.
- [ ] Run required full client tests, type/lint/Knip/scrub, Rust/WASM/package and production build checks. Record commands, failures/reruns and optional skips accurately.
- [ ] Self-review and commit; fresh independent reviewer checks the backport diff against source fixes and preserved v9 behavior. Address blocking findings and verify before publication. Write portable evidence without machine-specific paths.

### Task 2: Update existing v9 PRs and follow CI

**Files:** PR bodies and any necessary integration/CI fixes; portable publication evidence under the corresponding release validation directory.

**Interfaces:** The user authorized Git pushes and metadata updates for existing v9 PRs. The controller performs external writes and follows CI through completion. Leave all PRs open for review.

- [ ] Update PR #89 with backport test totals and independent review, preserve prior qualification history, and push its branch without force.
- [ ] Check existing provider PR #6 and Docker PR #33 for shared changes required by the backport. Preserve unchanged source when fixes are client-only; update their coordination/evidence notes rather than manufacturing code changes. Attach all updated PRs to this chat.
- [ ] Check actual-head CI on all affected existing v9 PRs to completion. Investigate failures with Superpowers systematic debugging, correct root causes, rerun affected checks, push and continue until required checks succeed or a demonstrated external blocker requires user action.
- [ ] Record final PR URLs, heads and check results; leave PRs open for review.

## Review-driven transport correction

Independent review reproduced HTTP 206, next-page headers and provider-accepted affirmative flag downgrades. Direct cross-origin Fetch hides non-exposed headers; the qualified Docker API currently exposes none. Fix client transport/refusal handling and expose only `Link`, `Content-Range`, and `Access-Control-Expose-Headers` in the existing API overlay, with real browser tests and a paired image check. Preserve ordinary tables, local snapshots and exact live route admission. Private-preview prefix normalization/live support is excluded.
