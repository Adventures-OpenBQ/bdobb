# V9 Pivot Inspector Flake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix the pivot inspector's intermittent Chromium failure, prove the affected scenario without retries, and update existing v9 PR #89 with independent review and CI results while all three PRs remain unmerged.

**Architecture:** Diagnose the failing browser/test boundary before choosing a patch. Preserve the real stores, worker, inspector behavior and assertions; prefer the smallest test-harness correction if evidence establishes a harness fault. Change product code only if the reproduction establishes a product defect.

**Tech Stack:** Existing Playwright 1.62.1, Chromium, Vite, TypeScript/React stores and table worker. No dependency upgrades.

**Spec:** The user's explicit flake-fix instruction. Existing `e2e/pivot-page-runtime.spec.ts` defines the inspector behavior to preserve; the preceding CI run `44900796420` at client `60cbc4f8` is the failure evidence.

## Global Constraints

- Existing client branch `codex/v9-live-observed-returns`, PR #89, baseline `60cbc4f8`. Keep PR #89, provider #6 and Docker #33 open and unmerged. Do not publish v10.
- Failure: `observed Page group inspector light 1280 cramped=false coarse=false` failed once at `page.evaluate(async () => import('/src/stores/dashboardStore.ts'))` with `Resulting promise was garbage collected`; retry passed. Cause is not yet established.
- No catch-and-retry wrapper, retry increase, arbitrary sleep, timeout inflation, forced test skip, weaker assertion or synthetic store/worker substitute.
- Preserve all theme/width/cramped/touch variants, paging and focus behavior, 112 observed members, 109 unfiltered session rows, shared baseline R101 versus viewer override, source-import counts, saved definition and persisted dashboard invariance.
- Root `.codegraph` is absent: use targeted ordinary searches; do not index. Reuse the existing isolated workspace and dependencies, preserve older archives/recovery files.
- Source qualification/provider/Docker changes from the prior task remain untouched unless the new reproduction demonstrates a dependency. No merge or deployment.

## Review Focus

1. The fix must address the failed evaluation's lifetime or the reproduced actual cause, rather than hide its rejection.
2. Controlled pressure/delayed-load evidence must exercise the real relevant boundary; distinguish diagnostic forcing from the original hosted trigger.
3. Real shared-store mutation, worker settling, selected keys and row counts must remain asserted.
4. Any helper must remain test-only, preserve cleanup and not introduce state across pages/tests.
5. New hosted results must distinguish retries/flakes from clean passes; retain initial failure evidence.

### Task 1: Diagnose and correct the affected inspector test

**Files:** Inspect `e2e/pivot-page-runtime.spec.ts`, its fixture/store entry points and installed Playwright Chromium evaluation implementation. Modify that spec and a directly shared test fixture/sibling only where the demonstrated cause requires it. Add portable evidence under `docs/releases/validation/v9/live-observed-returns/pivot-inspector-flake.md`.

**Interfaces:** Keep production store/worker APIs and original scenario outcomes. If a test-only helper is needed, name and document its page lifetime and exact use in the report.

- [ ] Retrieve the original hosted error, inspect the relevant evaluation and working patterns, and record a falsifiable hypothesis.
- [ ] Reproduce the original error or a controlled equivalent using the actual browser boundary. Record original/controlled differences and instrument navigation/context lifetime when relevant.
- [ ] Apply the smallest proven correction, preserving all existing behavioral assertions. Inspect directly related occurrences of the faulty pattern and fix only those sharing the demonstrated cause.
- [ ] Demonstrate RED/GREEN or a mutation removing the correction, then run the affected variants/specs without retries. Repetition is justified for this intermittent failure; record exact count, engine, ports and browser version.
- [ ] Run affected static checks and the project test command once, plus any checks required by changed production code. Self-review and commit. Obtain a fresh independent whole-fix review, address blockers and verify before publication.

### Task 2: Publish the reviewed fix and finish CI

**Files:** Existing PR metadata, portable verification/review documents, and any demonstrated CI fixes.

**Interfaces:** Controller owns authorized pushes/PR edits; independent reviewers do not publish or modify the worktree.

- [ ] Publish the reviewed client fix and review evidence to existing PR #89 with a normal push; preserve previous verification history and the original retry record.
- [ ] Follow the new exact-head CI to completion. Investigate failures with systematic debugging and rerun affected checks after corrections. Verify the pivot inspector and latest suite retry counts rather than infer them from job success.
- [ ] Recheck provider PR #6 and Docker PR #33 at their unchanged heads; update coordination notes with final client test/review/CI results as needed.
- [ ] Verify all three PRs remain open/unmerged and worktrees are clean; preserve raw diagnostics and report the final heads, results and limitations.
