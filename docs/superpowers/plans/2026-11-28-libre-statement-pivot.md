# Libre Statement Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v10 is Libre compatible. A Libre Terminal statement card binds itself to a Statement template, shows every dollar line in a section, takes a list of symbols, labels each company's periods by its own fiscal year, and can be rearranged with Line item, Period and Company as three dimensions, any one of them paged.

**Architecture:** Four pure units and their wiring. A **statement source** step wraps the card's one `fetchWidgetData` call: it fans a symbol list out to one request per symbol and stamps `symbol` and `period_kind` on the rows. The existing relabelling (`useStatementRows` → `correctStatementRows`) then works per company unchanged; it gains a `rows` rung for backends with no fiscal-year-end route and stamps period bounds. A **vocabulary** module, written from clean sources, feeds both a new **template 1.1.0** and the quick view's taxonomy. **Auto-binding** proposes a `StatementIntent` from a card's columns. The intent gains a **layout** preset that `compileStatement` turns into rows, columns and page.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library (jsdom), the existing table worker and pivot model. No Rust change. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-28-libre-statement-pivot-design.md` (approved 2026-11-28). Read it before any task. Its "What exists today" and "What Libre's rows look like" sections are facts recorded from the code and from live rows.

## Global Constraints

- **Clean-source rule (binding).** Do not open, fetch, search or quote Libre Terminal's repository while working on this plan, and in particular not `terminal/static/statements.js`. The vocabulary comes only from: the `yfinance` SDK's statement key list (Apache-2.0), the OpenBB SEC provider's field definitions (Apache-2.0), and the recorded fixtures of Task 0. If a line is missing, add it from a fixture, and record where it came from.
- **Home line v10.** Work in this worktree on `claude/v10-libre-statements`. PR into `release/v10`. The carry to `main` is a separate step after merge and is not part of this plan.
- **Carry-friendly edits.** `WidgetCard.tsx`, `useWidgetData.ts` and the help topics differ on `main`. Keep edits to them to a few lines that call into new files.
- **A card with no Statement intent and one symbol behaves exactly as it does today.** Every task keeps the existing suites green without editing their expectations, except where a task says so.
- **No new dependency, no lock change.** `git diff --stat pnpm-lock.yaml src-tauri/Cargo.lock` prints nothing after every task.
- **Untrusted rows.** Backend JSON is untrusted. A malformed value is absent, never a throw.
- **New source files carry the house header** as their first two lines (`scripts/header-check.sh`):
  `// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.`
  `// SPDX-License-Identifier: AGPL-3.0-only`
- **Scrub.** No absolute home-directory paths in any committed file (`scripts/scrub-check.sh`).
- **Commits.** One commit per task, in this worktree. Never push. The `.githooks` secret-gate must pass; if it fails, stop and report. Never `--no-verify`.
- **Release artefacts are not this plan's.** Do not regenerate `SOURCE-MANIFEST.json` or `source-offer.json`. The PR description must say they are stale.
- **Gates**, run from the worktree root after every task:
  - `pnpm typecheck`
  - `pnpm lint` (only a new violation fails)
  - `pnpm knip` (add no unused file, dependency or export)
  - `pnpm test:run`
  - `pnpm test:web`
  - `pnpm build:web`
  - `pnpm notices:check`
  - `pnpm scrub`
  - `git status --short`, clean after the commit

  `pnpm test:run` needs the generated pivot WebAssembly. If `src/lib/tableExecution/rust/generated/` is missing, run `pnpm pivot:build` first (it names the pinned `wasm-bindgen` to install if absent).

## Review Focus

