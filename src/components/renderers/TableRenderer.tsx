// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { ErrorCell } from './table-model/ErrorCell';
import { TotalRows } from './table-model/TotalRows';
import type { DatasetCellError } from '../../lib/widgetData/types';
import type { SelectionAction, SelectionSummary } from '../../lib/tableExecution/types';
import { accessorFor, declaredKind } from "../../lib/tableFiltering";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type CellContext,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type ColumnSizingState,
  type SortingFn,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cellVisual, titleCase, type CellVisual } from "../../lib/columnRender";
import { formatCell, type CellFormat } from "../../lib/format";
import { fillRowTemplate } from "../../lib/rowTemplate";
import { sparklineValues } from "../../lib/sparkline";
import { HoverCardCell } from "./HoverCardCell";
import { SparklineCell } from "./SparklineCell";
import {
  COLUMN_DRAG_TYPE,
  effectivePinned,
  hiddenFields,
  moveColumn,
  orderFields,
  setPinned,
  tableColumns,
  tableRows,
  type CellClick,
  type Row,
  type TableColumn,
} from "../../lib/tableColumns";
import { pivotFoldWarnings } from "../../lib/pivotKeys";
import { EMPTY_PIVOT, isPivoting, toggleExpanded } from "../../lib/pivotConfig";
import {
  KEY_SEP,
  LABEL_FIELD,
  pivotTable,
  type FieldKind,
  type PivotResult,
  type PivotRowMeta,
} from "../../lib/pivotTable";
import type { PinSide, PivotConfig, TableCardState, TableSpec } from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";
import { isMenuKey, RowContextMenu, type MenuItem } from "../RowContextMenu";
import { PivotPanel, PivotStrip } from "./PivotPanel";
import { RawJsonView } from "./RawJsonView";
import { FilterControl, filterFnFor, filterKindFor, type DateBounds } from "./TableFilterRow";
import type { ResolveContext } from "../../lib/dateExpressions";
import { filterDateContext, resolveDateFilters } from "../../lib/dateFilters";

/**
 * Shallow. `b` is always the null-prototype map built below, so a field named
 * "toString" reads as undefined rather than as an inherited function.
 */
