# Workspace Field Gaps (v3, items A–F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BDOBB act on six `widgets.json` fields it currently ignores: `exportable`, `imgUrl`, `colorValueKey` with `columnColor`, `chartDataType` with `chartView`, `raw: true` on html/youtube, and cron `refetchInterval` with `staleTime` and `dataUpdateDisplay`.

**Architecture:** Every field is parsed once in `normalizeWidgets` (`src/lib/widgetsJson.ts`) into an optional, strictly typed `WidgetDef`/`ColumnSpec` property that is absent when the manifest is silent, so manifests without these fields take the same code paths as today. Each consumer reads only its own property. Cron gets one small pure module (`src/lib/cron.ts`). Refetch timing reuses `useMinuteTick`'s minute-boundary scheduling inside `useWidgetData`'s existing timer.

**Tech Stack:** React 19 + TypeScript, zustand stores, Plotly partial bundle, vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-workspace-field-gaps-design.md` (items A–F only; G is a separate v6 plan, H is docs only).

## Open questions

These are places where the spec and the v3 code don't line up cleanly. Each one has a default the plan follows. If you rule otherwise, the affected task changes as described.

1. **Which help tree.** The spec says to update `src/help/guide/`. But `src/help/guide.ts` says that tree is *vendored verbatim from the BDOBB-V2 Help vault by `pnpm help:sync`*, and `src/help/index.ts` says `src/help/topics/` is the manual that is "edited in the same commit as the behaviour it describes". **Default:** edit `guide/` as the spec says. Also fix the one line in `topics/running-and-refreshing.md` (line 31) that would otherwise become false ("Cron-style refresh schedules are not supported in v3"). If guide/ edits must instead go through the vault, drop the guide/ steps and port the text to the vault.
2. **"Both restricted" for day-of-month/day-of-week.** **Default:** a field counts as restricted when its text does not start with `*`. That is Vixie cron's rule: `*/2` counts as unrestricted. If it should mean "is not exactly `*`", change one expression in Task 6.
3. **`staleTime` "refetches once when its dashboard becomes active again".** In v3 this already happens, and more broadly. `DashboardGrid` mounts only the active dashboard's active tab (the help says so: "Cards on tabs you are not looking at are not mounted"), and `useWidgetData` fetches on mount. So every card refetches on activation, stale or not. **Default:** no code for this half. Task 8 only adds the stale tint.
4. **Invalid `dataUpdateDisplay`.** The spec requires validation to report only an invalid cron `refetchInterval`. **Default:** an invalid `dataUpdateDisplay` is treated as absent and not reported.
5. **`canExport`.** The spec says `canExport` "also checks `widget.exportable !== false`". v3 has no such check and no `exportable` field. **Default:** add it. The ⋯ menu also holds Rename/Maximize/Columns, so the plan splits the menu gate from the export gate. An `exportable: false` card keeps its ⋯ menu and loses only **Export ▸**.
6. **Trace when `chartDataType` is declared but `chartType` is not.** **Default:** a `time` x draws `line` and a `category` x draws `column`, which are today's analogues. The declared path never draws a candlestick. A declared `chartType` on a widget with no `chartDataType` replaces today's automatic trace choice, including the candlestick.
7. **"Reuses useMinuteTick's scheduling".** Calling the hook from every card would re-render every card once a minute. **Default:** extract `msToNextMinute()` from `useMinuteTick.ts`. The cron timer then wakes on each minute boundary and refetches on the boundaries that match. This also keeps every delay far below `setTimeout`'s 2^31−1 ms ceiling, however rare the schedule.
8. **`imgUrl` placement.** `.library-card` has `overflow: hidden`, so an overlay would be clipped. **Default:** the preview renders inline inside the card while it is hovered or focused, and the card grows to fit it.
9. **Stale tint accessibility.** Colour alone excludes some users. **Default:** a stale button's tooltip also says "Data is older than its stale time". The spec doesn't ask for this line; remove it if unwanted.

## Global Constraints

- The manifest is untrusted JSON. Read literal types only: `false` (not `"false"` or `0`), non-empty strings, and finite numbers. A malformed value is treated as absent.
- An absent field leaves today's behaviour exactly as it is. The existing tests pass unchanged.
- No new dependency. Cron is a hand-written 5-field matcher.
- New source files start with exactly these two lines, as `src/hooks/useMinuteTick.ts` does (never an Apache header):
  ```ts
  // Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
  // SPDX-License-Identifier: AGPL-3.0-only
  ```
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, and `bash scripts/header-check.sh`. During tasks, prefer targeted `pnpm vitest run <file>`, because the full suite can time out under host load.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match the surrounding comment density and idiom. No abstractions beyond what a task shows.
- Work only in `/Users/artcashin/Developer/openbq-bdobb-v3-field-gaps` on branch `claude/v3-workspace-field-gaps`.

## Review Focus

1. **A rare cron schedule** (`0 0 1 * *`, monthly) or a non-matching minute. The card must not fetch on a boundary the expression doesn't match. A delay longer than `setTimeout`'s ceiling must never fire early. Pinned in Task 7 ("does not refetch on a minute boundary the expression does not match").
2. **A cron boundary that passes while the window is hidden.** The card fetches once on return, as an elapsed interval does today. Pinned in Task 7.
3. **The stale tint clears after a refetch** (refetch-interval.md: "the indicator will turn green again"). Pinned in Task 8.
4. **`colorValueKey` naming a field the row lacks.** No rule matches, not even `ne`, which `undefined` would otherwise satisfy. Pinned in Task 3.
5. **`chartDataType` declared but with no `series`, or no `time`/`category` column.** The card shows "Nothing chartable", doesn't crash, and isn't offered a Chart mode. Pinned in Task 4.

---

### Task 1: A. `exportable: false` hides Export

**Files:**
- Modify: `src/lib/types.ts` (`WidgetDef`, ~line 214–270)
- Modify: `src/lib/widgetsJson.ts` (`normalizeWidgets` push, ~line 434–458)
- Modify: `src/components/WidgetCard.tsx` (`canExport`/`hasMenu`, ~line 353–363)
- Modify: `src/help/guide/widget-cards.md` (line 27)
- Test: `src/lib/widgetsJson.test.ts`, `src/components/WidgetCard.test.tsx`

**Interfaces:**
- Produces: `WidgetDef.exportable?: false`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/widgetsJson.test.ts`:

```ts
describe("exportable", () => {
  it("keeps only a literal false", () => {
    const { widgets } = normalizeWidgets(
      { a: { exportable: false }, b: { exportable: "false" }, c: { exportable: 0 }, d: { exportable: true }, e: {} },
      "b1",
    );
    expect(widgets.map((w) => w.exportable)).toEqual([false, undefined, undefined, undefined, undefined]);
  });
});
```

In `src/components/WidgetCard.test.tsx`, add inside `describe("WidgetCard", …)`, next to the existing export-menu tests (~line 328):

```tsx
  it("drops Export from the card menu when the widget declares exportable: false, and keeps the rest", async () => {
    register({ exportable: false });
    useWidgetData.mockReturnValue({ status: "ready", data: [{ a: 1 }], retry: vi.fn() });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Card menu" }));

    expect(screen.queryByRole("menuitem", { name: "Export ▸" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/components/WidgetCard.test.tsx -t "exportable"`
Expected: FAIL. TypeScript/vitest reports `exportable` missing on the result, and the menu still shows **Export ▸**.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, inside `WidgetDef` after `runButton`:

```ts
  /**
   * `exportable: false` hides the card's Export ▸ (CSV, JSON, Excel). Only
   * ever `false` or absent: any other value keeps export available.
   */
  exportable?: false;
```

In `src/lib/widgetsJson.ts`, in the `widgets.push({ … })` object after `runButton`:

```ts
      exportable: w.exportable === false ? false : undefined,
```

In `src/components/WidgetCard.tsx`, replace

```ts
  const canExport = widget !== undefined && fetchesData(widget) && widget.type !== "pdf";
```

with

```ts
  const hasPayload = widget !== undefined && fetchesData(widget) && widget.type !== "pdf";
  // The manifest's `exportable: false` takes Export ▸ away and nothing else:
  // Rename, Maximize and Columns stay, so the menu's gate is hasPayload.
  const canExport = hasPayload && widget.exportable !== false;
```

and replace `const hasMenu = canExport || isMarkdownNote;` with `const hasMenu = hasPayload || isMarkdownNote;`. Update the comment above `isMarkdownNote` so it says `hasPayload` ("this card has a fetched payload") where it currently says `canExport`.

In `src/help/guide/widget-cards.md` line 27, after the sentence that ends "…**Columns ▸** and **Reset table**.", insert:

```
A widget that declares `exportable: false` has no **Export ▸**; the rest of the menu is unchanged.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/components/WidgetCard.test.tsx`
Expected: PASS, including every existing test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/widgetsJson.ts src/components/WidgetCard.tsx src/help/guide/widget-cards.md src/lib/widgetsJson.test.ts src/components/WidgetCard.test.tsx
git commit -m "feat(widgets): honour exportable: false on the card menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: B. `imgUrl` preview in the Widget Library

**Files:**
- Modify: `src/lib/types.ts` (`WidgetDef`)
- Modify: `src/lib/widgetsJson.ts` (import `safeUrl`, push)
- Modify: `src/components/WidgetLibrary.tsx`
- Modify: `src/styles.css` (after `.library-card-description`, ~line 667)
- Modify: `src/help/guide/widget-library.md` (after line 28)
- Test: `src/lib/widgetsJson.test.ts`, `src/components/WidgetLibrary.test.tsx`

