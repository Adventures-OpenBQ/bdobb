# Linked chart composition views: 100% stacked and pie

Date: 2026-11-14. Repo: Adventures-OpenBQ/bdobb. Home line: release/v4 (tag `v4.0.0`), carried forward.

## Why

The user wants to see how a company's composition changes year over year: the
asset, liability and equity mix of a balance sheet first, then the same for
other statements and any table. Research on how financial-statement data is
charted (2026-11-14) found that the year-over-year mix question is best
answered by one 100% stacked column chart with a column per year (common-size
analysis), while a pie suits a single year's breakdown. Several pies side by
side are hard to compare.

This is the first release of a larger idea. It began as "Art's Charts category
pages", a panel per year in one Art's Charts graphic (bdobb-v2
`docs/superpowers/specs/2026-10-04-arts-charts-category-pages-reference.md`).
The user ruled that this belongs in the **linked chart**, not Art's Charts.
Art's Charts is a time-series tool; the linked chart presents what a table has
calculated.

## Goals

1. The linked chart gains a **100% stacked** display for columns and bars:
   every stack is normalised to 100%, and the hover shows both the value and
   its share.
2. The linked chart gains a **Pie** chart type showing one measure, such as one
   year, across the category's rows.
3. A **Series from: Columns / Rows** switch lets a table whose rows are line
   items and whose columns are years stack the items within each year. Today
   each measure column becomes a series. With Rows, each row becomes a series
   and the measure columns become the x-axis.
4. Each item keeps the same colour in every year and every chart, because the
   colour comes from the item's identity.

## Non-goals (later releases)

- A row of pies, one per year, which needs the table to hand over several
  page slices at once.
- Waterfall and Sankey charts.
- Ready-made statement mixes such as "Asset mix", with subtotals left out
  automatically. This was approach B.
- Rita setting linked chart options.
- Any change to Art's Charts.

## Anti-goals

- Never drop, flip or reinterpret a financial value without saying so.
- Never imply that data the table did not deliver exists.

## Approaches considered

- **A. Extend the linked chart (chosen by the user).** Add the 100% display, a
  Pie type and the Series-from switch. The table's existing filter checklist
  stays the only place where lines are chosen. Small, and works for any table.
- **B. A dedicated statement chart.** A linked chart mode that knows the
  statement templates and offers ready-made mixes. Better for balance sheets,
  but much more work and limited to statements. It can be added on top of A
  later.
- **C. Saved templates over today's chart.** Without the swap and the new
  types it cannot draw these charts at all.

## Design

### Settings: `LinkedChartSettings` in `src/lib/widgetData/types.ts`

- `type` becomes `"bar" | "column" | "line" | "pie"`.
- `display` becomes `"grouped" | "stacked" | "percent"`. `"percent"` is
  offered for `column` and `bar` only and shows as "100% stacked".
- New optional `seriesFrom?: "columns" | "rows"`. Absent means `"columns"`, so
  every existing card is unchanged. It is offered for `column`, `bar` and
  `line`, and hidden for `pie` (see Pie).

Two places write or validate these settings:

- the renderer's controls (`src/components/renderers/LinkedChartRenderer.tsx`);
- the dashboard import check (`src/lib/appsExtensionsV4.ts`, "Invalid linked
  chart"). This is the only list of allowed values; today it allows bar,
  column and line, and grouped and stacked.

Persistence (`src/lib/widgetData/persistence.ts`) passes `linkedChart`
through unchanged and needs no change. A round-trip test still guards it.

**Fields that don't apply to the current type (decided in the builder
check).**
- Changing the chart type resets the fields the new type cannot use:
  - `percent` becomes `stacked` when the type changes to line or pie;
  - `seriesFrom` is cleared when the type changes to pie.
- `buildLinkedFigure` also ignores any such leftover: line draws as a line,
  and pie always takes series from columns. A hand-edited or older file
  therefore still draws.
- The import check validates each field against its own allowed values and
  never rejects a combination, so a dashboard the app wrote always imports.

A dashboard saved with the new values and opened on a line without them fails
that line's import check. This is accepted: the carry puts the feature on
every later line.

### Figure: `buildLinkedFigure` in `src/lib/widgetData/chartFigure.ts`

**Columns, the current behaviour.** Each measure is a series; the category's
rows are the x-axis.

**Rows.** Each row is a series, named by its category value. Each measure
column is an x position, labelled the way the column's legend name is built
today: its `splitPath` labels, then its label. Hover text carries the row
label, the column name and the value.

**100% stacked.** Plotly `barmode: 'stack'` with `barnorm: 'percent'`. The
hover shows the raw value and its share of that stack's total. The axis
reads percent.

**Pie.**
- One Plotly `pie` trace. The slice labels are the category's rows; the values
  come from the single chosen measure.
