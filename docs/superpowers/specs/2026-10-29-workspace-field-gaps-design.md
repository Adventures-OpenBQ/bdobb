# Workspace field gaps — design

Date: 2026-10-29. Repo: Adventures-OpenBQ/bdobb.

## Why

The compatibility page (`secretoftheuniverse/src/compatibility.html`, "Not yet",
stated against v10.0.0) lists Workspace `widgets.json` fields BDOBB does not act
on. A widget that uses them loads, but the field is ignored. This design closes
them. The behaviour each field should have comes from OpenBB's archived
Workspace docs (snapshots in bdobb-v2 `docs/openbb-reference/`:
`json-specs/widgets-json-reference.md`, `widget-configuration/refetch-interval.md`,
`data-update-display.md`, `stale-time.md`, `render-functions.md`,
`matching-widget-to-mcp-tool.md`, `widget-types/html.md`,
`widget-types/aggrid-table-charts.md`). Those are an interface reference only.

## Placement (ruled 2026-10-29)

- Items A–F: home line **v3**. Build on `v3.0.0` (= `release/v3`), PR into
  `release/v3`, then carry forward through v4…v11, v11.5 and v12 in the release
  walk. Every subject already exists in v3.0.0.
- Item G (`mcp_tool`): home line **v6** (first tag with agent MCP servers).
  Build on `v6.0.0` (= `release/v6`), then carry forward.
- Item H: docs only, no code.
- The carry and the compatibility-page edits come after the merges and are
  not part of these plans.

## Decisions (ruled 2026-10-29)

- Cron is evaluated by a hand-written 5-field matcher. **No new dependency.**
  Refetch timing reuses the minute-boundary scheduling of
  `src/hooks/useMinuteTick.ts`.
- The live-grid header credential stays as it is: V10-P1 (no credential moved
  into a URL) stands.
- `mcp_tool` is in this batch.

## Shared rules

- The manifest is untrusted JSON. Read literal types only: `false` (not
  `"false"` or `0`), non-empty strings, finite numbers. A malformed value is
  treated as absent, as `widgetsJson.ts` already does for other fields.
- An absent field leaves today's behaviour exactly as it is.
- New files carry the AGPL-3.0-only header (`scripts/header-check.sh`).
- Each item updates the in-app help (`src/help/guide/`) where the field is
  documented.

## Items

### A. `exportable`
`exportable: false` hides the card's Export menu (CSV, JSON, Excel). Any
other value keeps export available. Today `canExport` in `WidgetCard.tsx`
decides this; it also checks `widget.exportable !== false`.

### B. `imgUrl`
An `http(s)` URL. In `WidgetLibrary`, hovering **or keyboard-focusing** a widget
row shows the image as a preview, with the widget name as alt text. An image
that fails to load shows nothing, not a broken-image icon. Other URL schemes
are ignored. The CSP already allows `img-src https: http:`.

### C. `columnColor` with `colorValueKey`
`colorRules` already colour cells whatever `renderFn` says, so a plain
`columnColor` column already works. What is missing: when
`renderFnParams.colorValueKey` is a non-empty string, a column's colorRules are
tested against **that field of the same row**, not against the cell's own
value (render-functions.md, "Multiple Render Functions and Color Rules"). The
existing `colorValueKey` use for `showCellChange` is unchanged. If the row
lacks that field, no rule matches.

### D. `chartDataType` and the widget's `chartView`
- `columnsDefs[].chartDataType` ∈ `category | series | time | excluded`.
- `data.table.chartView` = `{ enabled?: boolean, chartType?: string }`.
- When any column declares a `chartDataType`, a chart built from rows uses:
  x = the first `time` column, else the first `category` column; y = the
  `series` columns; `excluded` columns are never plotted. Without any
  declaration, today's detection (`detectChartAxis`) runs unchanged.
- `chartType` picks the trace for row-built charts: `line`, `area`,
  `column` (vertical bars), `bar` (horizontal bars), `scatter`. Anything else
  draws as `line`.
- `chartView.enabled: true` opens a **new** card in chart view. A card with
  a saved view keeps that view.
- A Plotly figure payload is still drawn exactly as it arrives.

### E. `raw: true` re-request
For `html` and `youtube` widgets with `raw: true`, the Raw view requests the
same endpoint with the card's params plus `raw=true`, and shows a list of
records (or an object's `results`) as a table, or else the JSON. The normal
view never sends `raw`. Refreshing while in Raw refetches the raw request.
Every other widget's Raw view stays as it is (it shows the payload already
fetched).

### F. Refresh schedule: cron `refetchInterval`, `staleTime`, `dataUpdateDisplay`
- **Cron module** (`src/lib/cron.ts`): standard 5 fields (minute, hour,
  day-of-month, month, day-of-week). Supports `*`, numbers, lists `a,b`, ranges
  `a-b`, and steps `*/n` and `a-b/n`. Day-of-week is 0–7, where both 0 and 7
  are Sunday. When day-of-month and day-of-week are both restricted, a day
  matches if **either** matches (standard cron). Local time. Previous and next
  times are found by stepping minute by minute, capped at four years, with a
  `ponytail:` comment naming the cap.
- **`refetchInterval` as a string**: a valid cron refetches the card on each
  minute boundary that matches, while the card is mounted. The app-wide
  interval does not apply to it. An invalid cron string is treated as absent,
  and validation reports it the way it reports other malformed fields. Numbers
  and `false` behave exactly as today.
- **`staleTime`** (ms, finite, > 0), applied **only when declared**. Once the
  data is older than `staleTime`, the refresh button shows a stale tint. When
  its dashboard becomes active again, a stale card refetches once.
- **`dataUpdateDisplay`** (cron string): display only. The refresh button's
  tooltip adds "Data update: `<expr>` · last `<local time>` · next
  `<local time>`". It never triggers a fetch.

### G. `mcp_tool` (v6 line)
`mcp_tool: { mcp_server, tool_id }`, both non-empty strings. When an agent
answer's recorded calls (`chatStore` `calls`, `kind: "agent_tool"`) include a
call whose server **name** equals `mcp_server` and whose tool equals `tool_id`
exactly, that answer's Sources list the matching widget as a citation.
Clicking it adds the widget to the open dashboard, or focuses its existing
card if one is already there. With no match, nothing changes.

### H. Live-grid header credentials
No code. The page's row is out of date: from v10 the app fetches a
single-use ticket from the backend's `ws_ticket`. Rewrite the row when the
compatibility page is updated.

## Success criteria

- For each item, OpenBB's reference example (cron refetch, data update
  display, stale time, raw HTML, table-to-chart / table-to-time-series,
  `columnColor` with `colorValueKey`, MCP matching) behaves as its doc
  describes.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:run` and `scripts/header-check.sh`
  pass on each branch.
- Manifests without these fields behave exactly as before. The existing tests
  pass unchanged.