**Interfaces:**
- Produces: `WidgetDef.imgUrl?: string`, which is always an `http:`/`https:` URL as `safeUrl` normalises it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/widgetsJson.test.ts`:

```ts
describe("imgUrl", () => {
  it("keeps an http(s) URL and drops every other scheme or type", () => {
    const { widgets } = normalizeWidgets(
      {
        a: { imgUrl: "https://img.example/p.png" },
        b: { imgUrl: "javascript:alert(1)" },
        c: { imgUrl: "data:image/png;base64,AAAA" },
        d: { imgUrl: 42 },
        e: { imgUrl: "relative/p.png" },
      },
      "b1",
    );
    expect(widgets.map((w) => w.imgUrl)).toEqual(["https://img.example/p.png", undefined, undefined, undefined, undefined]);
  });
});
```

Append inside `describe("WidgetLibrary", …)` in `src/components/WidgetLibrary.test.tsx`:

```tsx
  it("previews a widget's imgUrl on hover and on keyboard focus, named for the widget", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", name: "Price History", imgUrl: "https://img.example/p.png" })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    const row = screen.getByRole("button", { name: "Add Price History" });
    expect(screen.queryByAltText("Price History")).toBeNull();

    await userEvent.hover(row);
    expect(screen.getByAltText("Price History")).toHaveAttribute("src", "https://img.example/p.png");
    await userEvent.unhover(row);
    expect(screen.queryByAltText("Price History")).toBeNull();

    act(() => row.focus());
    expect(screen.getByAltText("Price History")).toBeInTheDocument();
  });

  it("shows nothing, not a broken image, when the preview fails to load", async () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "p", name: "Price History", imgUrl: "https://img.example/missing.png" })],
    });
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.hover(screen.getByRole("button", { name: "Add Price History" }));

    fireEvent.error(screen.getByAltText("Price History"));

    expect(screen.queryByAltText("Price History")).toBeNull();
  });

  it("shows no preview for a widget without imgUrl", async () => {
    render(<WidgetLibrary onClose={vi.fn()} target={TARGET} />);
    await userEvent.hover(screen.getByRole("button", { name: "Add Price History" }));
    expect(screen.queryByRole("img")).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/components/WidgetLibrary.test.tsx -t "imgUrl|preview"`
Expected: FAIL (`imgUrl` is undefined, and no image is found).

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, inside `WidgetDef` after `source`:

```ts
  /** An http(s) image the Widget Library previews on hover or focus. Any other scheme is dropped. */
  imgUrl?: string;
```

In `src/lib/widgetsJson.ts`, add `import { safeUrl } from "./safeUrl";` and add to the push object after `source`:

```ts
      // safeUrl is the app's http/https boundary; anything else is dropped.
      imgUrl: typeof w.imgUrl === "string" ? (safeUrl(w.imgUrl) ?? undefined) : undefined,
```

In `src/components/WidgetLibrary.tsx`, add below `SourceBadge`:

```tsx
/**
 * The widget's `imgUrl`, shown while its row is hovered or focused. An image
 * that fails to load renders nothing rather than the browser's broken-image
 * icon; it is remounted on the next hover, which tries again.
 */
function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="library-card-preview" src={src} alt={alt} onError={() => setFailed(true)} />;
}
```

In `WidgetLibrary`, next to the other `useState`s:

```tsx
  // Which row's imgUrl preview is showing: the hovered or focused one.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
```

In the `visible.map`, compute `const key = \`${w.backendId}:${w.id}\`;` alongside `present`, use `key={key}` on the button, and add these handlers to the `<button>`:

```tsx
                onMouseEnter={() => setPreviewKey(key)}
                onMouseLeave={() => setPreviewKey((k) => (k === key ? null : k))}
                onFocus={() => setPreviewKey(key)}
                onBlur={() => setPreviewKey((k) => (k === key ? null : k))}
```

and, after the description span:

```tsx
                {previewKey === key && w.imgUrl ? <PreviewImage src={w.imgUrl} alt={w.name} /> : null}
```

In `src/styles.css`, after the `.library-card-description` rule:

```css
/* Inline, not an overlay: .library-card clips its overflow. */
.library-card-preview {
  max-width: 100%;
  max-height: 160px;
  object-fit: contain;
}
```

In `src/help/guide/widget-library.md`, after line 28 ("Below the badges is the widget's own description."):

```

When a widget declares an `imgUrl` (an `http` or `https` address), hovering its card or moving keyboard focus to it shows that image under the description. An image that fails to load shows nothing.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/components/WidgetLibrary.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/widgetsJson.ts src/components/WidgetLibrary.tsx src/styles.css src/help/guide/widget-library.md src/lib/widgetsJson.test.ts src/components/WidgetLibrary.test.tsx
git commit -m "feat(library): preview a widget's imgUrl on hover or focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: C. `colorRules` tested against `colorValueKey`'s field

**Files:**
- Modify: `src/lib/columnRender.ts` (`cellVisual`, ~line 151–174; header comment ~line 10–16)
- Modify: `src/lib/tableColumns.ts` (`TableColumn` ~line 51–92, `declared` ~line 147–177, comment ~line 105)
- Modify: `src/components/renderers/TableRenderer.tsx` (~line 987)
- Modify: `src/lib/types.ts` (`ColumnSpec` doc comment, ~line 144–149)
- Modify: `src/help/guide/tables.md` (line 64)
- Test: `src/lib/columnRender.test.ts`, `src/lib/tableColumns.test.ts`, `src/components/renderers/TableRenderer.test.tsx`

**Interfaces:**
- Produces: `TableColumn.colorValueKey?: string` (non-empty)
- Produces: `cellVisual(column: { renderFn: string[]; colorRules?: ColorRule[]; colorValueKey?: string }, value: unknown, row?: Record<string, unknown>): CellVisual`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/columnRender.test.ts`:

```ts
describe("cellVisual with colorValueKey", () => {
  const rules: ColorRule[] = [{ condition: "eq", value: "Sarah Johnson", color: "blue", fill: true }];

  it("tests the rules against the named field of the same row, not the cell", () => {
    const column = { renderFn: ["columnColor"], colorRules: rules, colorValueKey: "Analyst" };
    expect(cellVisual(column, "AAPL", { Symbol: "AAPL", Analyst: "Sarah Johnson" })).toEqual({ color: "blue", fill: true });
    expect(cellVisual(column, "MSFT", { Symbol: "MSFT", Analyst: "Bob" })).toEqual({});
  });

  it("matches no rule when the row lacks the field, not even ne", () => {
    const column = {
      renderFn: ["columnColor"],
      colorRules: [{ condition: "ne", value: "x", color: "red" } as ColorRule],
      colorValueKey: "Analyst",
    };
    expect(cellVisual(column, "AAPL", { Symbol: "AAPL" })).toEqual({});
    expect(cellVisual(column, "AAPL")).toEqual({});
  });

  it("still tests the cell's own value when no colorValueKey is set", () => {
    expect(cellVisual({ renderFn: [], colorRules: rules }, "Sarah Johnson", { other: 1 })).toEqual({ color: "blue", fill: true });
  });
});
```

Append to `src/lib/tableColumns.test.ts` (it already imports `tableColumns`; add the import if it doesn't):

```ts
describe("colorValueKey", () => {
  it("resolves a non-empty renderFnParams.colorValueKey onto the column, and drops an empty or non-string one", () => {
    const cols = tableColumns([{ a: 1, b: 2, c: 3 }], {
      columns: [
        { field: "a", renderFnParams: { colorValueKey: "b" } },
        { field: "b", renderFnParams: { colorValueKey: "" } },
        { field: "c", renderFnParams: { colorValueKey: 7 } },
      ],
    });
    expect(cols.map((c) => c.colorValueKey)).toEqual(["b", undefined, undefined]);
  });
});
```

Append inside the table describe in `src/components/renderers/TableRenderer.test.tsx`, next to the colorRules test (~line 311). This is the reference example from render-functions.md:

```tsx
  it("colours a columnColor cell from colorValueKey's field of the same row", () => {
    render(
      <TableRenderer
        data={[
          { Symbol: "AAPL", Analyst: "Sarah Johnson" },
          { Symbol: "MSFT", Analyst: "Bob Lee" },
        ]}
        spec={{
          columns: [
            {
              field: "Symbol",
              renderFn: ["cellOnClick", "columnColor"],
              renderFnParams: {
                actionType: "groupBy",
                groupBy: { paramName: "symbol" },
                colorValueKey: "Analyst",
                colorRules: [{ condition: "eq", value: "Sarah Johnson", color: "rgb(0, 0, 255)", fill: true }],
              },
            },
            { field: "Analyst" },
          ],
        }}
      />,
    );
    const cells = [...document.querySelectorAll('td[data-field="Symbol"]')] as HTMLElement[];
    expect(cells[0].style.background).toBe("rgb(0, 0, 255)");
    expect(cells[1].style.background).toBe("");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/columnRender.test.ts src/lib/tableColumns.test.ts src/components/renderers/TableRenderer.test.tsx -t "colorValueKey"`
Expected: FAIL. The rules are tested against the cell's own value, and the `colorValueKey` property doesn't exist yet.

- [ ] **Step 3: Implement**

In `src/lib/columnRender.ts`, replace `cellVisual` with:

```ts
export function cellVisual(
  column: { renderFn: string[]; colorRules?: ColorRule[]; colorValueKey?: string },
  value: unknown,
  row?: Record<string, unknown>,
): CellVisual {
  const rules = column.colorRules ?? [];
  if (rules.length > 0) {
    // renderFnParams.colorValueKey: the rules test THAT field of the same row
    // (render-functions.md, "Multiple Render Functions and Color Rules"). A
    // row without it matches no rule -- not even `ne`, which undefined would
    // otherwise satisfy.
    let tested = value;
    if (column.colorValueKey !== undefined) {
      if (row === undefined || !Object.hasOwn(row, column.colorValueKey)) return {};
      tested = row[column.colorValueKey];
    }
    // The FIRST match wins, as the spec says — not the narrowest.
    const rule = rules.find((r) => matches(r, tested));
    if (!rule) return {};
    return rule.fill === true ? { color: rule.color, fill: true } : { color: rule.color };
  }
  if (!column.renderFn.includes("greenRed")) return {};
  const className = greenRedClass(value);
  return className ? { className } : {};
}
```

In the file's header comment, drop `columnColor` from the "Parsed and deliberately ignored" list, and add: "`columnColor` needs no code of its own: colorRules colour a cell whatever renderFn says, and `renderFnParams.colorValueKey` points them at another field of the row."

In `src/lib/tableColumns.ts`, add to `TableColumn` after `colorRules`:

```ts
  /**
   * `renderFnParams.colorValueKey`, when a non-empty string: colorRules test
   * that field of the row instead of the cell. showCellChange's own use of the
   * same key (cellChange below) is separate and unchanged.
   */
  colorValueKey?: string;
```

In `declared`, add before `return {`:

```ts
  const colorValueKey = column.renderFnParams?.colorValueKey;
```

and inside the returned object, after `colorRules: …`:

```ts
    colorValueKey: typeof colorValueKey === "string" && colorValueKey !== "" ? colorValueKey : undefined,
```

In `cellClickOf`'s comment (~line 105), change "and columnColor remains parsed-and-ignored" to "and colorValueKey is read in `declared`".

In `src/components/renderers/TableRenderer.tsx` (~line 987), change

```tsx
                  const visual: CellVisual = column ? cellVisual(column, cell.getValue()) : {};
```

to

```tsx
                  const visual: CellVisual = column ? cellVisual(column, cell.getValue(), original) : {};
```

In `src/lib/types.ts`'s `ColumnSpec` doc comment, replace "`columnColor` is parsed and deliberately ignored." with "`colorValueKey` points colorRules at another field of the row (see cellVisual)."

In `src/help/guide/tables.md` line 64, replace the opening sentence "`columnColor` is read and then ignored; a column asking for it draws a plain cell rather than an error." with:

```
A `columnColor` column is coloured by its `colorRules`, like any other column; when its `renderFnParams` names a `colorValueKey`, the rules are tested against that field of the same row instead of the cell's own value, and a row without that field is left uncoloured.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/columnRender.test.ts src/lib/tableColumns.test.ts src/components/renderers/TableRenderer.test.tsx src/components/renderers/LiveGridRenderer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/columnRender.ts src/lib/tableColumns.ts src/components/renderers/TableRenderer.tsx src/lib/types.ts src/help/guide/tables.md src/lib/columnRender.test.ts src/lib/tableColumns.test.ts src/components/renderers/TableRenderer.test.tsx
git commit -m "feat(tables): test colorRules against colorValueKey's field of the row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: D. `chartDataType` and the widget's `chartView`

**Files:**
- Modify: `src/lib/types.ts` (`ColumnSpec`, `WidgetDef`)
- Modify: `src/lib/widgetsJson.ts` (`toColumnSpec`, new `toChartView`, push)
- Modify: `src/lib/chartShapes.ts` (export `rowChartAxes`, `rowFigure`; extract `MARGIN`)
- Modify: `src/components/renderers/ChartRenderer.tsx` (`figureFor`, props)
- Modify: `src/components/WidgetCard.tsx` (import, `modes` memo ~line 319–325, both `<ChartRenderer>` sites ~line 988 and ~line 1016)
- Modify: `src/stores/dashboardStore.ts` (`addCardTo`, ~line 757–790)
- Modify: `src/help/guide/charts.md` (after line 10)
- Test: `src/lib/widgetsJson.test.ts`, `src/lib/chartShapes.test.ts`, `src/components/renderers/ChartRenderer.test.tsx`, `src/components/WidgetCard.test.tsx`, `src/stores/dashboardStore.test.ts`

**Interfaces:**
- Produces: `ColumnSpec.chartDataType?: "category" | "series" | "time" | "excluded"`
- Produces: `WidgetDef.chartView?: { enabled?: true; chartType?: string }`
- Produces: `rowChartAxes(rows: Array<Record<string, unknown>>, columns?: ColumnSpec[]): { x: string; series: string[]; time: boolean } | null`
- Produces: `rowFigure(rows, columns: ColumnSpec[] | undefined, chartType: string | undefined, theme?: "dark" | "light"): PlotlyFigure | null`
- Produces: `ChartRenderer` props `columns?: ColumnSpec[]`, `chartType?: string`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/widgetsJson.test.ts`:

```ts
describe("chartDataType and chartView", () => {
  it("keeps only the four documented chartDataType values", () => {
    const { widgets: [w] } = normalizeWidgets(
      {
        a: {
          data: {
            table: {
              columnsDefs: [
                { field: "n", chartDataType: "category" },
                { field: "t", chartDataType: "time" },
                { field: "s", chartDataType: "series" },
                { field: "x", chartDataType: "excluded" },
                { field: "bad", chartDataType: "pie" },
              ],
            },
          },
        },
      },
      "b1",
    );
    expect(w.table?.columns.map((c) => c.chartDataType)).toEqual(["category", "time", "series", "excluded", undefined]);
  });

  it("reads data.table.chartView: enabled only as literal true, chartType only as a non-empty string", () => {
    const { widgets } = normalizeWidgets(
      {
        a: { data: { table: { chartView: { enabled: true, chartType: "column" } } } },
        b: { data: { table: { chartView: { enabled: "true", chartType: "" } } } },
        c: { data: { table: {} } },
      },
      "b1",
    );
    expect(widgets.map((w) => w.chartView)).toEqual([{ enabled: true, chartType: "column" }, undefined, undefined]);
  });
});
```

Append to `src/lib/chartShapes.test.ts`, and add `rowChartAxes, rowFigure` to its import:

```ts
describe("rowFigure (chartDataType / chartView)", () => {
  // aggrid-table-charts.md, "Table to Chart Widget".
  const tvl = [
    { name: "Ethereum", tvl: 45e9, change_1d: 2.5 },
    { name: "Bitcoin", tvl: 35e9, change_1d: 1.2 },
  ];
  const tvlCols = [
    { field: "name", chartDataType: "category" as const },
    { field: "tvl", chartDataType: "series" as const },
  ];

  it("plots only the series columns against the category column, as columns by default", () => {
    const fig = rowFigure(tvl, tvlCols, undefined)!;
    expect(fig.data).toEqual([{ type: "bar", name: "tvl", x: ["Ethereum", "Bitcoin"], y: [45e9, 35e9] }]);
    expect(fig.layout.xaxis).toEqual({ type: "category" });
  });

  it("prefers the first time column over a category column, drawing lines by default", () => {
    const rows = [{ d: "2026-01-02", n: "a", v: 1 }];
    const fig = rowFigure(rows, [
      { field: "n", chartDataType: "category" },
      { field: "d", chartDataType: "time" },
      { field: "v", chartDataType: "series" },
    ], undefined)!;
    expect(fig.data).toEqual([{ type: "scatter", mode: "lines", name: "v", x: ["2026-01-02"], y: [1] }]);
    expect(fig.layout.xaxis).toEqual({ type: "date" });
  });

  it("never plots an excluded column, even a numeric one", () => {
    const fig = rowFigure(tvl, [...tvlCols, { field: "change_1d", chartDataType: "excluded" as const }], undefined)!;
    expect(fig.data.map((t) => (t as { name: string }).name)).toEqual(["tvl"]);
  });

  it.each([
    ["line", { type: "scatter", mode: "lines" }],
    ["area", { type: "scatter", mode: "lines", fill: "tozeroy" }],
    ["column", { type: "bar" }],
    ["scatter", { type: "scatter", mode: "markers" }],
    ["pie", { type: "scatter", mode: "lines" }],
  ])("draws chartType %s as the matching trace", (chartType, shape) => {
    expect(rowFigure(tvl, tvlCols, chartType)!.data[0]).toMatchObject(shape);
  });

  it("draws chartType bar horizontally, the axis on y", () => {
    const fig = rowFigure(tvl, tvlCols, "bar")!;
    expect(fig.data[0]).toEqual({ type: "bar", orientation: "h", name: "tvl", x: [45e9, 35e9], y: ["Ethereum", "Bitcoin"] });
    expect(fig.layout.yaxis).toEqual({ type: "category" });
  });

  it("returns null with no series column or no time/category column", () => {
    expect(rowFigure(tvl, [{ field: "name", chartDataType: "category" }], undefined)).toBeNull();
    expect(rowFigure(tvl, [{ field: "tvl", chartDataType: "series" }], undefined)).toBeNull();
    expect(rowChartAxes(tvl, [{ field: "tvl", chartDataType: "series" }])).toBeNull();
  });

  it("is today's figure exactly when nothing is declared", () => {
    const rows = [{ date: "2026-01-02", open: 1, high: 2, low: 0.5, close: 1.5 }];
    expect(rowFigure(rows, undefined, undefined, "dark")).toEqual(buildFigure(rows, "date", "dark"));
    expect(rowChartAxes(rows)).toEqual({ x: "date", series: ["open", "high", "low", "close"], time: true });
  });

  it("applies a chartType without declarations to the detected axis", () => {
    const fig = rowFigure([{ symbol: "AAPL", v: 1 }], undefined, "area")!;
    expect(fig.data).toEqual([{ type: "scatter", mode: "lines", fill: "tozeroy", name: "v", x: ["AAPL"], y: [1] }]);
  });
});
```

Append inside `describe("ChartRenderer", …)` in `src/components/renderers/ChartRenderer.test.tsx`:

```tsx
  it("charts rows by the widget's chartDataType columns and chartType", () => {
    render(
      <ChartRenderer
        data={[{ name: "ETH", tvl: 1, change: 2 }]}
        columns={[
          { field: "name", chartDataType: "category" },
          { field: "tvl", chartDataType: "series" },
        ]}
        chartType="column"
      />,
    );
    expect(figureFromLastCall().data).toEqual([{ type: "bar", name: "tvl", x: ["ETH"], y: [1] }]);
  });
```

Append inside `describe("WidgetCard renderer dispatch", …)` in `src/components/WidgetCard.test.tsx` (next to the Chart-mode tests ~line 975):

```tsx
  it("offers a Chart mode from declared chartDataType columns where detection finds none", () => {
    setUp(
      {
        type: "table",
        table: {
          columns: [
            { field: "symbol", chartDataType: "category" },
            { field: "name", chartDataType: "series" },
          ],
        },
      },
      [{ symbol: "AAPL", name: "Apple" }],
    );
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Chart" })).toBeInTheDocument();
  });

  it("offers no Chart mode when the declared columns name no series", () => {
    setUp(
      { type: "table", table: { columns: [{ field: "symbol", chartDataType: "category" }, { field: "value" }] } },
      [{ symbol: "AAPL", value: 1 }],
    );
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.queryByRole("option", { name: "Chart" })).not.toBeInTheDocument();
  });
```

Append inside `describe("addCard", …)` in `src/stores/dashboardStore.test.ts`:

```ts
  it("opens a new card in chart view when the widget's chartView is enabled", async () => {
    await useDashboardStore.getState().load();
    await useDashboardStore.getState().addCard(widget({ chartView: { enabled: true } }));
    await useDashboardStore.getState().addCard(widget({ id: "plain" }));

    const [charted, plain] = useDashboardStore.getState().activeDashboard()!.tabs[0].cards;
    expect(charted.view).toBe("chart");
    expect(plain.view).toBeUndefined();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/lib/chartShapes.test.ts src/components/renderers/ChartRenderer.test.tsx src/stores/dashboardStore.test.ts src/components/WidgetCard.test.tsx -t "chartDataType|chartView|rowFigure|Chart mode"`
Expected: FAIL (`rowFigure` and `rowChartAxes` are not exported, and the fields are undefined).

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, add to `ColumnSpec` after `sparkline`:

```ts
  /**
   * How a chart built from the rows treats this column: x is the first `time`
   * column, else the first `category` one; y is every `series` column;
   * `excluded` is never plotted. See rowChartAxes in src/lib/chartShapes.ts.
   */
  chartDataType?: "category" | "series" | "time" | "excluded";
```

Add to `WidgetDef` after `table`:

```ts
  /**
   * `data.table.chartView`. `enabled: true` opens a NEW card in chart view
   * (addCardTo); `chartType` picks the trace of a chart built from rows (see
   * rowFigure in src/lib/chartShapes.ts). Absent when it declares neither.
   */
  chartView?: { enabled?: true; chartType?: string };
```

In `src/lib/widgetsJson.ts`, above `toColumnSpec`:

```ts
const CHART_DATA_TYPES = new Set(["category", "series", "time", "excluded"]);
```

In `toColumnSpec`, after the `cellDataType` block:

```ts
  if (typeof c.chartDataType === "string" && CHART_DATA_TYPES.has(c.chartDataType)) {
    column.chartDataType = c.chartDataType as ColumnSpec["chartDataType"];
  }
```

After `toTable`:

```ts
/**
 * `data.table.chartView`, read on its own because a widget may declare it
 * with no columnsDefs (and so no TableSpec). Only a literal `true` and a
 * non-empty string survive.
 */
function toChartView(data: Record<string, unknown> | null): WidgetDef["chartView"] {
  const cv = asRecord(asRecord(data?.table)?.chartView);
  if (!cv) return undefined;
  const view: NonNullable<WidgetDef["chartView"]> = {};
  if (cv.enabled === true) view.enabled = true;
  if (typeof cv.chartType === "string" && cv.chartType !== "") view.chartType = cv.chartType;
  return Object.keys(view).length > 0 ? view : undefined;
}
```

In the push object after `table: toTable(data),`:

```ts
      chartView: toChartView(data),
```

In `src/lib/chartShapes.ts`, add `import type { ColumnSpec } from "./types";`. Add above `buildFigure`:

```ts
const MARGIN = { l: 48, r: 12, t: 12, b: 32 };
```

and in `buildFigure` replace `margin: { l: 48, r: 12, t: 12, b: 32 },` with `margin: MARGIN,`. Append at the end of the file:

```ts
/** What a chart built from rows plots: its x column, its y columns, and whether x is time. */
export type RowChartAxes = { x: string; series: string[]; time: boolean };

/**
 * columnsDefs' `chartDataType`, when any column declares one: x is the first
 * `time` column, else the first `category` one; y is every `series` column;
 * `excluded` and undeclared columns are never plotted. With no declaration
 * at all, this is detectChartAxis exactly -- non-null whenever it is -- so a
 * widget that declares nothing is offered a chart exactly as before.
 */
export function rowChartAxes(
  rows: Array<Record<string, unknown>>,
  columns: ColumnSpec[] = [],
): RowChartAxes | null {
  const typed = columns.filter((c) => c.chartDataType !== undefined);
  if (typed.length === 0) {
    const x = detectChartAxis(rows);
    return x === null ? null : { x, series: numericKeys(rows, x), time: detectTimeColumn(rows) === x };
  }
  const axis =
    typed.find((c) => c.chartDataType === "time") ?? typed.find((c) => c.chartDataType === "category");
  const series = typed.filter((c) => c.chartDataType === "series").map((c) => c.field);
  if (axis === undefined || series.length === 0 || rows.length === 0) return null;
  return { x: axis.field, series, time: axis.chartDataType === "time" };
}

/** chartView's `chartType` as a Plotly trace. Anything not listed draws as `line`. */
function seriesTrace(chartType: string, name: string, x: unknown[], y: unknown[]): Record<string, unknown> {
  switch (chartType) {
    case "area":
      return { type: "scatter", mode: "lines", fill: "tozeroy", name, x, y };
    case "column":
      return { type: "bar", name, x, y };
    case "bar":
      // Horizontal bars: the axis column runs up the y-axis.
      return { type: "bar", orientation: "h", name, x: y, y: x };
    case "scatter":
      return { type: "scatter", mode: "markers", name, x, y };
    default:
      return { type: "scatter", mode: "lines", name, x, y };
  }
}

/**
 * The figure for a row payload. A widget that declares neither chartDataType
 * nor chartView.chartType gets buildFigure, unchanged (candlestick included).
 * Otherwise x and y come from rowChartAxes and the trace from `chartType`,
 * defaulting to a line on a time axis and columns on a category one.
 */
export function rowFigure(
  rows: Array<Record<string, unknown>>,
  columns: ColumnSpec[] | undefined,
  chartType: string | undefined,
  theme: "dark" | "light" = "dark",
): PlotlyFigure | null {
  const declared = columns?.some((c) => c.chartDataType !== undefined) ?? false;
  if (!declared && chartType === undefined) {
    const axisKey = detectChartAxis(rows);
    return axisKey === null ? null : buildFigure(rows, axisKey, theme);
  }
  const axes = rowChartAxes(rows, columns);
  if (axes === null || axes.series.length === 0) return null;
  const type = chartType ?? (axes.time ? "line" : "column");
  const x = rows.map((r) => r[axes.x]);
  const axis = { type: axes.time ? "date" : "category" };
  return {
    data: axes.series.map((k) => seriesTrace(type, k, x, rows.map((r) => r[k]))),
    layout: {
      margin: MARGIN,
      showlegend: true,
      ...themedLayout(theme),
      ...(type === "bar" ? { yaxis: axis } : { xaxis: axis }),
    },
  };
}
```

In `src/components/renderers/ChartRenderer.tsx`, change the import to `isPlotlyFigure, rowFigure, rowsOf, type PlotlyFigure` (dropping `buildFigure` and `detectChartAxis`), add `import type { ColumnSpec } from "../../lib/types";`, and replace `figureFor` and the component signature/memo:

```tsx
function figureFor(
  data: unknown,
  theme: "dark" | "light",
  columns?: ColumnSpec[],
  chartType?: string,
): PlotlyFigure | null {
  if (isPlotlyFigure(data)) return data;
  const rows = rowsOf(data);
  if (rows === null) return null;
  return rowFigure(rows, columns, chartType, theme);
}
```

```tsx
export function ChartRenderer({
  data,
  uirevision = "chart",
  columns,
  chartType,
}: {
  data: unknown;
  uirevision?: string;
  /** The widget's columnsDefs, for their chartDataType. */
  columns?: ColumnSpec[];
  /** The widget's chartView.chartType. */
  chartType?: string;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const theme = useSettingsStore((s) => s.settings.theme);
  const figure = useMemo(() => figureFor(data, theme, columns, chartType), [data, theme, columns, chartType]);
```

In `src/components/WidgetCard.tsx`, change `import { detectChartAxis, rowsOf } from "../lib/chartShapes";` to `import { rowChartAxes, rowsOf } from "../lib/chartShapes";`. In the `modes` memo, replace

```ts
      if (rows && detectChartAxis(rows) !== null) list.push({ value: "chart", label: "Chart" });
```

with

```ts
      if (rows && rowChartAxes(rows, widget?.table?.columns) !== null) list.push({ value: "chart", label: "Chart" });
```

and change that memo's dependency list to `[widget?.type, widget?.table, data]`. At both `<ChartRenderer data={data} uirevision={paramsKey(query)} />` sites (the `view === "chart"` gate and `case "chart"`), pass the widget's declarations:

```tsx
<ChartRenderer
  data={data}
  uirevision={paramsKey(query)}
  columns={widget?.table?.columns}
  chartType={widget?.chartView?.chartType}
/>
```

Leave the `chart-vegalite`/`chart-highcharts` call unchanged. It always passes a ready figure.

In `src/stores/dashboardStore.ts` `addCardTo`, add this to the new card object after `layout: { … },`:

```ts
                    // chartView.enabled opens a NEW card on its chart; an
                    // imported or existing card keeps the view it saved.
                    ...(widget.chartView?.enabled ? { view: "chart" as const } : {}),
```

In `src/help/guide/charts.md`, after line 10:

```

A table widget can also say how its rows chart. When any of its columns declares a `chartDataType`, the chart takes its x-axis from the first `time` column (or, failing that, the first `category` column) and plots only the `series` columns; `excluded` columns are never plotted, and the **Chart** entry is offered only when there is an axis and at least one series. The widget's `chartView.chartType` picks the drawing — `line`, `area`, `column` (vertical bars), `bar` (horizontal bars) or `scatter`; any other type draws as a line — and `chartView.enabled: true` opens a newly added card on its chart. A card that already saved a view keeps it. A Plotly figure from the backend is still drawn exactly as it arrives.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/lib/chartShapes.test.ts src/components/renderers/ChartRenderer.test.tsx src/stores/dashboardStore.test.ts src/components/WidgetCard.test.tsx`
Expected: PASS, including every existing chart and Chart-mode test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/widgetsJson.ts src/lib/chartShapes.ts src/components/renderers/ChartRenderer.tsx src/components/WidgetCard.tsx src/stores/dashboardStore.ts src/help/guide/charts.md src/lib/widgetsJson.test.ts src/lib/chartShapes.test.ts src/components/renderers/ChartRenderer.test.tsx src/components/WidgetCard.test.tsx src/stores/dashboardStore.test.ts
git commit -m "feat(charts): chart rows by chartDataType and chartView

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: E. `raw: true` re-request for html and youtube

**Files:**
- Create: `src/components/renderers/RawRequestView.tsx`
- Modify: `src/lib/types.ts` (`WidgetDef`)
- Modify: `src/lib/widgetsJson.ts` (push)
- Modify: `src/components/WidgetCard.tsx` (import; gate before `if (view === "raw")`, ~line 987)
- Modify: `src/help/guide/html-and-iframe-widgets.md` (after line 10)
- Test: create `src/components/renderers/RawRequestView.test.tsx`; modify `src/lib/widgetsJson.test.ts` and `src/components/WidgetCard.test.tsx`

**Interfaces:**
- Produces: `WidgetDef.raw?: true`
- Produces: `RawRequestView({ backend: BackendConfig; widget: WidgetDef; params: Record<string, string>; refreshKey: number })`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/widgetsJson.test.ts`:

```ts
describe("raw", () => {
  it("keeps only a literal true", () => {
    const { widgets } = normalizeWidgets({ a: { raw: true }, b: { raw: "true" }, c: {} }, "b1");
    expect(widgets.map((w) => w.raw)).toEqual([true, undefined, undefined]);
  });
});
```

Create `src/components/renderers/RawRequestView.test.tsx`:

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWidgetData = vi.fn();
vi.mock("../../lib/dataClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dataClient")>()),
  fetchWidgetData: (...args: unknown[]) => fetchWidgetData(...args),
}));

import { backend, widget } from "../../test/fixtures";
import { RawRequestView } from "./RawRequestView";

const html = widget({ id: "portfolio", type: "html", raw: true });

beforeEach(() => fetchWidgetData.mockReset());

describe("RawRequestView", () => {
  it("asks the same endpoint with the card's params plus raw=true", async () => {
    fetchWidgetData.mockResolvedValue([]);
    render(<RawRequestView backend={backend()} widget={html} params={{ symbol: "AAPL" }} refreshKey={0} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    expect(fetchWidgetData.mock.calls[0][2]).toEqual({ symbol: "AAPL", raw: "true" });
  });

  it("shows a list of records as a table", async () => {
    fetchWidgetData.mockResolvedValue([{ symbol: "AAPL", shares: 100 }]);
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows an object's results list as a table", async () => {
    fetchWidgetData.mockResolvedValue({ results: [{ symbol: "AAPL" }] });
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows anything else as JSON", async () => {
    fetchWidgetData.mockResolvedValue("<ul></ul>");
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByTestId("raw-json")).toHaveTextContent('"<ul></ul>"');
  });

  it("refetches the raw request when refreshKey changes", async () => {
    fetchWidgetData.mockResolvedValue([]);
    const { rerender } = render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    rerender(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={1} />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(fetchWidgetData.mock.calls[1][2]).toEqual({ raw: "true" });
  });

  it("shows the error when the raw request fails", async () => {
    fetchWidgetData.mockRejectedValue(new Error("HTTP 422"));
    render(<RawRequestView backend={backend()} widget={html} params={{}} refreshKey={0} />);
    expect(await screen.findByText("HTTP 422")).toBeInTheDocument();
  });
});
```

The "shows a list of records as a table" test assumes the virtualised `TableRenderer` renders a `table` element in jsdom. If it doesn't, assert `document.querySelector("table.widget-table")` instead; `WidgetCard.test.tsx` already relies on `table.widget-table`.

In `src/components/WidgetCard.test.tsx`, add a module mock next to the `RssRenderer` mock:

```tsx
// REPLACED: the real one issues its own request. What is under test is what the CARD hands it.
vi.mock("./renderers/RawRequestView", () => ({
  RawRequestView: (props: { params: unknown; refreshKey: unknown }) => (
    <span data-testid="raw-request">{JSON.stringify({ params: props.params, refreshKey: props.refreshKey })}</span>
  ),
}));
```

and inside `describe("WidgetCard renderer dispatch", …)`:

```tsx
  it("routes a raw: true html card's Raw view to the raw re-request, with the card's own params", () => {
    setUp({ type: "html", raw: true }, "<p>hi</p>");
    useBackendsStore.setState({ backends: [backend()] });
    useDashboardStore.setState({ refreshEpoch: 2 });
    useWidgetData.mockReturnValue({ status: "ready", data: "<p>hi</p>", retry: vi.fn(), attempt: 1 });
    render(<WidgetCard card={{ ...card, view: "raw", params: { symbol: "AAPL" } }} onRemove={vi.fn()} />);
    expect(JSON.parse(screen.getByTestId("raw-request").textContent!)).toEqual({ params: { symbol: "AAPL" }, refreshKey: 3 });
  });

  it("keeps the fetched-payload Raw view for an html card without raw: true", () => {
    setUp({ type: "html" }, "<p>hi</p>");
    useBackendsStore.setState({ backends: [backend()] });
    render(<WidgetCard card={{ ...card, view: "raw" }} onRemove={vi.fn()} />);
    expect(screen.queryByTestId("raw-request")).toBeNull();
    expect(screen.getByTestId("raw-json")).toHaveTextContent('"<p>hi</p>"');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/components/renderers/RawRequestView.test.tsx src/components/WidgetCard.test.tsx -t "raw"`
Expected: FAIL (`RawRequestView` can't be resolved, and `raw` is undefined).

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, inside `WidgetDef` after `exportable`:

```ts
  /**
   * `raw: true` on an html or youtube widget: its Raw view re-asks the
   * endpoint with `raw=true` for the data behind the rendering (see
   * RawRequestView). Only ever `true` or absent.
   */
  raw?: true;
```

In `src/lib/widgetsJson.ts`'s push object, after `exportable`:

```ts
      raw: w.raw === true ? true : undefined,
```

Create `src/components/renderers/RawRequestView.tsx`:

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { fetchWidgetData } from "../../lib/dataClient";
import { isRecord } from "../../lib/isRecord";
import { paramsKey } from "../../lib/params";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { RawJsonView } from "./RawJsonView";
import { TableRenderer } from "./TableRenderer";

/**
 * The Raw view of an `html` or `youtube` widget that declares `raw: true`.
 * Its payload is markup or a video, not the data behind it, so the reference
 * (widget-types/html.md, "Raw Data View") has Raw ask the same endpoint again
 * with `raw=true` added to the card's params. The normal view never sends
 * it. A list of records -- or an object's `results` list -- is a table;
 * anything else is shown as JSON. `refreshKey` is how the header's Refresh
 * reaches this request, as for multi_file_viewer.
 */
export function RawRequestView({
  backend,
  widget,
  params,
  refreshKey,
}: {
  backend: BackendConfig;
  widget: WidgetDef;
  params: Record<string, string>;
  refreshKey: number;
}) {
  const [result, setResult] = useState<{ data: unknown } | { error: string } | null>(null);
  // A value-derived key, as in useWidgetData: the caller's params object can
  // change identity without changing the question.
  const key = paramsKey(params);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    fetchWidgetData(backend, widget, { ...params, raw: "true" }).then(
      (data) => {
        if (!cancelled) setResult({ data });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `params`
  }, [backend, widget, key, refreshKey]);

  if (result === null) return <p className="empty-state">Loading…</p>;
  if ("error" in result) return <p className="empty-state">{result.error}</p>;
  const { data } = result;
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.results) ? data.results : null;
  return rows ? <TableRenderer data={rows} /> : <RawJsonView data={data} />;
}
```

In `src/components/WidgetCard.tsx`, add `import { RawRequestView } from "./renderers/RawRequestView";` next to the `RawJsonView` import, and insert immediately before `if (view === "raw") return <RawJsonView data={data} />;`:

```tsx
    // html and youtube render markup or a video, not data: with `raw: true`
    // their Raw view re-asks the endpoint with raw=true instead of dumping
    // the payload already fetched (see RawRequestView).
    if (
      view === "raw" &&
      widget?.raw &&
      backend &&
      (widget.type === "html" || widget.type === "youtube")
    ) {
      return (
        <RawRequestView backend={backend} widget={widget} params={query} refreshKey={attempt + refreshEpoch} />
      );
    }
```

In `src/help/guide/html-and-iframe-widgets.md`, after line 10:

```

An HTML widget that declares `raw: true` — and a YouTube widget that does — gets a **Raw** view that asks its endpoint again with `raw=true` added to the card's parameters. A list of records, or an object whose `results` is one, is shown as a table; anything else as JSON. The normal view never sends `raw`, and **Refresh** while Raw is showing repeats the raw request. Without `raw: true`, Raw shows the payload already fetched, as on every other card.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/components/renderers/RawRequestView.test.tsx src/components/WidgetCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/renderers/RawRequestView.tsx src/components/renderers/RawRequestView.test.tsx src/lib/types.ts src/lib/widgetsJson.ts src/components/WidgetCard.tsx src/help/guide/html-and-iframe-widgets.md src/lib/widgetsJson.test.ts src/components/WidgetCard.test.tsx
git commit -m "feat(widgets): re-request raw=true for the Raw view of raw html/youtube widgets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: F1. The cron module

**Files:**
- Create: `src/lib/cron.ts`
- Test: create `src/lib/cron.test.ts`

**Interfaces:**
- Produces: `type Cron = { minute: Set<number>; hour: Set<number>; dayOfMonth: Set<number>; month: Set<number>; dayOfWeek: Set<number>; eitherDay: boolean }`
- Produces: `parseCron(expr: string): Cron | null`
- Produces: `cronMatches(cron: Cron, at: Date): boolean`
- Produces: `cronNext(cron: Cron, after: Date): Date | null` (first match strictly after the minute containing `after`)
- Produces: `cronPrev(cron: Cron, atOrBefore: Date): Date | null` (latest match at or before `atOrBefore`)
- Produces: `dataUpdateText(expr: string, now: Date): string | undefined`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cron.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { cronMatches, cronNext, cronPrev, dataUpdateText, parseCron } from "./cron";

/** Local time, as cron is. Month is 1-based here for readability. */
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

describe("parseCron", () => {
  it.each([
    "* * * * *",
    "*/5 * * * *",
    "0 8 * * 1-5",
    "0 10 * * *",
    "0 0 * * 0",
    "0 0 * * 7",
    "0,30 9-17/2 1,15 1-12 *",
    "  0 10 * * *  ",
  ])("accepts %s", (expr) => {
    expect(parseCron(expr)).not.toBeNull();
  });

  it.each([
    "",
    "* * * *",
    "* * * * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "* * * * 8",
    "5-1 * * * *",
    "*/0 * * * *",
    "5/2 * * * *",
    "1,,2 * * * *",
    "a * * * *",
    "-1 * * * *",
    "* * * JAN *",
  ])("rejects %j", (expr) => {
    expect(parseCron(expr)).toBeNull();
  });

  it("treats day-of-week 7 as Sunday, like 0", () => {
    const sunday = at(2026, 11, 1, 0, 0); // 1 Nov 2026 is a Sunday
    expect(cronMatches(parseCron("0 0 * * 7")!, sunday)).toBe(true);
    expect(cronMatches(parseCron("0 0 * * 0")!, sunday)).toBe(true);
  });
});

describe("cronMatches", () => {
  it("matches a day when EITHER restricted day field matches", () => {
    const c = parseCron("0 0 13 * 5")!; // the 13th, or any Friday
    expect(cronMatches(c, at(2026, 11, 13, 0, 0))).toBe(true); // Friday the 13th
    expect(cronMatches(c, at(2026, 10, 13, 0, 0))).toBe(true); // a Tuesday the 13th
    expect(cronMatches(c, at(2026, 10, 30, 0, 0))).toBe(true); // a Friday the 30th
    expect(cronMatches(c, at(2026, 10, 29, 0, 0))).toBe(false); // a Thursday the 29th
  });

  it("needs both when only one day field is restricted", () => {
    const c = parseCron("0 8 * * 1-5")!;
    expect(cronMatches(c, at(2026, 10, 29, 8, 0))).toBe(true); // Thursday
    expect(cronMatches(c, at(2026, 10, 31, 8, 0))).toBe(false); // Saturday
    expect(cronMatches(c, at(2026, 10, 29, 8, 1))).toBe(false);
  });
});

describe("cronNext / cronPrev", () => {
  it("finds the next boundary strictly after the given minute", () => {
    const c = parseCron("*/5 * * * *")!;
    expect(cronNext(c, at(2026, 10, 29, 10, 2))).toEqual(at(2026, 10, 29, 10, 5));
    expect(cronNext(c, at(2026, 10, 29, 10, 5))).toEqual(at(2026, 10, 29, 10, 10));
  });

  it("finds the latest boundary at or before the given time", () => {
    const c = parseCron("0 10 * * *")!;
    expect(cronPrev(c, at(2026, 10, 29, 12, 0))).toEqual(at(2026, 10, 29, 10, 0));
    expect(cronPrev(c, at(2026, 10, 29, 10, 0))).toEqual(at(2026, 10, 29, 10, 0));
    expect(cronPrev(c, at(2026, 10, 29, 9, 59))).toEqual(at(2026, 10, 28, 10, 0));
  });

  it("reaches a leap day within its four-year cap", () => {
    expect(cronNext(parseCron("0 0 29 2 *")!, at(2026, 10, 29, 0, 0))).toEqual(at(2028, 2, 29, 0, 0));
  });

  it("gives up, rather than looping, on a date that never comes", () => {
    expect(cronNext(parseCron("0 0 30 2 *")!, at(2026, 10, 29, 0, 0))).toBeNull();
  });
});

describe("dataUpdateText", () => {
  it("names the expression and the previous and next scheduled updates in local time", () => {
    const now = at(2026, 10, 29, 12, 0);
    expect(dataUpdateText("0 10 * * *", now)).toBe(
      `Data update: 0 10 * * * · last ${at(2026, 10, 29, 10, 0).toLocaleString()} · next ${at(2026, 10, 30, 10, 0).toLocaleString()}`,
    );
  });

  it("is undefined for an invalid expression", () => {
    expect(dataUpdateText("every day", new Date())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/cron.test.ts`
Expected: FAIL ("Failed to resolve import ./cron").

- [ ] **Step 3: Implement**

Create `src/lib/cron.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standard five-field cron -- minute, hour, day-of-month, month, day-of-week
 * -- as widgets.json's `refetchInterval` and `dataUpdateDisplay` use it, in
 * local time. Supported: `*`, numbers, lists `a,b`, ranges `a-b`, and steps
 * `*\/n` and `a-b/n`. Day-of-week runs 0-7 and both 0 and 7 are Sunday. No
 * names, no `?`, `L` or `#`: an expression using them is invalid.
 */
export type Cron = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /**
   * Both day fields restricted: a day matches if EITHER does (standard
   * cron). A field counts as unrestricted when it starts with `*`, as in
   * Vixie cron, so `*\/2` in one day field still ANDs with the other.
   */
  eitherDay: boolean;
};

const BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const DIGITS = /^\d+$/;

function parseField(text: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText, ...extra] = part.split("/");
    if (extra.length > 0) return null;
    let step = 1;
    if (stepText !== undefined) {
      if (!DIGITS.test(stepText)) return null;
      step = Number(stepText);
      if (step < 1) return null;
    }
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const ends = range.split("-");
      if (ends.length > 2 || !ends.every((e) => DIGITS.test(e))) return null;
      // `a/n` is not in the grammar: a step needs `*` or a range.
      if (stepText !== undefined && ends.length === 1) return null;
      lo = Number(ends[0]);
      hi = Number(ends[ends.length - 1]);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** null for anything that is not a valid expression in the grammar above. */
export function parseCron(expr: string): Cron | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(fields[i], BOUNDS[i][0], BOUNDS[i][1]);
    if (set === null) return null;
    sets.push(set);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = sets;
  if (dayOfWeek.delete(7)) dayOfWeek.add(0);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    eitherDay: !fields[2].startsWith("*") && !fields[4].startsWith("*"),
  };
}

export function cronMatches(cron: Cron, at: Date): boolean {
  if (!cron.minute.has(at.getMinutes()) || !cron.hour.has(at.getHours())) return false;
  if (!cron.month.has(at.getMonth() + 1)) return false;
  const dom = cron.dayOfMonth.has(at.getDate());
  const dow = cron.dayOfWeek.has(at.getDay());
  return cron.eitherDay ? dom || dow : dom && dow;
}

const MINUTE = 60_000;
// ponytail: minute-by-minute scan capped at four years (~2.1M steps, reached
// only by an expression that never matches, like `0 0 30 2 *`); jump field
// by field instead if it ever shows up in a profile.
const SCAN_LIMIT = 4 * 366 * 24 * 60;

/** The first matching minute strictly after the one containing `after`, or null within the cap. */
export function cronNext(cron: Cron, after: Date): Date | null {
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE;
  for (let i = 0; i < SCAN_LIMIT; i++) {
    t += MINUTE;
    const d = new Date(t);
    if (cronMatches(cron, d)) return d;
  }
  return null;
}

/** The latest matching minute at or before `atOrBefore`, or null within the cap. */
export function cronPrev(cron: Cron, atOrBefore: Date): Date | null {
  let t = Math.floor(atOrBefore.getTime() / MINUTE) * MINUTE;
  for (let i = 0; i < SCAN_LIMIT; i++, t -= MINUTE) {
    const d = new Date(t);
    if (cronMatches(cron, d)) return d;
  }
  return null;
}

/**
 * The refresh button's "Data update" line for `dataUpdateDisplay`: the
 * expression and its previous and next scheduled times, which come from the
 * schedule, not from when the card last fetched (data-update-display.md).
 */
export function dataUpdateText(expr: string, now: Date): string | undefined {
  const cron = parseCron(expr);
  if (cron === null) return undefined;
  const when = (d: Date | null) => (d === null ? "—" : d.toLocaleString());
  return `Data update: ${expr} · last ${when(cronPrev(cron, now))} · next ${when(cronNext(cron, now))}`;
}
```

The `*\/` inside the doc comments avoids closing the comment early. Write it exactly as shown.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/cron.test.ts`
Expected: PASS. The "never comes" case scans the full cap and may take about a second.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron.ts src/lib/cron.test.ts
git commit -m "feat(cron): add a five-field cron matcher

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: F2. Cron `refetchInterval`

**Files:**
- Modify: `src/lib/types.ts` (`WidgetDef`)
- Modify: `src/lib/widgetsJson.ts` (import `parseCron`; issue + push; `normalizeWidgets` doc comment)
- Modify: `src/hooks/useMinuteTick.ts` (export `msToNextMinute`)
- Modify: `src/hooks/useWidgetData.ts` (`refreshIntervalMs`, the fetch effect's timer)
- Modify: `src/help/guide/running-and-refreshing.md` (line 24), `src/help/guide/reference-validation.md` (step 4, "Cron scheduling remains deferred."), `src/help/topics/running-and-refreshing.md` (line 31; see Open question 1)
- Test: `src/lib/widgetsJson.test.ts`, `src/hooks/useMinuteTick.test.ts`, `src/hooks/useWidgetData.test.tsx`

**Interfaces:**
- Consumes: `parseCron`, `cronMatches`, `cronNext` from Task 6
- Produces: `WidgetDef.refetchCron?: string` (a valid cron expression; `refetchInterval` itself stays `number | false | undefined`)
- Produces: `msToNextMinute(now?: number): number`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/widgetsJson.test.ts`:

```ts
describe("cron refetchInterval", () => {
  it("keeps a valid cron string as refetchCron, leaving the numeric field unset", () => {
    const { widgets: [w], issues } = normalizeWidgets({ a: { refetchInterval: "*/1 * * * *" } }, "b1");
    expect(w.refetchCron).toBe("*/1 * * * *");
    expect(w.refetchInterval).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("treats an invalid cron string as absent and reports it", () => {
    const { widgets: [w], issues } = normalizeWidgets({ a: { refetchInterval: "every minute" } }, "b1");
    expect(w.refetchCron).toBeUndefined();
    expect(w.refetchInterval).toBeUndefined();
    expect(issues).toEqual([{ id: "a", reason: 'refetchInterval "every minute" is not a valid cron expression; ignored' }]);
  });

  it("leaves numbers and false exactly as before", () => {
    const { widgets } = normalizeWidgets({ a: { refetchInterval: 60_000 }, b: { refetchInterval: false } }, "b1");
    expect(widgets.map((w) => [w.refetchInterval, w.refetchCron])).toEqual([[60_000, undefined], [false, undefined]]);
  });
});
```

Append to `src/hooks/useMinuteTick.test.ts` (add `msToNextMinute` to its import):

```ts
describe("msToNextMinute", () => {
  it("is the time left to the next minute boundary", () => {
    expect(msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 15))).toBe(45_000);
    expect(msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 59, 999))).toBe(1);
  });
});
```

In `src/hooks/useWidgetData.test.tsx`, add to the `refreshIntervalMs` describe:

```ts
  it("leaves a cron widget off the app-wide interval", () => {
    expect(refreshIntervalMs(widget({ refetchCron: "0 * * * *" }), 5)).toBeUndefined();
  });
```

and inside `describe("useWidgetData auto-refresh", …)`:

```ts
  /** Registers w1 with a cron refetchInterval, already normalised. */
  function registerCron(expr: string) {
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({ widgets: st.widgets.map((w) => ({ ...w, refetchCron: expr })) }));
  }

  it("refetches on each minute boundary the cron matches, and on no other", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerCron("*/5 * * * *");
    useFakeClock();
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 30));

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(priceRequests(s)).toBe(1);

    // 10:01 through 10:04 pass without a match.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(priceRequests(s)).toBe(1);

    // 10:05 matches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

  it("does not refetch on a minute boundary the expression does not match, and ignores the app-wide interval", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerCron("0 0 1 * *"); // monthly: far past setTimeout's ceiling
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 30));

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(priceRequests(s)).toBe(1);
    expect(result.current.intervalMs).toBeUndefined();
  });

  it("catches up once on becoming visible when a cron boundary passed while hidden", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerCron("*/5 * * * *");
    useFakeClock();
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 30));

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000);
    });
    expect(priceRequests(s)).toBe(1);

    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/hooks/useMinuteTick.test.ts src/hooks/useWidgetData.test.tsx -t "cron|msToNextMinute"`
Expected: FAIL (`refetchCron` and `msToNextMinute` don't exist, and no cron refetch happens).

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, inside `WidgetDef` after `refetchInterval`:

```ts
  /**
   * A cron `refetchInterval`, already validated: the card refetches on each
   * minute boundary it matches, and the app-wide interval does not apply. An
   * invalid string never gets here (normalizeWidgets reports and drops it).
   */
  refetchCron?: string;
