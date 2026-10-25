// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  eodhdLogoUrl,
  addDays, bucketRows, buildTree, businessDaysBetween, continuousWeeks, createWheelStepper, detectDateColumn,
  detectTitleColumn, distinctValues, fetchWindow, filterSeries, filterTree, firstOfMonth, gridWeeks, hiddenEventCount, isoWeekday, localClock,
  BARE_DATE, localDate, mondayOf, resolveMode, SHEET_WEEKS, SHEET_WEEKS_BEFORE, sortedBusinessDays, staticWeeks, stepCursor, todayLocal, toggleTreePath, treeCounts,
  type CalendarEvent, type TreeNode,
} from "../../lib/calendarView";
import type { CalendarCardState, CalendarCellMode, CalendarMode, CalendarUnit, TableSpec } from "../../lib/types";
import { useMinuteTick } from "../../hooks/useMinuteTick";
import { cellFormat, formatCell } from "../../lib/format";
import { useSettingsStore } from "../../stores/settingsStore";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/**
 * Paged's three pages. `continuous` is not among them any more: since the
 * 2026-09-07 rework the endless scroll is a mode of its own, and `continuous`
 * survives in `CalendarUnit` only so a card persisted before the rework still
 * reads (see `resolveMode`).
 */
const UNITS: Array<Exclude<CalendarUnit, "continuous">> = ["day", "week", "month"];
const MODES: CalendarMode[] = ["static", "vertical", "horizontal", "paged"];
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The endless box's scroll offset, content size and visible size on one axis. */
const extent = (box: HTMLElement, axis: "x" | "y") =>
  axis === "x" ? [box.scrollLeft, box.scrollWidth, box.clientWidth] : [box.scrollTop, box.scrollHeight, box.clientHeight];

/**
 * An endless box's scroll: near the leading edge, ask for six weeks before
 * (stashing the box's size in `prepend` for settlePrepend), near the
 * trailing edge six after.
 *
 * A scroll event is continuous-priority in React, so this can run again
 * before the prepend has committed and the layout effect has put the reader
 * back. Without the `prepend` guard, two events that both snapshot the
 * pre-growth size each ask for a correction of the *total* growth,
 * double-counting it. Measured here, corrected there: only the layout effect
 * runs after React has committed the new weeks, so only it can see how much
 * bigger they made the box.
 */
function sheetScroll(box: HTMLElement, axis: "x" | "y", prepend: { current: number | null }, grow: (before: boolean) => void) {
  const [pos, size, view] = extent(box, axis);
  if (pos < CONT_EDGE) {
    if (prepend.current !== null) return;
    prepend.current = size;
    grow(true);
  } else if (size - pos - view < CONT_EDGE) {
    grow(false);
  }
}

/** After a prepend, scroll on by exactly how much the box grew. True when there was one to settle. */
function settlePrepend(box: HTMLElement, axis: "x" | "y", prepend: { current: number | null }): boolean {
  if (prepend.current === null) return false;
  const growth = extent(box, axis)[1] - prepend.current;
  if (axis === "x") box.scrollLeft += growth;
  else box.scrollTop += growth;
  prepend.current = null;
  return true;
}

/** One segmented toolbar control: pressed is the current value. */
function Seg<T extends string>({ label, options, value, onPick }: {
  label: string; options: readonly (readonly [T, string])[]; value: T; onPick: (value: T) => void;
}) {
  return (
    <div className="calendar-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>{text}</button>
      ))}
    </div>
  );
}
/** Weeks an endless sheet grows by when the reader scrolls near one of its edges. */
const CONT_WEEKS = 6;
/**
 * How close to a scroll edge (px) the reader gets before six more weeks are
 * added. Under the shortest week row (an 88 px cell plus the 4 px gap) on
 * purpose: the opening sheet has only one week above the cursor's, and the
 * landing scroll puts the cursor's row at the top, so that one row is all
 * the distance there is from the leading edge. At 120 px, as it was when six
 * weeks sat above, the landing itself would trip a prepend.
 */
const CONT_EDGE = 80;
/** The endless modes' opening sheet for a cursor: the same weeks `fetchWindow("continuous")` asks for. */
const freshSheet = (cursor: string) => ({ first: addDays(mondayOf(cursor), -7 * SHEET_WEEKS_BEFORE), count: SHEET_WEEKS });
const RANGE_DEBOUNCE_MS = 300;
/**
 * A tree path as one string, for a Map key or a React key only — joined on a
 * NUL because event names contain slashes and this must never merge two
 * different statistics into one row of the popover.
 */
const pathKey = (path: string[]) => path.join("\u0000");

/**
 * Actual, estimate and previous live in the row's hover tooltip, not in the
 * row (user decision, 2026-09-07): a Month cell is about 250 px wide, and
 * three numbers with labels left the title truncated to its first word. The
 * tooltip has room, so it uses the dictionary's own header names ("Consensus"
 * where the widget says so) and these defaults otherwise. The one value that
 * stays in the row is an amount, because for an auction the amount IS the
 * headline; it carries a currency sign rather than a label, since the data
 * dictionary has no currency field and the one amount this view knows, a
 * Treasury offering, is dollars.
 */
const TOOLTIP_FIELDS = ["actual", "consensus", "estimate", "previous"] as const;
const AMOUNT_FIELD = "offering_amount";
const DEFAULT_LABELS: Record<(typeof TOOLTIP_FIELDS)[number], string> = {
  actual: "Actual", consensus: "Consensus", estimate: "Estimate", previous: "Previous",
};

