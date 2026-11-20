# Linked Chart Composition (100% stacked, Pie, Series from Rows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The linked chart gains a 100% stacked display, a Pie type and a Series-from Columns/Rows switch, and refuses share views it cannot draw honestly.

**Architecture:** `LinkedChartSettings` widens; the v4 import check validates each field on its own. `buildLinkedFigure` builds one series-by-position value matrix (Columns or Rows), runs the share checks on it for pie and percent, and returns a figure with `notes`, an error, or a refusal. `LinkedChartRenderer` adds the controls, resets fields the new type cannot use, and shows a refusal as a status line with the plot cleared.

**Tech Stack:** React 19 + TypeScript, Plotly figures (already a dependency), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-14-linked-chart-composition-design.md`

## Global Constraints

- Work only in this worktree, branch `claude/v4-linked-chart-types`, cut from tag `v4.0.0`. No pushes, tags or PRs.
- Out of scope: the carry to v5–v10 and main (a later release-walk step); v11/v12; Rita; Art's Charts; row of pies; waterfall/Sankey; ready-made statement mixes.
- No new files are planned. If one is needed, its header is exactly:
  `// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.`
  `// SPDX-License-Identifier: AGPL-3.0-only` — never an Apache header.
- No new dependencies. Plotly already provides `pie`, `barnorm` and stacking.
- Tests use fakes only (the existing `Boundary` worker, `input` fixture, in-memory store); no network.
- During tasks run single files: `pnpm vitest run <file>`. The full suite can time out under host load; run it only in the final gate step.
- Gates (final step): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm scrub`, `pnpm test:web` (exists in package.json).
- Anti-goals: never drop, flip or reinterpret a financial value without saying so; never imply data the table did not deliver.
- Exact copy (straight apostrophe, em dash `—`):
  - `Pie shows one measure — choose one`
  - `Can't show shares of negative values: <list>.`
  - `Can't show shares of a zero total: <list>.`
  - `Missing: <list>` (no trailing period)
  - `<list>` items are `name (position)` (zero total: `position` only), joined `, `; at most 5, then `, and N more`.
  - Duplicate names: `Revenue — Segment: Cloud`, then ` (2)`, ` (3)` in row order.
  - Display option label `100% stacked`.

## Rulings made while planning (spec silent; flag at review)

1. Result type: a single `ok:false` variant with optional `refused: true`, so every existing caller (`.ok` checks in `finalReview.test.ts`, the renderer, the figure tests) compiles unchanged.
2. Zero-total refusal applies to a stack or pie with at least one present value summing to 0. A stack where every value is missing is only listed under `Missing:`.
3. The 5-item cap and `and N more` also apply to the `Missing:` and zero-total lists.
4. Display is hidden for Pie as well as Lines.
5. `revision` gains a trailing `'rows'` element only when Rows is in effect, so existing cards keep byte-identical figures and uirevision.
6. The import check keeps its current shape: it adds `seriesFrom` validation but no `keys()` check on `linkedChart` (unknown keys were never refused there; refusing them now could break files the app wrote).
7. The help pages that list the chart controls are updated (Task 4, Step 7) so they do not describe the old controls.

## Review Focus

1. A pie or 100% stack over rows whose category labels repeat: Plotly merges equal pie labels, so names must be unique before they reach the trace (Task 2 duplicate test, Task 3 pie test).
2. An old or hand-edited card (`line` + `percent`, `pie` + `seriesFrom: 'rows'`) must still draw: line as a plain line, pie from columns (Task 3 leftover test).
3. A refusal after a good chart must not leave the old share chart on screen, and must not show the "stale" line, which would imply the old chart is current (Task 4 refusal test).
4. A stack that is entirely missing must not be called a zero total (Task 3 all-missing test).
5. Existing grouped/stacked Columns cards must keep the exact figure, including no `barnorm: undefined` key (inline snapshots in Task 2, Step 1; never update them with `-u`).

---

### Task 1: Settings values, import check, persistence round-trip