function sameOffsets(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * What a clicked cell reports. `valueField` names a different row key than the
 * column displays; without one the COLUMN'S OWN field is read — not the
 * paramName it groups, which may be a different name entirely.
 *
 * Object.hasOwn rather than a bare index: `row` came back from JSON.parse and
 * therefore inherits Object.prototype, so a valueField of "toString" or
 * "constructor" would otherwise stringify an inherited FUNCTION into a query
 * parameter. Same hazard, same fix, as effectivePinned and measureOffsets.
 *
 * A missing, null or undefined value is reported as "" and the click is still
 * delivered: the card decides what an empty value means, not the renderer.
 */
/**
 * `shown` is the cell's own accessor value -- for a hoverCard column the
 * cellField out of the cell's object, never the object itself -- and is what
 * a click sends unless the column names a different `valueField` on the row.
 */
function cellClickValue(click: CellClick, shown: unknown, row: Row): CellClickEvent {
  const raw =
    click.valueField === undefined
      ? shown
      : Object.hasOwn(row, click.valueField)
        ? row[click.valueField]
        : undefined;
  return {
    paramName: click.paramName,
    value: raw === null || raw === undefined ? "" : String(raw),
    forceUpdate: click.forceUpdate,
  };
}

/** Hoisted: an absent state must not be a new identity on every render. */
const NO_STATE: TableCardState = {};
const NO_SORTING: SortingState = [];
const NO_FILTERS: ColumnFiltersState = [];
const DEFAULT_DATE_CONTEXT = filterDateContext();

/**
 * The stored filters as the table applies them: a date expression resolved
 * to its day now. Keyed on `rows` too, so every refresh -- a new payload --
 * resolves again and a "T-1bd" bound moves with the calendar.
 */
function useResolvedFilters(columnFilters: ColumnFiltersState, rows: unknown, ctx: ResolveContext | undefined): ColumnFiltersState {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rows is the refresh signal
  return useMemo(() => resolveDateFilters(columnFilters, ctx ?? DEFAULT_DATE_CONTEXT), [columnFilters, rows, ctx]);
}

/** Verbatim from the spec: "column widths are debounced 300 ms". */
const WIDTH_SAVE_MS = 300;

/** What the renderer reports; the card merges it into DashboardCard.table. */
export type TableStatePatch = Partial<TableCardState>;

/** What a cellOnClick cell reports: the parameter, its new value, and whether the source refetches too. */
export type CellClickEvent = { paramName: string; value: string; forceUpdate: boolean };

/**
 * A row-array payload as a table. `spec` is the widget's own `data.table` —
 * columnsDefs plus the table-level formatterFn default. With no spec every
 * column, header and cell is exactly what it was before columnsDefs was
 * parsed at all.
 */
/**
 * The header menu's sort items, above the pin items. A <th> is not natively
 * activatable, so Enter and Space open this menu rather than sorting, and
 * these are what make a sort reachable without a pointer. The item matching
 * the column's CURRENT direction is disabled, as pinItems disables the
 * current side; Clear sort appears only once there is a sort to clear.
 * `null` is a clear.
 */
function sortItems(sorted: false | "asc" | "desc", onSort: (desc: boolean | null) => void): MenuItem[] {
  const items: MenuItem[] = [
    { label: "Sort ascending", disabled: sorted === "asc", onSelect: () => onSort(false) },
    { label: "Sort descending", disabled: sorted === "desc", onSelect: () => onSort(true) },
  ];
  if (sorted) items.push({ label: "Clear sort", onSelect: () => onSort(null) });
  return items;
}

/**
 * The table header's right-click menu items: pin left, pin right, unpin. The
 * item matching the column's CURRENT effective side is disabled.
 */
function pinItems(side: PinSide | undefined, onPin: (next: PinSide | null) => void): MenuItem[] {
  return [
    // Separated from the sort items above it; see sortItems.
    { label: "Pin left", disabled: side === "left", separatorBefore: true, onSelect: () => onPin("left") },
    { label: "Pin right", disabled: side === "right", onSelect: () => onPin("right") },
    { label: "Unpin", disabled: side === undefined, onSelect: () => onPin(null) },
  ];
}

/**
 * What the virtualised table needs from the card that owns it. Declared once:
 * TableRenderer takes exactly these and forwards them unchanged.
 */
export type ExecutionSlot = {
  rowId?: string;
  groupPath: string[];
  offset: number;
  group?: { path: string[]; childCount: number; open: boolean };
};
export type ExecutionTableView = {
  columns: (TableColumn & { groupPath?: string[]; source?: string })[];
  count: number;
  rowIds: string[];
  slot: (index: number) => ExecutionSlot;
  requestRange: (start: number, end: number) => void;
  toggle: (path: string[]) => void;
  totals: Record<string, unknown>;
  totalErrors?: Record<string, DatasetCellError>;
  rowErrors?: ReadonlyMap<string, Record<string, DatasetCellError>>;
  rowFormats?: ReadonlyMap<string, Record<string, CellFormat>>;
  totalsEmpty?: boolean;
  totalLabel?: string;
  showTotals?: boolean;
  /** Rows the table received, for the filter row's "N of M rows"; absent when the count is not of source rows. */
  sourceCount?: number;
  /** The whole input, when the client holds it (a backend payload): where date filters start. */
  boundsRows?: Row[];
  selection?: SelectionSummary;
  selectionPending?: boolean;
  onSelection?: (action: SelectionAction) => void;
  formulaIds?: ReadonlyMap<string,string>;
  onShowFormula?: (id:string,trigger:HTMLElement)=>void;
};

type TableViewProps = {
  /**
   * How a date filter's expression (T-1bd, FQ-4 ...) is resolved: the card's
   * exchange and calendar. Absent: the default exchange's bundled calendar.
   */
  dateContext?: ResolveContext;
  execution?: ExecutionTableView;
  executionHidden?: boolean;
  executionIdentity?: {dashboardId:string;widgetId:string};
  onExecutionOutside?: () => void;
  spec?: TableSpec;
  /** The card's persisted table state (DashboardCard.table). */
  state?: TableCardState;
  /**
   * Every change, as a patch for the owner to merge and persist. Absent means
   * nobody owns the state, and the renderer keeps it in memory instead — which
   * is how a bare <TableRenderer data={...} /> still sorts and reorders.
   */
  onStateChange?: (patch: TableStatePatch) => void;
  /**
   * A cell of a `cellOnClick` column was clicked. ABSENT means the column
   * renders as a plain cell even when the spec asks for a click: nobody owns
   * a parameter to assign it to, and a button that did nothing would be a lie.
   */
  onCellClick?: (click: CellClickEvent) => void;
  /**
   * A `sendToAgent` cell was clicked, with its row already filled into the
   * column's markdown. ABSENT (no Rita URL, or a viewer window) renders the
   * column plainly, for the same reason onCellClick's absence does.
   */
  onSendToAgent?: (text: string, agentId?: string) => void;
  /** The card header's ⌕ toggle: a filter row under the header row. */
  filterRow?: boolean;
  /**
   * Quick actions ▸ Autosize columns. Bumped, not booleaned, so pressing the
   * item twice in a row still re-triggers the effect below — the same
   * pattern WidgetCard's own tableResetKey uses for Reset table.
   */
  autosizeKey?: number;
  /**
   * A live_grid's row-identity column (wsRowIdColumn). When set, showCellChange
   * tracks a cell by this value rather than by row index, so a grid that
   * reorders its rows flashes the cell that actually changed.
   */
  rowIdColumn?: string;
  pivotPreset?: PivotConfig;
  pivotOpen?: boolean;
  onPivotOpen?: () => void;
};

/**
 * What VirtualTable needs to draw an engine result instead of a payload. Its
 * presence is the ONE switch: every pivot branch in VirtualTable tests
 * `pivot !== undefined` (or reads a member of it), so with it absent the
 * component is exactly the table it was before pivots existed.
 */
type PivotView = {
  result: Extract<PivotResult, { ok: true }>;
  /** Kinds of the SOURCE columns: the engine's rows begin with group rows, whose cells say little about a column's type. */
  kinds: ReadonlyMap<string, FieldKind>;
  onToggle: (path: string) => void;
  /** For the filter row's "N of M rows", which must count source rows, not group rows. */
  sourceCount: number;
  filteredCount: number;
};

/** The state VirtualTable is handed rather than owning: see TableView. */
type TableStateProps = {
  tableState: TableCardState;
  patch: (patch: TableStatePatch) => void;
};

/**
 * A column as VirtualTable holds it: an ordinary TableColumn, or a pivot's,
 * which also says which split headers sit above it and which field it was made
 * from. Optional here so the ordinary path needs no cast.
 */
type ViewColumn = TableColumn & { groupPath?: string[]; source?: string };

/** Hoisted: an empty column list must not be a new identity on every render. */
const NO_COLUMNS: TableColumn[] = [];

export function TableRenderer({
  data,
  columns,
  ...view
}: TableViewProps & {
  data: unknown;
  /**
   * Given, a static grid in this column order: header text and cells,
   * nothing else. The transposed view uses it because its columns are the
   * DATA's first-column values — the spec's columnsDefs, the card's
   * sort/filter/pins and the column menu all describe columns that no longer
   * exist on screen. Never derived from the rows' keys: see transposeRows.
   */
  columns?: string[];
}) {
  const rows = tableRows(data);

  // An unexpected shape always falls through to raw JSON, never to nothing.
  if (!rows) return <RawJsonView data={data} />;
  if (rows.length === 0 && !view.execution) return <p className="empty-state">No rows.</p>;
  if (columns) return <PlainTable rows={rows} columns={columns} />;

  if (view.execution) return <VirtualTable rows={rows} tableState={view.state ?? NO_STATE} patch={view.onStateChange ?? (() => {})} {...view} />;
  return <TableView rows={rows} {...view} />;
}

/**
 * A static grid over an explicit column order, formatted through the same cell
 * formatter and the same `table.widget-table` markup, so it inherits the CSS
 * the virtualised table already has. No TanStack table at all: nothing here
 * sorts, filters, pins, resizes or reorders.
 */
// memo: both props are already memoised by the callers (WidgetCard's
// `transposed` useMemo, LocalTableRenderer's), so this short-circuits the
// rows × columns element rebuild on every unrelated WidgetCard re-render.
const PlainTable = memo(function PlainTable({
  rows,
  columns,
}: {
  rows: Row[];
  columns: string[];
}) {
  const maxDecimalPlaces = useSettingsStore((s) => s.settings.maxDecimalPlaces);
  return (
    <div className="table-scroll">
      {/* `plain` only turns off what the toolkit's header offers -- the
          pointer cursor and the un-selectable text of a sortable header. */}
      <table className="widget-table plain">
        <thead>
          <tr>
            {columns.map((field) => (
              <th key={field} scope="col" data-field={field}>
                {/* Verbatim, never titleCase: these headers are the data's own
                    first-column values, plus transposeRows' `Field`. */}
                {field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((field) => (
                <td key={field} data-field={field}>
                  {/* Object.hasOwn, as everywhere else a row is read by a
                      computed key: `row` came back from JSON.parse and
                      inherits Object.prototype. */}
                  {formatCell(
                    Object.hasOwn(row, field) ? row[field] : undefined,
                    field,
                    maxDecimalPlaces,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/**
 * Controlled by the owner when one is wired, in memory when one is not. The
 * hook count is identical on both paths — useState always runs — so the
 * branch is safe.
 */
function useTableState(
  state: TableCardState | undefined,
  onStateChange: ((patch: TableStatePatch) => void) | undefined,
): [TableCardState, (patch: TableStatePatch) => void] {
  const [local, setLocal] = useState<TableCardState>(NO_STATE);
  if (onStateChange) return [state ?? NO_STATE, onStateChange];
  return [local, (p) => setLocal((s) => ({ ...s, ...p }))];
}

/**
 * Case-insensitive: `sensitivity: "base"` is localeCompare's own option, held
 * in one Collator because building a fresh one per comparison is the slow
 * path on a table of any size.
 */
const TEXT_ORDER = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * Every column's sort, stated rather than left to table-core's `auto`, which
 * sniffs a column's type from its rows AFTER the first ten
 * (`flatRows.slice(10)`) and so hands a short table `basic` -- a bare `>`,
 * under which null compares like 0 and lands in the middle of a signed
 * column (change %, say).
 *
 * Missing -- null or undefined -- sorts last in BOTH directions, which is why
 * the direction is an input: table-core flips a sortingFn's answer for a
 * descending sort, so this pre-flips it. The column's `sortUndefined: false`
 * sends undefined here too; table-core's own `"last"` covers undefined but
 * not null, and folding null into undefined in the accessor would change
 * what an `eq: null` colour rule matches.
 *
 * `numeric` is the column's filter kind -- cellDataType when the spec gives
 * one, otherwise the type of its first value. A stray non-number in a numeric
 * column falls back to the text order rather than comparing as NaN.
 */
function sortingFnFor(numeric: boolean, desc: boolean): SortingFn<Row> {
  return (a, b, id) => {
    const x = a.getValue(id);
    const y = b.getValue(id);
    const xMissing = x === null || x === undefined;
    const yMissing = y === null || y === undefined;
    if (xMissing || yMissing) {
      if (xMissing && yMissing) return 0;
      return xMissing !== desc ? 1 : -1;
    }
    if (numeric && typeof x === "number" && typeof y === "number") return x - y;
    return TEXT_ORDER.compare(String(x), String(y));
  };
}

/**
 * What `columnDefs` stashes in `columnDef.meta` for `TableCell` to read.
 * `name` is what formatCell's name heuristics are given: the column's field, or
 * under a split the SOURCE field. `rowMeta` is the pivot engine's per-row meta,
 * parallel to the rows, and absent whenever nothing is pivoting.
 */
type CellMeta = {
  column: TableColumn;
  name: string;
  maxDecimalPlaces: number;
  rowMeta?: readonly PivotRowMeta[];
  rowFormats?: ExecutionTableView["rowFormats"];
};

/**
 * The cell body for every non-plain column, hoisted to MODULE scope rather
 * than rebuilt per render so its identity never changes (columnDefs is rebuilt
 * on every tick, but `cell` must stay one reference — see the columnDefs memo).
 * Everything it needs that changes travels through `columnDef.meta`.
 */
function TableCell(ctx: CellContext<Row, unknown>) {
  const { column, name, maxDecimalPlaces, rowMeta, rowFormats } = ctx.column.columnDef.meta as CellMeta;
  const value = ctx.getValue();
  // A pivot's group (or total) row: its cells are aggregates, not a real row's
  // values. An ABSENT value is a column with no aggregation yet (or a
  // combination with no rows) and reads blank. Leaf rows — and every row of an
  // unpivoted table — fall through untouched.
  const pivotRow = rowMeta?.[ctx.row.index];
  if (pivotRow && pivotRow.kind !== "leaf" && value === undefined) return "";
  if ((!pivotRow || pivotRow.kind === "leaf") && column.sparkline && Array.isArray(value)) {
    const nums = sparklineValues(value, column.sparkline);
    if (nums.length > 0) return <SparklineCell values={nums} config={column.sparkline} />;
  }
  const text = formatCell(value, name, maxDecimalPlaces, undefined, rowFormats?.get(ctx.row.id)?.[column.field] ?? column.format);
  const shown = column.renderFn.includes("titleCase") ? titleCase(text) : text;
  if (!column.hoverCard || (pivotRow && pivotRow.kind !== "leaf")) return shown;
  const original = ctx.row.original;
  const source = Object.hasOwn(original, column.field) ? original[column.field] : undefined;
  return <HoverCardCell text={shown} card={column.hoverCard} source={source} />;
}

/**
 * Object.hasOwn, as everywhere a row is read by a computed key: `row` came back
 * from JSON.parse and inherits Object.prototype. Shared by both tables' column
 * defs and by the pivot's headless filter table.
 */

/**
 * `all` minus the entries naming a column this table does not currently have —
 * the ONE filter both the engine and table-core read their sort through.
 * Switching a split off leaves synthetic ids in the persisted sort, grouping or
 * hiding a field leaves its id, and table-core logs an error for every unknown
 * id it is asked to resolve. Keyed on WHICH entries survive so the SAME array
 * comes back until the sort or the surviving set actually changes. `known` null
 * means there is nothing to check against, and `all` is kept as it is.
 */
function useKnownSorting(all: SortingState, known: { has(id: string): boolean } | null): SortingState {
  const keptAt = known ? all.flatMap((s, i) => (known.has(s.id) ? [i] : [])).join(",") : null;
  return useMemo(() => {
    if (keptAt === null) return all;
    const kept = keptAt === "" ? [] : keptAt.split(",").map(Number);
    return kept.length === all.length ? all : kept.map((i) => all[i]);
  }, [all, keptAt]);
}

/**
 * The rows the column filters leave, computed by a headless TanStack table so
 * the pivot filters by EXACTLY the functions the ordinary table does —
 * `filterFnFor` answers with a table-core built-in's NAME for text columns, so
 * there is no plain function to call instead. With no filters set table-core
 * returns the core model untouched, so this costs nothing until it is needed.
 */
function useFilteredRows(
  rows: Row[],
  columns: TableColumn[],
  kinds: ReadonlyMap<string, FieldKind>,
  columnFilters: ColumnFiltersState,
): Row[] {
  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((column) => ({
        id: column.field,
        accessorFn: accessorFor(column),
        filterFn: filterFnFor(kinds.get(column.field) ?? "none"),
        enableColumnFilter: kinds.get(column.field) !== "none",
      })),
    [columns, kinds],
  );
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { columnFilters },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const model = table.getFilteredRowModel().rows;
  return useMemo(() => model.map((r) => r.original), [model]);
}

/**
 * Owns the table state and picks the path. useTableState lives HERE, not in
 * VirtualTable, because two components below need the same state — and with no
 * owner wired that state is this component's own useState, of which there must
 * be exactly one.
 *
 * Not pivoting and panel closed returns the bare VirtualTable: no wrapper, no
 * extra element, the DOM of every release before this one.
 */
function TableView({
  rows,
  pivotPreset,
  pivotOpen = false,
  onPivotOpen,
  ...view
}: TableViewProps & { rows: Row[] }) {
  const [tableState, patch] = useTableState(view.state, view.onStateChange);
  const config = tableState.pivot ?? pivotPreset ?? EMPTY_PIVOT;
  // Whether this table could be pivoting at all. Every table goes through here,
  // and tableColumns with a spec scans the whole payload, so the source columns
  // are only worked out when the panel is open or the config asks for a pivot.
  const wanted = pivotOpen || (config.enabled && config.grouping.length + config.split.length > 0);
  const columns = useMemo(
    () => (wanted ? tableColumns(rows, view.spec) : NO_COLUMNS),
    [wanted, rows, view.spec],
  );
  const known = useMemo(() => new Set(columns.map((c) => c.field)), [columns]);
  const pivoting = isPivoting(config, known);
  // Here rather than in PivotedTable: the panel needs it too, and one memo
  // serves both. Empty — and free — whenever `columns` is.
  const kinds = useMemo(
    () => new Map<string, FieldKind>(columns.map((c) => [c.field, filterKindFor(c, rows)])),
    [columns, rows],
  );

  const table = pivoting ? (
    <PivotedTable
      rows={rows}
      columns={columns}
      kinds={kinds}
      config={config}
      tableState={tableState}
      patch={patch}
      {...view}
    />
  ) : (
    <VirtualTable rows={rows} tableState={tableState} patch={patch} {...view} />
  );
  // Exactly today's DOM when there is nothing to show above the table.
  if (!pivotOpen && !pivoting) return table;
  const foldWarnings = pivotFoldWarnings(config);
  return (
    <div className="table-with-pivot">
      {foldWarnings.map((warning) => <p key={warning} role="alert" className="pivot-note">{warning}</p>)}
      {pivotOpen ? (
        <PivotPanel
          columns={columns}
          order={orderFields(columns, tableState.columnOrder)}
          hidden={hiddenFields(columns, tableState.hidden)}
          kinds={kinds}
          rows={rows}
          config={config}
          // One completed edit, one patch, one dashboard write. Built from the
          // EFFECTIVE config, so the first edit of a widget's preset is what
          // copies it into the card.
          onChange={patch}
        />
      ) : (
        <PivotStrip columns={columns} config={config} kinds={kinds} onEdit={onPivotOpen} />
      )}
      {table}
    </div>
  );
}

function PivotedTable({
  rows,
  columns,
  kinds,
  config,
  tableState,
  patch,
  ...view
}: TableViewProps &
  TableStateProps & {
    rows: Row[];
    columns: TableColumn[];
    kinds: ReadonlyMap<string, FieldKind>;
    config: PivotConfig;
  }) {
  const columnFilters = tableState.columnFilters ?? NO_FILTERS;
  const survivors = useFilteredRows(rows, columns, kinds, useResolvedFilters(columnFilters, rows, view.dateContext));
  const allSorting = tableState.sorting ?? NO_SORTING;
  // The VISIBLE order: a hidden column stays hidden under a pivot.
  const order = useMemo(() => {
    const hidden = new Set(hiddenFields(columns, tableState.hidden));
    return orderFields(columns, tableState.columnOrder).filter((f) => !hidden.has(f));
  }, [columns, tableState.columnOrder, tableState.hidden]);

  // The engine's columns do not depend on the sort, so the first run's are the
  // columns this pivot has; the sort is then filtered against exactly those.
  const draft = useMemo(
    () => pivotTable({ rows: survivors, columns, kinds, order, config, sorting: allSorting }),
    [survivors, columns, kinds, order, config, allSorting],
  );
  const draftIds = useMemo(
    () => (draft?.ok ? new Set(draft.columns.map((c) => c.field)) : null),
    [draft],
  );
  const sorting = useKnownSorting(allSorting, draftIds);
  const result = useMemo(
    () =>
      sorting === allSorting
        ? draft
        : pivotTable({ rows: survivors, columns, kinds, order, config, sorting }),
    [draft, sorting, allSorting, survivors, columns, kinds, order, config],
  );
  const onToggle = useCallback((path: string) => patch(toggleExpanded(config, path)), [config, patch]);

  // null cannot happen — TableView only mounts this while isPivoting — but the
  // type says it can, and the ordinary table is the honest answer if it did.
  if (result === null) return <VirtualTable rows={rows} tableState={tableState} patch={patch} {...view} />;
  if (!result.ok) {
    return (
      <p className="empty-state" role="alert">
        {result.reason}
      </p>
    );
  }
  return (
    <VirtualTable
      rows={result.rows}
      tableState={tableState}
      patch={patch}
      {...view}
      // A fresh object on every render: VirtualTable keys its memos on the
      // stable members (`result`, `kinds`), never on this wrapper.
      pivot={{ result, kinds, onToggle, sourceCount: rows.length, filteredCount: survivors.length }}
    />
  );
}

/**
 * Leaf defs under TanStack column groups, one level per entry of `path`. The
 * leaves arrive in display order with equal prefixes adjacent, so a run of
 * equal heads IS one group. With every path empty — no pivot, or no split — the
 * leaves come back as they went in and the table has its single header row.
 */
function nestDefs(
  leaves: { def: ColumnDef<Row>; path: string[] }[],
  depth = 0,
  prefix = "group",
): ColumnDef<Row>[] {
  const out: ColumnDef<Row>[] = [];
  let i = 0;
  while (i < leaves.length) {
    const head = leaves[i].path[depth];
    if (head === undefined) {
      out.push(leaves[i].def);
      i += 1;
      continue;
    }
    let j = i;
    while (j < leaves.length && leaves[j].path[depth] === head) j += 1;
    const id = `${prefix}${KEY_SEP}${head}`;
    out.push({ id, header: head, columns: nestDefs(leaves.slice(i, j), depth + 1, id) });
    i = j;
  }
  return out;
}

/**
 * The label column's cell. A leaf row's is empty. A group's shows the fold
 * (when it has something to unfold), the label, and the count of source rows
 * beneath it; an incomplete calendar period shows "2 of 3" instead.
 */
function ExecutionGroupLabel({ group, label, onToggle }: {
  group: NonNullable<ExecutionSlot["group"]>;
  label: unknown;
  onToggle?: (path: string[]) => void;
}) {
  return <span className="pivot-label" style={{ paddingLeft: (group.path.length - 1) * 16 }}>
    <button type="button" className="pivot-fold" aria-expanded={group.open}
      aria-label={`${group.open ? "Collapse" : "Expand"} ${String(label ?? "")}`}
      onClick={() => onToggle?.(group.path)}>{group.open ? "▾" : "▸"}</button>
    {String(label ?? "")}
  </span>;
}

function PivotLabelCell({ meta, onToggle }: { meta: PivotRowMeta; onToggle: (path: string) => void }) {
  if (meta.kind === "leaf") return null;
  const incomplete = meta.kind === "group" ? meta.incomplete : undefined;
  return (
    <span className="pivot-label" style={{ paddingLeft: meta.depth * 16 }}>
      {meta.kind === "group" && meta.expandable ? (
        <button
          type="button"
          className="pivot-fold"
          aria-expanded={meta.open}
          aria-label={`${meta.open ? "Collapse" : "Expand"} ${meta.label}`}
          onClick={(e) => {
            // One ancestor away from a row and a header that both take clicks.
            e.stopPropagation();
            onToggle(meta.path);
          }}
        >
          {meta.open ? "▾" : "▸"}
        </button>
      ) : (
        <span className="pivot-fold-spacer" />
      )}
      <span className="pivot-label-text">{meta.label}</span>
      <span className={incomplete ? "pivot-count pivot-incomplete" : "pivot-count"}>
        {incomplete ? ` (${incomplete.have} of ${incomplete.expected})` : ` (${meta.count})`}
      </span>
    </span>
  );
}

function VirtualTable({
  rows,
  spec,
  tableState,
  patch,
  onCellClick,
  onSendToAgent,
  filterRow,
  autosizeKey,
  rowIdColumn,
  pivot,
  dateContext,
  execution, executionHidden, executionIdentity, onExecutionOutside,
}: Omit<TableViewProps, "state" | "onStateChange" | "pivotPreset" | "pivotOpen" | "onPivotOpen"> &
  TableStateProps & { rows: Row[]; pivot?: PivotView }) {
  const pivotResult = pivot?.result;
  const pivotKinds = pivot?.kinds;
  // TableFilter and TanStack's ColumnFilter are both { id: string; value:
  // unknown }, so the persisted array IS a ColumnFiltersState.
  const columnFilters = tableState.columnFilters ?? NO_FILTERS;
  // What the table filters by; the boxes show (and edits patch) the stored ones.
  const appliedFilters = useResolvedFilters(columnFilters, rows, dateContext);
  const maxDecimalPlaces = useSettingsStore((s) => s.settings.maxDecimalPlaces);
  /**
   * The field a header drag started on. Kept here as well as on the event
   * because dataTransfer.getData() is not readable during dragover, which is
   * where the drop has to be allowed.
   */
  const draggedField = useRef<string | null>(null);
  /**
   * True from a press on a column resizer until the button is released. The
   * resizer is not draggable, so a browser starts the drag on its draggable
   * ancestor instead: dragstart's target is the <th>, never the span, and a
   * target check alone cannot see it (bdobb#7).
   */
  const resizePress = useRef(false);
  const startResize = (handler: (e: unknown) => void) => (e: React.MouseEvent | React.TouchEvent) => {
    resizePress.current = true;
    const end = () => {
      resizePress.current = false;
      document.removeEventListener("mouseup", end);
      document.removeEventListener("touchend", end);
    };
    document.addEventListener("mouseup", end);
    document.addEventListener("touchend", end);
    handler(e);
  };

  /**
   * The ONE piece of state that is not controlled. `columnResizeMode:
   * "onChange"` updates it on every pointer move, and a controlled value
   * would only come back after the debounced write below — so a dragged
   * column would not move until the drag ended. Seeded once from the
   * persisted widths; "Reset table" bumps a key on this component, which
   * re-seeds it.
   */
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => Object.assign(Object.create(null), tableState.widths ?? {}));
  const widthTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The pending save itself, so unmount can make it rather than drop it. */
  const widthSave = useRef<(() => void) | undefined>(undefined);
  // A pending save must not outlive the card: the renderer unmounts on a view
  // toggle, a tab switch and a card removal. It is made NOW rather than
  // cancelled -- cancelling it dropped a width dragged within the last
  // 300ms -- and only if the timer has not already made it.
  useEffect(
    () => () => {
      if (widthTimer.current === undefined) return;
      clearTimeout(widthTimer.current);
      widthSave.current?.();
    },
    [],
  );

  const columns = useMemo<ViewColumn[]>(
    () => (execution?.columns ?? (pivotResult ? pivotResult.columns : tableColumns(rows, spec))),
    [execution, pivotResult, rows, spec],
  );
  /** Field -> its column, for the <th>/<td> that need more than TanStack holds. */
  const byField = useMemo(
    () => new Map<string, TableColumn>(columns.map((c) => [c.field, c])),
    [columns],
  );
  /** The sort table-core sees: the card's, less any entry naming a column not here. See useKnownSorting. */
  const sorting = useKnownSorting(tableState.sorting ?? NO_SORTING, byField);
  /** A split replaces the source columns outright; the filter row has nothing to line up with. */
  const hasSplit = columns.some(c => (c.groupPath?.length ?? 0) > 0);

  // showCellChange: flash a cell when its value changes, coloured by the sign
  // of the column's colorValueKey field, then clear it after the animation so
  // a repeat change re-triggers the flash. Only rendered rows are tracked --
  // a small live grid shows them all, and an off-screen row that scrolls back
  // simply does not flash, which is preferable to flashing spuriously.
  const prevValues = useRef<Map<string, unknown>>(new Map());
  const [flash, setFlash] = useState<Map<string, "up" | "down">>(() => new Map());
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const changed: Array<[string, "up" | "down"]> = [];
    // Built from the current rows only, so a row that has left is forgotten
    // rather than kept for the life of the card.
    const next = new Map<string, unknown>();
    // Object.hasOwn, as everywhere else a row is read by a computed key: a
    // parsed row inherits Object.prototype, so a field named "toString" would
    // otherwise read an inherited function.
    const own = (row: Row, field: string) => (Object.hasOwn(row, field) ? row[field] : undefined);
    rows.forEach((row, i) => {
      const rowKey = rowIdColumn ? String(own(row, rowIdColumn)) : String(i);
      for (const col of columns) {
        if (!col.cellChange?.enabled) continue;
        const key = `${rowKey}|${col.field}`;
        const raw = own(row, col.field);
        // Every snapshot and streamed row is freshly parsed, so an object
        // cell is a new reference each time: compare its content instead.
        const cur = typeof raw === "object" && raw !== null ? JSON.stringify(raw) : raw;
        const before = prevValues.current.get(key);
        next.set(key, cur);
        if (before !== undefined && before !== cur) {
          const ck = col.cellChange.colorValueKey;
          const sign = ck !== undefined ? Number(own(row, ck)) : Number(cur) - Number(before);
          changed.push([key, sign < 0 ? "down" : "up"]);
        }
      }
    });
    prevValues.current = next;
    if (changed.length === 0) return;
    setFlash((current) => {
      const m = new Map(current);
      for (const [key, dir] of changed) m.set(key, dir);
      return m;
    });
    for (const [key] of changed) {
      const existing = flashTimers.current.get(key);
      if (existing !== undefined) clearTimeout(existing);
      flashTimers.current.set(
        key,
        setTimeout(() => {
          flashTimers.current.delete(key);
          setFlash((current) => {
            const m = new Map(current);
            m.delete(key);
            return m;
          });
        }, 700),
      );
    }
  }, [rows, columns, rowIdColumn]);
  useEffect(
    () => () => {
      for (const timer of flashTimers.current.values()) clearTimeout(timer);
      flashTimers.current.clear();
    },
    [],
  );

  const columnOrder = useMemo(
    // Under a pivot the engine's order IS the order: it already applied the
    // card's columnOrder and left the hidden columns out.
    () => (execution || pivotResult ? columns.map((c) => c.field) : orderFields(columns, tableState.columnOrder)),
    [execution, pivotResult, columns, tableState.columnOrder],
  );
  const columnVisibility = useMemo<VisibilityState>(
    () =>
      execution || pivotResult
        ? {}
        : Object.fromEntries(hiddenFields(columns, tableState.hidden).map((f) => [f, false])),
    [execution, pivotResult, columns, tableState.hidden],
  );
  /**
   * A column's effective side: the card's own override when it has one, else
   * the widget spec's. Every read of a side in this component goes through
   * here, so the pinned groups, the header menu and the drag rule cannot
   * disagree. The worker emits one combined LABEL_FIELD even for several row
   * categories; pin that identity rather than transferring a prefix count to
   * a measure when the label is moved or hidden.
   */
  const sideOf = useCallback(
    (field: string) => {
      const column = byField.get(field);
      return execution && field === LABEL_FIELD && column ? "left" : column ? effectivePinned(column, tableState.pinned) : undefined;
    },
    [byField, tableState.pinned, execution],
  );

  /**
   * Derived from columnOrder rather than held separately. TanStack orders the
   * left and right groups by these two arrays, NOT by columnOrder
   * (table-core core/headers.js), so making columnOrder the single source of
   * order is what lets a column move inside its own pinned group at all.
   */
  const columnPinning = useMemo<ColumnPinningState>(
    () => ({
      left: columnOrder.filter((f) => sideOf(f) === "left"),
      right: columnOrder.filter((f) => sideOf(f) === "right"),
    }),
    [columnOrder, sideOf],
  );

  /** The header menu: which column it was opened on, and where the pointer was. */
  const [menuAt, setMenuAt] = useState<{
    x: number;
    y: number;
    field: string;
    /** The header cell the menu was opened from, so closing it hands focus
     * back to that cell rather than to <body>. */
    trigger: HTMLElement;
  } | null>(null);

  // A refresh that drops the column must not leave the menu pointing at it:
  // sideOf would read undefined and the pick would persist a phantom entry.
  useEffect(() => {
    setMenuAt((at) => (at && !byField.has(at.field) ? null : at));
  }, [byField]);

  /**
   * One filter control kind per column: cellDataType when the spec gives one,
   * otherwise the type of the column's first non-null value.
   */
  const filterKinds = useMemo(
    () =>
      new Map(
        columns.map((c): [string, FieldKind] => {
          if (execution) return [c.field, declaredKind(c.cellDataType)];
          if (!pivotKinds) return [c.field, filterKindFor(c, rows)];
          // The label column filters nothing; a data column filters as its
          // SOURCE column does — read from the source rows, because the
          // engine's rows open with a group row.
          return [c.field, c.source === undefined ? "none" : (pivotKinds.get(c.source) ?? "none")];
        }),
      ),
    [columns, rows, pivotKinds, execution],
  );

  /** A date column's first and last day in the loaded rows: where its From
   * and To boxes start. Compared as YYYY-MM-DD text, as dateFilter does. A
   * table computed in the background holds only the window on screen, which
   * is not the column, so its boxes start empty -- unless it brought its whole
   * input (a backend payload). */
  const dateBounds = useMemo(() => {
    const bounds = new Map<string, DateBounds>();
    const source = execution ? execution.boundsRows : rows;
    if (!source) return bounds;
    for (const [field, kind] of filterKinds) {
      if (kind !== "date") continue;
      const days = source
        .map((r) => (Object.hasOwn(r, field) ? r[field] : undefined))
        .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))
        .map((v) => v.slice(0, 10))
        .sort();
      if (days.length > 0) bounds.set(field, { first: days[0], last: days[days.length - 1] });
    }
    return bounds;
  }, [execution, filterKinds, rows]);
  /** Bumped by Clear, so every control starts again from its column -- a box
   * holding refused text has no applied filter for Clear to change. */
  const [clears, setClears] = useState(0);

  const columnDefs = useMemo<ColumnDef<Row>[]>(
    () =>
      // nestDefs puts a split's leaves under their spanning headers; with no
      // split every path is empty and the leaves come back exactly as built.
      nestDefs(
        columns.map((column) => {
          const def: ColumnDef<Row> = {
            id: column.field,
            // accessorFn, never accessorKey: table-core reads a dotted key as a
            // nested path, and a transposed table's keys are the data's own
            // first-column values -- `BRK.B`, `AAPL.US`, `1.5` -- so every cell,
            // sort and filter of such a column read undefined.
            accessorFn: accessorFor(column),
            header: column.header,
            size: column.size,
            minSize: column.minSize,
            maxSize: column.maxSize,
            filterFn: filterFnFor(filterKinds.get(column.field) ?? "none"),
            enableColumnFilter: filterKinds.get(column.field) !== "none",
            // The direction is an input to the comparator (see sortingFnFor), so
            // this array also rebuilds on a sort change.
            sortingFn: sortingFnFor(
              filterKinds.get(column.field) === "number",
              sorting.some((s) => s.id === column.field && s.desc),
            ),
            sortUndefined: false,
            // `cell` MUST be a reference that never changes even though this
            // whole array is rebuilt on every tick — see TableCell. Everything
            // that changes travels through `meta`.
            meta: {
              column,
              name: column.source ?? column.field,
              maxDecimalPlaces,
              rowMeta: pivotResult?.meta,
              rowFormats: execution?.rowFormats,
            } satisfies CellMeta,
            cell: TableCell,
          };
          return { def, path: column.groupPath ?? [] };
        }),
      ),
    [columns, filterKinds, maxDecimalPlaces, sorting, pivotResult, execution?.rowFormats],
  );

  const selectionRows = new Map(execution?.selection?.rows.map(row => [row.rowId, row]));
  const rowSelection = Object.fromEntries([...selectionRows].filter(([, row]) => row.checked).map(([id]) => [id, true]));
  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: {
      sorting,
      columnFilters: appliedFilters,
      columnOrder,
      columnVisibility,
      columnPinning,
      columnSizing,
      rowSelection,
    },
    // TanStack hands over either an updater or a finished value; both are
    // resolved here so the patch the owner receives is always the new state,
    // never a function it would have to apply itself.
    enableRowSelection: row => selectionRows.get(row.id)?.selectable ?? false,
    enableSubRowSelection: false,
    onRowSelectionChange: updater => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      const changed = execution?.rowIds.find(id => !!next[id] !== !!rowSelection[id]);
      if (changed) execution?.onSelection?.({ kind: 'toggle', rowId: changed });
    },
    onSortingChange: (updater) => {
      patch({ sorting: typeof updater === "function" ? updater(sorting) : updater });
    },
    onColumnFiltersChange: (updater) => {
      patch({ columnFilters: typeof updater === "function" ? updater(columnFilters) : updater });
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnSizing) : updater;
      setColumnSizing(Object.assign(Object.create(null), next));
      if (widthTimer.current !== undefined) clearTimeout(widthTimer.current);
      // Only the settled width is worth a dashboard write. `patch` is safe to
      // capture here: it either forwards to the owner's handler (which closes
      // over nothing but the card id) or to this component's own setState.
      widthSave.current = () => {
        widthTimer.current = undefined;
        patch({ widths: next });
      };
      widthTimer.current = setTimeout(widthSave.current, WIDTH_SAVE_MS);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // Over the WHOLE dataset, not the virtualised window: measured at ~500 ms
    // for 133,000 rows, which is a one-off per filter change, not per frame.
    getFilteredRowModel: getFilteredRowModel(),
    columnResizeMode: "onChange",
    sortDescFirst: false,
    // Already the effective default for accessor columns (getCanMultiSort
    // falls back to !!accessorFn); stated so the behaviour cannot depend on
    // that. shift-click is table-core's own isMultiSortEvent default.
    enableMultiSort: true,
    // Under a pivot the engine has already filtered and sorted: siblings within
    // their parent, which a flat table-core sort would scramble.
    manualSorting: execution !== undefined || pivotResult !== undefined,
    manualFiltering: execution !== undefined || pivotResult !== undefined,
    manualGrouping: execution !== undefined,
    getRowId: execution ? (_, i) => execution.rowIds[i] : undefined,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const totalScrollRef = useRef<HTMLDivElement>(null);
  const modelRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: execution?.count ?? modelRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 20,
    measureElement: (el) => el.getBoundingClientRect().height,
    useFlushSync: false,
  });

  // A new sort or a new filter changes which row is first; staying at the old
  // scroll offset would land the user in the middle of a different result.
  useEffect(() => {
    virtualizer.scrollToIndex(0);
  }, [sorting, columnFilters, virtualizer]);

  const theadRef = useRef<HTMLTableSectionElement>(null);
  /** The `<table>` itself, so Autosize columns can measure text in its font. */
  const tableRef = useRef<HTMLTableElement>(null);
  /** field -> its sticky offset, in px, or empty when nothing was measurable. */
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [totalWidths, setTotalWidths] = useState<Record<string, number>>(() => Object.create(null));
  const [totalGutterWidth,setTotalGutterWidth]=useState(32);
  const workerBacked = execution !== undefined;
  const [offscreenColumns, setOffscreenColumns] = useState(0);
  const measureOverflow = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || !workerBacked || scroll.clientWidth <= 0 || scroll.scrollWidth - scroll.clientWidth - scroll.scrollLeft <= 1) {
      setOffscreenColumns(0);
      return;
    }
    const edge = scroll.getBoundingClientRect().left + scroll.clientLeft + scroll.clientWidth;
    const count = [...(theadRef.current?.querySelectorAll<HTMLElement>('th[data-field]') ?? [])]
      .filter(cell => !cell.classList.contains('pin-left') && !cell.classList.contains('pin-right') && cell.getBoundingClientRect().right > edge + 1).length;
    setOffscreenColumns(count);
  }, [workerBacked]);

  /**
   * Quick actions ▸ Autosize columns. Widths come from the widest of the
   * header and the first 200 rows' text, measured in the table's own font;
   * capped so one long cell cannot take the card. jsdom has no canvas, so
   * the measurer falls back to an average glyph width — enough to order
   * columns in a test, never seen by a user.
   */
  // The renderer is remounted (a fresh `key`) on Reset columns and on a view
  // switch, which re-runs this effect for whatever autosizeKey it was last
  // given -- initializing to that key, not to 0/undefined, means a fresh
  // mount treats its starting key as already applied, so it doesn't
  // immediately re-patch the widths it was just reset away from.
  const appliedAutosize = useRef(autosizeKey);
  useEffect(() => {
    if (autosizeKey === undefined || autosizeKey === appliedAutosize.current) return;
    appliedAutosize.current = autosizeKey;
    const font = tableRef.current ? getComputedStyle(tableRef.current).font : "12px system-ui";
    const ctx = document.createElement("canvas").getContext?.("2d") ?? null;
    if (ctx) ctx.font = font;
    const measure = (text: string) => (ctx ? ctx.measureText(text).width : 7 * text.length);
    const next: ColumnSizingState = {};
    for (const col of table.getVisibleLeafColumns()) {
      const header = String(col.columnDef.header ?? col.id);
      let widest = measure(header);
      for (const row of table.getRowModel().rows.slice(0, 200)) {
        const cell = row.getValue(col.id);
        widest = Math.max(widest, measure(cell === null || cell === undefined ? "" : String(cell)));
      }
      next[col.id] = Math.min(480, Math.ceil(widest) + 16);
    }
    // Merge over the saved widths rather than replacing them outright, so a
    // column hidden at autosize time (not in getVisibleLeafColumns) keeps
    // whatever width it had instead of losing it from the persisted map.
    const merged = { ...(tableState.widths ?? {}), ...next };
    setColumnSizing(merged);
    patch({ widths: merged });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per Autosize press
  }, [autosizeKey]);

  /**
   * Sticky offsets are summed from the pinned headers' MEASURED widths, not
   * from their declared sizes. `.widget-table` is `width: 100%` with the
   * browser's automatic table layout, so a columnsDefs `width` is only a hint:
   * a column whose content needs more room takes it, and summing declared
   * sizes would leave the next pinned column's offset short of the previous
   * one's real right edge -- the two would overlap. Measuring instead of
   * changing the table to `table-layout: fixed` is deliberate: that class is
   * shared with the plain transposed grid, which must stay untouched.
   *
   * A zero width is treated as "not measured" rather than as a real zero
   * (jsdom, and any render before layout), and then EVERY pinned cell falls
   * back to TanStack's getStart/getAfter. Falling back wholesale keeps the
   * two sources from being mixed within one row.
   *
   * One function, two triggers: the layout effect below (a column set, order,
   * visibility, pinning, payload or resize-drag change) and the
   * ResizeObserver below that (the container itself changing width).
   */
  const measureOffsets = useCallback(() => {
    const visible = table.getVisibleLeafColumns();
    const left = visible.filter((c) => c.getIsPinned() === "left").map((c) => c.id);
    const right = visible.filter((c) => c.getIsPinned() === "right").map((c) => c.id);

    // Null-prototype: a payload field named "__proto__" would not become an own
    // key on a plain object -- the assignment would hit the setter instead, and
    // that one column would then silently miss the wholesale fallback and read
    // a declared offset while its neighbours read measured ones.
    const next: Record<string, number> = Object.create(null);
    const thead = theadRef.current;
    if (thead) {
      // Read every header once into a map rather than one selector per field:
      // a field name out of an untrusted payload is not a safe selector.
      const widths = new Map<string, number>();
      for (const cell of thead.querySelectorAll<HTMLElement>("th[data-field]")) {
        const field = cell.getAttribute("data-field");
        if (field !== null) widths.set(field, cell.getBoundingClientRect().width);
      }
      const measured: Record<string,number> = Object.create(null);
      for(const [id,width] of widths) if(width>0) measured[id]=width;
      const gutter=thead.querySelector<HTMLElement>('th[data-selection-gutter]')?.getBoundingClientRect().width;
      if(gutter && gutter>0 && workerBacked) setTotalGutterWidth(gutter);
      if(workerBacked) setTotalWidths(prev=>sameOffsets(prev,measured)?prev:measured);
      const width = (field: string) => widths.get(field) ?? 0;
      if ([...left, ...right].every((f) => width(f) > 0)) {
        // The selection gutter is not a TanStack column; count its width once.
        let offset = execution?.selection ? (gutter && gutter > 0 ? gutter : totalGutterWidth) : 0;
        for (const field of left) {
          next[field] = offset;
          offset += width(field);
        }
        offset = 0;
        // Inwards from the right edge: the LAST pinned-right column sits at 0.
        for (const field of [...right].reverse()) {
          next[field] = offset;
          offset += width(field);
        }
      }
    }
    setOffsets((prev) => (sameOffsets(prev, next) ? prev : next));
    measureOverflow();
  }, [table, workerBacked, execution?.selection, totalGutterWidth, measureOverflow]);

  useLayoutEffect(() => {
    measureOffsets();
  }, [measureOffsets, rows, columnOrder, columnVisibility, columnPinning, columnSizing]);

  /**
   * What the offsets are summed from is the pinned HEADER cells' widths, and
   * none of that is in the state above: a card is resizable and
   * react-grid-layout's WidthProvider re-widths every card on a window resize,
   * and this `width: 100%` auto-layout table also re-widths a column whenever
   * its content changes — a wider value scrolled into the virtual window, or a
   * sort bringing one to the top. Every one of those moves a pinned column's
   * right edge without changing a single prop, so without this the offsets
   * would stay at their last measured values and the pinned columns would
   * drift apart. Observing the cells themselves rather than the container
   * catches the content-driven case too.
   *
   * The filter row's cells are deliberately NOT observed: they are offset by
   * the header row's widths, so they report nothing the header cells do not.
   *
   * Undefined in jsdom, as in PdfView: guarded, not stubbed. (ChartRenderer's
   * observer is unguarded; its tests stub ResizeObserver instead.)
   */
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const thead = theadRef.current;
    if (!thead) return;
    // Not debounced: this only reads a handful of getBoundingClientRect and
    // then bails out of the state update unless a number actually changed, so
    // a drag's per-frame callbacks stay cheap and cause no re-render.
    const observer = new ResizeObserver(() => measureOffsets());
    if (workerBacked && scrollRef.current) observer.observe(scrollRef.current);
    for (const cell of thead.querySelectorAll<HTMLElement>(
      workerBacked ? "th[data-field], th[data-selection-gutter]" : "th[data-field].pin-left, th[data-field].pin-right",
    )) {
      observer.observe(cell);
    }
    return () => observer.disconnect();
    // The observed SET follows the column set, so it is keyed on exactly what
    // the layout effect above is keyed on (bar `rows`, which changes no
    // header cell's identity).
  }, [measureOffsets, columnOrder, columnVisibility, columnPinning, columnSizing, workerBacked]);

  /** The measured offset when there is one, else TanStack's declared-size sum. */
  const stickyOffset = (field: string, fallback: number) =>
    Object.hasOwn(offsets, field) ? offsets[field] : fallback;
  /** A pinned column's sticky left/right edge, shared by its header, filter and body cells. */
  const pinStyle = (c: Column<Row, unknown>) => {
    const side = c.getIsPinned();
    return {
      left: side === "left" ? stickyOffset(c.id, c.getStart("left") + (execution?.selection ? totalGutterWidth : 0)) : undefined,
      right: side === "right" ? stickyOffset(c.id, c.getAfter("right")) : undefined,
    };
  };

  const virtualItems = virtualizer.getVirtualItems();
  const rangeStart = virtualItems[0]?.index ?? 0;
  const rangeEnd = virtualItems[virtualItems.length - 1]?.index ?? Math.min(20, (execution?.count ?? 1) - 1);
  useEffect(() => { execution?.requestRange(rangeStart, rangeEnd); }, [execution, rangeStart, rangeEnd]);
  const totalSize = virtualizer.getTotalSize();
  const spacerTop = virtualItems[0]?.start ?? 0;
  const spacerBottom = totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0);
  // Read off the table, not off `columns`: a hidden column changes it.
  const columnCount = table.getVisibleLeafColumns().length + (execution?.selection ? 1 : 0) + (filterRow ? 1 : 0);
  /** The actions column's cell in every other row, while filtering. */
  const actionsCell = (Cell: "th" | "td") =>
    filterRow ? <Cell className="filter-actions-col" aria-hidden="true" /> : null;
  const filteredCount = table.getFilteredRowModel().rows.length;
  /**
   * The leaf header row, which is what the filter row must line up with.
   * getVisibleLeafColumns() is ordered by columnOrder and is NOT grouped into
   * left/centre/right, so using it here would misalign the filter row under
   * any pinned column.
   */
  const leafHeaders = table.getHeaderGroups().at(-1)?.headers ?? [];

  function onColumnDrop(target: string) {
    const from = draggedField.current;
    draggedField.current = null;
    if (from === null) return;
    // null is a refused move: across the pinned boundary, or a no-op. The
    // boundary is the EFFECTIVE one -- tableState, not the `state` prop, so
    // that with no owner wired the in-memory pins still count.
    const next = moveColumn(columnOrder, columns, from, target, tableState.pinned);
    if (next) patch({ columnOrder: next });
  }

  const tableContent = (
    <div className="table-scroll" ref={scrollRef} data-overflow-right={offscreenColumns > 0 ? "" : undefined} onScroll={execution ? e => { if(totalScrollRef.current) totalScrollRef.current.scrollLeft=e.currentTarget.scrollLeft; measureOverflow(); } : undefined}>
      {execution?.selection ? <div className="table-selection-controls" role="status">
        <span>{execution.selection.selectedCount} selected</span>{' '}
        <button type="button" disabled={execution.selectionPending || execution.selection.selection.kind === 'none'} onClick={() => execution.onSelection?.({ kind: 'clear' })}>Clear selection</button>
      </div> : null}
      {/* A split hides the filter row, but its filters still apply: say so, and offer Clear. */}
      {hasSplit && pivot && columnFilters.length ? <div className="filter-actions" role="status">
        <span className="filter-count">Filtered: {pivot.filteredCount} of {pivot.sourceCount} source rows</span>{' '}
        <button type="button" onClick={() => { setClears((n) => n + 1); patch({ columnFilters: [] }); }}>Clear</button>
      </div> : null}
      {/* As wide as its columns (bdobb#10): widths are exact, a wide table
          scrolls in .table-scroll, a narrow one leaves space on the right. */}
      <table className="widget-table sized" ref={tableRef} style={{ width: table.getTotalSize() + (execution?.selection ? totalGutterWidth : 0) }}>
        {/* Fixed layout takes widths from the first row, which in a pivoted
            table is the group header row; the columns carry the leaf widths. */}
        <colgroup>
          {execution?.selection ? <col style={{ width: totalGutterWidth }} /> : null}
          {leafHeaders.map((h) => (
            <col
              key={h.id}
              // A date column is widened while the filter row is open, so From
              // and To fit; fixed layout takes the width from here.
              style={{
                width:
                  filterRow && filterKinds.get(h.column.id) === "date"
                    ? `max(${h.getSize()}px, var(--date-range-width))`
                    : h.getSize(),
              }}
            />
          ))}
          {/* The actions column (Clear and the count), only while filtering. */}
          {filterRow ? <col className="filter-actions-col" /> : null}
        </colgroup>
        <thead ref={theadRef}>
          {table.getHeaderGroups().map((group, groupIndex) => (
            <tr key={group.id}>
              {execution?.selection && groupIndex === 0 ? <th className="selection-cell pin-left" data-selection-gutter rowSpan={table.getHeaderGroups().length} style={{ width: 32, left: 0 }}>
                <SelectionCheckbox label="Select all rows" checked={execution.selection.checked} indeterminate={execution.selection.indeterminate} disabled={execution.selectionPending || execution.selection.eligibleCount === 0} onChange={() => execution.onSelection?.({ kind: execution.selection?.checked ? 'clear' : 'all' })} />
              </th> : null}
              {group.headers.map((header) => {
                const column = byField.get(header.column.id);
                const side = header.column.getIsPinned();
                // The two kinds of cell only a split adds. Neither carries
                // `data-field`, which keeps measureOffsets reading leaf headers
                // only. An unpivoted table has one header row of leaves, so it
                // never reaches either branch.
                if (header.isPlaceholder) {
                  // The slot above the label column. Sticky like the cell below.
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-hidden="true"
                      className={side ? `pin-${side}${execution && side === "left" && header.column.id === columnPinning.left?.at(-1) ? " pin-left-last" : ""}` : undefined}
                      style={{
                        left:
                          side === "left"
                            ? stickyOffset(header.column.id, header.column.getStart("left"))
                            : undefined,
                      }}
                    />
                  );
                }
                if (!column) {
                  // A split header: it spans its leaves and does nothing else.
                  return (
                    <th key={header.id} colSpan={header.colSpan} scope="colgroup" className="pivot-group-header">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                }
                const openHeaderMenu = (trigger: HTMLElement, x: number, y: number) =>
                  setMenuAt({ x, y, field: header.column.id, trigger });
                return (
                  <th
                    key={header.id}
                    data-field={header.column.id}
                    className={side ? `pin-${side}${execution && side === "left" && header.column.id === columnPinning.left?.at(-1) ? " pin-left-last" : ""}` : undefined}
                    title={column?.tooltip}
                    // "none" included: aria-sort is what tells a screen reader
                    // the header sorts at all, and every accessor column does.
                    aria-sort={
                      !header.column.getCanSort()
                        ? undefined
                        : header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                    }
                    style={{
                      // Widened only while the filter row is open, so From and
                      // To fit; the column's own size returns when it closes.
                      // table-layout: fixed grows the table to the wider sum.
                      width:
                        filterRow && filterKinds.get(header.column.id) === "date"
                          ? `max(${header.getSize()}px, var(--date-range-width))`
                          : header.getSize(),
                      ...pinStyle(header.column),
                    }}
                    draggable={pivot === undefined}
                    // In the Tab order, and focusable at all: pinning and
                    // hiding a column live only in this cell's menu, so a
                    // header a keyboard cannot reach is a feature a keyboard
                    // cannot use. It is also what makes the menu's
                    // return-focus real — .focus() on an element the browser
                    // does not consider focusable is a silent no-op.
                    tabIndex={0}
                    onDragStart={(e) => {
                      // A press that began on the resize handle must not become
                      // a native drag, or the mousemove-driven resize never
                      // runs. draggable={false} on the span says the same
                      // thing; this guard is what the test pins, so the
                      // behaviour does not rest on any engine's choice of drag
                      // source.
                      if (resizePress.current || (e.target as HTMLElement).classList.contains("column-resizer")) {
                        e.preventDefault();
                        return;
                      }
                      draggedField.current = header.column.id;
                      e.dataTransfer.setData(COLUMN_DRAG_TYPE, header.column.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (draggedField.current !== null) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onColumnDrop(header.column.id);
                    }}
                    onDragEnd={() => {
                      draggedField.current = null;
                    }}
                    onContextMenu={(e) => {
                      // preventDefault stops the OS menu. It neither sorts nor
                      // drags: the browser fires no click for the secondary
                      // button, and a native drag needs a primary-button
                      // press -- both pinned by tests rather than assumed.
                      e.preventDefault();
                      openHeaderMenu(e.currentTarget, e.clientX, e.clientY);
                    }}
                    onKeyDown={(e) => {
                      // The four keys isMenuKey takes.
                      // Enter/Space activate a focused control, and neither
                      // reaches this cell's own click (the browser synthesises
                      // one only for natively activatable elements, which a
                      // <th> is not); ContextMenu / Shift+F10 are the OS keys
                      // for a context menu, so the menu is reachable the way a
                      // keyboard-only user expects.
                      if (!isMenuKey(e)) return;
                      // Space would scroll the table out from under the menu.
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      openHeaderMenu(e.currentTarget, rect.left, rect.bottom);
                    }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() ? (
                      <span className="sort-marker">
                        {header.column.getIsSorted() === "asc" ? "▲" : "▼"}
                      </span>
                    ) : null}
                    {/* The 1-based position in the sort, shown only once more
                        than one column is sorted — a lone "1" says nothing. */}
                    {sorting.length > 1 && header.column.getSortIndex() >= 0 ? (
                      <span className="sort-index">{header.column.getSortIndex() + 1}</span>
                    ) : null}
                    <span
                      className="column-resizer"
                      draggable={false}
                      // The one guard the resize press needs: sorting is wired
                      // to the <th>'s click, so without this the click that
                      // ends a resize drag would sort the column too.
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={startResize(header.getResizeHandler())}
                      onTouchStart={startResize(header.getResizeHandler())}
                    />
                  </th>
                );
              })}
              {actionsCell("th")}
            </tr>
          ))}
          {filterRow && !hasSplit ? (
            <tr className="filter-row">
              {execution?.selection ? <th /> : null}
              {leafHeaders.map((header) => {
                const leaf = header.column;
                const side = leaf.getIsPinned();
                const column = byField.get(leaf.id);
                return (
                  <th
                    key={leaf.id}
                    data-filter-for={leaf.id}
                    className={side ? `pin-${side}${execution && side === "left" && leaf.id === columnPinning.left?.at(-1) ? " pin-left-last" : ""}` : undefined}
                    // The MEASURED offsets, exactly as the header and body
                    // rows use: mixing a declared sum in here would leave this
                    // row's pinned cells at different left/right edges from the
                    // header's whenever a column takes more room than it
                    // declared -- which is the whole reason the offsets are
                    // measured at all.
                    style={pinStyle(leaf)}
                  >
                    <FilterControl
                      key={clears}
                      kind={filterKinds.get(leaf.id) ?? "none"}
                      header={column?.header ?? leaf.id}
                      value={columnFilters.find((f) => f.id === leaf.id)?.value}
                      bounds={dateBounds.get(leaf.id)}
                      dateContext={dateContext ?? DEFAULT_DATE_CONTEXT}
                      onChange={(next) => leaf.setFilterValue(next)}
                    />
                  </th>
                );
              })}
              {/* Clear and the count, in a column of their own after the last
                  one, so no column's filter cell holds them. The column exists
                  only while filtering, and every row carries a cell for it
                  (actionsCell below), so header, filter and body rows stay in
                  step; the spacers' colSpan counts it too. */}
              <th className="filter-actions-col">
                <span className="filter-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setClears((n) => n + 1);
                      patch({ columnFilters: [] });
                    }}
                  >
                    Clear
                  </button>
                  <span className="filter-count">
                    {pivot
                      ? `${pivot.filteredCount} of ${pivot.sourceCount} rows`
                      : execution ? execution.sourceCount === undefined ? `${execution.count} rows` : `${execution.count} of ${execution.sourceCount} rows` : `${filteredCount} of ${rows.length} rows`}
                  </span>
                </span>
              </th>
            </tr>
          ) : null}
        </thead>
        <tbody>
          {spacerTop > 0 ? (
            <tr className="table-spacer">
              <td colSpan={columnCount} style={{ height: spacerTop }} />
            </tr>
          ) : null}
          {virtualItems.map((item) => {
            const slot = execution?.slot(item.index);
            const row = execution ? modelRows.find(r => r.id === slot?.rowId) : modelRows[item.index];
            if (!row) return <tr key={`loading-${item.index}`} data-index={item.index}><td colSpan={columnCount}>Loading rows…</td></tr>;
            // Manual sorting: table-core keeps the engine's order, and row.index
            // is the position in `rows`, i.e. in the engine's parallel `meta`.
            const rowMeta = pivotResult?.meta[row.index];
            // row.index is the DATA index, which is what the showCellChange
            // effect keys by; item.index is the position after sort/filter.
            const original = row.original as Row;
            const rowKey = rowIdColumn
              ? String(Object.hasOwn(original, rowIdColumn) ? original[rowIdColumn] : undefined)
              : String(row.index);
            return (
              <tr
                key={row.id}
                data-index={item.index}
                data-row-id={row.id}
                ref={virtualizer.measureElement}
                className={rowMeta && rowMeta.kind !== "leaf" ? "pivot-group-row" : undefined}
              >
                {/* Named by position: a row id can be a content hash (the row's cells as JSON), which a
                    screen reader would read out. Tests that need one row use the tr's data-row-id. */}
                {execution?.selection ? <td className="selection-cell pin-left" style={{ width: 32, left: 0 }}>{row.getCanSelect() ? <SelectionCheckbox label={`Select row ${item.index + 1}`} checked={row.getIsSelected()} indeterminate={selectionRows.get(row.id)?.indeterminate ?? false} disabled={execution.selectionPending} onChange={row.getToggleSelectedHandler()} /> : null}</td> : null}
                {row.getVisibleCells().map((cell) => {
                  const column = byField.get(cell.column.id);
                  const side = cell.column.getIsPinned();
                  const errors = execution?.rowErrors?.get(row.id);
                  const error = errors && Object.hasOwn(errors, cell.column.id) ? errors[cell.column.id] : undefined;
                  const visual: CellVisual = column ? cellVisual(column, cell.getValue()) : {};
                  const cellFlash = column?.cellChange?.enabled
                    ? flash.get(`${rowKey}|${cell.column.id}`)
                    : undefined;
                  // A const, so TypeScript's narrowing survives into the
                  // button's onClick closure below -- no non-null assertion,
                  // of which this codebase has none in product code.
                  const click = column?.cellClick;
                  const agentAction = column?.sendToAgent;
                  const classes = [side ? `pin-${side}` : null, execution && side === "left" && cell.column.id === columnPinning.left?.at(-1) ? "pin-left-last" : null, error ? "cell-error" : visual.className ?? null].filter(
                    (c): c is string => c !== null,
                  );
                  /* The same pivot-leaf guard the cell-click branch below
                      carries: a group or total row's cells are aggregates,
                      not a real row's values, so fillRowTemplate would send
                      Rita a message built from an aggregate row it cannot
                      act on. Those cells render as plain text. */
                  const leafRow = !rowMeta || rowMeta.kind === "leaf";
                  const activate =
                    agentAction && onSendToAgent && leafRow
                      ? () => onSendToAgent(fillRowTemplate(agentAction.markdown, cell.row.original), agentAction.agentId)
                      : click && onCellClick && leafRow
                        ? () => onCellClick(cellClickValue(click, cell.getValue(), cell.row.original))
                        : undefined;
                  return (
                    <td
                      key={cell.id}
                      data-field={cell.column.id}
                      data-flash={cellFlash}
                      className={classes.length > 0 ? classes.join(" ") : undefined}
                      title={error ? `${error.code}: ${error.message}` : undefined}
                      style={{
                        ...pinStyle(cell.column),
                        color: error || visual.fill ? undefined : visual.color,
                        background: !error && visual.fill ? visual.color : undefined,
                      }}
                    >
                      {error ? <ErrorCell error={error} /> : slot?.group && cell.column.id === LABEL_FIELD ? (
                        <ExecutionGroupLabel group={slot.group} label={cell.getValue()} onToggle={execution?.toggle} />
                      ) : activate ? (
                        <button
                          type="button"
                          className="cell-link"
                          onClick={(e) => {
                            // Nothing above this cell handles a click today,
                            // but the header's sort and drag handlers are one
                            // ancestor away and a row handler would be one
                            // more: assigning a parameter must never also
                            // re-sort the table under the user's finger.
                            e.stopPropagation();
                            activate();
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </button>
                      ) : rowMeta && pivot && cell.column.id === LABEL_FIELD ? (
                        <PivotLabelCell meta={rowMeta} onToggle={pivot.onToggle} />
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                    </td>
                  );
                })}
                {actionsCell("td")}
              </tr>
            );
          })}
          {spacerBottom > 0 ? (
            <tr className="table-spacer">
              <td colSpan={columnCount} style={{ height: spacerBottom }} />
            </tr>
          ) : null}
        </tbody>
      </table>
      {/* Mounted here, rendered into <body> by createPortal: this position in
          the tree is a mount point, not a layout decision, so .table-scroll's
          overflow and stacking context never see it. */}
      {menuAt ? (
        <RowContextMenu
          x={menuAt.x}
          y={menuAt.y}
          portal
          returnFocusTo={menuAt.trigger}
          items={[
            // table-core's own toggleSorting/clearSorting, so a menu sort
            // follows the same single/multi-sort rule a header click does.
            // Always offered: a synthetic split column can be sorted too.
            ...(execution?.formulaIds?.has(menuAt.field) && execution.onShowFormula ? [{label: 'Show formula', onSelect:()=>execution.onShowFormula!(execution.formulaIds!.get(menuAt.field)!,menuAt.trigger)}] : []),
            ...sortItems(table.getColumn(menuAt.field)?.getIsSorted() ?? false, (desc) => {
              const sortColumn = table.getColumn(menuAt.field);
              if (desc === null) sortColumn?.clearSorting();
              else sortColumn?.toggleSorting(desc);
            }),
            // Under a SPLIT the columns are the engine's synthetic ones: a
            // synthetic column can be sorted and nothing else; a pin or a
            // hide belongs to the panel's lists rather than to a header.
            // With Row Groups only the data columns are still the real
            // source fields, so Pin and Hide stay (N7). A forced report label
            // cannot be manually unpinned; do not offer an ineffective action.
            ...(hasSplit
              ? []
              : (execution && menuAt.field === LABEL_FIELD ? [] : pinItems(sideOf(menuAt.field), (next) =>
                  // ONE patch, so one dashboard write: setPinned returns the
                  // map and the re-positioned order together.
                  patch(setPinned(columns, columnOrder, tableState.pinned, menuAt.field, next)),
                )).concat({
                  label: "Hide",
                  separatorBefore: true,
                  onSelect: () =>
                    patch({ hidden: [...new Set([...(execution ? tableState.hidden ?? [] : hiddenFields(columns, tableState.hidden)), menuAt.field])] }),
                })),
          ]}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </div>
  );
  return execution ? (
    // Passive dismissal observes clicks on the table surface; buttons retain their own semantics.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="table-execution-layout" hidden={executionHidden} tabIndex={-1} data-dashboard={executionIdentity?.dashboardId} data-pivot-table={executionIdentity?.widgetId} onClick={event=>{const target=event.target as HTMLElement;if(!target.closest('button,input,select,textarea,a,[role="menu"],[role="dialog"],th,.table-filter-row,.table-selection-controls'))onExecutionOutside?.();}}>{tableContent}
    {offscreenColumns > 0 ? <><div className="table-overflow-cue" aria-hidden="true" /><button type="button" className="table-overflow-chip" onClick={() => scrollRef.current?.scrollBy({ left: scrollRef.current.clientWidth, behavior: 'smooth' })}>+{offscreenColumns} {offscreenColumns === 1 ? "column" : "columns"} →</button></> : null}
    {execution.showTotals !== false ? <div className="table-total-footer">
      <div className="table-total-context" title={execution.totalLabel}>{execution.totalLabel && execution.totalLabel.length > 160 ? `${execution.totalLabel.slice(0,160)}…` : execution.totalLabel ?? 'Grand total · Surviving groups'}</div>
      <div className="table-total-scroll" ref={totalScrollRef}><table className="widget-table" style={{ width: leafHeaders.reduce((n,{column})=>n+(totalWidths[column.id]??column.getSize()),execution.selection?(totalGutterWidth):0) }}>
        <TotalRows columns={leafHeaders.map(({column}) => ({id:column.id,label:byField.get(column.id)?.header??column.id,pin:column.getIsPinned(),style:{width:totalWidths[column.id]??column.getSize(),minWidth:totalWidths[column.id]??column.getSize(),maxWidth:totalWidths[column.id]??column.getSize(),...pinStyle(column)}}))}
          values={execution.totals} cellErrors={execution.totalErrors} empty={execution.totalsEmpty} label={execution.totalLabel}
          selectionGutter={!!execution.selection} selectionGutterWidth={totalGutterWidth} format={(value,id)=>formatCell(value,id,maxDecimalPlaces,undefined,byField.get(id)?.format)} />
      </table></div>
    </div> : null}
    </div>
  ) : tableContent;
}

function SelectionCheckbox({ label, checked, indeterminate, disabled, onChange }: { label: string; checked: boolean; indeterminate: boolean; disabled?: boolean; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}
