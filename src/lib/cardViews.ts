// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ViewMode } from "../components/ViewToggle";
import { fetchesData, SSRM_TYPES } from "./builtins";
import { detectDateColumn } from "./calendarView";
import { detectChartAxis, rowsOf } from "./chartShapes";
import { widenLongRows } from "./statementRows";
import { detectStatement } from "./statementTaxonomy";
import { tableRows } from "./tableColumns";
import type { CardView, DashboardCard, WidgetDef } from "./types";

/** The label for a card's default mode is the widget's own type. */
export const TYPE_LABELS: Record<string, string> = {
  table: "Table",
  chart: "Chart",
  markdown: "Markdown",
  html: "HTML",
  iframe: "Page",
  metric: "Metric",
  note: "Note",
  clock: "Clock",
  rss: "Feed",
  keys: "Keys",
  pdf: "PDF",
  multi_file_viewer: "Files",
  local_table: "Table",
};

/** A managed-native SSRM widget: its statement view needs no rows from `data`. */
function isManaged(widget: WidgetDef | undefined): boolean {
  return widget !== undefined && SSRM_TYPES.has(widget.type) && widget.provider === "managed-native" && widget.protocolVersion === 1;
}

/** The views a card can offer for its widget and the data that arrived (moved verbatim from WidgetCard's `modes` memo). */
export function availableViews(widget: WidgetDef | undefined, data: unknown, card: Pick<DashboardCard, "linkedSource">): ViewMode[] {
  const type = widget?.type ?? "table";
  const rows = rowsOf(data);
  const tableData = tableRows(data);
  const list: ViewMode[] = [{ value: undefined, label: TYPE_LABELS[type] ?? "Default" }];
  // Chart is offered when the widget is not already a chart and the rows that
  // actually arrived carry a time column — a property of the DATA, per the
  // spec, not of the widget's self-description.
  if (type !== "chart" && rows && detectChartAxis(rows) !== null) list.push({ value: "chart", label: "Chart" });
  if (isManaged(widget) || type === "local_table" || card.linkedSource || (type === "table" && tableData && detectStatement([...new Set((widenLongRows(tableData) ?? tableData).flatMap(row => Object.keys(row)))]) !== null)) list.push({ value: "statement", label: "Statement" });
  if (rows?.length && detectDateColumn(rows) !== null) list.push({ value: "calendar", label: "Calendar" });
  // Raw shows the payload useWidgetData fetched. iframe/note/clock/keys
  // never fetch — they report data: null unconditionally and WidgetCard's
  // body() early-returns for them before the view==="raw" gate — so a Raw
  // segment on those would look actionable and do nothing. fetchesData is
  // exactly the "this card has fetched data a raw view could show"
  // predicate. body()'s early return for "keys" is the actual enforcement
  // (it protects even a persisted view: "raw"); this just keeps the toggle
  // from advertising a mode that can't be reached.
  if (widget && fetchesData(widget)) list.push({ value: "raw", label: "Raw" });
  // Transposed is a property of the DATA too: a row array with something to
  // turn on its side. Offered for the two table-typed cards only.
  if (type === "table" || type === "local_table") {
    // tableRows, not rowsOf: rowsOf accepts array-typed elements
    // ([[1,2],[3,4]]) that the transposed view cannot render at all, and
    // offering the option there would dead-end in the empty state with
    // every export disabled. This gate must be the renderer's own.
    // A local_table card's rows live in its renderer, not in `data`, so the
    // option is offered unconditionally there -- the same reason showsTable
    // treats that type separately.
    if (type === "local_table" || (tableData !== null && tableData.length > 0)) {
      list.push({ value: "transposed", label: "Transposed" });
    }
  }
  return list;
}

/**
 * Every view availableViews could offer this card for SOME data, so Rita can
 * set one before the data arrives (#40). Chart and calendar still depend on
 * the rows: without a date/time column the card says so instead of drawing.
 * pdf and multi_file_viewer cards show no view toggle, so only their default.
 */
export function possibleViews(widget: WidgetDef, card: Pick<DashboardCard, "linkedSource">): CardView[] {
  if (widget.type === "pdf" || widget.type === "multi_file_viewer") return [];
  const fetches = fetchesData(widget);
  const table = widget.type === "table" || widget.type === "local_table";
  const views: CardView[] = [];
  if (fetches && widget.type !== "chart") views.push("chart");
  if (table || card.linkedSource || isManaged(widget)) views.push("statement");
  if (fetches) views.push("calendar", "raw");
  if (table) views.push("transposed");
  return views;
}