- With more than one measure ticked, nothing is drawn and the chart says
  "Pie shows one measure — choose one" (status line, not an error state).
- Series-from is hidden for pie. A table with years as rows needs Series
  from: Columns, with the year as the category. This is the builder's call;
  revisit if it proves awkward.

**Colours.**
- In Rows mode and for pie slices, colour by the row's identity: its category
  value, plus its `groupPath` members where present.
- In Columns mode, colour stays as today.
- The palette and hash stay the existing `color()`.

**Rows with the same category value (decided in the builder check).**
- In Rows mode and in pie they stay separate series or slices, never merged.
- A name is disambiguated with its `groupPath` labels, the way hover text is
  built today, e.g. "Revenue — Segment: Cloud".
- Two rows that are still identical after that are suffixed " (2)",
  " (3)" in row order. They share a colour, because their identity is
  the same.

### Values a share cannot show (pie and 100% stacked only)

This follows from the anti-goal.

- **Negative values.** If any value to be drawn is negative, the chart draws
  nothing and lists the offending items and positions, at most 5 followed by
  "and N more". For example: "Can't show shares of negative values:
  treasury_stock (FY2025)." The user unticks those lines in the table.
- **Zero total.** A stack or pie whose total is zero draws nothing, with a
  message naming the year or measure.
- **Missing values.** These are left out of that stack or pie, and a status
  line lists them ("Missing: inventory (FY2023)"). The chart still draws.
- Grouped, plain stacked and line charts are unchanged; negatives are fine
  there.

**How a refusal shows (decided in the builder check).**
- A refusal clears the plot, including any chart drawn before it. The
  message appears as a status line, not as an alert.
  - Leaving the previous chart up under the message would look like a share
    chart of data the chart has just refused, which breaks the anti-goal.
  - A failed fetch is different: it keeps today's behaviour of showing the
    last completed chart, marked stale.
- `buildLinkedFigure` therefore needs a third result alongside `ok:true` and
  `ok:false`: refused, with its message.
- Its success result also carries `notes` for the "Missing: …" lines, so the
  chart draws with its notes underneath.
- Today's `ok:false` cases (a missing field, a non-numeric measure) stay
  errors as now.

### Lines that overlap

A balance sheet table has subtotals and totals among its rows: `cash` next to
`cash_and_cash_equivalents`, and `total_current_assets` and `total_assets`
next to their parts. Stacking or pieing all of them counts the same money
more than once. In this release the user chooses non-overlapping lines with
the table's filter checklist. The chart cannot detect the overlap, so no
warning is promised. Ready-made mixes (approach B) are the later fix.

## Constraints

- **Release line.** Build and PR against the released `v4.0.0` commit on
  release/v4, then carry to v5 through v10 and main, one line at a time in the
  release walk.
  - v11 and v12 are not public. They pick the feature up through their own
    carries when those lines are next worked.
  - Nothing merges outside the release walk.
  - Public bdobb pushes are on hold: push only where the user says, and ask
    first.
- **Headers.** The house copyright header is AGPL-3.0-only.
- **No new dependencies.** Plotly already ships pie, `barnorm` and stacking.
- **Gates on every line:** `pnpm install --frozen-lockfile`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test:run`, `pnpm scrub`, and `pnpm test:web` where it
  exists.

## Testing

- **`chartFigure.test.ts`:**
  - Rows mode builds one trace per row, with measure columns as x.
  - Percent sets `barnorm`, and the hover carries the share.
  - Pie builds one pie trace and refuses more than one measure.
  - Negative and zero-total values are refused with the item list (capped at
    5).
  - Missing values are listed and the chart still draws.
  - An item has the same colour in every year.
  - Existing cards (no `seriesFrom`, grouped or stacked) give byte-identical
    figures.
- **Renderer test:**
  - The new controls appear for the right types: Display offers 100% for
    column and bar, and Series-from is hidden for pie.
  - A change commits settings, and changing the type resets fields the new
    type can't use.
  - A refusal clears a previously drawn chart and shows a status line, not an
    alert.
  - A failed fetch still keeps the stale chart.
  - Duplicate category values in Rows mode give disambiguated names.
- **`appsExtensionsV4` and persistence tests:**
  - The new values round-trip.
  - Any combination of valid field values imports.
  - Unknown values are still refused.
- **By hand, once per line:** a balance sheet table with items as rows and
  fiscal years as columns. Tick asset lines with no subtotals, link a chart, and
  check:
  - 100% stacked with Series from Rows;
  - a pie of one year;
  - a negative line ticked gives the refusal.

## Left to the builder

- Exact control labels and layout within the existing chart controls.
- The hover template wording.
- Whether percent axis ticks show 0–100 with a % suffix.
- Test fixture shapes.
