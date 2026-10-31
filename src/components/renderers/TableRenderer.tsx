// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
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
import { formatCell } from "../../lib/format";
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
import type { PinSide, TableCardState, TableSpec } from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";
import { isMenuKey, RowContextMenu, type MenuItem } from "../RowContextMenu";
import { RawJsonView } from "./RawJsonView";
import { FilterControl, filterFnFor, filterKindFor, type DateBounds } from "./TableFilterRow";

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
type TableViewProps = {
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
  /** The card header's ⌕ toggle: a filter row under the header row. */
  filterRow?: boolean;
  /**
   * A live_grid's row-identity column (wsRowIdColumn). When set, showCellChange
   * tracks a cell by this value rather than by row index, so a grid that
   * reorders its rows flashes the cell that actually changed.
   */
  rowIdColumn?: string;
};

export function TableRenderer({
  data,
  plain = false,
  columns,
  ...view
}: TableViewProps & {
  data: unknown;
  /**
   * A static grid: header text and cells, nothing else. The transposed view
   * uses it because its columns are the DATA's first-column values — the
   * spec's columnsDefs, the card's sort/filter/pins and the column menu all
   * describe columns that no longer exist on screen.
   */
  plain?: boolean;
  /** Plain mode's column order. Never derived from the rows' keys: see transposeRows. */
  columns?: string[];
}) {
  const rows = tableRows(data);

  // An unexpected shape always falls through to raw JSON, never to nothing.
  if (!rows) return <RawJsonView data={data} />;
  if (rows.length === 0) return <p className="empty-state">No rows.</p>;
  if (plain) {
    // `columns` is what the transposed view always passes. The fallback is for
    // a plain table over an ordinary payload: the same field order the
    // virtualised table would have shown.
    const fields = columns ?? tableColumns(rows, undefined).map((c) => c.field);
    return <PlainTable rows={rows} columns={fields} />;
  }

  return <VirtualTable rows={rows} {...view} />;
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

function VirtualTable({
  rows,
  spec,
  state,
  onStateChange,
  onCellClick,
  filterRow,
  rowIdColumn,
}: TableViewProps & { rows: Row[] }) {
  const [tableState, patch] = useTableState(state, onStateChange);
  const sorting = tableState.sorting ?? NO_SORTING;
  // TableFilter and TanStack's ColumnFilter are both { id: string; value:
  // unknown }, so the persisted array IS a ColumnFiltersState.
  const columnFilters = tableState.columnFilters ?? NO_FILTERS;
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
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => state?.widths ?? {});
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

  const columns = useMemo(() => tableColumns(rows, spec), [rows, spec]);
  /** Field -> its column, for the <th>/<td> that need more than TanStack holds. */
  const byField = useMemo(
    () => new Map<string, TableColumn>(columns.map((c) => [c.field, c])),
    [columns],
  );

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
    () => orderFields(columns, tableState.columnOrder),
    [columns, tableState.columnOrder],
  );
  const columnVisibility = useMemo<VisibilityState>(
    () => Object.fromEntries(hiddenFields(columns, tableState.hidden).map((f) => [f, false])),
    [columns, tableState.hidden],
  );
  /**
   * A column's effective side: the card's own override when it has one, else
   * the widget spec's. Every read of a side in this component goes through
   * here, so the pinned groups, the header menu and the drag rule cannot
   * disagree.
   */
  const sideOf = useCallback(
    (field: string) => {
      const column = byField.get(field);
      return column ? effectivePinned(column, tableState.pinned) : undefined;
    },
    [byField, tableState.pinned],
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
    () => new Map(columns.map((c) => [c.field, filterKindFor(c, rows)])),
    [columns, rows],
  );

  /** A date column's first and last day in the loaded rows: where its From
   * and To boxes start. Compared as YYYY-MM-DD text, as dateFilter does. */
  const dateBounds = useMemo(() => {
    const bounds = new Map<string, DateBounds>();
    for (const [field, kind] of filterKinds) {
      if (kind !== "date") continue;
      const days = rows
        .map((r) => (Object.hasOwn(r, field) ? r[field] : undefined))
        .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))
        .map((v) => v.slice(0, 10))
        .sort();
      if (days.length > 0) bounds.set(field, { first: days[0], last: days[days.length - 1] });
    }
    return bounds;
  }, [filterKinds, rows]);
  /** Bumped by Clear, so every control starts again from its column -- a box
   * holding refused text has no applied filter for Clear to change. */
  const [clears, setClears] = useState(0);

  const columnDefs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((column) => ({
        id: column.field,
        // accessorFn, never accessorKey: table-core reads a dotted key as a
        // nested path, and a transposed table's keys are the data's own
        // first-column values -- `BRK.B`, `AAPL.US`, `1.5` -- so every cell,
        // sort and filter of such a column read undefined. Object.hasOwn, as
        // everywhere else a row is read by a computed key: `row` came back
        // from JSON.parse and inherits Object.prototype.
        accessorFn: (row: Row) => {
          const value = Object.hasOwn(row, column.field) ? row[column.field] : undefined;
          // A hoverCard cell holds an object; the value it displays, sorts
          // and filters by is the one under cellField. The whole object is
          // read back from row.original for the card itself.
          const field = column.hoverCard?.cellField;
          if (field !== undefined && typeof value === "object" && value !== null) {
            const record = value as Record<string, unknown>;
            return Object.hasOwn(record, field) ? record[field] : undefined;
          }
          return value;
        },
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
        cell: (ctx) => {
          const value = ctx.getValue();
          if (column.sparkline && Array.isArray(value)) {
            const nums = sparklineValues(value, column.sparkline);
            if (nums.length > 0) return <SparklineCell values={nums} config={column.sparkline} />;
          }
          const text = formatCell(value, column.field, maxDecimalPlaces, undefined, column.format);
          const shown = column.renderFn.includes("titleCase") ? titleCase(text) : text;
          if (!column.hoverCard) return shown;
          const original = ctx.row.original;
          const source = Object.hasOwn(original, column.field) ? original[column.field] : undefined;
          return <HoverCardCell text={shown} card={column.hoverCard} source={source} />;
        },
      })),
    [columns, filterKinds, maxDecimalPlaces, sorting],
  );

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: {
      sorting,
      columnFilters,
      columnOrder,
      columnVisibility,
      columnPinning,
      columnSizing,
    },
    // TanStack hands over either an updater or a finished value; both are
    // resolved here so the patch the owner receives is always the new state,
    // never a function it would have to apply itself.
    onSortingChange: (updater) => {
      patch({ sorting: typeof updater === "function" ? updater(sorting) : updater });
    },
    onColumnFiltersChange: (updater) => {
      patch({ columnFilters: typeof updater === "function" ? updater(columnFilters) : updater });
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnSizing) : updater;
      setColumnSizing(next);
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
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const modelRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: modelRows.length,
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
  /** field -> its sticky offset, in px, or empty when nothing was measurable. */
  const [offsets, setOffsets] = useState<Record<string, number>>({});

  /**
   * Sticky offsets are summed from the pinned headers' MEASURED widths, not
   * from their declared sizes. `.widget-table` is `width: 100%` with the
   * browser's automatic table layout, so a columnsDefs `width` is only a hint:
   * a column whose content needs more room takes it, and summing declared
   * sizes would leave the next pinned column's offset short of the previous
   * one's real right edge -- the two would overlap. Measuring instead of
   * changing the table to `table-layout: fixed` is deliberate: that class is
   * shared with KeysRenderer, which must stay untouched.
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
    if (thead && left.length + right.length > 0) {
      // Read every header once into a map rather than one selector per field:
      // a field name out of an untrusted payload is not a safe selector.
      const widths = new Map<string, number>();
      for (const cell of thead.querySelectorAll<HTMLElement>("th[data-field]")) {
        const field = cell.getAttribute("data-field");
        if (field !== null) widths.set(field, cell.getBoundingClientRect().width);
      }
      const width = (field: string) => widths.get(field) ?? 0;
      if ([...left, ...right].every((f) => width(f) > 0)) {
        let offset = 0;
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
  }, [table]);

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
    for (const cell of thead.querySelectorAll<HTMLElement>(
      "th[data-field].pin-left, th[data-field].pin-right",
    )) {
      observer.observe(cell);
    }
    return () => observer.disconnect();
    // The observed SET follows the column set, so it is keyed on exactly what
    // the layout effect above is keyed on (bar `rows`, which changes no
    // header cell's identity).
  }, [measureOffsets, columnOrder, columnVisibility, columnPinning, columnSizing]);

  /** The measured offset when there is one, else TanStack's declared-size sum. */
  const stickyOffset = (field: string, fallback: number) =>
    Object.hasOwn(offsets, field) ? offsets[field] : fallback;
  /** A pinned column's sticky left/right edge, shared by its header, filter and body cells. */
  const pinStyle = (c: Column<Row, unknown>) => {
    const side = c.getIsPinned();
    return {
      left: side === "left" ? stickyOffset(c.id, c.getStart("left")) : undefined,
      right: side === "right" ? stickyOffset(c.id, c.getAfter("right")) : undefined,
    };
  };

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const spacerTop = virtualItems[0]?.start ?? 0;
  const spacerBottom = totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0);
  // Read off the table, not off `columns`: a hidden column changes it.
  const columnCount = table.getVisibleLeafColumns().length + (filterRow ? 1 : 0);
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

  return (
    <div className="table-scroll" ref={scrollRef}>
      {/* As wide as its columns (bdobb#10): widths are exact, a wide table
          scrolls in .table-scroll, a narrow one leaves space on the right. */}
      <table className="widget-table sized" style={{ width: table.getTotalSize() }}>
        <thead ref={theadRef}>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const column = byField.get(header.column.id);
                const side = header.column.getIsPinned();
                return (
                  <th
                    key={header.id}
                    data-field={header.column.id}
                    className={side ? `pin-${side}` : undefined}
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
                    draggable
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
                      setMenuAt({
                        x: e.clientX,
                        y: e.clientY,
                        field: header.column.id,
                        trigger: e.currentTarget,
                      });
                    }}
                    onKeyDown={(e) => {
                      // The same four keys KeysRenderer's row trigger takes.
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
                      setMenuAt({
                        x: rect.left,
                        y: rect.bottom,
                        field: header.column.id,
                        trigger: e.currentTarget,
                      });
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
          {filterRow ? (
            <tr className="filter-row">
              {leafHeaders.map((header) => {
                const leaf = header.column;
                const side = leaf.getIsPinned();
                const column = byField.get(leaf.id);
                return (
                  <th
                    key={leaf.id}
                    data-filter-for={leaf.id}
                    className={side ? `pin-${side}` : undefined}
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
                      value={leaf.getFilterValue()}
                      bounds={dateBounds.get(leaf.id)}
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
                  <span className="filter-count">{`${filteredCount} of ${rows.length} rows`}</span>
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
            const row = modelRows[item.index];
            // row.index is the DATA index, which is what the showCellChange
            // effect keys by; item.index is the position after sort/filter.
            const original = row.original as Row;
            const rowKey = rowIdColumn
              ? String(Object.hasOwn(original, rowIdColumn) ? original[rowIdColumn] : undefined)
              : String(row.index);
            return (
              <tr key={row.id} data-index={item.index} ref={virtualizer.measureElement}>
                {row.getVisibleCells().map((cell) => {
                  const column = byField.get(cell.column.id);
                  const side = cell.column.getIsPinned();
                  const visual: CellVisual = column ? cellVisual(column, cell.getValue(), original) : {};
                  const cellFlash = column?.cellChange?.enabled
                    ? flash.get(`${rowKey}|${cell.column.id}`)
                    : undefined;
                  // A const, so TypeScript's narrowing survives into the
                  // button's onClick closure below -- no non-null assertion,
                  // of which this codebase has none in product code.
                  const click = column?.cellClick;
                  const classes = [side ? `pin-${side}` : null, visual.className ?? null].filter(
                    (c): c is string => c !== null,
                  );
                  return (
                    <td
                      key={cell.id}
                      data-field={cell.column.id}
                      data-flash={cellFlash}
                      className={classes.length > 0 ? classes.join(" ") : undefined}
                      style={{
                        ...pinStyle(cell.column),
                        color: visual.fill ? undefined : visual.color,
                        background: visual.fill ? visual.color : undefined,
                      }}
                    >
                      {click && onCellClick ? (
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
                            onCellClick(
                              cellClickValue(click, cell.getValue(), cell.row.original),
                            );
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </button>
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
            ...sortItems(table.getColumn(menuAt.field)?.getIsSorted() ?? false, (desc) => {
              const sortColumn = table.getColumn(menuAt.field);
              if (desc === null) sortColumn?.clearSorting();
              else sortColumn?.toggleSorting(desc);
            }),
            ...pinItems(sideOf(menuAt.field), (next) =>
              // ONE patch, so one dashboard write: setPinned returns the map and
              // the re-positioned order together.
              patch(setPinned(columns, columnOrder, tableState.pinned, menuAt.field, next)),
            ).concat({
              label: "Hide",
              separatorBefore: true,
              onSelect: () =>
                patch({ hidden: [...hiddenFields(columns, tableState.hidden), menuAt.field] }),
            }),
          ]}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </div>
  );
}
