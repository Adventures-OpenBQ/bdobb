# Libre Terminal statements in the pivot — design

Date: 2026-11-28. Repo: Adventures-OpenBQ/bdobb.

## Why

Libre Terminal (https://github.com/samlazs/libre-terminal) serves the OpenBB
Platform's statement routes (`/api/v1/equity/fundamental/{income,balance,cash}`,
providers `yfinance` and `sec`). From release 1.1 it admits BDOBB's desktop
origins through `TERMINAL_EXTRA_ORIGINS`, so it can be a Connection on the same
computer. v10's discovery reads both of its endpoints without change (verified
2026-11-27 in a real window through the MCP bridge: 1044 widgets on the data
port, 51 on the views port).

Its statement cards load in v10 as plain tables, and the quick Statement view
recognises them. Two things are missing:

1. Most lines land under **Other**, because both taxonomies are keyed to FMP and
   EODHD names (AAPL through Libre: 144 of 275 lines across the six statements).
2. A statement cannot be **rearranged**. The quick view is a fixed transpose
   (`StatementRenderer`: "no sort, filter, pins or resize"), and the Pivot toggle
   is hidden while it is shown (`WidgetCard.tsx`).

BDOBB already has the machinery to do this properly: the Statement template
(`src/lib/statementModel/`) compiles a statement into a real pivot model whose
categories are Section, Line item, Company and Period. This design makes that
machinery reach Libre's rows without hand-authoring, and adds a layout choice.

## Placement (ruled 2026-11-28)

- Home line **v10**. Build on `release/v10` in this worktree
  (`claude/v10-libre-statements`), PR into `release/v10`, then carry forward to
  `main`.
- "v10 is Libre compatible" is the acceptance statement for this work.

## Decisions (ruled 2026-11-28)

- Approach: **auto-bound Statement templates**. Not an extension of the quick
  view alone, and not a provider-neutral concept layer.
- First version covers **one company and several companies side by side**.
  Showing the same company from two providers in one view is out of scope.
- **None of Libre Terminal's code or data files is an input.** See the next
  section. Its statement card is a reference for behaviour only.
- No change to OpenBQ-yfinance or openbq-docker.
- Companies are compared by **fiscal-year matching**, not by calendar year of
  the period end.
- Fiscal context reaches the pivot as **explicit row fields** (fiscal year,
  quarter, period start and end stamped on each row), not as per-company
  context. Each exported row then describes its own period.
- **Company is a third dimension** beside Line item and Period. Any one of the
  three can be the page: the card shows one member of it at a time, with a
  selector to step through the rest.
- The work **reuses BDOBB's fiscal awareness and symbol-list conventions**. It
  adds rungs and callers to them; it does not build a second fiscal or
  multi-symbol mechanism beside them.

## Clean-source rule

Libre Terminal is AGPL-3.0-or-later, which BDOBB (AGPL-3.0-only) could accept,
but the ruling is not to pull its code in. The line vocabulary added here is
built only from:

1. the `yfinance` SDK's own list of statement keys (Apache-2.0), snake-cased;
2. the OpenBB SEC provider's statement field definitions (Apache-2.0);
3. field names observed in live rows, recorded as fixtures with the date,
   symbol, provider and backend version they came from.

`terminal/static/statements.js` in Libre Terminal (its ordered line maps) must
not be read while authoring the vocabulary, and no list may be generated from
it. Section placement is BDOBB's own judgement.

An earlier exploratory patch to `src/lib/statementTaxonomy.ts` took part of its
coverage from those line maps. It was withdrawn and deleted on 2026-11-28 and
never entered this repository. Its test results are evidence that the approach
works, nothing more.

## What exists today (v10, read 2026-11-28)

- `src/lib/statementRows.ts` — the quick view. `widenLongRows` turns long-form
  rows (`line_item` + `value`) into one row per symbol and period;
  `detectStatement` picks income, balance or cash from anchor fields.
- `src/lib/statementTaxonomy.ts` — the quick view's sections.
- `src/lib/statementModel/` — `StatementIntent` (template, bindings, overrides),
  `compileStatement`, template catalogue pinned at `1.0.0`, update preview.
  `taxonomy.ts` there is a second, separate copy of the section lists and says
  "Explicit provider slots; aliases remain independent. No detection or
  fallback."
- `compile.ts` fixes the layout: rows `[section, item]`, columns `[period]`.
- `statementPresentation.ts` reads the layout positionally (`rows[0]` section,
  `rows[1]` item, `columns[0]` period), so the Statement renderer only
  understands lines-by-period.