/** A YYYY-MM-DD day as en-GB text, read as a UTC date so no zone can move it. */
const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
const monthName = (day: string) => dayLabel(`${day.slice(0, 7)}-01`, { month: "short", year: "numeric" });
const dayName = (day: string) => dayLabel(day, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** The same date without its weekday: the week range prints two of these and
 *  the weekday is already the column header. Its own format rather than a
 *  slice of `dayName`, which leaves the comma's space behind. */
const dateName = (day: string) => dayLabel(day, { day: "numeric", month: "short", year: "numeric" });
function bizLabel(days: number[]): string {
  if (days.length === 7) return "All 7 days";
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  return run && days.length > 1 ? `${DOW[days[0] - 1]}–${DOW[days[days.length - 1] - 1]}` : days.map((d) => DOW[d - 1]).join(" ");
}
/**
 * The value column, formatted the way the table view formats the same cell:
 * through the widget's data dictionary (`data.table.columnsDefs`, so a
 * column's own formatterFn, decimalPlaces and abbreviate opt-out apply) and
 * the app's maximum-decimals setting. That is what turns 58000000000 into
 * 58B and keeps a percent column reading as one; the calendar adds nothing
 * of its own beyond the label.
 */
function present(row: Record<string, unknown>, f: string): boolean {
  return row[f] !== null && row[f] !== undefined && row[f] !== "";
}

/** One value, formatted as the table view formats the same cell (see `values` in the spec). */
function formatValue(row: Record<string, unknown>, f: string, table: TableSpec | undefined, maxDecimals: number): string {
  const column = table?.columns.find((c) => c.field === f);
  // Only an amount abbreviates (user decision, 2026-09-07): 1,779 continuing
  // claims is a count the reader compares against last week's, and "1.78K"
  // hides the digits that comparison needs. An amount's magnitude IS the
  // point, so $58B keeps the table's abbreviation unless the dictionary
  // opts that column out.
  const format = { ...cellFormat(column, table), abbreviate: f === AMOUNT_FIELD ? (column?.abbreviate ?? true) : false };
  return formatCell(row[f], f, maxDecimals, undefined, format);
}

/** The amount, the one value that stays in the row; empty when the row has none. */
function amountText(row: Record<string, unknown>, table: TableSpec | undefined, maxDecimals: number): string {
  return present(row, AMOUNT_FIELD) ? `$${formatValue(row, AMOUNT_FIELD, table, maxDecimals)}` : "";
}

/**
 * "Actual 162", "Estimate 56", "Previous 21": the tooltip lines, labelled by
 * the dictionary. An amount appears here too, in full — "Offering Amount
 * $58,000,000,000" — since the row shows it abbreviated (user decision,
 * 2026-09-07).
 */
function valueLines(row: Record<string, unknown>, table: TableSpec | undefined, maxDecimals: number): string[] {
  const labelOf = (f: string, fallback: string) => table?.columns.find((c) => c.field === f)?.headerName ?? fallback;
  const lines = TOOLTIP_FIELDS.filter((f) => present(row, f)).map(
    (f) => `${labelOf(f, DEFAULT_LABELS[f])} ${formatValue(row, f, table, maxDecimals)}`,
  );
  if (present(row, AMOUNT_FIELD)) {
    const column = table?.columns.find((c) => c.field === AMOUNT_FIELD);
    const full = formatCell(row[AMOUNT_FIELD], AMOUNT_FIELD, maxDecimals, undefined, { ...cellFormat(column, table), abbreviate: false });
    lines.push(`${labelOf(AMOUNT_FIELD, "Amount")} $${full}`);
  }
  return lines;
}

/**
 * The calendar view. Presentational: rows in, patches out. It owns its
 * toolbar the way the advanced chart owns ChartToolbar, so WidgetCard's
 * header stays the same width for every view.
 *
 * `timeZone` exists for the tests, which have to lay a day out for Tokyo
 * while jsdom sits in whatever zone the machine has; the app never passes it
 * and every Intl call then uses the system zone, which is the whole point.
 */
export function CalendarRenderer({
  rows, state, onPatch, onRange, readOnly = false, timeZone, table, range,
}: {
  rows: Array<Record<string, unknown>>;
  state: CalendarCardState;
  onPatch: (patch: Partial<CalendarCardState>) => void;
  onRange?: (window: { start_date: string; end_date: string }) => void;
  readOnly?: boolean;
  timeZone?: string;
  /** The widget's `data.table` dictionary, so values format as the table view formats them. */
  table?: TableSpec;
  /**
   * The widget's own `start_date` / `end_date` params, which Static draws and
   * no other mode reads. Absent when the widget declares no such params, and
   * either end may be blank when it declares them and the reader cleared one.
   */
  range?: { start?: string; end?: string };
}) {
  // Read here, not in WidgetCard, for the same reason TableRenderer reads it
  // itself: it is an app-wide display setting, not card state.
  const maxDecimals = useSettingsStore((s) => s.settings.maxDecimalPlaces);
  // One call answers "which of the four modes, drawn how" for both a card
  // written since the rework and one written before it; nothing below asks
  // `state.unit` again.
  const { mode, unit, rowUnit } = resolveMode(state);
  const cellMode: CalendarCellMode = state.cellMode ?? "list";
  const evenRows = state.evenRows ?? false;
  const businessDays = useMemo(() => sortedBusinessDays(state.businessDays), [state.businessDays]);
  const today = todayLocal(timeZone);
  const cursorRaw = state.cursor ?? today;
  // Where the cursor names one cell of its own — a Paged Day page, an agenda
  // row, a ribbon column — it can land on a day the grid does not draw, so it
  // is nudged forward to the next business day. Where it only names a week,
  // there is nothing to nudge: the week is drawn either way.
  const cursorIsACell = mode === "horizontal"
    || (mode === "paged" && unit === "day")
    || (mode === "vertical" && rowUnit === "day");
  const cursor = cursorIsACell && !businessDays.includes(isoWeekday(cursorRaw))
    ? stepCursor("day", cursorRaw, 1, businessDays)
    : cursorRaw;

  // The columns this payload actually has. An override is only honoured while
  // its column is one of them: a card that names a field a later payload
  // dropped (a provider rename, a different widget on the same card) would
  // otherwise bucket every row against a missing key and draw an empty grid.
  // Falling back to detection puts the calendar back on its feet by itself.
  // Every row's keys, not the first row's (review S-rend-3): a sparse field
  // the first row lacks is still a column an override may name.
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const dateField = state.dateField && columns.includes(state.dateField)
    ? state.dateField
    : detectDateColumn(rows);
  const titleField = dateField
    ? (state.titleField && columns.includes(state.titleField) ? state.titleField : detectTitleColumn(rows, dateField))
    : null;
  /**
   * The Type of the Type / Series filter: the column the kept values come
   * from, defaulting to the title column — on an earnings calendar that is
   * the ticker, which is what "the names I follow" means. A persisted field
   * this payload does not carry falls back the same way a column override
   * does, for the same reason: filtering on a missing key would keep no rows
   * at all and leave the reader an empty grid with no way to see why.
   */
  const seriesField = state.seriesField && columns.includes(state.seriesField)
    ? state.seriesField
    : titleField ?? dateField ?? "";
  // The Type select's own options are every column but the date one — but
  // when there is no title column, `seriesField` above falls all the way to
  // the date column itself, which those options exclude. Folding the current
  // value in when it is missing keeps the select from ever holding a value
  // it has no <option> for.
  const seriesTypeOptions = columns.filter((c) => c !== dateField);
  if (seriesField && !seriesTypeOptions.includes(seriesField)) seriesTypeOptions.push(seriesField);
  /**
   * Which filter this payload gets. A row that carries a non-empty `source`
   * has been classified by the provider (openbq-eodhd 9.0.0; the donor openbb-eodhd from 9.6.0), and
   * for those rows the three-level tree IS the filter — Type is fixed to the
   * event column and Series becomes the tree. Everything else, an earnings
   * calendar above all, keeps Type / Series: a taxonomy of tickers is a
   * watchlist, not a tree. One row carrying a source is enough, so a payload
   * the index only half knows still gets the tree, with the rest under Other.
   */
  const treeActive = useMemo(() => rows.some((r) => typeof r.source === "string" && r.source !== ""), [rows]);
  // The tree's third level is the title column's own value, so the tree and
  // the cells can never disagree about what a statistic is called.
  const treeTitleField = titleField ?? dateField ?? "";
  // The filter runs before anything is bucketed, so every count, every hint
  // and Static's row-derived span all speak about the rows the reader kept.
  const filtered = useMemo(
    () => (treeActive
      ? filterTree(rows, state.exclude, state.include, treeTitleField)
      : filterSeries(rows, seriesField, state.series)),
    [treeActive, rows, state.exclude, state.include, treeTitleField, seriesField, state.series],
  );
  // The tree is built from every row, not from the filtered ones: a source
  // the reader has just unticked has to stay in the tree, or there would be
  // no box left to tick it back on with.
  const tree = useMemo(() => (treeActive ? buildTree(rows, treeTitleField) : []), [treeActive, rows, treeTitleField]);
  // The datalist behind the Series box offers what the payload actually
  // contains — all of it, not just what survives the current filter, since
  // the reader is usually there to add a name. Memoised because it walks
  // every row and the toolbar re-renders on every cursor step.
  const seriesOptions = useMemo(
    () => (treeActive ? [] : distinctValues(rows, seriesField)),
    [treeActive, rows, seriesField],
  );
  const seriesListId = useId();
  const buckets = useMemo(
    () => (dateField ? bucketRows(filtered, dateField, titleField ?? dateField, timeZone) : new Map<string, CalendarEvent[]>()),
    [filtered, dateField, titleField, timeZone],
  );

  /**
   * Whether a row of this mode is one day (Vertical's agenda, Horizontal's
   * ribbon) or a week of columns (Paged, Static, Vertical's weeks). It decides
   * what the sheet is counted in, whether the day-of-week header means
   * anything, and which element the landing effect looks for.
   */
  const dayRows = mode === "horizontal" || (mode === "vertical" && rowUnit === "day");
  // Both sheets, weeks and days alike, open on the same seven weeks: one
  // before the cursor's week, the cursor's week, five after (SHEET_WEEKS in
  // calendarView). That is the window they fetch, and the two have to match
  // (user ruling, 2026-10-18): a row drawn outside the fetched window is a
  // blank row that only looks like a quiet day. The old sheet was eighteen
  // weeks, and its fetch six months of every symbol, which ran past the
  // gateway's 55 s.
  // The endless modes keep their own sheet, in weeks whichever way it is
  // drawn; it grows at the edges as the reader scrolls and resets when the
  // cursor, the mode or the business set changes.
  const [sheet, setSheet] = useState(() => freshSheet(cursor));
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const ribbonRef = useRef<HTMLDivElement | null>(null);
  // sheetScroll's prepend branch stashes the box's height — or, in
  // Horizontal, its width — here before the six new weeks are asked for
  // (null: no prepend pending); the layout effect below puts the reader back
  // where they were once React has committed them. One ref serves both axes
  // because only one endless box exists at a time: a mode is vertical or
  // horizontal, never both.
  const prepend = useRef<number | null>(null);
  const growSheet = (before: boolean) =>
    setSheet((s) => (before ? { first: addDays(s.first, -7 * CONT_WEEKS), count: s.count + CONT_WEEKS } : { ...s, count: s.count + CONT_WEEKS }));
  // Home and Today both patch `{ cursor: today }`. In Vertical and Horizontal
  // nothing else moves the cursor, so after a plain scroll (no cursor change)
  // that patch is value-identical to what is already in state — React sees no
  // prop change and none of the effects below, all keyed on `cursor`, run
  // again. This counter is what a re-land bumps instead: it always changes,
  // so an effect that also keys on it fires every time, whether or not the
  // cursor came along for the ride.
  const [landing, setLanding] = useState(0);
  useLayoutEffect(() => {
    // Only the endless modes have a sheet, so only they reset one; Paged reads
    // `weeks` from gridWeeks and Static from staticWeeks, and neither of them
    // ever looks at this state. `landing` rides along so a re-land after a
    // long scroll resets the sheet to the cursor's neighbourhood even when the
    // cursor itself did not move — otherwise Today could land the view on a
    // sheet that grew away from today and no longer contains it.
    if (mode !== "vertical" && mode !== "horizontal") return;
    const fresh = freshSheet(cursor);
    setSheet((s) => (s.first === fresh.first && s.count === fresh.count ? s : fresh));
  }, [mode, cursor, businessDays, landing]);

  /**
   * Where the Vertical box is scrolled to, both cases, in one layout effect
   * so the position is right before the browser paints:
   *
   * - After a prepend, the six rows added above must not shove the view, so
   *   the reader is scrolled down by exactly how much the box grew. This
   *   cannot be done from the scroll handler: that handler runs in the same
   *   frame as the event, before React has committed setSheet, so the growth
   *   measured there — even inside a requestAnimationFrame — is still zero.
   *   Chrome's scroll anchoring hides that mistake; WebKit, which is what
   *   Tauri renders in, has none, and the view jumps a page every prepend.
   * - Otherwise the sheet is fresh: one week sits above the cursor's week, so
   *   without this the reader lands a week in the past. The cursor's week
   *   goes to the top of the box, which is what the spec asks for.
   *
   * `landing` is in the deps for the same reason it is on the sheet-reset
   * effect above: Home patches `{ cursor: today }`, which after a plain
   * scroll is already the value in state, so this effect would otherwise
   * never re-run and the box would stay scrolled away from today.
   */
  useLayoutEffect(() => {
    const box = gridRef.current;
    if (mode !== "vertical" || !box || settlePrepend(box, "y", prepend)) return;
    // The row that carries the cursor: a week row keyed by its Monday, or, in
    // the agenda, the cursor's own day.
    const row = box.querySelector<HTMLElement>(rowUnit === "day"
      ? `.calendar-agenda-row[data-day="${cursor}"]`
      : `.calendar-week[data-week="${mondayOf(cursor)}"]`);
    if (!row) return;
    // This write queues its own scroll event, but that event only arrives on a
    // later frame — nothing runs between the write and here for a flag to
    // guard, so the prepend branch above needs no help staying out of the way.
    // What actually keeps that later event from prepending is that the
    // cursor's week sits one row down — five agenda rows, five ribbon columns
    // — and even one week row is taller than CONT_EDGE.
    box.scrollTop = row.offsetTop - box.offsetTop;
  }, [mode, rowUnit, cursor, sheet.first, landing]);

  /**
   * Horizontal's half of exactly the same story, on the other axis: after a
   * left-hand prepend the reader is pushed right by however much wider the
   * ribbon got, and otherwise the cursor's column goes to the left edge. The
   * measurement is stashed in the scroll handler and applied here for the
   * reason spelled out above — a handler runs before React has committed the
   * new columns, so what it measures is always zero growth.
   *
   * `landing` is in the deps for the same reason as Vertical's: Today patches
   * `{ cursor: today }`, which after a plain scroll of the ribbon is already
   * the value in state, so without it this effect would never re-run and
   * `scrollLeft` would stay wherever the reader had scrolled it.
   */
  useLayoutEffect(() => {
    const box = ribbonRef.current;
    if (mode !== "horizontal" || !box || settlePrepend(box, "x", prepend)) return;
    const col = box.querySelector<HTMLElement>(`.calendar-col[data-day="${cursor}"]`);
    if (!col) return;
    box.scrollLeft = col.offsetLeft - box.offsetLeft;
  }, [mode, cursor, sheet.first, landing]);

  /**
   * A seven-week sheet can be shorter than its box: seven bare week rows are
   * about 640 px, and a tall card shows all of them with room to spare. A box
   * with nothing to scroll fires no scroll event, so sheetScroll would never
   * get the chance to grow it, and the reader could not reach the eighth
   * week at all. So after every landing and every growth, a sheet whose
   * trailing edge is already within CONT_EDGE of view grows by itself, until
   * the box can scroll. It runs after the two landing effects so it measures
   * where they left the box, and a box with no size (hidden, or jsdom) is
   * left alone — it has no edge to be near.
   */
  useLayoutEffect(() => {
    const box = mode === "vertical" ? gridRef.current : mode === "horizontal" ? ribbonRef.current : null;
    if (!box) return;
    const [pos, size, view] = extent(box, mode === "horizontal" ? "x" : "y");
    if (view > 0 && size - pos - view < CONT_EDGE) setSheet((s) => ({ ...s, count: s.count + CONT_WEEKS }));
  }, [mode, rowUnit, sheet.first, sheet.count, landing]);

  // The day-shaped modes lay their cells out one per business day across the
  // sheet's span; the week-shaped ones lay them out in rows of weeks. Only one
  // of the two is ever drawn, so only one is ever built.
  const days = dayRows
    ? businessDaysBetween(sheet.first, addDays(sheet.first, 7 * sheet.count - 1), businessDays)
    : [];
  /**
   * Static's span: the widget's own params when it declares both and neither
   * is blank, and otherwise the span of the rows it returned (the spec's rule
   * — the parameter panel is the control, and a widget without the params
   * shows what it has). A payload with no rows and no params falls back to
   * today, so the mode still draws a week rather than nothing. A bound that
   * is not a `YYYY-MM-DD` date (a typed "abc") counts as blank: staticWeeks
   * would otherwise throw on it, or walk weeks toward year 10000.
   */
  const paramRange = BARE_DATE.test(range?.start ?? "") && BARE_DATE.test(range?.end ?? "");
  const rowDays = mode === "static" && !paramRange ? [...buckets.keys()].sort() : [];
  const staticFrom = paramRange ? range!.start! : rowDays[0] ?? today;
  const staticTo = paramRange ? range!.end! : rowDays[rowDays.length - 1] ?? today;

  const weeks = mode === "static" ? staticWeeks(staticFrom, staticTo, businessDays)
    : mode === "paged" ? gridWeeks(unit, cursor, businessDays)
    : mode === "vertical" && rowUnit === "week" ? continuousWeeks(sheet.first, sheet.count, businessDays)
    : [];
  const lastWeek = weeks[weeks.length - 1];
  const rangeFrom = dayRows ? days[0] ?? cursor : weeks[0]?.[0] ?? cursor;
  const rangeTo = dayRows ? days[days.length - 1] ?? cursor : lastWeek?.[lastWeek.length - 1] ?? cursor;
  const hidden = hiddenEventCount(buckets, mondayOf(rangeFrom), addDays(mondayOf(rangeTo), 6), businessDays);

  // The fetch window follows the settled cursor, debounced so a run of wheel
  // steps costs one request, not one per step. Static asks for nothing at all:
  // its range IS the widget's params, so pushing one back would fight the
  // parameter panel for them.
  useEffect(() => {
    if (!onRange || mode === "static") return;
    // Paged asks for its page plus one unit either side. The endless modes
    // ask for their sheet, first Monday to last Sunday, whether they draw it
    // as rows or as columns: it opens on fetchWindow("continuous"), and every
    // growth at an edge re-pushes the whole grown sheet, so no row is ever
    // drawn for a date that was not asked for (user ruling, 2026-10-18). One
    // request per growth, and the debounce folds a run of them into one.
    const span = mode === "paged"
      ? fetchWindow(unit, cursor)
      : { start_date: sheet.first, end_date: addDays(sheet.first, 7 * sheet.count - 1) };
    const timer = setTimeout(() => onRange(span), RANGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onRange, mode, unit, cursor, sheet.first, sheet.count]);

  const step = (n: number) => onPatch({ cursor: stepCursor(unit, cursor, n, businessDays) });
  const stepper = useRef(createWheelStepper());
  // Native, non-passive listener rather than an onWheel prop: React (17+,
  // and this repo is 19) registers its root `wheel` listener as passive, so
  // `preventDefault` called from an onWheel handler is a no-op — the ancestor
  // card/dashboard scrolls anyway even as the grid steps a unit. Only a
  // listener attached with `{ passive: false }` can actually capture it.
  //
  // It sits on the sheet — the day-of-week header plus the grid — rather than
  // the grid alone: in a busy month nearly every target inside the grid is a
  // cell list that owns its own wheel (correctly), which left the reader with
  // almost nowhere to step from. The toolbar stays outside the sheet on
  // purpose; it holds selects and the business-day popover, which scroll on
  // their own terms.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || readOnly || mode !== "paged") return;
    function handler(e: WheelEvent) {
      // A cell that can scroll owns its wheel; see the spec's "Wheel" rule.
      const list = (e.target as HTMLElement).closest(".calendar-list");
      if (list && list.scrollHeight > list.clientHeight) return;
      e.preventDefault();
      const dir = stepper.current(e.deltaY, Date.now());
      if (dir !== 0) onPatch({ cursor: stepCursor(unit, cursor, dir, businessDays) });
    }
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [readOnly, mode, unit, cursor, businessDays, onPatch]);

  /**
   * Horizontal's wheel, and the reason it exists: a mouse has no horizontal
   * wheel, and a ribbon that only answers Shift+wheel reads as broken. So a
   * vertical wheel over the ribbon moves the ribbon sideways — unless its
   * target is a cell that can scroll, which owns its own wheel exactly as in
   * Paged. Native and non-passive for the same reason the listener above is:
   * `preventDefault` from a React onWheel is a no-op, and without it the card
   * and the dashboard behind the ribbon scroll as well.
   */
  useEffect(() => {
    const el = ribbonRef.current;
    if (!el || readOnly || mode !== "horizontal") return;
    // An arrow, not a `function` declaration: a hoisted declaration is typed
    // where it is hoisted to, which is above the null guard, so `el` would
    // still read as possibly null inside it.
    const handler = (e: WheelEvent) => {
      const list = (e.target as HTMLElement).closest(".calendar-list");
      if (list && list.scrollHeight > list.clientHeight) return;
      // A trackpad's sideways gesture is already `deltaX`, and the box scrolls
      // itself with it; there is nothing to map and nothing to capture.
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [readOnly, mode]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // An endless mode has no cursor motion — stepCursor returns the cursor
    // unchanged — so handling an arrow there would only call preventDefault on
    // the key the reader was using to scroll the box, and write a no-op patch.
    // Static has no cursor at all. Home still re-lands the endless modes on
    // today: patching the cursor resets the sheet, and the landing effect does
    // the rest.
    if (readOnly || mode === "static") return;
    if (mode === "paged" && (e.key === "ArrowDown" || e.key === "ArrowRight")) { e.preventDefault(); step(1); }
    else if (mode === "paged" && (e.key === "ArrowUp" || e.key === "ArrowLeft")) { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); onPatch({ cursor: today }); setLanding((n) => n + 1); }
  }

  /**
   * The Series box, committed rather than live: a keystroke filter would
   * rewrite the card's persisted state on every letter of "AAPL". Enter and
   * blur both commit, which is what a comma list wants — the reader finishes
   * typing, then leaves. An entry that trims to nothing is dropped, so a
   * cleared box patches an empty list, which IS "no filter".
   *
   * The box used to be uncontrolled, `key`-remounted whenever `seriesText`
   * changed so a patch coming back in as a prop would reseed it. But a key
   * change unmounts and remounts the DOM node, which drops focus — so
   * `NVDA, TSLA{Enter}` committed correctly and then ate every keystroke
   * typed right after, because the input the reader thought they were still
   * in no longer existed. A controlled `draft` fixes that: typing only
   * updates local state (no patch, no remount), and the draft re-syncs to
   * the outside value — an import, a Type switch that clears `series`,
   * another card's copy of this state — without remounting, by comparing
   * against the previous render's `seriesText` (the "previous prop" pattern:
   * https://react.dev/learn/you-might-not-need-an-effect, no `useEffect`
   * needed since this only ever reacts to a prop, never a side effect).
   */
  const seriesText = state.series?.join(", ") ?? "";
  const [prevSeriesText, setPrevSeriesText] = useState(seriesText);
  const [seriesDraft, setSeriesDraft] = useState(seriesText);
  if (seriesText !== prevSeriesText) {
    setPrevSeriesText(seriesText);
    setSeriesDraft(seriesText);
  }
  function commitSeries(text: string) {
    onPatch({ series: text.split(",").map((s) => s.trim()).filter((s) => s !== "") });
  }

  /**
   * The tree popover's own state: whether it is open, and which nodes are
   * expanded. Sources open collapsed — twenty-odd of them is a list, not a
   * wall — except the ones a rule speaks about, since those are exactly what
   * the reader came to check. Seeded once, from the card's rules at mount:
   * expanding is a reading gesture, not card state, and nothing persists it.
   */
  const [treeOpen, setTreeOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    const open = new Set<string>();
    for (const rule of [...(state.exclude ?? []), ...(state.include ?? [])]) {
      // The rule's own node (so a source with a rule on it is open) and the
      // ancestors it hangs under.
      open.add(pathKey(rule.slice(0, 1)));
      if (rule.length >= 2) open.add(pathKey(rule.slice(0, 2)));
    }
    return open;
  });
  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
  // Escape closes the popover from anywhere, which is why it is a document
  // listener and not an onKeyDown on the popover: Reset disables itself the
  // moment it clears the last rule, and a disabled button drops focus to the
  // body — so the one keystroke most likely to follow a Reset would have had
  // nothing left inside the popover to bubble through.
  useEffect(() => {
    if (!treeOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTreeOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [treeOpen]);
  function toggleNode(node: TreeNode) {
    const { allowed, total } = treeCounts(node, state.exclude, state.include);
    onPatch(toggleTreePath(node.path, state.exclude, state.include, allowed === total));
  }
  const treeFiltering = (state.exclude?.length ?? 0) + (state.include?.length ?? 0) > 0;

  const [bizOpen, setBizOpen] = useState(false);
  function toggleDay(d: number) {
    const next = businessDays.includes(d) ? businessDays.filter((x) => x !== d) : [...businessDays, d];
    if (next.length === 0) return; // the last column stays; the lib guard covers files
    onPatch({ businessDays: sortedBusinessDays(next) });
  }

  if (!dateField) {
    return <p className="empty-state">No date column in these rows, so there is nothing to lay out on a calendar.</p>;
  }

  // Static's label is its span, because that span is the whole of what the
  // mode shows; the endless modes have no page to name, so they say so.
  const rangeLabel = mode === "static" ? `${dateName(staticFrom)} – ${dateName(staticTo)}`
    : mode !== "paged" ? "scrolling"
    : unit === "month" ? monthName(cursor)
    : unit === "day" ? dayName(cursor)
    : `${dateName(weeks[0][0])} – ${dateName(weeks[0][weeks[0].length - 1])}`;

  /**
   * The sizing class the CSS keys off. Vertical's week sheet keeps the
   * historical `continuous` name rather than gaining one of its own: it IS
   * the old Continuous grid, and every rule written for it — the endless box,
   * the 150 px even row — still applies unchanged.
   */
  const gridClass = mode === "paged" ? `calendar-unit-${unit}`
    : mode === "static" ? "calendar-unit-static"
    : rowUnit === "day" ? "calendar-unit-agenda"
    : "calendar-unit-continuous";
  // A timeline axis in a short cell labels every third hour and a tall one
  // labels every hour: only Paged's Week and Day pages and Horizontal's
  // full-height columns are tall.
  const compactCells = mode === "paged" ? unit === "month" : mode !== "horizontal";

  /**
   * One day's cell, the same in every mode: the day's head, then its events in
   * the chosen cell mode. Only the head's labels and one wrapper class differ
   * between a month square, an agenda row and a ribbon column, so the three
   * grids share this rather than each carrying a copy of it.
   */
  function dayCell(day: string, opts: { out?: boolean; showMonth?: boolean; weekday?: boolean; className?: string }) {
    const events = buckets.get(day) ?? [];
    return (
      <div
        key={day}
        data-testid={`cal-cell-${day}`}
        data-day={day}
        className={`calendar-cell${opts.className ? ` ${opts.className}` : ""}${day === today ? " calendar-cell-today" : ""}${opts.out ? " calendar-cell-out" : ""}`}
      >
        <div className="calendar-day">
          <b>
            {opts.weekday ? `${DOW[isoWeekday(day) - 1]} ` : null}
            {opts.showMonth ? <span className="calendar-mon">{monthName(day).slice(0, 3)} </span> : null}
            {Number(day.slice(8))}
          </b>
          <span className="calendar-count">{events.length > 0 ? events.length : ""}</span>
        </div>
        {cellMode === "timeline"
          ? <CalendarTimeline events={events} day={day} today={today} compact={compactCells} timeZone={timeZone} table={table} maxDecimals={maxDecimals} />
          : <CalendarList events={events} timeZone={timeZone} table={table} maxDecimals={maxDecimals} />}
      </div>
    );
  }

  return (
    <div className="calendar">
      {readOnly ? null : (
        <div className="calendar-toolbar">
          <Seg label="Mode" options={MODES.map((m) => [m, capital(m)] as const)} value={mode} onPick={(m) => onPatch({ mode: m })} />
          {/* The mode leads, then that mode's own controls: Paged's pages,
              Vertical's row unit, and for Static nothing but the label — its
              range comes from the parameter panel. */}
          {mode === "paged" ? (
            <Seg label="Unit" options={UNITS.map((u) => [u, capital(u)] as const)} value={unit} onPick={(u) => onPatch({ unit: u })} />
          ) : null}
          {mode === "vertical" ? (
            <Seg label="Row unit" options={[["week", "Weeks"], ["day", "Days"]] as const} value={rowUnit} onPick={(u) => onPatch({ rowUnit: u })} />
          ) : null}
          <div className="calendar-nav">
            {mode === "paged" ? <button type="button" aria-label="Previous" onClick={() => step(-1)}>‹</button> : null}
            <span className="calendar-range">{rangeLabel}</span>
            {mode === "static" ? null : (
              <button type="button" onClick={() => { onPatch({ cursor: today }); setLanding((n) => n + 1); }}>Today</button>
            )}
            {mode === "paged" ? <button type="button" aria-label="Next" onClick={() => step(1)}>›</button> : null}
          </div>
          <Seg label="Cell mode" options={[["list", "List"], ["timeline", "Timeline"]] as const} value={cellMode} onPick={(c) => onPatch({ cellMode: c })} />
          {/* Classified rows get the tree; everything else keeps Type /
              Series. The two never show together: on an economic calendar
              the Type IS the event column and the Series IS the tree, so a
              text box beside it would be a second way to say the same thing
              with worse spelling. */}
          {treeActive ? (
            <div className="calendar-tree">
              <button
                type="button"
                className="card-action"
                aria-expanded={treeOpen}
                onClick={() => setTreeOpen((o) => !o)}
              >
                {/* Rows kept of rows received, on the button itself, for the
                    reason the Series count exists: a filter that keeps
                    nothing looks exactly like a backend that returned
                    nothing. */}
                {treeFiltering ? `Filter · ${filtered.length} of ${rows.length}` : "Filter"}
              </button>
              {treeOpen ? (
                <div className="calendar-tree-pop">
                  {/* A group, not role="tree": a tree promises arrow-key
                      navigation between its items, and this one is Tab
                      through real checkboxes and buttons, which announce
                      themselves — including each twisty's Expand/Collapse. */}
                  <div role="group" aria-label="Filter" className="calendar-tree-list">
                    <CalendarTree
                      nodes={tree}
                      exclude={state.exclude}
                      include={state.include}
                      expanded={expanded}
                      onExpand={toggleExpanded}
                      onToggle={toggleNode}
                    />
                  </div>
                  <button
                    type="button"
                    className="calendar-tree-reset"
                    disabled={!treeFiltering}
                    onClick={() => onPatch({ exclude: [], include: [] })}
                  >
                    Reset
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
          /* Type, then Series: the column the values come from, then the
             values themselves. The box is a controlled `draft` — see the
             comment above `commitSeries` for why it stopped being an
             uncontrolled, `key`-remounted input. */
          <div className="calendar-series">
            {/* Switching Type starts a new column unfiltered: a Series list
                chosen under the old column (say, tickers under `symbol`) is
                nonsense against the new one (`announce_time`), and leaving it
                in place silently filtered the grid to "0 of N" with no clue
                why. Clearing `series` alongside `seriesField` is the fix; the
                draft below re-syncs to the same empty string once this patch
                round-trips back in as `state.series`. */}
            <select
              aria-label="Type"
              value={seriesField}
              onChange={(e) => onPatch({ seriesField: e.target.value, series: [] })}
            >
              {seriesTypeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              aria-label="Series"
              list={seriesListId}
              value={seriesDraft}
              onChange={(e) => setSeriesDraft(e.target.value)}
              title="Comma-separated values of the Type column; blank shows everything."
              onKeyDown={(e) => { if (e.key === "Enter") commitSeries(e.currentTarget.value); }}
              onBlur={(e) => commitSeries(e.target.value)}
            />
            <datalist id={seriesListId}>
              {seriesOptions.map((v) => <option key={v} value={v} />)}
            </datalist>
          </div>
          )}
          <label className="calendar-check">
            <input type="checkbox" checked={evenRows} onChange={(e) => onPatch({ evenRows: e.target.checked })} />
            Even rows
          </label>
          {/* Rows kept of rows received: without it a filter that matches
              nothing looks exactly like a backend that returned nothing. */}
          {!treeActive && state.series && state.series.length > 0 ? (
            <span className="calendar-series-count">{`${filtered.length} of ${rows.length}`}</span>
          ) : null}
          <div className="calendar-biz">
            <button type="button" className="card-action" aria-expanded={bizOpen} onClick={() => setBizOpen((o) => !o)}>
              {bizLabel(businessDays)}
            </button>
            {bizOpen ? (
              <div className="calendar-biz-pop" role="group" aria-label="Business days">
                {DOW.map((name, i) => (
                  <label key={name}>
                    <span>{name}</span>
                    <input type="checkbox" aria-label={name} checked={businessDays.includes(i + 1)} onChange={() => toggleDay(i + 1)} />
                  </label>
                ))}
                <p className="calendar-biz-hint">
                  {hidden === 0 ? "No events on hidden days in this range"
                    : `${hidden} event${hidden === 1 ? "" : "s"} fall${hidden === 1 ? "s" : ""} on hidden days in this range`}
                </p>
                <label className="calendar-biz-col">
                  Date column
                  <select value={dateField} onChange={(e) => onPatch({ dateField: e.target.value })}>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="calendar-biz-col">
                  Title column
                  <select value={titleField ?? ""} onChange={(e) => onPatch({ titleField: e.target.value })}>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <div className="calendar-sheet" ref={sheetRef}>
        {/* A day-shaped mode has no weekday columns to head: its own cells
            carry their weekday. */}
        {dayRows ? null : (
          <div className="calendar-dow" role="row" style={{ gridTemplateColumns: `repeat(${businessDays.length}, minmax(0, 1fr))` }}>
            {businessDays.map((d) => <div key={d} role="columnheader">{DOW[d - 1]}</div>)}
          </div>
        )}
        {mode === "horizontal" ? (
          <div
            ref={ribbonRef}
            className="calendar-ribbon"
            role="grid" aria-label="Calendar dates"
            data-testid="cal-grid"
            tabIndex={readOnly ? -1 : 0}
            onKeyDown={onKeyDown}
            onScroll={(e) => sheetScroll(e.currentTarget, "x", prepend, growSheet)}
          >
            {days.map((day) => dayCell(day, {
              weekday: true,
              showMonth: day.slice(8) === "01" || day === days[0],
              className: "calendar-col",
            }))}
          </div>
        ) : (
        <div
          ref={gridRef}
          role="grid" aria-label="Calendar dates"
          className={`calendar-grid ${gridClass}${evenRows ? " calendar-even" : ""}${cellMode === "timeline" ? " calendar-timeline" : ""}`}
          data-testid="cal-grid"
          tabIndex={readOnly ? -1 : 0}
          onKeyDown={onKeyDown}
          onScroll={mode === "vertical" ? (e) => sheetScroll(e.currentTarget, "y", prepend, growSheet) : undefined}
        >
          {/* Vertical's agenda: one full-width row per business day, the row
              carrying the day so the landing effect can find it the way the
              week sheet's data-week is found. */}
          {mode === "vertical" && rowUnit === "day"
            ? days.map((day) => (
              <div key={day} className="calendar-agenda-row" data-day={day}>
                {dayCell(day, { weekday: true, showMonth: day.slice(8) === "01" || day === days[0] })}
              </div>
            ))
            : /* data-week carries the row's Monday so the Continuous layout effect
                 can find the cursor's row to land on, without a ref per week. It's
                 derived from the row's first drawn day rather than read off it
                 directly, because that first day is not Monday when Monday itself
                 is toggled off as a business day. */
            weeks.map((week) => (
              <div key={week[0]} data-week={mondayOf(week[0])} className="calendar-week" style={{ gridTemplateColumns: `repeat(${week.length}, minmax(0, 1fr))` }}>
                {week.map((day) => {
                  const outOfMonth = mode === "paged" && unit === "month" && firstOfMonth(day, 0) !== firstOfMonth(cursor, 0);
                  // Static dims what the widget's range does not cover, the way
                  // Month dims a neighbouring month's days: the row shape is
                  // whole weeks, and the range rarely starts on a Monday.
                  const outOfRange = mode === "static" && (day < staticFrom || day > staticTo);
                  // The spec's rule: the first cell of each month, and the first
                  // cell of each row. The old `|| unit !== "month"` printed the
                  // month in every cell of every Continuous, Week and Day grid.
                  // Month keeps its name in the toolbar, so only its row-first
                  // cells that belong to a neighbouring month need one.
                  const showMonth = day.slice(8) === "01"
                    || (day === week[0] && (mode !== "paged" || unit !== "month" || outOfMonth));
                  return dayCell(day, { out: outOfMonth || outOfRange, showMonth });
                })}
              </div>
            ))}
        </div>
        )}
      </div>
    </div>
  );
}

/**
 * One tri-state box. `indeterminate` is a DOM property with no HTML attribute
 * and no React prop, so it has to be written to the node itself; `aria-checked
 * ="mixed"` is what says the same thing to a screen reader, and neither is
 * derivable from the other.
 */
function TriBox({ label, allowed, total, onChange }: {
  label: string; allowed: number; total: number; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const mixed = allowed > 0 && allowed < total;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-checked={mixed ? "mixed" : allowed === total}
      checked={allowed === total}
      onChange={onChange}
    />
  );
}

/**
 * The tree itself: Source → Release → Statistic, one row per node, recursing
 * into its own children. Every level is the same row — a twisty where there
 * is something to open, a tri-state box, the name, the row count — because
 * every level is the same decision at a different grain.
 */
function CalendarTree({ nodes, exclude, include, expanded, onExpand, onToggle }: {
  nodes: TreeNode[];
  exclude?: string[][];
  include?: string[][];
  expanded: Set<string>;
  onExpand: (key: string) => void;
  onToggle: (node: TreeNode) => void;
}) {
  return nodes.map((node) => {
    const key = pathKey(node.path);
    const open = expanded.has(key);
    const { allowed, total } = treeCounts(node, exclude, include);
    const branch = node.children.length > 0;
    return (
      <div
        key={key}
        className={`calendar-tree-node calendar-tree-l${node.path.length}`}
      >
        <div className="calendar-tree-row">
          {branch ? (
            <button
              type="button"
              className="calendar-tree-twisty"
              aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
              onClick={() => onExpand(key)}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : <span className="calendar-tree-twisty" />}
          {/* The label wraps the box and the name so the name IS the box's
              accessible name; the count sits outside it, or every box would
              be called "EIA 154". */}
          <label>
            <TriBox label={node.name} allowed={allowed} total={total} onChange={() => onToggle(node)} />
            <span className="calendar-tree-name">{node.name}</span>
          </label>
          <span className="calendar-tree-count">{node.count}</span>
        </div>
        {branch && open ? (
          <div role="group" className="calendar-tree-kids">
            <CalendarTree
              nodes={node.children}
              exclude={exclude}
              include={include}
              expanded={expanded}
              onExpand={onExpand}
              onToggle={onToggle}
            />
          </div>
        ) : null}
      </div>
    );
  });
}

/**
 * A stock logo before a title that is an EODHD symbol (`AAPL.US`), from the
 * public static path episode 9 documents under *Stock logos*: no token, no
 * credit. Anything that is not a dotted symbol draws nothing, so an economic
 * release or an auction term is untouched. Same discipline as the table's
 * logo column: lazy, no alt text to duplicate the title, and a missing file
 * hides itself rather than showing a broken-image glyph.
 */
function Logo({ title }: { title: string }) {
  const src = eodhdLogoUrl(title);
  if (!src) return null;
  return (
    <img
      // Keyed by the URL (review S-rend-1): a failed logo is hidden on the
      // element itself, and the list reuses elements by index, so without a
      // fresh element the next symbol drawn here would stay hidden.
      key={src}
      className="calendar-logo"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function CalendarList({ events, timeZone, table, maxDecimals }: {
  events: CalendarEvent[]; timeZone?: string; table?: TableSpec; maxDecimals: number;
}) {
  if (events.length === 0) return <div className="calendar-list calendar-empty">—</div>;
  return (
    <ul className="calendar-list">
      {events.map((e, i) => {
        const clock = e.time.kind === "instant" ? localClock(e.time.at, timeZone) : null;
        const hasEstimate = e.row.consensus !== undefined && e.row.consensus !== null || e.row.estimate !== undefined && e.row.estimate !== null;
        return (
          <li
            key={i}
            className={`calendar-ev${hasEstimate ? " calendar-ev-est" : ""}`}
            title={[e.title, ...valueLines(e.row, table, maxDecimals)].join("\n")}
          >
            <span className={`calendar-t${clock ? "" : " calendar-t-allday"}`}>{clock ? `${clock.hh}:${clock.mm}` : "ALL DAY"}</span>
            <span className="calendar-n"><Logo title={e.title} />{e.title}</span>
            <span className="calendar-v">{amountText(e.row, table, maxDecimals)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Same-instant releases share a block in Week and Day; in the shorter month cell, the same half hour does. */
const COMPACT_SLOT_MS = 30 * 60_000;

/**
 * A vertical hour axis inside the cell. The window fits the day's events,
 * an hour of air each side, and is never narrower than 08:00–17:00, so a
 * quiet day still reads as a working day rather than a single dot. The
 * 08:30 print is one moment, not eleven rows: events at the same instant
 * (or, in a compact cell, the same half hour) share one block with a ×N
 * badge and the full list in the hover title.
 */
function CalendarTimeline({ events, day, today, compact, timeZone, table, maxDecimals }: {
  events: CalendarEvent[]; day: string; today: string; compact: boolean; timeZone?: string;
  table?: TableSpec; maxDecimals: number;
}) {
  const now = useMinuteTick();
  const allDay = events.filter((e) => e.time.kind === "allday");
  const timed = events.filter((e): e is CalendarEvent & { time: { kind: "instant"; at: Date } } => e.time.kind === "instant");
  const fracs = timed.map((e) => localClock(e.time.at, timeZone).frac);
  const lo = Math.max(0, Math.min(8, ...fracs.map((f) => Math.floor(f) - 1)));
  const hi = Math.min(24, Math.max(17, ...fracs.map((f) => Math.ceil(f) + 1)));
  const y = (frac: number) => `${((frac - lo) / (hi - lo)) * 100}%`;

  const slot = compact ? COMPACT_SLOT_MS : 1;
  const groups = new Map<number, typeof timed>();
  for (const e of timed) {
    const key = Math.floor(e.time.at.getTime() / slot) * slot;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(e);
  }
  const hours: number[] = [];
  for (let h = lo; h <= hi; h++) hours.push(h);
  const isToday = day === today && localDate(now, timeZone) === day;

  return (
    <div className={`calendar-tl-wrap${compact ? " calendar-tl-compact" : ""}`}>
      {allDay.length > 0 ? (
        <div className="calendar-allday">
          {allDay.map((e, i) => <span key={i} className="calendar-chip" title={e.title}><Logo title={e.title} />{e.title}</span>)}
        </div>
      ) : null}
      <div className="calendar-tl">
        {hours.map((h) => (
          <div key={h} className="calendar-hour" data-testid="cal-hour" style={{ top: y(h) }}>
            {!compact || (h - lo) % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </div>
        ))}
        {[...groups.values()].map((g) => {
          const lead = g.find((e) => e.row.consensus != null || e.row.estimate != null) ?? g[0];
          const clock = localClock(g[0].time.at, timeZone);
          return (
            <div
              key={g[0].time.at.getTime()}
              className="calendar-block"
              data-testid="cal-block"
              style={{ top: `calc(${y(clock.frac)} + 1px)` }}
              title={g.map((e) => [e.title, ...valueLines(e.row, table, maxDecimals)].join(" · ")).join("\n")}
            >
              {clock.hh}:{clock.mm} <Logo title={lead.title} />{lead.title}
              {g.length > 1 ? <span className="calendar-v"> ×{g.length}</span> : null}
              {!compact ? <span className="calendar-v"> {amountText(lead.row, table, maxDecimals)}</span> : null}
            </div>
          );
        })}
        {isToday ? <div className="calendar-now" data-testid="cal-now" style={{ top: y(localClock(now, timeZone).frac) }} /> : null}
      </div>
    </div>
  );
}
