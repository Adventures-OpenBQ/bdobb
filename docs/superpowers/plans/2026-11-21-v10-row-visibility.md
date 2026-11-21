# V10 Refused-Source Row Visibility Implementation Plan

> **For agentic workers:** Use Superpowers TDD, verification-before-completion and requesting-code-review. Execute this narrow test correction inline, then obtain fresh independent review.

**Goal:** Close the stacked review's Minor row-visibility coverage note, verify it locally and in CI, and keep all PRs unmerged.

**Architecture:** Retain the synthetic refusal cases and their existing chart, Parameters, request and header assertions. Add a visible listing data-cell assertion scoped to the real source table in each case. Qualify the new assertion by hiding rendered data rows while retaining headers, then remove the diagnostic mutation and verify both engines and browsers.

**Spec:** The user's explicit test-coverage request and the Minor finding in `docs/releases/validation/v10/live-price-views/independent-stacked-review.md`.

## Constraints

- Start at client `4048adb9be2d33497edf31e133986f41860a975b`, branch `codex/v10-live-price-views`, existing isolated worktree; no CodeGraph directory.
- Change only the affected test and portable evidence/review notes. No product, fixture payload, dependency, retry, timeout or skip changes.
- Preserve ordinary rows, opted-in missing receipt and opted-in nested snapshot cases, all chart refusal/Apply/query assertions, and the existing header check.
- Add an accessible visible `AAPL.US` data-cell check scoped to the source card. Do not require all 58 rows to render because the table is virtualized.
- Keep v10 #90 and v9 client #89/provider #6/Docker #33 open/unmerged; preserve the stacked base and every v9 source head.

### Task 1: Strengthen and verify row visibility

- [x] Demonstrate the existing refusal cases still pass with rendered body rows hidden but headers visible, using a temporary browser-only diagnostic.
- [x] Add the data-cell assertion and demonstrate the same diagnostic fails specifically at that assertion. Remove all diagnostic changes.
- [x] Run all three affected cases on Chromium and WebKit with both TypeScript and compiled Rust engines, retries zero; check runtime/WASM evidence. Run typecheck, lint, scrub and the project unit suite once; retain outputs and first failures.
- [x] Record exact evidence and limitations in portable validation notes. Commit and obtain an independent review of the whole correction and diagnostic proof; resolve blocking findings.

### Task 2: Publish and finish CI

- [ ] Record the independent review, push normally to existing PR #90 and follow exact-head CI to completion. Inspect browser retry/flake counts.
- [ ] Update PR #90 with correction, affected results, review and hosted CI. Update prior coordination notes if their open Minor statement is superseded, preserving history.
- [ ] Verify all four PRs remain OPEN/unmerged, v9 source heads unchanged, and worktrees clean. Preserve diagnostics and report final results.
