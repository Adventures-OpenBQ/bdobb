# Run 3 Defect Fixes (2026-10-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** fix the defects found in regression run 3 (D-001, D-009 to D-015) at each one's home line. Carry the fixes upward by merge, then rebuild and rerun the v6 regression.

**Approval:** the user approved this scope on 2026-10-09 as recommended ("approved as recommended, go ahead"). That approval covers six rulings:

1. **D-012:** preview mode only. No worker summary-statistics command, and Rita may quote `describe_table`'s exact row count.
2. **D-012:** `mode` on `arrange_table`, not a separate read-only tool.
3. **D-011:** the one-time row-ID change for rows that contain a blank is accepted.
4. **D-001:** the standard zod 400 envelope ("received undefined") is accepted.
5. **NAS:** recreating `openbq-rita` is approved.
6. **D-001 upstream:** offering the fix to openbq-org is NOT part of this plan. It is held for an explicit ask.

**Trace evidence:** the session scratchpad holds diffs and tests for each fix, made against v4 `1a97fcf` and v6 `acb7c1d`. They are prototypes and are re-applied here with TDD.

## Global constraints

- **Checkouts** (the same as `2026-10-08-clean-line-fix-batch.md`):
  - v4: `bdobb-clean-v4-integration` (`codex/clean-v4-integration`).
  - v5: `bdobb-clean-v5-reconciled` (`codex/clean-v5-reconciled`).
  - v6: `bdobb-clean-v6` (`codex/clean-v6`).
  - Rita recipe: `adventures-agent-rita/.worktrees/v6-step1-services`.
  - All are under `~/Developer/adventures-in-openbb-articles/openbq-relaunch/`.
- **Carry by merge:** v4 into v5, and v5 into v6. Do not cherry-pick.
- **Commit hygiene:** before every commit, check that `git rev-parse --show-toplevel` is the named checkout. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No pushes and no tags in git.** Pushing images to GHCR (Task 4) is authorized.
- **No tailnet names, IPs or secrets in tracked files.**
- **Hermetic tests:** committed tests must not read `~/QA-fixtures-v6` or `reference-manual`. Put minimal fixtures in the test, or copy them into the repo under the test's directory.
- **TDD:** each fix starts with a test that fails for the stated reason. A changed existing assertion is listed in that line's ledger. The only expected change is the `"M"` addition to v6 `contract.test.ts`.
- **Unit suite:** run `pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000`. Check `uptime` first. Any reruns are recorded as composite evidence.
- **Receipts:** go in `docs/releases/validation/<line>/fixbatch-2026-10-09/`. Run each line's gates with the committed `docs/releases/validation/v3-repair/fixbatch-2026-10-08/run-gates.sh`.

## Task 1: v4 table engine (D-011 and D-014)

- [ ] **D-011.**
  - **Test:** a CSV with a blank Amount, and a JSON row that omits the Amount key. Both must keep `Amount` present as null; Company×Desk sums must have no `#ERROR`; the totals must be correct.
  - **Fix:** in `src/lib/localTableData.ts` `datasetFromBytes`, after `fields` is computed, fill each absent key with null through `Object.defineProperty`. That keeps a `__proto__` field name safe, and it needs its own test.
  - **Leave alone:** the engine's rule that an absent key means the field is unavailable.
- [ ] **D-014, the test:** an `M` category with first/max/min/last/sum reproduces a small monthly fixture. The existing legacy-month result is the oracle.
- [ ] **D-014, the fix:** add `'M'` at each of these sites.
  - The unions in `lib/tableModel/types.ts` and `lib/widgetData/types.ts` (both unions).
  - The enum lists in `lib/tableModel/validation.ts` and `lib/tableExecution/validation.ts` (both lists).
  - The mapping `M → 'month'` in `lib/tableModel/categories.ts`.
  - The transform options in `table-model/CategoryEditor.tsx`.
  - The label `M: 'Month'` in `pivot-drawer/ArrangePanel.tsx`.
- [ ] **D-014, migration:** stored `legacyBucket: 'month'` is never rewritten.
- [ ] **Gates and ledger:** run the v4 gates, write receipts, and append to the ledger in `docs/releases/v4-integration.md`. Commit.

## Task 2: carry into v5

- [ ] Merge v4 into v5 and resolve any conflicts.
- [ ] Run the v5 gates, write receipts, and append to the ledger in `docs/releases/v5-reconciliation.md`. Commit.

## Task 3: v6 client fixes (D-010, D-015, D-012, D-013, D-009)