```

In `src/lib/widgetsJson.ts`, add `import { parseCron } from "./cron";`. In the loop, after the params issue lines and before `widgets.push`:

```ts
    // A string refetchInterval is a cron expression (refetch-interval.md).
    // One that does not parse is treated as absent, and reported.
    const cronText = typeof w.refetchInterval === "string" ? w.refetchInterval : undefined;
    const refetchCron = cronText !== undefined && parseCron(cronText) !== null ? cronText : undefined;
    if (cronText !== undefined && refetchCron === undefined) {
      issues.push({ id, reason: `refetchInterval "${cronText}" is not a valid cron expression; ignored` });
    }
```

In the push object after `refetchInterval: …`:

```ts
      refetchCron,
```

In the `normalizeWidgets` doc comment, after "…a params value that isn't an array at all)", add: ", and a string `refetchInterval` that is not a valid cron expression". `refetchMs` already turns a string into `undefined`, so `refetchInterval` stays unset for a cron string.

In `src/hooks/useMinuteTick.ts`, add above `useMinuteTick`:

```ts
/**
 * Milliseconds from `now` to the next minute boundary. Shared with
 * useWidgetData, whose cron refetch wakes on the same boundaries.
 */
export function msToNextMinute(now = Date.now()): number {
  return MINUTE - (now % MINUTE);
}
```

and in `schedule` replace `const ms = MINUTE - (Date.now() % MINUTE);` with `const ms = msToNextMinute();`.

In `src/hooks/useWidgetData.ts`, add the imports:

```ts
import { cronMatches, cronNext, parseCron, type Cron } from "../lib/cron";
import { msToNextMinute } from "./useMinuteTick";
```

At the top of `refreshIntervalMs`'s body:

```ts
  // A cron schedule replaces the interval outright: neither the manifest's
  // number nor the user's setting applies (see the cron timer below).
  if (widget.refetchCron !== undefined) return undefined;