- `StatementPanel.tsx` — authoring by hand: one field selector per line.
- Bindings require `companyFieldId` and `periodKindFieldId` (`validation.ts`).

Fiscal awareness:

- A backend statement card (its **Period** offers FY and FQ,
  `isStatementPeriodParam`) relabels its rows from the reporting company's
  fiscal year end before any view reads them. Table, Statement, charts and
  exports all see the relabelled rows; `fiscal_year` and `fiscal_period` are
  rewritten to match (`help/topics/statement-view.md`).
- The year-end month comes from `fiscalChain.ts`, first answer wins: the card's
  **FY ends** override, the parameter's declared fields, the widget's, then the
  lookup `GET api/v1/fundamentals/fiscal_year_end?symbol=` on the card's backend
  (`useFiscalYearEnd`, called from `useCardRequest`; a 404 is remembered as "no
  answer"), then December.
- The lookup only runs for exactly one ticker (`singleTicker`): a comma in the
  value stands it down.
- When the year end is unknown, a date cannot be read, or several symbols share
  rows with no symbol column, rows stay as served and the card says *Fiscal
  labels as reported*.
- `periods.ts` owns the naming: `fiscalPeriod`, `formatFiscalLabel`,
  `fiscalYearSpan`, `quarterSpan`. A January filer's quarter ending July 2026 is
  `FY2027-Q2`.

Symbol lists:

- A ticker parameter is one whose type is `ticker` or `symbol`, or whose name is
  `symbol` (`isTickerParam`).
- Lists travel comma-joined: multi-select values, and a `multiple` dropdown's
  typed list (`help/topics/card-parameters.md`).
- A dataset's provenance carries the acquisition's `symbol` parameter;
  `symbolList(provenance)` splits it, and linked charts use it to check which
  symbols the data covers (`widgetData/chartRecipes/priceEvidence.ts`).
- Rows holding several companies are already handled by the quick view: every
  company is kept and each period column is prefixed, `AAPL FY2025`.

## What Libre's rows look like (recorded 2026-11-27, Libre Terminal 1.1.0)

- Wide: one row per period, newest first, one column per line.
- `yfinance`: identity is `period_ending` only. No symbol, no period kind.
- `sec`: `period_ending`, `fiscal_period`, `fiscal_year`, `reported_currency`.
  No symbol.
- One symbol per request. `symbol=AAPL,MSFT` returns no rows from `yfinance` and
  an error from `sec` ("Could not find CIK").
- Libre has no fiscal-year-end route, so a statement card reads *Fiscal labels
  as reported*.
- Yahoo reports some figures under two names with identical values (for AAPL:
  `interest_income` and `interest_income_non_operating`; `other_income_expense`
  and `other_non_operating_income_expenses`).

## Design

### A. Statement source adapter

A pure function between the card's fetched payload and the table worker, used
only when the card is bound to a Statement intent that asks for it.

- Adds `symbol` and `period_kind` columns to every row, from the card's own
  ticker parameter (`isTickerParam`) and `period` parameter values. A row that
  already carries a `symbol` keeps it.
- The symbol list is the ticker parameter's value in BDOBB's existing
  comma-joined form. No new parameter, control or syntax.
- A list fans out to one request per symbol, sequentially, capped at **8**.
  Rows are concatenated in list order. A backend that accepts a list in one
  request (its ticker parameter is `multiSelect` or `multiple`) is sent the
  list unchanged and is not fanned out.
- The dataset's provenance keeps the comma-joined `symbol` exactly as the
  parameter holds it, so `symbolList(provenance)` and the linked charts that
  rely on it see the same list they would for any other multi-symbol card.
- Because every row now carries `symbol`, the existing per-company handling
  applies unchanged: prefixed period headers in the quick view, and per-symbol
  fiscal relabelling (section A2).
- A symbol whose request fails does not fail the card: it is named in a notice
  line under the header, as SSRM warnings are, and the rest render. All failing
  is the card's ordinary error state.
- Over the cap: refuse with a message naming the cap. No silent truncation.
- The added columns are marked as derived so export and linked tables can tell
  them from served data.

### A2. Fiscal context, through the existing chain

Fiscal-year matching needs every company's rows labelled with its own fiscal
year. That is what the relabelling step already does; this section makes it
reach a fanned-out card and a backend with no lookup route.

- **Per symbol.** A fanned-out card resolves the chain once per symbol.
  `singleTicker` keeps its meaning for single-symbol cards; the fan-out calls
  the lookup itself for each symbol. The lookup's cache is already per
  upper-cased ticker.
- **The card's FY ends override** still wins, and applies to every symbol on
  the card. It is the user's statement that they all share a year end.
- **A new rung, `rows`,** after the lookup and before the December default, for
  a backend that serves no `fiscal_year_end` route (Libre Terminal):
  1. rows that carry their own `fiscal_year` and `fiscal_period` (the `sec`
     provider) are used as they are;
  2. annual rows: the month of the company's `period_ending`;
  3. quarterly rows with neither: one extra annual request for that symbol,
     `limit=1`, to read the year-end month. If it fails, that symbol stays
     *as reported*.
  `FiscalSource` gains `"rows"`, and `fiscalLabel` words it so the card says
  where the month came from, as it does for the other sources.
- **Naming** is `periods.ts`'s, unchanged. No second labelling rule.
- **Explicit row fields (ruled).** After relabelling, the adapter stamps
  `fiscal_year`, `fiscal_period`, `period_start` and `period_end` on every row,
  the bounds from `fiscalYearSpan` and `quarterSpan`. Rows that already carry
  `fiscal_year` and `fiscal_period` keep them; only the bounds are added.
  Stamped columns are marked derived, like `symbol` and `period_kind`.
- **Binding.** Auto-binding (section C) fills the model's `FiscalBinding` with
  those four fields and the period kind, the explicit form `compile.ts` and
  `resolveFiscalPeriod` already accept. The pivot's Period category is then the
  fiscal period, not the date.
- **Companies across** pages on the fiscal label (`FY2026`, or `FY2026-Q2` for
  FQ). A company with no row for that label shows an empty column and is named
  in a notice. Nothing is shifted to the nearest date.
- **When it cannot.** If any company on the card is *Fiscal labels as
  reported*, no fiscal fields are stamped for it. Layouts that put Company on
  an axis are refused with that reason and the company named. Paging by
  Company still works, because each page holds one company on its own dates.

### B. Template 1.1.0

A new pinned version beside `1.0.0`, which is not edited (its comment forbids
rewriting a version).

- Adds lines for the `yfinance` and `sec` vocabularies, sourced as in the
  clean-source rule. OpenBQ-yfinance's own spellings (Yahoo's label snake-cased,
  not renamed, e.g. `pretax_income`, `stockholders_equity`) are included from
  the same SDK key list.