**Files:**
- Modify: `src/lib/widgetData/types.ts:90-95`
- Modify: `src/lib/appsExtensionsV4.ts:84-87`
- Test: `src/lib/appsJson.cleanV4.test.ts` (the tests for the v4 import check live here; there is no `appsExtensionsV4.test.ts`)
- Test: `src/lib/widgetData/persistence.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LinkedChartSettings = {
    type: "bar" | "column" | "line" | "pie";
    category?: string;
    measures: string[];
    display: "grouped" | "stacked" | "percent";
    seriesFrom?: "columns" | "rows"; // absent means "columns"
  };
  ```

- [ ] **Step 1: Write the failing tests**

In `appsJson.cleanV4.test.ts`, next to `v4 accepts omitted optional chart fields…`:

```ts
it('v4 round-trips every new linked chart value, in any combination', () => {
  for (const linkedChart of [
    { type: 'pie', display: 'grouped', category: 'region', measures: ['revenue'] },
    { type: 'column', display: 'percent', category: 'region', measures: ['revenue'], seriesFrom: 'rows' },
    { type: 'pie', display: 'percent', category: 'region', measures: ['revenue'], seriesFrom: 'rows' }, // leftover combination still imports
    { type: 'line', display: 'percent', measures: ['revenue'], seriesFrom: 'columns' },
  ] as const) {
    const exported = exportCompatibleApp({ id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [card({ linkedChart, paramsOpen: true })] }] });
    if (!exported.ok) throw new Error(exported.issue.message);
    expect(importApps([JSON.parse(JSON.stringify(exported.value))], []).dashboards[0].tabs[0].cards[0].linkedChart).toEqual(linkedChart);
  }
});
```

Extend the `invalid` list in the existing malformed test with
`{ linkedChart: { type: 'column', display: 'percentage', measures: [] } }` and
`{ linkedChart: { type: 'column', display: 'grouped', measures: [], seriesFrom: 'diagonal' } }`.

In `persistence.test.ts`:

```ts
it('persists the new linked chart values unchanged', () => {
  const linkedChart = { type: 'pie', category: 'item', measures: ['fy2025'], display: 'percent', seriesFrom: 'rows' } as const;
  expect(persistedCard({ ...child, linkedChart }).linkedChart).toEqual(linkedChart);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/appsJson.cleanV4.test.ts src/lib/widgetData/persistence.test.ts`
Expected: the round-trip test FAILS with `Invalid linked chart.`, and the malformed test FAILS because `seriesFrom: 'diagonal'` imports. (Vitest does not typecheck, so the new literals compile only after Step 3.)

- [ ] **Step 3: Widen `LinkedChartSettings` and the import check**

`types.ts`: the type in Interfaces. `appsExtensionsV4.ts`: allowed lists become `['bar', 'column', 'line', 'pie']` and `['grouped', 'stacked', 'percent']`, plus `(c.seriesFrom !== undefined && !['columns', 'rows'].includes(c.seriesFrom as string))` in the same `Invalid linked chart.` condition. No combination checks.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/lib/appsJson.cleanV4.test.ts src/lib/widgetData/persistence.test.ts` → PASS. Then `pnpm typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/widgetData/types.ts src/lib/appsExtensionsV4.ts src/lib/appsJson.cleanV4.test.ts src/lib/widgetData/persistence.test.ts
git commit -m "feat(linked-chart): accept pie, 100% stacked and series-from values"
```

---

### Task 2: Figure result with notes and refusal; Series from Rows

**Files:**
- Modify: `src/lib/widgetData/chartFigure.ts`
- Test: `src/lib/widgetData/chartFigure.test.ts`

**Interfaces:**
- Consumes: `LinkedChartSettings` from Task 1.
- Produces:
  ```ts
  export type LinkedFigureResult =
    | { ok: true; figure: PlotlyFigure; revision: string; notes: string[] }
    | { ok: false; message: string; refused?: true };
  export function buildLinkedFigure(dataset: WidgetDataset, settings: LinkedChartSettings, theme: 'light' | 'dark'): LinkedFigureResult;
  ```
  `refused: true` means "draw nothing, show `message` as a status line". Without it, `ok:false` is today's error.

- [ ] **Step 1: Pin today's figures before touching the code**

Add, run once on unchanged code so Vitest fills the inline snapshots into the test file, and commit them with this task (the repo has no `.snap` files; keep it that way):

```ts
it.each([
  ['grouped column', settings],
  ['stacked bar', { ...settings, type: 'bar', display: 'stacked' }],
  ['line', { ...settings, type: 'line' }],
  ['explicit columns', { ...settings, seriesFrom: 'columns' }],
] as const)('existing %s cards give byte-identical figures', (_, s) => {
  expect(JSON.stringify(figure(s as LinkedChartSettings))).toMatchInlineSnapshot();
});
```

Run: `pnpm vitest run src/lib/widgetData/chartFigure.test.ts` → PASS with four inline snapshots written. `it.each` shares one inline snapshot call site, so if Vitest refuses that, write four separate `it` blocks instead. The `explicit columns` string must equal the `grouped column` one (check by eye).

- [ ] **Step 2: Write the failing Rows tests**

```ts
const years: WidgetDataset = { ...dataset,
  columns: [{ id: 'item', label: 'Item', dtype: 'text' }, { id: 'fy24', label: 'FY2024', dtype: 'number' }, { id: 'fy25', label: 'FY2025', dtype: 'number' }],
  rows: [{ id: 'cash', values: { item: 'cash', fy24: 10, fy25: 30 } }, { id: 'inv', values: { item: 'inventory', fy24: 30, fy25: 10 } }] };