```

Inside the fetch effect, after `let completedAt = 0;`:

```ts
    /** The widget's cron refetchInterval; null for every other widget. */
    const cron = widget.refetchCron === undefined ? null : parseCron(widget.refetchCron);
```

After `function arm(…) { … }`, add:

```ts
    // useMinuteTick's scheduling: wake on every minute boundary and refetch
    // on the ones the expression matches. Waking each minute rather than
    // sleeping until the next match keeps every delay far below setTimeout's
    // ceiling, however rare the schedule (a monthly one is ~31 days).
    function armCron(schedule: Cron) {
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (cronMatches(schedule, new Date())) setAttempt((n) => n + 1);
        else armCron(schedule);
      }, msToNextMinute());
    }
```

Replace `armAfterCompletion`'s two body lines after `completedAt = Date.now();` with:

```ts
      if (document.hidden) return;
      if (cron) armCron(cron);
      else if (intervalMs !== undefined) arm(intervalMs);
```

Replace `onVisibilityChange` with:

```ts
    function onVisibilityChange() {
      if (cancelled || (intervalMs === undefined && cron === null)) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      // Still waiting on the first answer: armAfterCompletion will arm it.
      if (completedAt === 0) return;
      if (cron) {
        // A boundary that matched while hidden is caught up once, as an
        // elapsed interval is below.
        const due = cronNext(cron, new Date(completedAt));
        if (due !== null && due.getTime() <= Date.now()) setAttempt((n) => n + 1);
        else armCron(cron);
        return;
      }
      if (intervalMs === undefined) return;
      const elapsed = Date.now() - completedAt;
      if (elapsed >= intervalMs) setAttempt((n) => n + 1);
      else arm(intervalMs - elapsed);
    }
