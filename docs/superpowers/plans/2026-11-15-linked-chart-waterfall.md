# Linked Chart Waterfall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Waterfall type on the linked chart that walks an income statement table from revenue to net income for each year, with reported subtotals, plus a statement setting that moves a line into another section.

**Architecture:** A statement line gains an optional displayed section (`overrides.lineSection`); one helper computes displayed membership and every reader (validation, compile, panel, template updates) uses it. The chart derives each row's walk role from the template line id already in the row's `groupPath` (item member), so nothing new travels from compile to chart. A new `waterfallFigure.ts` builds the traces; `buildLinkedFigure` dispatches to it.

**Tech Stack:** TypeScript, React, Vitest, Plotly partial bundle (`src/lib/plotly.ts`).

**Spec:** `docs/superpowers/specs/2026-11-15-linked-chart-waterfall-design.md`

## Global Constraints

- Branch `claude/v4-linked-chart-waterfall` (from `befde736`, #46's head). Push only to the `private` remote, and only when the user says.
- House header on every new file: `// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.` / `// SPDX-License-Identifier: AGPL-3.0-only`.
- No new dependencies. Help pages edited by hand; never run `help:sync`.
- Gates: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm scrub`, `pnpm test:web`.
- Wasm must be this line's own build: `PIVOT_WASM_BINDGEN=/Users/artcashin/Developer/openbq-bdobb-v4-fold/.pivot-tools/bin/wasm-bindgen pnpm -s pivot:build` before `test:run`; never copy another worktree's `src/lib/tableExecution/rust/generated/`.
- Existing statements, dashboards and chart types must give byte-identical results (absent `lineSection`, non-waterfall types).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A moved line that is hidden by its *home* section but not its displayed one: it must follow the displayed section (visible).
2. A moved line inside a formula's selectors (e.g. `revenue` moved, `calculated_gross_profit` still resolves) — must compute the same value as unmoved.
3. Floating-point gaps: running sum 100.0000001 vs reported 100 must draw no "Other".
4. A long-shape statement (bindings.shape `long`) with a moved line: the engine's section column follows the move.
5. Template update preview with a `lineSection` entry naming a line or section the new snapshot lacks: a conflict, never a silent drop.

Each has a test in its owning task below.

---

### Task 1: Line placement in the statement model

**Files:**
- Create: `src/lib/statementModel/placement.ts`, `src/lib/statementModel/placement.test.ts`
- Modify: `src/lib/statementModel/types.ts` (StatementOverrides), `validation.ts` (overrides block ~L160–197), `compile.ts` (sectionByLine L32, lines L72, hidden L102), `updates.ts` (L40–55), `overrides.ts` (reset)
- Test: `placement.test.ts`, `compile.test.ts`, `validation.test.ts`, `updates.test.ts`, `src/lib/tableExecution/engine` statement test that covers long shape (extend the existing one)

**Interfaces:**
- Produces: `StatementOverrides.lineSection?: Record<string, string>` (line id → section id, only when different from home).
- Produces: `displayedSections(template: StatementTemplate, overrides: StatementOverrides): { id: string; label: string; lineIds: string[] }[]` in template section order; `lineIds` = the section's own lines not moved away, then lines moved in, in template line order. (lineOrder and sectionOrder are applied by callers as today.)

- [ ] **Step 1: Write failing tests**
  - `placement.test.ts`: `displayedSections` with `lineSection: { [gross_profit]: expensesSectionId }` puts gross_profit last in Expenses and removes it from Profit; empty/absent map returns template membership exactly.
  - `validation.test.ts`: accepts `lineSection`; refuses unknown line id, unknown section id (`'overrides.lineSection'` path); `lineOrder` for a section must be a permutation of its **displayed** members (moved-in line required, moved-out line refused).
  - `compile.test.ts`: income fixture with `lineSection` moving `gross_profit` into Expenses and a lineOrder placing it after `cost_of_revenue` → `sectionByLine[gross_profit] === expensesSectionId` and output row order revenue, cost_of_revenue, gross_profit, …; formula line `calculated_gross_profit` with `revenue` moved still yields revenue − cost_of_revenue (Review Focus 2); `hiddenIds` containing the home section of a moved line does not hide it (Review Focus 1); without `lineSection` the compiled result deep-equals today's (snapshot of an existing fixture).
  - engine long-shape test: a moved line's `Section` column value is the displayed section (Review Focus 4).
  - `updates.test.ts`: `lineSection` ids are mapped like `lineOrder`; an entry whose line or section is missing from the new snapshot is a conflict `'Section membership changed; resolve the local line placement.'` (Review Focus 5).
  - `persistence.test.ts`: a statement with `lineSection` round-trips through `statementSnapshot` and the dashboard import (`appsExtensionsV4`, which calls `validateStatementIntent`).
  - `overrides.test`/reset: `resetStatementOverrides(intent, lineId)` deletes `lineSection[lineId]` and removes that line from any `lineOrder` entry it was moved into; full reset clears `lineSection`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/statementModel` → new tests FAIL.
- [ ] **Step 3: Implement** `displayedSections` and wire it: validation's `exact(o, [...])` key list gains `'lineSection'`; `sections` map used for lineOrder checks comes from `displayedSections`; compile builds `sectionByLine` and the per-section line list from it; updates maps and conflict-checks it; reset clears it.
- [ ] **Step 4: Run** `pnpm vitest run src/lib/statementModel src/lib/tableExecution` → PASS.
- [ ] **Step 5: Commit** `feat(statement): move a line into another section`

### Task 2: Statement panel — section picker and ↑

**Files:** Modify `src/components/renderers/table-model/StatementPanel.tsx` (line row L98–103); Test `StatementPanel.test.tsx`

**Interfaces:** Consumes `displayedSections` (Task 1). Ruling: the panel has only ↓ today; a moved line lands last, so a `Move <label> up` button (mirror of ↓) is added — without it a moved line cannot reach its walk position.

- [ ] **Step 1: Failing tests**
  - Panel lists lines per displayed section (uses `displayedSections`, then `lineOrder`).
  - `Section <label>` select (aria-label) on each line, options = section labels (override label if set). Choosing Expenses for gross_profit writes `lineSection[gross_profit] = expensesId`, writes Expenses' `lineOrder` = current displayed order + gross_profit, and removes gross_profit from Profit's `lineOrder` if present. Choosing the home section deletes the entry.
  - `Move <label> up` swaps with the previous line; disabled on the first line.
  - "Reset line" on a moved line returns it home.
- [ ] **Step 2: Run** `pnpm vitest run src/components/renderers/table-model/StatementPanel.test.tsx` → FAIL.
- [ ] **Step 3: Implement** in the line row; no other layout change.
- [ ] **Step 4: Run** same → PASS.
- [ ] **Step 5: Commit** `feat(statement): section picker and move up for lines`

### Task 3: Walk roles and the waterfall figure

**Files:**
- Create: `src/lib/widgetData/waterfallFigure.ts`, `src/lib/widgetData/waterfallFigure.test.ts`
- Modify: `src/lib/widgetData/types.ts` (`type` gains `"waterfall"`), `chartFigure.ts` (dispatch after the measures loop; revision unchanged in shape), `src/lib/plotly.ts` + `plotly.test.ts` (register `plotly.js/lib/waterfall`, mock it like pie)

**Interfaces:**
- Produces: `walkRole(row: DatasetRow): { templateId: string; line: string; role: 'step' | 'cost' | 'subtotal' | 'calculated' | 'ebitda' } | undefined` (in `waterfallFigure.ts`). Finds the `groupPath` member whose `categoryId` matches `statement/<id>/<version>/category/item`; `line` is the text after `/line/` of its `value`; home section from `statementTemplate(id, version)`: Income → step, Expenses → cost, Profit → subtotal, except `net_income_from_discontinued_operations` and `discontinued_operations` → step, `calculated_gross_profit` → calculated, `ebitda` → ebitda.
- Produces: `buildWaterfall(rows: DatasetRow[], labels: string[], measures: { id: string; name: string; colorKey: string; column: DatasetColumn; values: (number | null)[] }[]): { ok: true; data: object[]; xaxis: object; notes: string[] } | { ok: false; refused: true; message: string }`. `buildLinkedFigure` wraps it with the existing `frame`, `margin`, `legend`, `uirevision`, `waterfallmode: 'group'`.

Algorithm (pins what tests can't): walk rows in order; positions are shared across years. Before each subtotal/calculated row, compute each year's gap = reported − running; a gap counts when `|gap| > 1e-9 * Math.max(1, |reported|)`. If any year has a gap, insert an "Other" position (unique key `other:<rowIndex>`, tick text `Other`). Per year: step → relative +v; cost → relative −v; subtotal/calculated → absolute v, running = v; Other → relative gap (0 where none). A null value → relative 0 and listed missing; a null subtotal → relative 0 (no reset), listed missing. Each trace: `type: 'waterfall'`, `name` = year name, `x` = position keys, `measure`, `y`, `increasing/decreasing/totals: { marker: { color } }` all the year colour, `text` hover, `hovertemplate: '%{text}<extra></extra>'`, `textposition: 'none'`. X axis: `type: 'category'`, `tickvals` = keys, `ticktext` = labels (calculated subtotal tick: `<label> (calculated)`).

- [ ] **Step 1: Failing tests** (`waterfallFigure.test.ts`, fixture rows with real income-template ids and groupPath members):
  - signs: revenue 100 up, cost_of_revenue 60 down, gross_profit 40 absolute; a negative `income_tax_expense` (−5) goes up.
  - a line whose groupPath section member says Expenses but whose item is `revenue` still goes up (role from home template, not displayed section).
  - gap: revenue 100, cost 60, operating costs 20 shown, `operating_income` reported 15 → "Other" relative −5 then absolute 15; no gap → no "Other" position; 40.0000001 vs 40 → no "Other" (Review Focus 3).
  - multiple years: one trace per measure, same x keys, a year without a gap has Other y = 0.
  - discontinued_operations is relative; calculated_gross_profit is absolute with tick `… (calculated)`; ebitda ticked → refused `EBITDA isn't part of the walk — untick it`.
  - missing step and missing subtotal → relative 0 and note `Missing: cost_of_revenue (FY2023)`, plus note `Expenses shown as decreases.` always present on success.
  - refused `Waterfall needs an income statement table` for balance-template rows and for rows with no statement groupPath; refused `Waterfall needs period columns` when a measure column has no `statement/income/<v>/category/period` member in `splitPath`.
  - hover text contains line label, year, stored value, signed step and running total; Other's hover says `Not in the lines shown`.
  - `chartFigure.test.ts`: all existing tests still pass unchanged (byte-identical figures for other types).
  - `plotly.test.ts`: `REGISTERED_TRACE_TYPES.has("waterfall")`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/widgetData src/lib/plotly.test.ts` → FAIL.
- [ ] **Step 3: Implement** as pinned above.
- [ ] **Step 4: Run** same → PASS.
- [ ] **Step 5: Commit** `feat(linked-chart): waterfall from revenue to net income`

### Task 4: Controls, import check and help

**Files:** Modify `src/components/renderers/LinkedChartRenderer.tsx` (`withType` L14–16, type select L135, Display/Series-from L138–139), `src/lib/appsExtensionsV4.ts` L86, `src/help/guide/linked-widgets.md`, `src/help/topics/linked-widgets.md`, `src/help/guide/tables.md`, `src/help/topics/tables.md`; Tests `LinkedChartRenderer.test.tsx`, the appsExtensionsV4 test, any help test counting pages (counts unchanged: no new pages).

- [ ] **Step 1: Failing tests**
  - Chart type offers `Waterfall`; with it, Display and Series from are hidden; `withType(…, 'waterfall')` resets `display: 'percent'` → `'stacked'` and deletes `seriesFrom`.
  - A waterfall refusal clears a previously drawn chart and shows a status line (no `role="alert"`); a failed fetch still keeps the stale chart.
  - Import: `type: 'waterfall'` imports with any valid display/seriesFrom; an unknown type is still refused.
- [ ] **Step 2: Run** `pnpm vitest run src/components/renderers/LinkedChartRenderer.test.tsx src/lib/appsExtensionsV4` → FAIL.
- [ ] **Step 3: Implement**; help: linked-widgets pages describe Waterfall (income statements only, reported subtotals, "Other", expenses shown as decreases, EBITDA refused); tables pages describe moving a line into another section and ↑.
- [ ] **Step 4: Run** full gates (Global Constraints) → all exit 0.
- [ ] **Step 5: Commit** `feat(linked-chart): waterfall controls, import check and help`

### After the tasks (controller, not a task)

Browser check per the recipe (`pnpm exec vite --mode browser --port 1431 --strictPort`): an income statement CSV, gross_profit and operating_income moved after their costs, three years; an unticked cost produces "Other"; a balance sheet is refused. The real-provider sign check waits for a real income statement on a running stack.
