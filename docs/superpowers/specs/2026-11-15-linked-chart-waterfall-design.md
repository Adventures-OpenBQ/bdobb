# Linked chart waterfall: revenue to net income

Date: 2026-11-15. Repo: Adventures-OpenBQ/bdobb. Home line: release/v4, stacked on
the composition work (`claude/v4-linked-chart-types`, PR #46), carried forward.

## Why

The user wants to see how revenue walks down to net income in each fiscal year,
through gross profit and operating income, and to compare those walks across years.
The composition chart (100% stacked, pie) shows a year's mix; it cannot show a
running walk. The composition spec listed waterfall as a later release; this is it.

## Goals

1. The linked chart gains a **Waterfall** type for income statement tables.
2. Every year in the table is one waterfall, the years grouped side by side at each
   step, each year in its own colour.
3. Subtotals (gross profit, operating income, net income, any Profit line) are drawn
   at the value the company **reported**. When the running sum of the lines before a
   subtotal differs from it, an **"Other"** step bridges the gap.
4. The statement table can **move a line into another section**, so the user can lay
   the statement out in walk order. The chart follows the table's row order.

## Non-goals

- Balance sheet and cash flow walks. They refuse (see Refusals).
- Waterfalls on plain (non-statement) tables, and a per-line Add/Subtract/Total
  picker (approach B in the brainstorm). Can be added later without changing this.
- A bridge of one line between two years.
- Automatic walk ordering from the template (approach C).
- Rita setting chart options; any change to Art's Charts.

## Anti-goals

- Never draw a subtotal the company did not report, and never invent a total.
- Never flip a value without saying so.
- Never imply data the table did not deliver exists.

## Approaches considered

- **Signs from the statement's sections (chosen).** No per-line setup; works only
  on statement tables.
- Per-line role picker in chart settings: any table, but a new settings panel and a
  saved per-row map. Several times the size.
- Dedicated statement chart that knows the template's subtotals: biggest, duplicates
  the figure code.

For placing gross and operating profit in the walk, the user chose to let the
**table** arrange lines (rejecting a fixed walk table inside the chart), and of the
two table layouts chose **b1, move a line into another section**, over b2, a flat
custom order without section headers.

## Design

### 1. Moving a line into another section (statement table)

- `StatementOverrides` gains `lineSection?: Record<lineId, sectionId>`: a line's
  displayed section when it differs from its template section. Absent means
  today's placement, so every saved statement is unchanged.
- The statement panel (`StatementPanel.tsx`) gives each line a section picker. Moving a
  line appends it to the end of the target section's order; ↑/↓ then works as now
  inside that section. Resetting a line clears its move.
- `compileStatement` places each line by `lineSection` before its home section:
  section membership, line order, the Section category's member and the
  section-hidden rule all follow the displayed section. `sectionByLine`, which
  `compile.ts` and `tableExecution/engine.ts` both read, becomes the displayed
  placement.
- Formula selectors must keep resolving: a moved line's cells are found under its
  displayed section, consistently in unpivot, selectors and outputs.
- The dashboard import check (`appsExtensionsV4.ts`) and statement persistence accept
  `lineSection` and refuse unknown line or section ids.

### 2. A line's role comes from its home section

The chart's sign rule uses each line's **template** section, never its displayed
section or its label:

- Income → the step goes up by the stored value.
- Expenses → the step goes down by the stored value (stored values are positive
  costs). A negative stored expense, e.g. a tax benefit, therefore goes up.
- Profit → a reported subtotal, with these exceptions (user ruling 2026-11-15):
  - `net_income_from_discontinued_operations` and `discontinued_operations` are
    pieces of net income: ordinary steps, up by their signed stored value;
  - `calculated_gross_profit` is a subtotal drawn at its computed value and labelled
    "(calculated)", because the company did not report it;
  - `ebitda` is not on the walk: a waterfall with it ticked is refused;
  - `ebit` is an ordinary subtotal.

Sign convention (user ruling 2026-11-15): the rule assumes providers store costs as
positive numbers. This is not verified against real data; it is checked by hand on one
real income statement per line. A wrong sign cannot produce a wrong subtotal, because
subtotals are reported values: it shows as an "Other" of about twice that cost at the
next subtotal, and the hover shows the stored value.

The statement compile carries each output row's role to the linked chart alongside
the dataset (the mechanism is the builder's). A dataset with no roles, or with rows
from the balance or cash-flow template, is refused.

### 3. The figure (`buildLinkedFigure`, `chartFigure.ts`)

- `LinkedChartSettings.type` gains `"waterfall"`. Display and Series-from are hidden
  for it, and changing to waterfall resets them as pie does. Category is the line
  item; measures are the year columns.
- One Plotly `waterfall` trace per measure (year), `waterfallmode: 'group'`, colour by
  the measure's existing `colorKey`, so a year keeps its colour.
- Steps run in the table's row order. For each year:
  - an Income or Expenses row is a `relative` step with its signed value;
  - a Profit row is drawn as an `absolute` bar at its reported value. When the
    running sum differs from it, a `relative` step named "Other" is inserted
    before it for that year. The x position is shared, so every year's walk gets the
    "Other" slot; a year with no gap draws nothing there.
  - the running sum then continues from the reported value.
- Hover: line, year, stored value, signed step, running total. "Other" says
  "Not in the lines shown".
- A note under the chart: "Expenses shown as decreases."
- `waterfall` is registered in `src/lib/plotly.ts` beside pie, with its test.
- The import check accepts `"waterfall"` as a type.

### 4. Missing values and refusals

- A missing Income or Expenses value skips that step for that year; listed in the
  existing "Missing: …" note.
- A missing reported subtotal leaves that bar (and its "Other") out for that year; the
  walk continues on the running sum; listed in the note.
- Refused (status line, plot cleared, as the composition spec defines):
  - not an income statement table: "Waterfall needs an income statement table";
  - no period column chosen, or a chosen measure that is not a period column
    (e.g. a formula column such as YoY %): "Waterfall needs period columns". FY and
    FQ statements are both allowed (builder-check call);
  - `ebitda` ticked: "EBITDA isn't part of the walk — untick it".
- Near-duplicate lines (`revenue` / `operating_revenue`, `interest_expense` /
  `total_interest_expense`, `income_tax_expense` / `tax_provision`) are left for the
  user to untick, as in the composition chart; a double count shows as a negative
  "Other" (builder-check call).
- Grouped, stacked, 100%, pie and line charts are unchanged.

## Constraints

- Build on `claude/v4-linked-chart-waterfall`, cut from `befde736` (#46's head). Its
  PR waits for #46; then carry to v5–v10 and main in the release walk, each carry
  with the `plotly.ts` waterfall registration. Nothing merges outside the walk.
- Push only to the `private` remote unless the user says otherwise.
- House header AGPL-3.0-only. No new dependencies (Plotly ships waterfall).
- Gates on every line: `pnpm install --frozen-lockfile`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test:run`, `pnpm scrub`, `pnpm test:web` where it exists.
- Help pages are edited by hand; never `help:sync`.

## Testing

- Statement: moving a line changes its displayed section and row order; formulas
  still resolve; reset restores; import and persistence round-trip `lineSection`
  and refuse unknown ids; existing statements compile byte-identically.
- Figure: signs by home section, including a line moved into another section; reported
  subtotal drawn at its value with "Other" for the gap and none without a gap;
  missing step and missing subtotal noted; non-income table refused; one trace per
  year grouped; existing chart types give identical figures.
- Renderer: Waterfall offered, Display and Series-from hidden, refusal clears the plot.
- By hand, once per line: an income statement with gross_profit and
  operating_income moved after their costs; check the walk for three years, an
  unticked cost producing "Other", a balance sheet refused, and that the provider's
  expense lines are stored positive (no "Other" of about twice a cost).

## Left to the builder

- How roles travel from the compile to the chart.
- Picker label and placement; hover wording; the "Other" colour (neutral grey
  suggested); increase/decrease styling beyond the year colour.
- Test fixture shapes.