```

The effect's dependency list doesn't change. `widget` is already in it, and `refetchCron` lives on `widget`.

Help:
- `src/help/guide/running-and-refreshing.md` line 24: replace "Cron-style refresh schedules are not supported in v3. Use a numeric interval, the app-wide refresh setting, or manual Refresh/Run." with:
  ```
  A widget's `refetchInterval` may also be a five-field cron expression, such as `*/5 * * * *` or `0 8 * * 1-5`, in local time. Such a card refetches on each minute boundary the expression matches, for as long as it is on screen, and your app-wide setting does not apply to it. An expression the app cannot read is ignored and noted in the log. Supported: `*`, numbers, lists, ranges and steps; day-of-week 0–7 with both 0 and 7 meaning Sunday.
  ```
- `src/help/topics/running-and-refreshing.md` line 31: replace the same sentence with "A widget's `refetchInterval` may also be a five-field cron expression; such a card refetches on each minute boundary the expression matches, and your app-wide setting does not apply to it."
- `src/help/guide/reference-validation.md` step 4: change "Try **Run** on a run-button widget, and a numeric-refresh example. Cron scheduling remains deferred." to "Try **Run** on a run-button widget, a numeric-refresh example and a cron-refresh example."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/hooks/useMinuteTick.test.ts src/hooks/useWidgetData.test.tsx`
Expected: PASS, including every existing interval and visibility test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/widgetsJson.ts src/hooks/useMinuteTick.ts src/hooks/useWidgetData.ts src/help/guide/running-and-refreshing.md src/help/guide/reference-validation.md src/help/topics/running-and-refreshing.md src/lib/widgetsJson.test.ts src/hooks/useMinuteTick.test.ts src/hooks/useWidgetData.test.tsx
git commit -m "feat(refresh): schedule refetches from a cron refetchInterval

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: F3. `staleTime` tint and `dataUpdateDisplay` tooltip