1. **One failing symbol must not blank the card.** Three symbols, the second fails: two companies render and the third is named in a notice. All failing is the card's ordinary error. Task 3 pins this.
2. **A January filer and a December filer on one card.** Each lands on its own `FY` label, and companies-across compares `FY2026` with `FY2026`, never July with June. Tasks 4 and 5 pin this.
3. **Nothing guessed.** A company whose year end cannot be established stays *Fiscal labels as reported*, gets no stamped fiscal fields, and any layout with Company on an axis is refused naming it. Task 7 pins the refusal.
4. **1.0.0 is immutable.** `statementTemplate('income', '1.0.0')` must be byte-identical before and after. Task 2 pins a snapshot.
5. **The quick view and the template cannot drift.** Both read one vocabulary module. Task 2 pins that a line placed by one is placed by the other.
6. **Saved cards.** A version 2 intent opens as `lines-by-period` with no rewrite on read. Task 6 pins it.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lib/statementModel/fixtures/libre/*.json`, `…/openbqYfinance/*.json` | new | Recorded rows with a provenance header |
| `src/lib/statementModel/vocabulary.ts` | new | The one list of sections and line names, with emphasis and units |
| `src/lib/statementModel/vocabulary.test.ts` | new | Every fixture dollar line is placed; no line in two sections |
| `src/lib/statementModel/taxonomy.ts` | edit | Unchanged content for 1.0.0; exports stay |
| `src/lib/statementModel/catalog.ts` | edit | Installs 1.1.0 from the vocabulary beside 1.0.0 |
| `src/lib/statementModel/validation.ts` | edit | Accepts `emphasis` on 1.1.0 lines; intent schema 3 and `layout` |
| `src/lib/statementTaxonomy.ts` | edit | Sections derived from the vocabulary |
| `src/lib/statementSource.ts` | new | Fan-out plan, merge, stamping, notices, cap. Pure |
| `src/lib/statementSource.test.ts` | new | |
| `src/hooks/useWidgetData.ts` | edit | Calls the statement source around `fetchWidgetData` |
| `src/hooks/useStatementYearEnds.ts` | edit | `correctStatementData` uses the same source step |
| `src/lib/statementFiscal.ts` | edit | `rows` rung; stamps `period_start`, `period_end` |
| `src/lib/fiscalChain.ts` | edit | `FiscalSource` gains `"rows"`; `fiscalLabel` words it |
| `src/lib/statementModel/autoBind.ts` | new | Columns and card params → proposed intent and unmapped list |
| `src/lib/statementModel/autoBind.test.ts` | new | |
| `src/lib/statementModel/types.ts` | edit | `layout` on the intent; `emphasis` on a line |
| `src/lib/statementModel/compile.ts` | edit | Rows, columns and page from the preset |
| `src/lib/statementModel/persistence.ts` | edit | Reads schema 2 as `lines-by-period` |
| `src/lib/statementModel/duplicates.ts` | new | Identical-line detection. Pure |
| `src/lib/agent/tableModel/statement.ts` | edit | Rita's statement operations accept schema 3 |
| `src/components/renderers/table-model/StatementPanel.tsx` | edit | Opens with a proposal; shows unmapped; preset choice |
| `src/components/renderers/StatementRenderer.tsx` | edit | Bold for `emphasis`; duplicates control |
| `src/components/WidgetCard.tsx` | edit | Statement template action; Pivot toggle no longer hidden for a bound statement; page selector |
| `src/help/topics/connections.md`, `statement-view.md`, `credits.md` | edit | Spec section F |

---

## Task 0: Baseline and fixtures

**Files:** `src/lib/statementModel/fixtures/**`

- [ ] Run every gate on the untouched worktree. Record any that fail before a line is changed; those are not this plan's to fix, but they must not get worse.
- [ ] Start the `libre-bdobb` container (Libre Terminal as a backend, guard on `127.0.0.1:7900`). Record annual and quarterly income, balance and cash statements for **AAPL, JPM, XOM and WMT** from providers `yfinance` and `sec`. WMT is the January filer the review focus needs.
- [ ] Record the same from OpenBQ-yfinance 3.0.0 (`obb.yfinance.fundamental.{income,balance,cash}`), long-form.
- [ ] Trim each file to `limit=5` periods. Each file starts with a `_provenance` object: date recorded, symbol, provider, route, backend name and version. Tests strip it.
- [ ] Add a test that every fixture file parses and carries a complete `_provenance`.
- [ ] Gates. Commit: `test(statement): recorded Libre and openbq-yfinance statement fixtures`.

## Task 1: Vocabulary

**Files:** `src/lib/statementModel/vocabulary.ts`, `vocabulary.test.ts`

- [ ] Write the failing tests first:
  - every numeric field in every fixture is either placed in a section or listed in `NOT_MONEY` (per-share, share counts, ratios);
  - no field sits in two sections of one statement;
  - every existing 1.0.0 line (`TAXONOMY` in `statementModel/taxonomy.ts`) is present, in its 1.0.0 section.
- [ ] Author the module. Shape: per statement, ordered sections; per section, ordered lines `{ field, emphasis?, unit? }`. Start from the 1.0.0 lists verbatim, then add:
  - the `yfinance` SDK's statement keys, converted with the same snake-case rule OpenBQ-yfinance uses (`records.py: snake`), each placed by reading what the line is;
  - the OpenBB SEC provider's statement fields;
  - any fixture field still unplaced.
- [ ] Above each added block, a comment naming its source (SDK version, provider package and version, or fixture file). This comment is the audit trail for the clean-source rule.
- [ ] Per-share and share-count income lines go in a **Per share** section with their unit, not in `NOT_MONEY`. `NOT_MONEY` is for ratios such as `tax_rate_for_calcs`.
- [ ] Mark `emphasis: 'total'` on each statement's headline totals and `'subtotal'` on section subtotals. Keep it to lines whose name says so (`total_*`, `gross_profit`, `operating_income`, `net_income`, the three `*_cash_flow` totals).
- [ ] Gates. Commit: `feat(statement): one line vocabulary from clean sources`.

## Task 2: Template 1.1.0 and the quick view

**Files:** `catalog.ts`, `validation.ts`, `types.ts`, `src/lib/statementTaxonomy.ts`, their tests

- [ ] Failing tests: a snapshot of `statementTemplate(id, '1.0.0')` for all three (must not change); `statementTemplate(id, '1.1.0')` exists and carries every vocabulary line; a 1.0.0 snapshot carrying `emphasis` is rejected; `previewStatementUpdate` from 1.0.0 to 1.1.0 reports no conflicts for a statement with no overrides.
- [ ] `types.ts`: add optional `emphasis?: 'subtotal' | 'total'` to a template line.
- [ ] `catalog.ts`: build 1.1.0 from the vocabulary with the same policy rule as 1.0.0 (balance and the cash-position observations are `stock`, the rest `flow`). Add it to `INSTALLED_STATEMENT_TEMPLATES`. Leave `buildTemplate` for 1.0.0 reading the 1.0.0 `TAXONOMY` exactly as now.
- [ ] `validation.ts`: allow `emphasis` in a line's exact-key list only when the template version is not `1.0.0`.
- [ ] `src/lib/statementTaxonomy.ts`: derive `TAXONOMY` from the vocabulary (section name → field list), keeping its exported names and `OTHER_SECTION`. Its header comment's rule about unlisted per-share lines is replaced by the **Per share** section.
- [ ] Update `statementTaxonomy.test.ts` only where it asserts per-share lines are unplaced; every EODHD assertion stays.
- [ ] Gates. Commit: `feat(statement): template 1.1.0 and a shared taxonomy`.

## Task 3: Statement source — fan-out and stamping

**Files:** `src/lib/statementSource.ts`, test, `useWidgetData.ts`, `useStatementYearEnds.ts`

- [ ] Failing tests for the pure functions:
  - `statementRequests(widget, params)`: not a statement widget (`isStatementPeriodParam`) → one request, params untouched; one symbol → one request; `A,B,C` → three, each with one symbol, list order; a ticker param that is `multiSelect` or `multiple` → one request, list unchanged; nine symbols → a refusal naming the cap of 8;
  - `mergeStatementRows(results, params)`: rows concatenated in list order; each stamped `symbol` (upper-cased request symbol) unless the row already has a non-empty one; each stamped `period_kind` from the `period` param; a failed request contributes no rows and one notice naming the symbol; all failed → throws the first error unchanged.
- [ ] Implement. Symbols come from `statementSymbolsOf`. The ticker parameter is found with `isTickerParam`.
- [ ] `useWidgetData.ts`: replace the single `fetchWidgetData` call with a helper from `statementSource.ts` that runs the requests **sequentially** with the same options and abort signal, and returns `{ data, notices }`. For one request it must return exactly what `fetchWidgetData` returned, envelope included.
- [ ] Notices reach the card through the channel SSRM and provider warnings already use. Find it (`obbjectWarnings`) and reuse it; do not add a second notice line.
- [ ] `correctStatementData` (Rita's path) calls the same helper so both paths agree.
- [ ] Provenance: confirm with a test that the dataset's `symbol` fact is still the comma-joined parameter and `symbolList(provenance)` returns the list.
- [ ] Gates. Commit: `feat(statement): one request per symbol, rows stamped with their company`.

## Task 4: The `rows` rung

**Files:** `src/lib/statementFiscal.ts`, `src/lib/fiscalChain.ts`, `useStatementYearEnds.ts`, tests

- [ ] Failing tests on `correctStatementRows` and a new pure `inferYearEnds(rows, period, cardSymbols)`:
  - rows carrying their own `fiscal_year` and `fiscal_period` (SEC fixture) are left as served and are **not** as-reported;
  - annual rows with no lookup answer: month taken from `reportMonth(period_ending)`; WMT → January, AAPL → September;
  - a lookup answer beats the inferred month; the card's FY ends override beats both;
  - quarterly rows with no lookup answer and no own fiscal fields: unresolved by this function (returns null for that symbol).
- [ ] Implement `inferYearEnds` and merge its answers **under** the lookup's in `useStatementRows` (lookup first, then rows, then as-reported). December is not assumed for statement rows today and still is not.
- [ ] Quarterly case: in `statementYearEnds`, when the lookup answers null for a symbol and the card's period is a quarter kind, make one annual request for that symbol with `limit=1` through `fetchWidgetData` and infer from it. Cache the answer beside the lookup's, per backend and symbol. A failure is null, logged once.
- [ ] `fiscalChain.ts`: add `"rows"` to `FiscalSource`; `fiscalLabel` returns wording for it in the style of the others.
- [ ] Gates. Commit: `feat(fiscal): year end from a company's own rows when no lookup answers`.

## Task 5: Period bounds on rows

**Files:** `src/lib/statementFiscal.ts`, tests

- [ ] Failing tests: after relabelling, an annual row carries `period_start` and `period_end` equal to `fiscalYearSpan(fy, month)`; a quarterly row equal to `quarterSpan`; a TTM row carries neither; an as-reported row carries neither; rows that came with their own `fiscal_year` keep it and gain bounds only when a year-end month is known.
- [ ] Implement inside `correctStatementRows`' row mapping, so every consumer of relabelled rows sees the same fields.
- [ ] Check the Table view: the two new columns appear. Give them header names and a date format through the table spec path the relabelled `fiscal_year` uses.
- [ ] Gates. Commit: `feat(fiscal): relabelled statement rows carry their period bounds`.

## Task 6: Layout on the intent

**Files:** `types.ts`, `validation.ts`, `persistence.ts`, `compile.ts`, `statementPresentation.ts`, `src/lib/agent/tableModel/statement.ts`, tests

- [ ] Failing tests:
  - a schema 2 intent validates and reads as `layout: 'lines-by-period'`; nothing is written back on read;
  - schema 3 with each of the three presets compiles to the rows, columns and page in the spec's table;
  - `lines-by-period` with one company compiles to exactly today's model (compare against the existing compile snapshot);
  - the page selection defaults to the first member and round-trips through `statementSnapshot`;
  - `statementPresentation` is produced for `lines-by-period` only.
- [ ] `types.ts`: `StatementIntent` schema 3 adds `layout: 'lines-by-period' | 'lines-by-company' | 'periods-by-line'`. Keep the schema 2 type for reading.
- [ ] `compile.ts`: build `layout.rows`, `layout.columns` and `layout.page` from the preset. The paged category is Company for the two line/period presets and Period for `lines-by-company`.
- [ ] Refusal: a preset with Company on an axis, when any company's rows lack stamped fiscal fields, throws `StatementCompilationError` naming the company and "Fiscal labels as reported".
- [ ] Rita's operations (`applyStatementOps`) accept and emit schema 3. Add a `statement.layout` operation only if `contract.ts`'s operation list is the place every other statement change is declared; otherwise leave Rita reading and preserving the field.
- [ ] Gates. Commit: `feat(statement): layout presets with a paged third dimension`.

## Task 7: Auto-binding

**Files:** `src/lib/statementModel/autoBind.ts`, test

- [ ] Failing tests against fixtures run through Tasks 3–5: Libre `yfinance` income (wide) → template `income@1.1.0`, shape wide, company `symbol`, period kind `period_kind`, date `period_ending`, explicit fiscal fields bound, one mapping per placed column, `unmapped` empty; a column invented for the test appears in `unmapped`; OpenBQ-yfinance (long) → shape long with `line_item` and `value`; a table `detectStatement` does not recognise → no proposal.
- [ ] Implement as a pure function of `(columns, cardParams)`. Exact name match only.
- [ ] The proposal must pass `validateStatementIntent` and `compileStatement` for every fixture. Assert it.
- [ ] Gates. Commit: `feat(statement): propose a Statement template from a card's columns`.

## Task 8: Card and panel

**Files:** `WidgetCard.tsx`, `StatementPanel.tsx`, `StatementRenderer.tsx`, component tests

- [ ] Failing component tests: a table card with statement rows offers **Statement template**; choosing it opens the panel pre-filled with the proposal; unmapped columns are listed; saving stores the intent; the Pivot toggle is present on a card with a saved intent; the preset control switches layout; with two companies a page selector with previous and next appears and is absent with one.
- [ ] `WidgetCard.tsx`: the action, and stop hiding `PivotToggle` when the card has a Statement intent. A few lines each, calling into the panel.
- [ ] `StatementPanel.tsx`: accept an initial proposal; an **Unmapped** list; the preset `<select>`.
- [ ] `StatementRenderer.tsx`: bold for `emphasis`.
- [ ] Page selector placement is the spec's open item 2. Use the pivot's existing page strip if one renders for an ordinary pivot with a page selection; otherwise put the selector in the card header beside View. Say which in the commit message.
- [ ] Gates. Commit: `feat(statement): bind from the card, choose a layout, page through companies`.

## Task 9: Duplicate lines

**Files:** `src/lib/statementModel/duplicates.ts`, test, `StatementRenderer.tsx`

- [ ] Failing tests: two lines identical in every delivered period and non-null in at least one are a pair, the later in template order hidden; all-null lines are not duplicates of each other; a formula line is never hidden; the AAPL Libre `yfinance` income fixture hides `interest_income_non_operating` and `other_non_operating_income_expenses`.
- [ ] Implement over the delivered statement rows, per page.
- [ ] Renderer: hidden by default, a **Show duplicates** control stating the count, the choice saved with the card's statement state beside its folds.
- [ ] Gates. Commit: `feat(statement): hide lines that repeat another line's figures`.

## Task 10: Help

**Files:** `src/help/topics/connections.md`, `statement-view.md`, `credits.md`, help tests

- [ ] `connections.md`: "Libre Terminal as a backend" per spec section F. State the facts verified on 2026-11-27: `TERMINAL_EXTRA_ORIGINS` from Libre Terminal 1.1; `127.0.0.1:6900` data and `:6950` views; same computer only; no `apps.json` on the views endpoint; widgets opened in a frame may be refused.
- [ ] `statement-view.md`: Statement template from the card, the three layouts, several symbols, paging, duplicates, and the `rows` source of a fiscal year end.
- [ ] `credits.md`: Libre Terminal named as a supported backend. No derived-work wording.
- [ ] Run the help suites (`src/help`). If `shots.test.ts` requires a screenshot for a changed topic, capture it in Task 11 and wire it there.
- [ ] Gates. Commit: `docs(help): Libre Terminal as a backend; statement layouts`.

## Task 11: Native walk

- [ ] Build the debug app with the bridge under its own identifier, as `bridge-smoke.sh` does: `pnpm tauri dev --features mcp-bridge --config src-tauri/tauri.mcp.conf.json --config <overlay>`. The `libre-bdobb` container must admit `http://localhost:1420` (`LIBRE_GUARD_ORIGINS`).
- [ ] Walk, with a screenshot and an accessibility snapshot at each step: connect both endpoints; add the Yahoo income card; `AAPL`; Statement template → save; `lines-by-period`; add `WMT,JPM`; page through the three companies; `lines-by-company` on `FY2026`; `periods-by-line`; Show duplicates.
- [ ] Assert from the snapshots: no dollar line under an **Unmapped** or **Other** heading; WMT's latest annual column is its own fiscal year; the notice names nothing.
- [ ] Repeat the bind-and-flip steps on an OpenBQ stack with the long-form yfinance statement, to show the same intent works on both shapes.
- [ ] Put the screenshots where the help shots live if Task 10 needs them. Otherwise attach them to the PR, not the repository.
- [ ] Write the PR description: what changed, the gates' results, the walk's evidence, that `SOURCE-MANIFEST.json` and `source-offer.json` are stale, and that the carry to `main` follows. Do not open the PR or push without the owner's word.