const rows: LinkedChartSettings = { type: 'column', category: 'item', measures: ['fy24', 'fy25'], display: 'grouped', seriesFrom: 'rows' };

it('rows mode builds one trace per row with the measure columns as x', () => {
  const f = figure(rows, years);
  expect(f.data).toHaveLength(2);
  expect(f.data[0]).toMatchObject({ type: 'bar', name: 'cash', x: ['fy24', 'fy25'], y: [10, 30] });
  expect(f.layout.xaxis).toMatchObject({ tickvals: ['fy24', 'fy25'], ticktext: ['FY2024', 'FY2025'] });
  const text = (f.data[0] as { text: string[] }).text[1];
  expect(text).toContain('cash'); expect(text).toContain('FY2025'); expect(text).toContain('30');
  expect(figure({ ...rows, type: 'bar' }, years).data[0]).toMatchObject({ orientation: 'h', x: [10, 30], y: ['fy24', 'fy25'] });
  expect(figure({ ...rows, type: 'line' }, years).data[0]).toMatchObject({ type: 'scatter', x: ['fy24', 'fy25'] });
});
it('rows mode labels a split measure position with its split path', () => {
  const split = { ...years, columns: [years.columns[0], { ...years.columns[1], splitPath: [{ field: 'Symbol', value: 'AMD' }] }] };
  expect(figure({ ...rows, measures: ['fy24'] }, split).layout.xaxis).toMatchObject({ ticktext: ['AMD — FY2024'] });
});
it('rows mode keeps duplicate category values as separate, disambiguated series', () => {
  const d = { ...years, rows: [
    { id: 'a', values: { item: 'Revenue', fy24: 1 }, groupPath: [{ field: 'Segment', value: 'cloud', label: 'Cloud' }] },
    { id: 'b', values: { item: 'Revenue', fy24: 2 }, groupPath: [{ field: 'Segment', value: 'devices', label: 'Devices' }] },
    { id: 'c', values: { item: 'Cost', fy24: 3 } }, { id: 'd', values: { item: 'Cost', fy24: 4 } }] };
  const f = figure({ ...rows, measures: ['fy24'] }, d);
  expect(f.data.map(t => (t as { name: string }).name)).toEqual(['Revenue — Segment: Cloud', 'Revenue — Segment: Devices', 'Cost', 'Cost (2)']);
  expect((f.data[2] as { marker: unknown }).marker).toEqual((f.data[3] as { marker: unknown }).marker);
});
it('an item keeps its colour by identity, whatever the row order or measure set', () => {
  const a = figure(rows, years), b = figure({ ...rows, measures: ['fy25'] }, { ...years, rows: [...years.rows].reverse() });
  expect((b.data[1] as { marker: unknown }).marker).toEqual((a.data[0] as { marker: unknown }).marker);
});
it('rows mode changes the revision; columns mode keeps it', () => {
  expect(figure(rows, years).layout.uirevision).not.toBe(figure({ ...rows, seriesFrom: undefined }, years).layout.uirevision);
  expect(figure({ ...settings, seriesFrom: 'columns' }).layout.uirevision).toBe(figure().layout.uirevision);
});
it('success carries an empty notes list for plain charts', () => {
  const r = buildLinkedFigure(dataset, settings, 'dark');
  expect(r.ok && r.notes).toEqual([]);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/lib/widgetData/chartFigure.test.ts` → the new tests FAIL (one trace per measure, no `notes`); the inline snapshots PASS.

- [ ] **Step 4: Implement**

In `chartFigure.ts`:
- Export `LinkedFigureResult` and use it as the return type; success adds `notes: []` for now.
- Keep the per-measure validation exactly (same messages, same order) and collect each measure's `values`, `name` (splitPath labels + label, `' — '`) and Columns colour key as today.
- `const fromRows = settings.seriesFrom === 'rows' && settings.type !== 'pie';`
- Row names: `rowNames(dataset.rows, labels): string[]` — label alone when unique; when a label repeats, `[label, ...groupPath.map(m => `${m.field}: ${m.label ?? m.value}`)].join(' — ')`; names still equal get ` (2)`, ` (3)` in row order.
- Row colour key: `JSON.stringify([pivotValueKey(row.values[category]), ...(row.groupPath ?? []).map(m => [m.categoryId ?? m.field, m.memberKey ?? pivotValueKey(m.value)])])` passed to the existing `color()`.
- Rows mode transposes: a trace per row with `x`/`y` = measure ids and that row's values; axis `tickvals` = measure ids, `ticktext` = measure names; hover lines = escaped row name, groupPath lines, `${measure name}: ${value ?? 'Missing'}`.
- Columns mode output must stay byte-identical to the inline snapshots: do not add keys (not even `undefined` ones) to traces or layout.
- `revision`: `JSON.stringify([type, category, measures, display, ...(fromRows ? ['rows'] : [])])`.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/lib/widgetData/chartFigure.test.ts src/lib/tableExecution/finalReview.test.ts` → PASS, inline snapshots unchanged (no `-u`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/widgetData/chartFigure.ts src/lib/widgetData/chartFigure.test.ts
git commit -m "feat(linked-chart): series from rows with identity colours and figure notes"
```

---

### Task 3: 100% stacked, Pie, and the share checks

**Files:**
- Modify: `src/lib/widgetData/chartFigure.ts`
- Test: `src/lib/widgetData/chartFigure.test.ts`

**Interfaces:**
- Consumes: `LinkedFigureResult`, the row names / colours and the series-by-position values from Task 2.
- Produces: no new exports. Pie and percent results may be `{ ok: false, refused: true, message }` or `{ ok: true, notes: ['Missing: …'] }`.

- [ ] **Step 1: Write the failing tests**

Use `years` and `rows` from Task 2.

```ts
const refused = (s: LinkedChartSettings, d: WidgetDataset) => { const r = buildLinkedFigure(d, s, 'dark'); expect(r).toMatchObject({ ok: false, refused: true }); return (r as { message: string }).message; };
const withRows = (vals: [string, number | null, number | null][]) => ({ ...years, rows: vals.map(([item, fy24, fy25], i) => ({ id: `r${i}`, values: { item, fy24, fy25 } })) });

it('percent sets barnorm, a percent axis and the share in the hover', () => {
  const f = figure({ ...rows, display: 'percent' }, years);
  expect(f.layout).toMatchObject({ barmode: 'stack', barnorm: 'percent', yaxis: { ticksuffix: '%' } });
  expect((f.data[0] as { text: string[] }).text[0]).toMatch(/10[\s\S]*25\.0%/); // cash FY2024: 10 of 40
  expect(figure({ ...settings, type: 'bar', display: 'percent' }).layout).toMatchObject({ barnorm: 'percent', xaxis: { ticksuffix: '%' } });
});
it('pie builds one pie trace over the rows of one measure and refuses more than one', () => {
  const f = figure({ type: 'pie', category: 'item', measures: ['fy25'], display: 'grouped' }, years);
  expect(f.data).toEqual([expect.objectContaining({ type: 'pie', labels: ['cash', 'inventory'], values: [30, 10], sort: false })]);
  expect(refused({ type: 'pie', category: 'item', measures: ['fy24', 'fy25'], display: 'grouped' }, years)).toBe('Pie shows one measure — choose one');
  // Plotly merges equal pie labels, so duplicates must already be unique
  expect(figure({ type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, withRows([['Cost', 1, 1], ['Cost', 2, 2]])).data[0]).toMatchObject({ labels: ['Cost', 'Cost (2)'], values: [1, 2] });
});
it('a pie slice has the colour of the same row in a rows chart', () => {
  const pie = figure({ type: 'pie', category: 'item', measures: ['fy25'], display: 'grouped' }, years);
  expect((pie.data[0] as { marker: { colors: string[] } }).marker.colors[0]).toEqual((figure(rows, years).data[0] as { marker: { color: string } }).marker.color);
});
it('pie and percent refuse negative values, listing at most five', () => {
  expect(refused({ ...rows, display: 'percent' }, withRows([['cash', 10, 5], ['treasury_stock', 2, -4]]))).toBe("Can't show shares of negative values: treasury_stock (FY2025).");
  const many = withRows(Array.from({ length: 7 }, (_, i) => [`neg${i}`, -1, 1] as [string, number, number]));
  expect(refused({ type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, many)).toBe("Can't show shares of negative values: neg0 (FY2024), neg1 (FY2024), neg2 (FY2024), neg3 (FY2024), neg4 (FY2024), and 2 more.");
});
it('pie and percent refuse a zero total, naming the year or measure', () => {
  expect(refused({ ...rows, display: 'percent' }, withRows([['cash', 0, 5], ['inventory', 0, 5]]))).toBe("Can't show shares of a zero total: FY2024.");
  expect(refused({ type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, withRows([['cash', 0, 1]]))).toBe("Can't show shares of a zero total: FY2024.");
});
it('missing values are left out and listed, and the chart still draws', () => {
  const r = buildLinkedFigure(withRows([['cash', 10, 5], ['inventory', null, 5]]), { ...rows, display: 'percent' }, 'dark');
  expect(r).toMatchObject({ ok: true, notes: ['Missing: inventory (FY2024)'] });
  const pie = buildLinkedFigure(withRows([['cash', 10, 5], ['inventory', null, 5]]), { type: 'pie', category: 'item', measures: ['fy24'], display: 'grouped' }, 'dark');
  expect(pie).toMatchObject({ ok: true, notes: ['Missing: inventory (FY2024)'], figure: { data: [{ labels: ['cash'], values: [10] }] } });
});
it('an all-missing stack is listed as missing, not refused as a zero total', () => {
  expect(buildLinkedFigure(withRows([['cash', null, 5], ['inventory', null, 5]]), { ...rows, display: 'percent' }, 'dark')).toMatchObject({ ok: true, notes: ['Missing: cash (FY2024), inventory (FY2024)'] });
});
it('grouped, stacked and line charts keep negatives and give no notes', () => {
  const d = withRows([['cash', 10, null], ['treasury_stock', -4, 1]]);
  for (const display of ['grouped', 'stacked'] as const) expect(buildLinkedFigure(d, { ...rows, display }, 'dark')).toMatchObject({ ok: true, notes: [] });
});
it('leftover fields from another type still draw', () => {
  const line = figure({ ...rows, type: 'line', display: 'percent' }, withRows([['cash', -1, 2]]));
  expect(line.data[0]).toMatchObject({ type: 'scatter' }); expect(line.layout).not.toHaveProperty('barnorm');
  const pie = figure({ type: 'pie', category: 'item', measures: ['fy25'], display: 'percent', seriesFrom: 'rows' }, years);
  expect(pie.data[0]).toMatchObject({ type: 'pie', labels: ['cash', 'inventory'] });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/widgetData/chartFigure.test.ts` → the new tests FAIL; Task 2 tests and snapshots PASS.

- [ ] **Step 3: Implement**

- `share = settings.type === 'pie' || (settings.display === 'percent' && settings.type !== 'line')`.
- Pie with `measures.length > 1` → `{ ok: false, refused: true, message: 'Pie shows one measure — choose one' }`, checked after today's field errors.
- Pie uses the Rows layout of Task 2 with the single measure as the only position (series-from ignored for pie).
- When `share`, over the series-by-position values, in this order: any negative → refuse with `name (position)` items in row-then-position order; any position whose present values sum to 0 (at least one present) → refuse naming positions; missing values → `notes: ['Missing: …']`, omitted from the pie, `null` in bars. One list formatter `list(items: string[]): string` does the 5-cap and `, and N more`.
- Percent layout: `barmode: 'stack'`, `barnorm: 'percent'`, `ticksuffix: '%'` on the value axis (`yaxis` for column, `xaxis` for bar). Hover gains `Share: ${(v / total * 100).toFixed(1)}%`.
- Pie trace: `{ type: 'pie', labels: rowNames, values, marker: { colors }, text, hovertemplate: '%{text}<extra></extra>', sort: false }`; layout keeps legend, margins, colours, uirevision; no axis, no barmode.
- Columns-mode non-share output stays identical to the Task 2 snapshots.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/lib/widgetData/chartFigure.test.ts` → PASS, inline snapshots unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/widgetData/chartFigure.ts src/lib/widgetData/chartFigure.test.ts
git commit -m "feat(linked-chart): 100% stacked and pie with share refusals"
```

---

### Task 4: Renderer controls, type-change reset, refusal and notes; help; gates

**Files:**
- Modify: `src/components/renderers/LinkedChartRenderer.tsx`
- Test: `src/components/renderers/LinkedChartRenderer.test.tsx`
- Modify: `src/help/guide/linked-widgets.md:28-32`, `src/help/topics/linked-widgets.md` (the matching bullets; edit both by hand, do not run `help:sync`)

**Interfaces:**
- Consumes: `LinkedFigureResult` (`notes`, `refused`) from Tasks 2–3; `LinkedChartSettings` from Task 1.
- Produces: none for other tasks. `buildLinkedFigure` has no other production caller (`WidgetCard.tsx` only passes `onSettingsChange`).

- [ ] **Step 1: Write the failing tests**

Add a small helper beside `setup()` for custom rows, following the pattern of the existing split-binding tests:

```ts
async function setupRows(rows: { region: string; revenue: number | null }[]) { /* createTableExecutionStore with input + these rows, sync [source, chart], ensureTable('d','c'), settled */ }
const controls = (s: object) => render(<LinkedChartRenderer dashboardId="d" card={{ ...chart, linkedChart: { ...settings, ...s } }} refreshKey={0} store={store} onSettingsChange={commit}/>);
```

Tests (assertions are the contract; fixture shapes are free):

- `offers 100% stacked and series-from only for the types that use them`: for `column` and `bar`, the `Display` select has options `['grouped','stacked','percent']` with `percent` labelled `100% stacked`, and `getByLabelText('Series from')` exists; for `line`, `queryByLabelText('Display')` is null and `Series from` exists; for `pie`, both are null. `Chart type` has a `pie` option labelled `Pie`.
- `commits new values and resets fields the new type cannot use`:
  - from `{ display: 'percent', seriesFrom: 'rows' }`, choosing `line` commits `{ ...settings, type: 'line', display: 'stacked', seriesFrom: 'rows' }`;
  - choosing `pie` commits an object with `type: 'pie'`, `display: 'stacked'` and no `seriesFrom` key (`expect(commit.mock.lastCall![0]).not.toHaveProperty('seriesFrom')`);
  - choosing Display `percent` commits `{ ...settings, display: 'percent' }`; choosing Series from `rows` commits `{ ...settings, seriesFrom: 'rows' }`.
- `a refusal clears a drawn chart and shows a status line, not an alert`: `setupRows([{ region: 'cash', revenue: 10 }, { region: 'treasury_stock', revenue: -5 }])`; render grouped → figure; rerender with `{ type: 'pie' }` → `await waitFor(() => expect(screen.queryByTestId('figure')).toBeNull())`; `expect(screen.getByText(/^Can't show shares of negative values: treasury_stock/)).toHaveAttribute('role', 'status')`; `queryByRole('alert')` is null; `queryByText(/stale/)` is null. Rerender grouped → figure returns, refusal text gone.
- `pie with two measures says choose one as a status line`: `{ type: 'pie', measures: ['revenue', 'revenue-copy'] }` (or any two numeric fields the fixture provides) → text `Pie shows one measure — choose one`, no figure, no alert.
- `missing values are listed under a drawn share chart`: `setupRows([{ region: 'cash', revenue: 10 }, { region: 'inventory', revenue: null }])`, `{ type: 'pie' }` → figure present and `getByText(/^Missing: inventory/)` visible.
- `rows mode gives duplicate category values disambiguated names`: `setup()` (1600 rows, all region `A`), `{ seriesFrom: 'rows' }` → `data` has 1600 traces, names `data[0].name === 'A'`, `data[1].name === 'A (2)'`.
- The existing `failed chart transport retains its completed figure…` test covers "a failed fetch still keeps the stale chart"; leave it unchanged and keep it green.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/renderers/LinkedChartRenderer.test.tsx` → new tests FAIL; existing tests PASS.

- [ ] **Step 3: Implement**

In `LinkedChartRenderer.tsx`:
- State `const [refused, setRefused] = useState<string>()`. In the delivery `.then`: if `!result.ok && result.refused` → `setCompleted(undefined); setError(undefined); setRefused(result.message); return;`. On error, success, empty scope and the field checks → `setRefused(undefined)`. The `.catch` path is unchanged (keeps the stale chart).
- Replace the `figure` memo with one memo returning the whole `buildLinkedFigure` result; derive `figure` and `notes` from it.
- Status block: `{refused ? <p role="status">{refused}</p> : null}`; notes as `<p role="status">` lines next to the completeness warnings; the "Choose chart fields" fallback also requires `!refused`.
- Controls: `Chart type` gains `<option value="pie">Pie</option>`; Display shown when `type` is `column` or `bar`, with `<option value="percent">100% stacked</option>`; a `Series from` select (`aria-label="Series from"`, options `columns` "Columns", `rows` "Rows", value `settings.seriesFrom ?? 'columns'`) shown unless `type === 'pie'`.
- Type change goes through a local `withType(settings: LinkedChartSettings, type: LinkedChartSettings['type']): LinkedChartSettings`: `percent` → `stacked` for `line`/`pie`; drop the `seriesFrom` key for `pie`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/components/renderers/LinkedChartRenderer.test.tsx src/lib/widgetData/chartFigure.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/renderers/LinkedChartRenderer.tsx src/components/renderers/LinkedChartRenderer.test.tsx
git commit -m "feat(linked-chart): pie, 100% stacked and series-from controls"
```

- [ ] **Step 6: Help pages**

In both help files, the linked chart bullets become: Chart type adds **Pie**; Display is **Grouped**, **Stacked** or **100% stacked**, offered for Columns and Bars; a new **Series from** bullet (**Columns** or **Rows**; not offered for Pie); one sentence that pie and 100% stacked refuse negative values and zero totals with a message, and list missing values under the chart. Commit `docs(help): linked chart pie, 100% stacked and series from`.

- [ ] **Step 7: Gates**

Run each; all must exit 0:
`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test:run` (if it times out under load, rerun once and report the failing files), `pnpm scrub`, `pnpm test:web`.

- [ ] **Step 8: By-hand check (report, do not automate)**

In the running app: a balance sheet table, items as rows, fiscal years as columns, asset lines ticked with no subtotals, a linked chart. Check 100% stacked with Series from Rows; a pie of one year; ticking a negative line gives the refusal. Report what was seen; nothing is pushed.