**Files:**
- Modify: `src/lib/types.ts` (`WidgetDef`)
- Modify: `src/lib/widgetsJson.ts` (push)
- Modify: `src/hooks/useWidgetData.ts` (`fetchedAt`, `dataStale`, return value)
- Modify: `src/components/WidgetCard.tsx` (destructure, Run/Refresh buttons ~line 1153–1172)
- Modify: `src/styles.css` (`--stale` token in both `:root` blocks; rule after `.card-action[aria-expanded="true"]`)
- Modify: `src/help/guide/running-and-refreshing.md` (end of "Automatic refresh")
- Test: `src/lib/widgetsJson.test.ts`, `src/hooks/useWidgetData.test.tsx`, `src/components/WidgetCard.test.tsx`

**Interfaces:**
- Consumes: `parseCron`, `dataUpdateText` from Task 6
- Produces: `WidgetDef.staleTime?: number` (finite, > 0), `WidgetDef.dataUpdateDisplay?: string` (a valid cron expression)
- Produces: `useWidgetData(...).dataStale: boolean`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/widgetsJson.test.ts`:

```ts
describe("staleTime and dataUpdateDisplay", () => {
  it("keeps a finite positive staleTime and nothing else", () => {
    const { widgets } = normalizeWidgets(
      { a: { staleTime: 5000 }, b: { staleTime: 0 }, c: { staleTime: "5000" }, d: { staleTime: Infinity }, e: {} },
      "b1",
    );
    expect(widgets.map((w) => w.staleTime)).toEqual([5000, undefined, undefined, undefined, undefined]);
  });

  it("keeps only a valid cron dataUpdateDisplay", () => {
    const { widgets, issues } = normalizeWidgets(
      { a: { dataUpdateDisplay: "0 10 * * *" }, b: { dataUpdateDisplay: "daily" }, c: { dataUpdateDisplay: 10 } },
      "b1",
    );
    expect(widgets.map((w) => w.dataUpdateDisplay)).toEqual(["0 10 * * *", undefined, undefined]);
    expect(issues).toEqual([]);
  });
});
```

In `src/hooks/useWidgetData.test.tsx`, inside `describe("useWidgetData auto-refresh", …)`:

```ts
  it("reports data stale once it is older than staleTime, and fresh again after a refetch", async () => {
    await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({ widgets: st.widgets.map((w) => ({ ...w, staleTime: 120_000 })) }));
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.dataStale).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(result.current.dataStale).toBe(true);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.dataStale).toBe(false));
  });

  it("never reports stale for a widget that declares no staleTime", async () => {
    await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(result.current.dataStale).toBe(false);
  });