- [ ] **D-010, `search_widgets`:** rank results by the number of query words matched. Search the name, category, subcategory, description and source. Add the yahoo→yfinance synonym. Return `matched_words` and `all_words_matched`.
- [ ] **D-015, `navigate`:** try an exact match, then case-insensitive, then a unique prefix or word. A refusal lists the tab names.
- [ ] **D-012, `arrange_table` mode** (`apply` by default, or `preview`). Preview returns `{status:"previewed", committed:false, revision, preview:{columns, rows≤20, total, truncated, completeness}, warnings}` before any write or Undo.
  - **Argument checks:** reject unknown arguments and bad modes with `invalid-arrangement`.
  - **Skill:** add a "Read-only asks never commit" section to the arrange-table SKILL.md, and update the tool description and builtins text.
  - **Row count:** let Rita quote `describe_table`'s `completeness.totalRowCount`.
  - **Test cases:** linked-child preview, truncation, the existing six prototype cases, and an unknown argument that never applies.
- [ ] **D-013:** `.rita-on .agent-edit-bar` gets padding to clear the pane, and `.rita-pinned .agent-edit-bar` is reset. Prove it with the e2e hit test.
- [ ] **D-009:** `App.tsx` adds `rita-pinned` only when `ritaUrl !== ""`. `useWindowMenuPins` derives the Rita pin from both stores; the item is disabled with no URL, and its toggle is a no-op when disabled. Cover it with unit and e2e tests.
- [ ] Commit each fix separately.

## Task 4: Rita patch 0010 (D-001)

- [ ] **Failing tests:** each test posts a malformed body and expects 400 with `error: "Invalid request"`. One goes in `tests/integration/routes/query.test.ts`, and a loop over the five `/generate/*` JSON routes goes in `generate.test.ts`.
- [ ] **Fix:** at all six sites, change `c.req.json()` to `c.req.json().catch(() => undefined)`.
- [ ] **Patch file:** `patches/rita/0010-fix-routes-answer-a-non-JSON-body-with-400-not-500.patch`, made with `git format-patch --zero-commit`.
- [ ] **Build gate:**
  - Add the allow-list file `patches/rita.post-gate`, with one `<patch> <path>` per line.
  - In `scripts/build.sh`:
    1. Hold the listed patches back.
    2. Run the reference-equality gate unchanged.
    3. Apply the held patches, then require the set of changed paths to equal the allow-list exactly.
    4. Die if an unlisted patch sorts after a listed one.
  - **Tests in `tests/test_build.sh`:** allowed paths pass, a wrong path fails, and a missing allow-list fails.
- [ ] **Build:** run `build.sh --check-only`, then the full bun suite. Build and push `openbq-rita` for linux/amd64 and linux/arm64, tagged `sha-<recipe short sha>` and `6.0.0-candidate`. Record the digest in `manifest.json`.
- [ ] **Records:** add an "intended change" note to the parity receipts (pairing A's malformed-body case: 400 against production's 500). Commit locally.
- [ ] **NAS (approved):** pull the new digest and recreate only `openbq-rita`. Check `/status` through :10443 and a malformed POST (expect 400). No other service is touched.

## Task 5: carry into v6, then rebuild

- [ ] **Merge:** merge v5 into v6. The `validation.ts` enum moved to `CATEGORY_TRANSFORMS` (0e0227e); add `'M'` there.
- [ ] **Tests and hint:**
  - Update the enum list in `contract.test.ts` (this is the listed assertion change).
  - Add the first/last hint to `HOW_TO_ARRANGE` in `capabilities.ts`: first/last become available when the arrangement has date categories (Y/Q/M) on exactly one field, so add that category in the same call.
  - Add a Rita test: monthly first/max/min/last/sum through `arrange_table`.
- [ ] **Gates and ledger:** run the v6 gates and the e2e specs (rita, rita-arrange, layout, rail, drop, smoke, plus the new D-009 and D-013 specs). Append to the ledger in `docs/releases/v6-assembly.md`.
- [ ] **QA bundle:** rebuild the QA bundle (`com.artcashin.bdobb.clean.v6`, through the overlay) and record its sha.

## Task 6: regression rerun

- [ ] **Run 4, full screen:**
  - V6-004, V6-007 (all steps), V6-008, D-009, D-013, and a native check of the ⋯ menu.
  - Measure the summary's `getBoundingClientRect()` against `innerWidth` in Web Inspector.
  - Then run the v3–v5 matrix.
- [ ] **Receipts:** go in `docs/releases/validation/v6/regression/run4/`.