- Per-share and share-count income lines get `unit: 'shares'` or a per-share
  unit and sit in their own section, instead of being left unlisted.
- A line may carry `emphasis: 'subtotal' | 'total'`. The renderer bolds it.
  This is a template schema addition; `validation.ts` must accept it for 1.1.0
  and still reject it on a 1.0.0 snapshot.
- `src/lib/statementTaxonomy.ts` (quick view) is regenerated from the same
  vocabulary, so the two copies stop drifting. One source file, two consumers.
- Saved 1.0.0 statements move up through `previewStatementUpdate`. Nothing
  migrates silently.

### C. Auto-binding

A pure function: `(columns, cardParams) → proposal`.

- Chooses the template with `detectStatement`.
- Chooses the shape: long when `widenLongRows` would accept the rows, else wide.
- Binds company to `symbol`, period kind to `period_kind`, report date to
  `period_ending` (else `date`), and currency to `reported_currency` when
  present.
- Wide: one mapping per column whose id equals a template line's field name.
  Exact match only. No fuzzy matching, no aliases.
- Returns the numeric columns it could not map as `unmapped`. They are shown in
  the panel and offered as lines in an **Unmapped** section, never dropped.
- The proposal opens in the existing `StatementPanel` for preview. Nothing is
  saved until the user calculates a preview and saves, as today.
- Entry point: a **Statement template** action on a table card whose rows
  `detectStatement` recognises, beside the existing View control.

### D. Layout on the intent

A statement has three dimensions: Line item (under Section), Period and
Company. `StatementIntent` gains `layout`, which names what goes down, what
goes across, and what is paged. Three presets:

| Preset | Down | Across | Paged | Renderer |
|---|---|---|---|---|
| `lines-by-period` (default) | Section, Line item | Period | Company | Statement |
| `lines-by-company` | Section, Line item | Company | Period | Pivot grid |
| `periods-by-line` | Period | Line item | Company | Pivot grid |