```

In `src/components/WidgetCard.test.tsx`, inside `describe("WidgetCard", …)`:

```tsx
  it("tints Refresh when the hook reports the data stale, and says so in its tooltip", () => {
    register();
    useWidgetData.mockReturnValue({ status: "ready", data: [], retry: vi.fn(), dataStale: true });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("data-stale", "true");
    expect(refresh).toHaveAttribute("title", "Data is older than its stale time");
  });

  it("leaves Refresh untinted and untitled without staleness or a dataUpdateDisplay", () => {
    register();
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).not.toHaveAttribute("data-stale");
    expect(refresh).not.toHaveAttribute("title");
  });

  it("adds the dataUpdateDisplay schedule to the refresh tooltip, as of the hover", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 29, 12, 0));
      register({ dataUpdateDisplay: "0 10 * * *" });
      render(<WidgetCard card={card} onRemove={vi.fn()} />);
      const refresh = screen.getByRole("button", { name: "Refresh" });

      vi.setSystemTime(new Date(2026, 9, 30, 11, 0));
      fireEvent.pointerEnter(refresh);

      expect(refresh).toHaveAttribute(
        "title",
        `Data update: 0 10 * * * · last ${new Date(2026, 9, 30, 10, 0).toLocaleString()} · next ${new Date(2026, 9, 31, 10, 0).toLocaleString()}`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Run's own tooltip and adds the schedule beneath it", () => {
    register({ runButton: true, dataUpdateDisplay: "0 10 * * *" });
    render(<WidgetCard card={card} onRemove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Run" }).getAttribute("title")).toMatch(
      /^Run \(⌘-click: hard refresh\)\nData update: 0 10 \* \* \* · last /,
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/hooks/useWidgetData.test.tsx src/components/WidgetCard.test.tsx -t "stale|dataUpdateDisplay|tooltip|untinted"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, inside `WidgetDef` after `refetchCron`:

```ts
  /**
   * Milliseconds after a successful fetch at which the data counts as stale:
   * the refresh button takes the stale tint. Applied only when declared.
   */
  staleTime?: number;
  /**
   * A cron expression shown in the refresh button's tooltip with its
   * previous and next scheduled times. Display only: it never fetches.
   */
  dataUpdateDisplay?: string;
```

In `src/lib/widgetsJson.ts`'s push object after `refetchCron,`:

```ts
      staleTime:
        typeof w.staleTime === "number" && Number.isFinite(w.staleTime) && w.staleTime > 0 ? w.staleTime : undefined,
      dataUpdateDisplay:
        typeof w.dataUpdateDisplay === "string" && parseCron(w.dataUpdateDisplay) !== null
          ? w.dataUpdateDisplay
          : undefined,
```

In `src/hooks/useWidgetData.ts`, after the `attempt` state:

```ts
  /** Date.now() of the last successful fetch; null until there is one. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  /** The widget's staleTime has passed since fetchedAt. Always false without one. */
  const [dataStale, setDataStale] = useState(false);
  const staleTime = widget?.staleTime;
```

In the fetch effect's success path, after `setData(result);`, add `setFetchedAt(Date.now());`. After the fetch effect, add:

```ts
  // The stale tint (stale-time.md): set once staleTime has passed since the
  // last successful fetch, cleared by the next one.
  useEffect(() => {
    setDataStale(false);
    if (staleTime === undefined || fetchedAt === null) return;
    const timer = setTimeout(() => setDataStale(true), Math.min(staleTime, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [staleTime, fetchedAt]);
```

Add `dataStale` to the returned object.

In `src/components/WidgetCard.tsx`, add `dataStale` to the `useWidgetData` destructure. Add `import { dataUpdateText } from "../lib/cron";`. Near the other `useState`s add:

```tsx
  /**
   * When the refresh tooltip was last stamped. The pointer or focus reaching
   * the button restamps it, so "last" and "next" are as of the hover, not of
   * the card's last render. Only a dataUpdateDisplay widget needs it.
   */
  const [titleAt, setTitleAt] = useState(() => new Date());
  const stampTitle = () => {
    if (widget?.dataUpdateDisplay) setTitleAt(new Date());
  };
```

Before the `return (`, add:

```tsx
  /** The refresh/Run tooltip: the button's own words, then staleness, then the data update schedule. */
  const refreshTitle = (base?: string) =>
    [
      base,
      dataStale ? "Data is older than its stale time" : undefined,
      widget?.dataUpdateDisplay ? dataUpdateText(widget.dataUpdateDisplay, titleAt) : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n") || undefined;
```

On the Run button, replace `title="Run (⌘-click: hard refresh)"` with:

```tsx
                title={refreshTitle("Run (⌘-click: hard refresh)")}
                data-stale={dataStale || undefined}
                onPointerEnter={stampTitle}
                onFocus={stampTitle}
```

Replace the Refresh button with:

```tsx
              <button
                type="button"
                className="card-action"
                title={refreshTitle()}
                data-stale={dataStale || undefined}
                onPointerEnter={stampTitle}
                onFocus={stampTitle}
                onClick={retry}
              >
                Refresh
              </button>
```

In `src/styles.css`, add `--stale: #e0a040;` after `--error` in the dark `:root` block (~line 12), and `--stale: #b7791f;` after `--error` in the `:root[data-theme="light"]` block (~line 55). After the `.card-action[aria-expanded="true"]` rule, add:

```css
/* staleTime has passed since the last fetch: the reference's orange refresh
   button. Comes after the accent states so a stale button reads as stale. */
.card-action[data-stale="true"] { color: var(--stale); border-color: var(--stale); }
```

Check that `.card-action.card-run` (filled accent) still reads with the stale border. It does: its `color` comes from the more specific rule, and the stale rule changes only the border.

In `src/help/guide/running-and-refreshing.md`, at the end of the "Automatic refresh" bullet list (after the "*Backend not configured*" bullet), add:

```

A widget may also declare a `staleTime`, in milliseconds. Once its data is older than that, the card's **Refresh** (or **Run**) button turns orange, and the next fetch clears it. Coming back to a dashboard or tab always refetches its cards, because cards that are off screen are not mounted. A `dataUpdateDisplay` cron expression adds a line to that button's tooltip — *Data update: `<expression>` · last `<time>` · next `<time>`*, in local time — giving the schedule's previous and next times, not when the card last fetched. It never triggers a fetch.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts src/hooks/useWidgetData.test.tsx src/components/WidgetCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/widgetsJson.ts src/hooks/useWidgetData.ts src/components/WidgetCard.tsx src/styles.css src/help/guide/running-and-refreshing.md src/lib/widgetsJson.test.ts src/hooks/useWidgetData.test.tsx src/components/WidgetCard.test.tsx
git commit -m "feat(refresh): stale tint from staleTime and a dataUpdateDisplay tooltip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gates

**Files:** none new.

- [ ] **Step 1: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0. If lint flags the `eslint-disable-next-line` in `RawRequestView.tsx` as unused, remove it: in that case the rule already accepts `key`.

- [ ] **Step 2: Header check**

Run: `bash scripts/header-check.sh`
Expected: exit 0. The new files are `src/lib/cron.ts`, `src/lib/cron.test.ts`, `src/components/renderers/RawRequestView.tsx` and `src/components/renderers/RawRequestView.test.tsx`.

- [ ] **Step 3: Full unit suite**

Run: `pnpm test:run`
Expected: PASS. If it times out under host load, rerun the touched files with `pnpm vitest run src/lib src/hooks src/components src/stores` and report the timeout instead of claiming a pass.

- [ ] **Step 4: Confirm no stray dependency**

Run: `git diff "v3.0.0" -- package.json pnpm-lock.yaml`
Expected: no output.

- [ ] **Step 5: Commit any gate fixes**

Commit only if steps 1–3 required edits:

```bash
git add -A src
git commit -m "chore: gate fixes for the Workspace field gaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