- The paged dimension uses the model's existing `page` selection
  (`PageSelection`, already carried on the intent). The card shows a selector
  for it with previous and next, and the choice saves with the card.
- With one company the Company page has one member and the selector is not
  drawn. A single-company card looks exactly as it does today.
- `lines-by-period` paged by Company is the default for several companies:
  each company is a full statement, one at a time, in the Statement renderer.
  The quick view's composed headers (`AAPL FY2025`) remain what the quick view
  does; a bound statement pages instead.
- `compileStatement` emits rows, columns and page from the preset.
- `statementPresentation` is used for `lines-by-period` only; the other two go
  to the ordinary pivot grid, which already handles arbitrary layouts.
- The Pivot toggle stops being hidden for a card with a Statement intent and
  opens the preset choice.
- `schemaVersion` on the intent goes from 2 to 3; a version 2 intent reads as
  `lines-by-period`.

### E. Duplicate lines

- After mapping, two lines whose values are identical in every delivered period
  (and non-null in at least one) are a duplicate pair. The later one in template
  order is hidden by default.
- A **Show duplicates** control on the card reveals them. The hidden count is
  stated beside it.
- Detection is from the data on screen. There is no list of known duplicates.

### F. Help

- `src/help/topics/connections.md`: "Libre Terminal as a backend" — the
  `TERMINAL_EXTRA_ORIGINS` setting, the two endpoints (`:6900` data, `:6950`
  views), same-computer only, and that the views endpoint serves no `apps.json`.
- `src/help/topics/statement-view.md`: auto-binding, the three presets, several
  companies, duplicates.
- `src/help/topics/credits.md`: names Libre Terminal as a supported backend.
  No derived-work credit is owed under the clean-source rule; the entry is a
  courtesy its author asked for.

## Shared rules

- Backend rows are untrusted JSON. A malformed value is treated as absent.
- A card with no Statement intent behaves exactly as today.
- New files carry the AGPL-3.0-only header (`scripts/header-check.sh`).
- No new dependency.

## Testing

- Unit: adapter (stamping, fan-out order, partial failure, cap), auto-binding
  (wide, long, unmapped), each preset's compiled layout, duplicate detection,
  1.0.0 → 1.1.0 update preview, version 2 → 3 intent read.
- Unit, fiscal: the `rows` rung in each of its three cases; its place in the
  chain (after the lookup, before December, below the card override); a
  January filer and a December filer on one card land on their own `FY` labels;
  `lines-by-company` refused when a company is *as reported*.
- Unit, symbol list: provenance keeps the comma-joined `symbol`;
  `symbolList(provenance)` returns the card's list; a `multiSelect` ticker
  parameter is not fanned out.
- Fixtures: recorded rows for AAPL, JPM and XOM (an industrial, a bank, an oil
  major) from Libre Terminal 1.1.0 (`yfinance`, `sec`) and OpenBQ-yfinance
  3.0.0, each with its provenance line.
- Acceptance per statement: every dollar line placed in a section; only
  per-share, share-count and ratio lines outside the money sections.
- Native: a bridge walk against the `libre-bdobb` container — connect, add the
  Yahoo income card, bind, switch through the three presets, add a second
  symbol — with screenshots, in the style of `bridge-smoke.sh`.

## Out of scope

- Provider-neutral concepts (the same line across Yahoo, SEC and EODHD).
- Libre Terminal's computed views (`/x/*`).
- Widgets Libre refuses to serve into a frame (the request carries no origin).
- Asking a different connected backend for a company's fiscal year end. The
  lookup stays on the card's own backend.
- Logos or other `symbol_meta` on statement cards.

## Open items for the plan

1. **Where the per-symbol requests are made.** Not ruled; the design default is
   the card's own request path (`useCardRequest`), where fiscal relabelling
   already runs, so Table, Statement, charts and exports all read the merged
   rows. The plan confirms this against the code. A server-managed table bound
   to the same widget does not fan out in this version.
2. **Page selector placement.** Whether the Company or Period selector sits in
   the card header beside View or in the pivot's existing page strip.
3. **Release artefacts.** `SOURCE-MANIFEST.json` hashes every file and
   `source-offer.json` is bound to it. Regenerating them is part of the release
   process, not of this change; the PR must say so.
4. **Pre-commit hook.** `.githooks` secret-gate failed with `FileNotFoundError`
   in a fresh clone on 2026-11-27. Confirm it runs in this worktree before the
   first commit; do not bypass it.
