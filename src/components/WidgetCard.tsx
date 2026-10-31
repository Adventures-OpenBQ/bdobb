// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { confirm, open as openFileDialog, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useWidgetData } from "../hooks/useWidgetData";
import { UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, SSRM_TYPES, fetchesData } from "../lib/builtins";
import { rowChartAxes, rowsOf } from "../lib/chartShapes";
import { dataUpdateText } from "../lib/cron";
import { authHeaders } from "../lib/dataClient";
import { originOf } from "../lib/iframeProtocol";
import { exportFilename, rowsForExport, toCsv, toJson, toJsonRows, toXlsx } from "../lib/export";
import { logError, logOnce } from "../lib/logger";
import { markdownFileRefusal } from "../lib/markdownNote";
import { bodyParams, paramsKey, queryParams, visibleParams } from "../lib/params";
import { effectiveParams, splitParamEdit, type ParamEdit } from "../lib/paramGroups";
import { hiddenFields, orderFields, tableColumns, tableRows } from "../lib/tableColumns";
import { NOTHING_TO_TRANSPOSE, transposeRows } from "../lib/transpose";
import type { DashboardCard, WidgetDef } from "../lib/types";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { InlineRename } from "./InlineRename";
import { ParamControls } from "./ParamControls";
import { MenuPanel } from "./RowContextMenu";
import { WidgetFormPanel } from "./WidgetFormPanel";
import { WidgetTabs } from "./WidgetTabs";
import { ChartRenderer } from "./renderers/ChartRenderer";
import { ClockRenderer } from "./renderers/ClockRenderer";
import { ErrorState } from "./renderers/ErrorState";
import { HtmlRenderer } from "./renderers/HtmlRenderer";
import { IframeRenderer } from "./renderers/IframeRenderer";
import { LocalTableRenderer } from "./renderers/LocalTableRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricRenderer } from "./renderers/MetricRenderer";
import { MultiFileRenderer } from "./renderers/MultiFileRenderer";
import { NoteRenderer } from "./renderers/NoteRenderer";
import { ParamEchoRenderer } from "./renderers/ParamEchoRenderer";
import { YouTubeRenderer } from "./renderers/YouTubeRenderer";
import { NewsfeedRenderer } from "./renderers/NewsfeedRenderer";
import { LiveGridRenderer } from "./renderers/LiveGridRenderer";
import { OmniRenderer } from "./renderers/OmniRenderer";
import { vegaLiteToPlotly } from "../lib/vegaLite";
import { highchartsToPlotly } from "../lib/highcharts";
import { RssRenderer } from "./renderers/RssRenderer";
import { TradingViewRenderer } from "./renderers/TradingViewRenderer";
import { PdfRenderer } from "./renderers/PdfRenderer";
import { RawJsonView } from "./renderers/RawJsonView";
import { RawRequestView } from "./renderers/RawRequestView";
import {
  TableRenderer,
  type CellClickEvent,
  type TableStatePatch,
} from "./renderers/TableRenderer";
import type { WidgetMessaging } from "./renderers/useWidgetMessages";
import { ViewToggle, type ViewMode } from "./ViewToggle";

type Props = {
  card: DashboardCard;
  onRemove: () => void;
  /** The "Open in new window" window: no Remove, no Minimize. */
  viewer?: boolean;
};

/**
 * A parameter name pushed by a framed page, made safe to interpolate into one
 * log line: C0 controls (the newline among them, which would otherwise forge a
 * line of its own) removed, and 64 characters at most, since the page chooses
 * the length too. Done here rather than in the logger, which stays a plain
 * writer — this is the one call site whose argument is attacker-chosen.
 */
function clampParamName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
}

/** The label for a card's default mode is the widget's own type. */
const TYPE_LABELS: Record<string, string> = {
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

/**
 * Types whose body IS a document viewer with its own toolbar. Both dispatch
 * BEFORE the `view === "raw"` gate, as `keys` does, so a card persisted with
 * `view: "raw"` still shows its documents; and neither offers the header's
 * table/chart/raw toggle, because there is no second way to look at a PDF and
 * a Raw segment over 600 KB of base64 is a trap rather than a feature.
 */
const DOCUMENT_TYPES = new Set(["pdf", "multi_file_viewer"]);

/** The three export items. The key doubles as the file extension. */
type ExportKind = "csv" | "json" | "xlsx";
const EXPORT_LABELS: Record<ExportKind, string> = { csv: "CSV", json: "JSON", xlsx: "Excel" };

/** Open file…'s dialog filter, shared with the file-size refusal below it. */
const MARKDOWN_FILTER = { name: "Markdown", extensions: ["md", "markdown", "txt"] };

/**
 * Deferred: the editor stack (BlockNote, Mantine, tiptap, ProseMirror) is
 * about 0.75 MB of JS plus its own stylesheet, and most dashboards never add
 * this widget. Same pattern as HelpDialog in App.tsx.
 */
const MarkdownEditorRenderer = lazy(() =>
  import("./renderers/MarkdownEditorRenderer").then((m) => ({ default: m.MarkdownEditorRenderer })),
);

/** Verbatim from the design's eligibility table. */
const NON_TABULAR_TITLE = "Only JSON export is available for this payload";

/**
 * Why the export items are off on a transposed card with nothing to turn.
 * NON_TABULAR_TITLE would be a lie there: JSON is disabled too, because it
 * follows the view like CSV and Excel.
 */
const NOTHING_TO_TRANSPOSE_TITLE = "Nothing to transpose";

/** The only two card types the transposed view is offered on, and reachable on. */
const TRANSPOSABLE_TYPES = new Set(["table", "local_table"]);

/** The card types that render nothing but "Waiting for widget…" until their widget is discovered. */
const WAITS_FOR_WIDGET = new Set<string>(["iframe", "note", "markdown_editor", "clock", "rss", "local_table"]);

export function WidgetCard({ card, onRemove, viewer = false }: Props) {
  const widget = useWidgetRegistryStore((s) => s.find(card.backendId, card.widgetId));
  // ParamControls fetches this card's optionsEndpoint param options, so it
  // needs the BackendConfig the card is bound to. useWidgetData resolves the
  // same one internally for its own fetch; this is the only other place the
  // card needs it.
  // The resolved widget's backend, matching useWidgetData's own lookup: an
  // imported card carrying UNRESOLVED_BACKEND_ID names no BackendConfig, and
  // ParamControls needs the real one to fetch its option lists.
  const backend = useBackendsStore((s) =>
    s.backends.find((b) => b.id === (widget?.backendId ?? card.backendId)),
  );
  const dashboard = useDashboardStore((s) => s.dashboards.find((d) => d.id === s.activeId));
  const applyCardParams = useDashboardStore((s) => s.applyCardParams);
  const setCardMinimized = useDashboardStore((s) => s.setCardMinimized);
  const patchCardField = useDashboardStore((s) => s.patchCardField);
  const refreshEpoch = useDashboardStore((s) => s.refreshEpoch);
  const setMaximized = useDashboardStore((s) => s.setMaximized);
  // A boolean selector, not the id: only the card that gains or loses the
  // state re-renders, not every card on the tab.
  const maximized = useDashboardStore((s) => s.maximizedCardId === card.id);
  const minimizeButtonEnabled = useSettingsStore((s) => s.settings.minimizeButton);
  const collapseControls = useSettingsStore((s) => s.settings.collapseWidgetControls);
  const chartTheme = useSettingsStore((s) => s.settings.theme);
  const minimized = card.minimized ?? false;

  const [controlsOpen, setControlsOpen] = useState(false);
  /**
   * When the refresh tooltip was last stamped. The pointer or focus reaching
   * the button restamps it, so "last" and "next" are as of the hover, not of
   * the card's last render. Only a dataUpdateDisplay widget needs it.
   */
  const [titleAt, setTitleAt] = useState(() => new Date());
  const stampTitle = () => {
    if (widget?.dataUpdateDisplay) setTitleAt(new Date());
  };
  // dataUpdateText scans minute by minute, so it runs once per stamp, not per render.
  const dataUpdateLine = useMemo(
    () => (widget?.dataUpdateDisplay ? dataUpdateText(widget.dataUpdateDisplay, titleAt) : undefined),
    [widget?.dataUpdateDisplay, titleAt],
  );
  /**
   * Is the title an InlineRename field right now? Transient by design: an
   * interrupted rename is not state worth persisting, and closing the field
   * is the only thing Escape has to do.
   */
  const [renaming, setRenaming] = useState(false);
  /**
   * The ⋯ menu. Still named for the export wrapper that used to be its only
   * content — the wrapper, its ref and its dismiss effect are unchanged; only
   * the toggle's label and the menu's items are new.
   */
  const [exportOpen, setExportOpen] = useState(false);
  /**
   * Which section of the ⋯ menu is expanded. Sections that open in place, not
   * flyouts: no positioning logic, and they stay inside the menu's own
   * Escape/outside-press dismissal.
   */
  const [exportSubOpen, setExportSubOpen] = useState(false);
  const [columnsSubOpen, setColumnsSubOpen] = useState(false);
  /**
   * The ⌕ toggle. Transient on purpose — the design's persisted list is sort,
   * filter, order, visibility and widths, and does not include whether the
   * filter row is showing.
   */
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  /**
   * Bumped by Reset table. The renderer seeds its column widths once from the
   * card's state, so clearing that state has to remount it for the widths to
   * fall back to the spec's.
   */
  const [tableResetKey, setTableResetKey] = useState(0);
  /**
   * Transient: cleared whenever the menu is reopened or another export is
   * started. Nothing persists it — an export failure is about this attempt,
   * not about the card.
   */
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  /**
   * The ⋯ toggle, kept so the menu can hang from it. The menu is portalled
   * to <body> and positioned from this element's rect: .widget-card clips
   * its overflow, and react-grid-layout's transform on every grid item makes
   * a `fixed` menu inside the card position against the card, so an in-tree
   * menu was cut off at a short card's bottom edge and covered by the next
   * card. Escape, an outside press and the arrow keys are MenuPanel's, the
   * contract every menu in the app shares.
   */
  const [exportAnchor, setExportAnchor] = useState<HTMLButtonElement | null>(null);
  /** One measurement for both coordinates, as LeftRail's Help menu does.
   * Undefined while the menu is closed — the `?.` never measures. */
  const exportRect = exportOpen ? exportAnchor?.getBoundingClientRect() : undefined;

  /**
   * Escape restores. Registered only while THIS card is the maximized one, so
   * a dashboard of twenty cards has at most one such listener and a dashboard
   * with nothing maximized has none — Escape then reaches whatever else wants
   * it, unchanged.
   *
   * One Escape does ONE thing: the ⋯ menu, being the innermost thing open,
   * consumes the press and the card stays maximized — the next press restores
   * it. No guard is needed here for that: the menu's own listener (MenuPanel)
   * is on window in the CAPTURE phase and stops the press there, so this
   * bubble-phase one never sees it, even though it was registered first
   * (maximizing precedes opening the menu over a maximized card). A rename
   * needs no guard either: its field is a React onKeyDown inside this
   * subtree, which runs before this window listener and calls
   * stopPropagation (InlineRename.tsx).
   */
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMaximized(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized, setMaximized]);

  /**
   * Memoised because useWidgetData's effect lists this object among its
   * dependencies. Built inline it would be a new identity on every render,
   * and the card would refetch forever.
   *
   * Depends on the specific fields effectiveParams reads — card.params,
   * card.bindings, dashboard.groups, widget — not on `card` or `dashboard`
   * themselves. Two separate sources of churn make that narrowing necessary,
   * not just tidy:
   *
   * 1. mutateDashboard (src/stores/dashboardStore.ts) rebuilds a brand-new
   *    top-level Dashboard on every mutation — drag/resize, view toggle,
   *    param apply, card removal — even when nothing this card cares about
   *    changed. updateLayouts, patchCardField and removeCard all spread `...d`,
   *    so dashboard.groups keeps its identity when they run; applyCardParams
   *    rebuilds it into a new array only when a group's value is actually
   *    edited. Depending on `dashboard` here would re-run this memo —
   *    and refetch this card against the live backend — whenever ANY other
   *    card moved, toggled its view, or was removed.
   *
   * 2. updateLayouts additionally rebuilds EVERY card object on any single
   *    drag or resize, because its caller hands it react-grid-layout's full
   *    layout array — so every card takes the `{ ...c, layout: {...} }`
   *    branch, not just the one that moved. That spread preserves
   *    card.params and card.bindings by reference, but not `card` itself.
   *    Depending on `card` here would re-run this memo — and refetch every
   *    card on the dashboard — on every drag or resize of any single card.
   *
   * Do not widen this back to [card, dashboard, widget].
   */
  const groups = dashboard?.groups;
  // A primitive, so it joins the dependency list below without widening it
  // back to `dashboard` — see the comment above about what that would cost.
  const groupsDisabled = dashboard?.groupsDisabled ?? false;
  const params = useMemo(
    () => (widget ? effectiveParams(card, groups, widget, groupsDisabled) : card.params),
    [card.params, card.bindings, groups, groupsDisabled, widget],
  );

  /**
   * The params that go on the widget's GET: `params` without the form
   * entries. A form field is card state, not a query parameter — leaving its
   * value in would append `<form>.<field>=…` to the request AND refetch the
   * card on every keystroke, because useWidgetData keys its fetch on
   * paramsKey of exactly this object. queryParams returns `params` itself for
   * a widget with no form, so nothing else in the app gains an identity churn.
   */
  const query = useMemo(() => (widget ? queryParams(widget, params) : params), [widget, params]);

  // The manifest's flag, not a card setting: nothing about it is persisted.
  // `widget` is undefined for the first renders of every card, so this is
  // false until discovery resolves it — which is exactly the render on which
  // the hook arms its first fetch.
  const { status, data, error, warnings, retry, attempt, run, stale, intervalMs, dataStale } = useWidgetData(
    card,
    query,
    widget?.runButton,
  );

  // Declared controls that render in the BODY rather than in the header row:
  // tabs are meant to be seen, and a form is the card's main verb.
  const tabs = widget ? bodyParams(widget, "tabs") : [];
  const forms = widget ? bodyParams(widget, "form") : [];
  const hasControls = widget ? visibleParams(widget).length > 0 : false;
  const view = card.view;
  /**
   * `view === "transposed"`, but only where it means something. Nothing stops
   * a dashboard file — hand-edited, imported, or written before the card's
   * widget was re-registered under another type — from carrying
   * `view: "transposed"` on a markdown or metric card. Only `table` and
   * `local_table` can render it, so everywhere else the card treats the view
   * as unset: it renders normally and keeps its exports, rather than silently
   * losing its JSON item to a view it never shows. ViewToggle still displays
   * the stray value (disabled) so the user can clear it.
   */
  const isTransposed = view === "transposed" && TRANSPOSABLE_TYPES.has(widget?.type ?? "");

  // Chart is offered when the widget is not already a chart and the rows that
  // actually arrived carry a time column — a property of the DATA, per the
  // spec, not of the widget's self-description.
  const modes: ViewMode[] = useMemo(() => {
    const type = widget?.type ?? "table";
    const list: ViewMode[] = [{ value: undefined, label: TYPE_LABELS[type] ?? "Default" }];
    if (type !== "chart") {
      const rows = rowsOf(data);
      if (rows && rowChartAxes(rows, widget?.table?.columns) !== null) list.push({ value: "chart", label: "Chart" });
    }
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
      const rows = tableRows(data);
      // A local_table card's rows live in its renderer, not in `data`, so the
      // option is offered unconditionally there -- the same reason showsTable
      // treats that type separately.
      if (type === "local_table" || (rows !== null && rows.length > 0)) {
        list.push({ value: "transposed", label: "Transposed" });
      }
    }
    return list;
  }, [widget?.type, widget?.table, data]);

  // No export surface at all for the built-in and document cards: fetchesData
  // is already the "this card has a fetched payload" predicate (it is false
  // for iframe, keys, multi_file_viewer and every builtin, i.e. note and
  // clock), and `pdf` is excluded on top of it because its payload IS one
  // base64 document, not data.
  const hasPayload = widget !== undefined && fetchesData(widget) && widget.type !== "pdf";
  // The manifest's `exportable: false` takes Export ▸ away and nothing else:
  // Rename, Maximize and Columns stay, so the menu's gate is hasPayload.
  const canExport = hasPayload && widget.exportable !== false;
  // The markdown note has a ⋯ menu without an Export section: its two items
  // move a .md file in or out of the note. hasPayload keeps its exact meaning
  // ("this card has a fetched payload"); this is the menu's gate, not export's.
  const isMarkdownNote = widget?.type === "markdown_editor";
  const hasMenu = hasPayload || isMarkdownNote;
  /**
   * The transposed view's rows and their column order, computed once for the
   * body and the Export menu. null when the payload has nothing to turn on
   * its side (fewer than two columns, or no rows).
   */
  const transposed = useMemo(() => {
    if (!isTransposed) return null;
    const rows = tableRows(data);
    return rows ? transposeRows(rows) : null;
  }, [isTransposed, data]);
  const exportRows = useMemo(
    () => (isTransposed ? (transposed?.rows ?? null) : rowsForExport(data)),
    [isTransposed, transposed, data],
  );
  // Explicit order for the exporters; undefined lets them derive it as today.
  const exportColumns = isTransposed ? transposed?.columns : undefined;
  // CSV and Excel head each column with the backend's headerName; JSON keeps
  // the field keys. Not the transposed view, whose columns are not fields.
  const exportLabels = useMemo(
    () => isTransposed ? {} : Object.fromEntries(
      (widget?.table?.columns ?? []).flatMap((c) => (c.headerName ? [[c.field, c.headerName]] : [])),
    ),
    [isTransposed, widget?.table?.columns],
  );
  // Why CSV and Excel are off, when they are: the transposed view's own
  // reason when that is what stopped them, the payload's otherwise.
  const exportOffTitle = isTransposed ? NOTHING_TO_TRANSPOSE_TITLE : NON_TABULAR_TITLE;

  /**
   * Is a TableRenderer actually on screen? Exactly the condition body()'s
   * `case "table"` needs — a table widget, not showing raw or chart, with a
   * payload that is a row array — so the ⌕ toggle and the Columns/Reset items
   * never appear over something that is not a table.
   */
  const showsTable =
    (widget?.type === "table" &&
      view !== "raw" &&
      view !== "chart" &&
      !isTransposed &&
      tableRows(data) !== null) ||
    // A local-file card's rows live inside its renderer, not in `data`: it
    // fetches nothing. The ⌕ toggle is the only thing this gate reaches for
    // such a card -- the Columns and Reset items below sit inside the ⋯ menu,
    // which no built-in card has (see canExport).
    (widget?.type === "local_table" && !isTransposed);

  /**
   * The same column list the renderer builds, from the same pure function.
   * The checklist must not re-derive it, or the menu and the table could
   * disagree about which columns exist.
   */
  const menuColumns = useMemo(() => {
    const rows = tableRows(data);
    return rows && rows.length > 0 ? tableColumns(rows, widget?.table) : [];
  }, [data, widget?.table]);
  const menuOrder = orderFields(menuColumns, card.table?.columnOrder);
  const menuHidden = hiddenFields(menuColumns, card.table?.hidden);

  async function apply(edit: ParamEdit) {
    try {
      await applyCardParams(card.id, edit);
    } catch (err) {
      await logError(`failed to apply params for card ${card.id}: ${err}`);
    }
  }

  /**
   * A cellOnClick cell was clicked: assign its value to the named parameter.
   *
   * Through splitParamEdit and `apply` — the SAME pair the row's own
   * controls commit through (ParamControls builds the edit, this card's
   * onApply commits it) — so a grouped parameter lands on its group
   * and every member card refetches, and an ungrouped one lands on this
   * card's own params. One edit, one dashboard write; splitParamEdit already
   * drops a group edit whose value has not moved.
   *
   * A parameter this widget never declared is refused rather than written:
   * binding it would append a query parameter the endpoint does not
   * understand, exactly as groupedParamNames refuses for the same reason.
   * logOnce, not a line per click: a cell is clickable over and over, and a
   * misconfigured column is one fact, not one per press. The line names the
   * parameter and the card and nothing else — never the clicked value.
   *
   * An EMPTY value is refused too, and silently — see the guard below.
   */
  async function handleCellClick(click: CellClickEvent) {
    if (!widget || !widget.params.some((p) => p.paramName === click.paramName)) {
      await logOnce(
        `cell-click-undeclared:${card.id}:${click.paramName}`,
        `cell click for undeclared param ${click.paramName} on ${card.id}`,
      );
      return;
    }
    // A null cell reports "" and the click is still delivered -- the CARD is
    // where it stops. Committing it would CLEAR the parameter, and a cleared
    // grouped `symbol` would 422 every member of the group on its next fetch.
    // Silent, and ahead of the forceUpdate refetch below: an empty cell is
    // ordinary data, not a misconfiguration worth a log line.
    if (click.value === "") return;
    await apply(
      splitParamEdit({ [click.paramName]: click.value }, card, groups, widget, groupsDisabled),
    );
    // After the write, so the refetch reads the new effective params. This is
    // what refreshes a source table whose OWN params did not change; when they
    // did, this issues one redundant request whose response useWidgetData's
    // `cancelled` flag discards. On a runButton card retry() re-asks the ARMED
    // params — the click has just made the card stale, and only Run adopts it.
    if (click.forceUpdate) retry();
  }

  /**
   * What a framed page is allowed to see and to say.
   *
   * `authHeaders` is the SAME function fetchWidgetData sends its credential
   * with, so there is one source of truth for what this backend's credential
   * is and where it goes. It answers `{}` for a backend with no credential
   * and for one that places its credential in the query string — and an empty
   * map is one of the two conditions useWidgetMessages requires before it
   * will reply with `openbb-auth` at all. A built-in (the Website widget)
   * names no BackendConfig, so `backend` is undefined and a user-typed
   * address is never handed a credential.
   *
   * `params` is the card's EFFECTIVE params, group values already resolved,
   * so the page is told what the card is actually showing.
   *
   * The credential also goes only to the backend's OWN origin. A backend
   * iframe widget frames `w.endpoint`, a full URL straight from widgets.json,
   * and nothing stops that URL naming a third-party page; the hook's
   * same-origin check compares the message with the FRAME's origin, not the
   * backend's, so it would hand that page the backend's credential. Any
   * other origin — and an endpoint with no origin at all, which is every
   * srcdoc HTML widget — gets `{}` and still receives the params.
   */
  function messagingFor(w: WidgetDef | undefined): WidgetMessaging | undefined {
    if (!w) return undefined;
    const frameOrigin = originOf(w.endpoint);
    return {
      headers:
        backend && frameOrigin !== null && frameOrigin === originOf(backend.baseUrl)
          ? authHeaders(backend)
          : {},
      params,
      declaredParamNames: w.params.map((p) => p.paramName),
      onParamsUpdate: (accepted, dropped) => void handleParamsUpdate(w, accepted, dropped),
    };
  }

  /**
   * A framed page pushed `openbb:widget-params:update`.
   *
   * Committed through the same pair everything else on this card commits
   * through — `splitParamEdit` then `apply` — so a grouped parameter lands on
   * its group and every member card refetches, an ungrouped one lands on this
   * card's own params, and a viewer window applies it in memory through the
   * store's own guard. One edit, one dashboard write.
   *
   * `dropped` names parameters this widget never declared; the hook has
   * already refused them. They are reported rather than written for the
   * reason groupedParamNames refuses them: binding one would append a query
   * parameter the endpoint does not understand. One line per CARD per session,
   * naming the first such parameter: the key is the card, never the name,
   * because the name comes from the framed page and a page free to invent
   * names would otherwise write a line — and grow the once-key set — per name.
   * The line names the parameter and the card and nothing else: never a value,
   * never a header.
   */
  async function handleParamsUpdate(
    w: WidgetDef,
    accepted: Record<string, string>,
    dropped: string[],
  ) {
    if (dropped.length > 0) {
      await logOnce(
        `iframe-param-undeclared:${card.id}`,
        `widget frame set undeclared param ${clampParamName(dropped[0])} on ${card.id}`,
      );
    }
    if (Object.keys(accepted).length === 0) return;
    // A page that echoes `openbb-params-update` back as an update would
    // otherwise cost one dashboard write per echo, and a page pushing on a
    // timer would write without bound. The hook already declines to re-post
    // an unchanged value; this is the same guard on the inbound side.
    if (Object.entries(accepted).every(([name, value]) => params[name] === value)) return;
    // Re-read rather than close over: two updates naming different ungrouped
    // parameters can arrive in one tick, before React has re-rendered this
    // card, and splitParamEdit builds cardParams from the card it is given.
    // Both would then start from the params this render was built with, and
    // the second write would drop the first. applyCardParams sets the store
    // synchronously, so the card read here already carries the earlier edit.
    const target = currentCard() ?? card;
    await apply(splitParamEdit(accepted, target, groups, w, groupsDisabled));
  }

  /** This card as the store holds it NOW, which a render's `card` may predate. */
  function currentCard(): DashboardCard | undefined {
    const active = useDashboardStore.getState().activeDashboard();
    return active?.tabs.flatMap((t) => t.cards).find((c) => c.id === card.id);
  }

  async function setMinimized(next: boolean) {
    try {
      await setCardMinimized(card.id, next);
    } catch (err) {
      await logError(`failed to toggle minimized for card ${card.id}: ${err}`);
    }
  }

  async function toggleMinimized() {
    // Half of the exclusivity: a maximized card being minimized is restored
    // first, because a card collapsed to its header bar has nothing to fill
    // the dashboard with.
    if (maximized) setMaximized(null);
    await setMinimized(!minimized);
  }

  /**
   * Maximize this card, or restore it. Transient — nothing is written, and
   * the same React node stays mounted, so a chart's zoom, a table's scroll
   * offset and a PDF's page all survive the change of size.
   */
  async function toggleMaximized() {
    if (maximized) {
      setMaximized(null);
      return;
    }
    // The other half of the exclusivity, through the same persisted flip
    // Minimize itself uses — so a card maximized out of the minimized state
    // stays expanded when it is restored. FIRST, and awaited: the card is
    // expanded before it goes fixed-position, so a collapsed header bar is
    // never stretched across the dashboard, not even for one frame.
    if (minimized) await setMinimized(false);
    setMaximized(card.id);
  }

  /**
   * Commits a renamed title. The widget's own name is not an override — it is
   * the default — so committing it REMOVES the field rather than freezing
   * today's name onto the card, and the card follows the manifest again.
   *
   * `next` is never empty: InlineRename reports an empty or unchanged commit
   * as a cancel (InlineRename's commit()), which is what closes the field.
   */
  async function commitTitle(next: string) {
    setRenaming(false);
    try {
      await patchCardField(card.id, "title", next === widget?.name ? null : next);
    } catch (err) {
      // The card and the error, never the typed title.
      await logError(`failed to rename card ${card.id}: ${err}`);
    }
  }

  /**
   * The table toolkit's only write path. `null` clears the card's whole table
   * state ("Reset table"). The log line names the card and the error and
   * nothing else — a patch carries user-typed filter text, which is payload,
   * not diagnostics.
   */
  async function saveTable(patch: TableStatePatch | null) {
    try {
      await patchCardField(card.id, "table", patch);
    } catch (err) {
      await logError(`failed to save table state for card ${card.id}: ${err}`);
    }
  }

  /**
   * Writes the whole hidden list, not a delta: an EMPTY list is meaningful —
   * it is how a user shows a column the widget ships with `hide: true`.
   */
  function toggleColumn(field: string) {
    const next = menuHidden.includes(field)
      ? menuHidden.filter((f) => f !== field)
      : [...menuHidden, field];
    void saveTable({ hidden: next });
  }

  function resetTable() {
    setExportOpen(false);
    // The renderer seeds its widths once, so remounting is what re-seeds them.
    setTableResetKey((n) => n + 1);
    void saveTable(null);
  }

  async function runExport(kind: ExportKind) {
    setExportOpen(false);
    setExportNotice(null);
    const name = widget?.name ?? card.widgetId;
    try {
      const path = await save({
        // `query`, not `params`: the filename names the QUESTION the payload
        // answers, and a form's fields are not part of it. They would also
        // put a `<form>.<field>=` pair — the user's own typed input — into a
        // filename that lands on disk.
        defaultPath: exportFilename(name, query, kind),
        filters: [{ name: EXPORT_LABELS[kind], extensions: [kind] }],
      });
      // null is the user cancelling. Not a failure, and nothing to write.
      if (path === null) return;
      if (kind === "json") {
        // JSON follows the view too, same as CSV/Excel (spec D5): the
        // transposed rows when the transposed view is showing, the raw
        // payload otherwise. toJsonRows, not toJson, for the reason toCsv
        // takes an explicit list -- a transposed row's own keys put an
        // integer-like header ("2024") ahead of `Field`.
        await writeTextFile(
          path,
          isTransposed ? toJsonRows(exportRows ?? [], exportColumns) : toJson(data),
        );
      } else if (kind === "csv") {
        // exportRows is non-null here: both non-JSON items are disabled
        // otherwise. The ?? [] is only what makes that legible to the compiler.
        await writeTextFile(path, toCsv(exportRows ?? [], exportColumns, exportLabels));
      } else {
        await writeFile(path, await toXlsx(exportRows ?? [], exportColumns, exportLabels));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice(`Export failed: ${message}`);
      // The widget's name and the error, never a row, a cell or a param
      // value: a payload can carry anything the backend holds.
      await logError(`widget ${name} export failed: ${message}`);
    }
  }

  async function openMarkdownFile() {
    setExportOpen(false);
    setExportNotice(null);
    try {
      const path = await openFileDialog({ multiple: false, filters: [MARKDOWN_FILTER] });
      // null is the user cancelling. Not a failure, and nothing to read.
      if (path === null) return;
      const basename = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
      // Sized through stat, BEFORE the file is read, on the same reasoning as
      // the apps.json import: open() adds the picked path to the fs scope,
      // which covers stat as much as it covers readTextFile.
      const refusal = markdownFileRefusal(basename, (await stat(path)).size);
      if (refusal !== null) {
        setExportNotice(refusal);
        return;
      }
      if ((card.params.text ?? "") !== "") {
        const ok = await confirm(`Replace this note with "${basename}"?`, {
          title: "Open file",
          kind: "warning",
          okLabel: "Replace",
          cancelLabel: "Cancel",
        });
        if (!ok) return;
      }
      // A copy, not a link: the scope grant is for this session only, and the
      // app's fs scope is $APPDATA (see the design's "Why no live link").
      await apply({ cardParams: { ...card.params, text: await readTextFile(path) }, groupEdits: [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice(`Open failed: ${message}`);
      await logError(`card ${card.id} open markdown file failed: ${message}`);
    }
  }

  async function saveMarkdownAs() {
    setExportOpen(false);
    setExportNotice(null);
    try {
      // The card's own title when it has one, else the widget's name -- the
      // same label the header shows. No params: the note's one param IS the
      // text, and prose does not belong in a filename.
      const path = await save({
        defaultPath: exportFilename(card.title ?? widget?.name ?? card.widgetId, {}, "md"),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (path === null) return;
      const text = card.params.text ?? "";
      // ponytail: writes the param, which trails the editor by up to the
      // 500 ms debounce (the ⋯ click usually blurs the editor, which flushes).
      // Thread a flush() up from the renderer if that ever bites.
      await writeTextFile(path, text.endsWith("\n") ? text : `${text}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice(`Save failed: ${message}`);
      await logError(`card ${card.id} save markdown file failed: ${message}`);
    }
  }

  function body() {
    if (status === "unresolved" && widget && WAITS_FOR_WIDGET.has(widget.type)) {
      return <p className="empty-state">Waiting for widget…</p>;
    }
    // An iframe widget's endpoint IS the URL; useWidgetData issues no
    // request for it (see the guard there). Render the frame regardless of
    // fetch status — there is no fetch whose status could gate it — except
    // while the widget itself hasn't been discovered yet, when there is no
    // URL to frame.
    if (widget?.type === "iframe") {
      // A backend iframe widget's endpoint IS the URL. The Website built-in
      // has no endpoint — the user types the address into its `url` param.
      const isBuiltin = widget.backendId === BUILTIN_BACKEND_ID;
      return (
        <IframeRenderer
          url={isBuiltin ? (card.params.url ?? "") : widget.endpoint}
          emptyHint={isBuiltin ? "Enter a URL in Parameters to frame a page." : undefined}
          messaging={messagingFor(widget)}
        />
      );
    }

    // A note has no backend and nothing is fetched for it (see
    // fetchesData/useWidgetData) — its data is always null. Handled here,
    // before the fetch-status/raw/chart gates below, for the same reason as
    // iframe above: the `data === null` check a few lines down exists for a
    // real 204 from a real backend, and would otherwise catch every note
    // first and show "No data for these parameters" instead of the note.
    if (widget?.type === "note") {
      return (
        <NoteRenderer
          text={card.params.text ?? ""}
          onChange={(text) =>
            void apply({ cardParams: { ...card.params, text }, groupEdits: [] })
          }
        />
      );
    }

    // Same reason as the note: a built-in has no backend, so data is always
    // null and the `data === null` gate below would claim the card.
    if (widget?.type === "markdown_editor") {
      return (
        <Suspense fallback={<p className="empty-state">Loading editor…</p>}>
          <MarkdownEditorRenderer
            text={card.params.text ?? ""}
            onChange={(text) =>
              void apply({ cardParams: { ...card.params, text }, groupEdits: [] })
            }
          />
        </Suspense>
      );
    }

    // Same reason as the note above: a clock has no backend, its data is
    // always null, and the `data === null` gate below would otherwise claim
    // the card and show "No data for these parameters" instead of the time.
    if (widget?.type === "clock") {
      return <ClockRenderer params={card.params} />;
    }

    // The echo shows the group-merged params, not card.params: a group's
    // effect on this card is exactly what it exists to display.
    if (widget?.type === "param_echo") {
      if (status === "unresolved") return <p className="empty-state">Waiting for widget…</p>;
      return <ParamEchoRenderer params={params} />;
    }

    // Same shape as the note and clock early returns above, and for the same
    // reason: a built-in fetches nothing through useWidgetData, so the
    // `data === null` gate below would otherwise claim this card and show
    // "No data for these parameters." instead of the headlines. Unlike them,
    // this renderer issues its own request, so it is handed two more things:
    // refreshKey, which is how the header's Refresh and ⌘R reach it (see the
    // multi_file_viewer case below), and the card's RESOLVED auto-refresh
    // interval, so the user's setting governs this feed exactly as it governs
    // every backend card.
    if (widget?.type === "rss") {
      return (
        <RssRenderer
          url={card.params.url ?? ""}
          // `|| 20` and not `??`: an empty string, a non-numeric value and a
          // literal 0 are all "the user did not choose a count", and a slice
          // of zero headlines is a blank card.
          limit={Number(card.params.limit) || 20}
          refreshKey={attempt + refreshEpoch}
          intervalMs={intervalMs}
        />
      );
    }

    // Same shape as the note and clock early returns above, and for the same
    // reason: a local-file card fetches nothing, so `data` is always null and
    // the `data === null` gate below would claim it. The bytes are read by the
    // renderer, from the file the drop stored.
    if (widget?.type === "local_table") {
      return (
        <LocalTableRenderer
          file={card.params.file ?? ""}
          label={card.title ?? card.widgetId}
          // How the header's Refresh reaches this renderer, exactly as it
          // reaches MultiFileRenderer: `retry` bumps `attempt`, and
          // refreshEpoch is summed in so a refresh-all re-reads the file too.
          refreshKey={attempt + refreshEpoch}
          state={card.table}
          onStateChange={(patch) => void saveTable(patch)}
          filterRow={filterRowOpen}
          transposed={isTransposed}
        />
      );
    }

    // The keys surface lives in Settings now. This early return stays, and
    // stays BEFORE the `view === "raw"` gate below: at tier 3 every row of a
    // keys payload carries the plaintext credential, and a card persisted
    // with `view: "raw"` from before the move must never reach RawJsonView.
    if (widget?.type === "keys") {
      return <p className="empty-state">Provider keys moved to Settings.</p>;
    }

    // Same shape as the note and clock early returns above, and for the same
    // reason: fetchesData is false for this type, so useWidgetData reports
    // `ready` with `data: null`, and the `data === null` gate below would
    // otherwise claim the card and show "No data for these parameters."
    // instead of the file rail. The renderer issues its own POST once the
    // reader has picked files.
    if (widget?.type === "omni" && backend) {
      // Like live_grid: fetchesData is false for omni, so the card's data===null
      // gate would otherwise claim it. The renderer POSTs on submit. `query`
      // carries the resolved visible params (e.g. the basic widget's `type`).
      return <OmniRenderer widget={widget} backend={backend} params={query} />;
    }

    if (widget?.type === "live_grid" && backend) {
      // Like multi_file_viewer: fetchesData is false for live_grid, so the
      // card's data===null gate would otherwise claim it. The renderer fetches
      // its own snapshot and opens the socket. `query` carries the resolved
      // symbol selection, the same params a GET would send.
      return <LiveGridRenderer widget={widget} backend={backend} params={query} />;
    }

    // Same shape as live_grid above, and for the same reason: fetchesData is
    // false for this type, so the data===null gate below would otherwise claim
    // the card. The renderer asks the UDF history route itself, through the
    // same data client. refreshKey is how the header's Refresh and ⌘R reach it,
    // exactly as for rss and multi_file_viewer. udfChart is always set for this
    // type by normalizeWidgets; the guard only narrows the optional field.
    if (widget?.type === "advanced_charting" && backend && widget.udfChart) {
      return (
        <TradingViewRenderer
          widget={widget}
          backend={backend}
          spec={widget.udfChart}
          refreshKey={attempt + refreshEpoch}
        />
      );
    }

    if (widget?.type === "multi_file_viewer") {
      // refreshKey is how the header's Refresh reaches this renderer: `retry`
      // bumps `attempt`, and the renderer re-issues its last Open. Nothing
      // else on this card has a request for Refresh to repeat. refreshEpoch
      // is summed in so a refresh-all reopens these documents too — the
      // renderer only compares the value to the last one it saw, so any
      // change is a refresh and the sum can never go backwards.
      return (
        <MultiFileRenderer
          widget={widget}
          backend={backend}
          // `query`, not `params`: these go on the documents POST's query
          // string, which is the widget's own question. A form's fields are
          // not part of it and must not be sent with it.
          params={query}
          refreshKey={attempt + refreshEpoch}
        />
      );
    }

    // A server-side row model table: the grid POSTs the viewport it wants and
    // the backend answers that slice. TableRenderer is a client-side grid over
    // a fetched row array reached by GET — a different contract end to end —
    // so this card is refused rather than rendered wrong.
    //
    // An early return for the same reason as the four above: fetchesData is
    // false for this type, so useWidgetData reports `ready` with `data: null`,
    // and the `data === null` gate below would otherwise claim the card and
    // show "No data for these parameters." — a lie about why it is empty. It
    // sits before the `view === "raw"` gate too, so a card persisted with
    // `view: "raw"` cannot reach RawJsonView and render null. `unresolved`
    // cannot apply here: a widget object exists in this branch.
    //
    // The sentence names the canonical spelling even for a manifest that said
    // `table_ssrm`: the reader is being told which OpenBB feature is missing,
    // not which string their manifest happened to use.
    if (widget && SSRM_TYPES.has(widget.type)) {
      return (
        <p className="empty-state">
          Server-side tables (ssrm_table) are not supported in this version.
        </p>
      );
    }

    if (status === "unresolved") {
      // An imported card is a different situation from a card whose backend
      // simply has not finished discovery: nothing is on the way, and naming
      // the widget id is the only way the user can tell which backend they
      // are missing. Every other unresolved card keeps the generic wait —
      // the widget id there is already shown by the header's fallback title
      // below, and repeating it would give getByText(/id/) two matches.
      if (card.backendId === UNRESOLVED_BACKEND_ID) {
        return (
          <p className="empty-state">{`Widget ${card.widgetId} is not on any connected backend.`}</p>
        );
      }
      return <p className="empty-state">Waiting for widget…</p>;
    }
    // `data === null` too: on a REFETCH the hook reports "loading" while
    // keeping the last payload, and swapping the renderer out for this
    // placeholder would destroy what the payload does not carry — a chart's
    // zoom and pan, a table's scroll offset and sort. Stale rows stay on
    // screen instead, with the header marked data-refreshing. Only a card
    // that has nothing to show yet gets the placeholder.
    if (status === "loading" && data === null) return <p className="empty-state">Loading…</p>;
    // A required param is still empty: nothing was requested, so no Retry.
    if (status === "incomplete") return <p className="empty-state">{error}</p>;
    if (status === "error") return <ErrorState message={error ?? "Request failed"} onRetry={retry} />;

    // A 204 from the backend: a correct answer with nothing in it. Not an
    // error, so no Retry; checked before the raw view, which has nothing to show.
    if (data === null) return <p className="empty-state">No data for these parameters.</p>;

    // A pdf card's payload IS one document, and the viewer is the only useful
    // rendering of it. Placed before the raw gate for the same reason as the
    // keys card above: a card persisted with `view: "raw"` must not dump
    // hundreds of kilobytes of base64 into the DOM.
    if (widget?.type === "pdf") return <PdfRenderer data={data} onRetry={retry} />;

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

    // Raw is returned BEFORE type dispatch, which is why a widget type that
    // must suppress the raw view has to do so explicitly (SP5's keys widget).
    if (view === "raw") return <RawJsonView data={data} />;
    if (view === "chart") return <ChartRenderer
        data={data}
        uirevision={paramsKey(query)}
        columns={widget?.table?.columns}
        chartType={widget?.chartView?.chartType}
      />;
    // Before the type dispatch, like raw and chart: the transposed grid is a
    // view of the payload, not of the widget's declared columns. local_table
    // is not here -- its rows never reach `data`, so its own renderer turns
    // them (see the early return above).
    if (isTransposed && widget?.type === "table") {
      if (transposed === null) {
        return <p className="empty-state">{NOTHING_TO_TRANSPOSE}</p>;
      }
      return <TableRenderer data={transposed.rows} plain columns={transposed.columns} />;
    }

    const type = widget?.type;

    switch (type) {
      case "table":
        return (
          <TableRenderer
            key={tableResetKey}
            data={data}
            spec={widget?.table}
            state={card.table}
            onStateChange={(patch) => void saveTable(patch)}
            onCellClick={(click) => void handleCellClick(click)}
            filterRow={filterRowOpen}
          />
        );
      case "chart":
        return <ChartRenderer
        data={data}
        uirevision={paramsKey(query)}
        columns={widget?.table?.columns}
        chartType={widget?.chartView?.chartType}
      />;
      case "markdown":
        return <MarkdownRenderer data={data} />;
      case "html":
        return <HtmlRenderer data={data} messaging={messagingFor(widget)} />;
      case "metric":
        return <MetricRenderer data={data} />;
      case "youtube":
        return <YouTubeRenderer data={data} />;
      case "newsfeed":
        return <NewsfeedRenderer data={data} />;
      case "chart-vegalite":
      case "chart-highcharts": {
        // Translated to Plotly rather than given a Vega renderer; an
        // unmappable spec falls back to the raw view (see vegaLite.ts).
        const figure = (type === "chart-vegalite" ? vegaLiteToPlotly : highchartsToPlotly)(data, chartTheme);
        return figure ? (
          <ChartRenderer data={figure} uirevision={paramsKey(query)} />
        ) : (
          <RawJsonView data={data} />
        );
      }
      // "iframe", "note" and "clock" are handled by the early returns above,
      // before any of the fetch-status/raw/chart gates — none reaches this switch.
      // An unexpected shape or an unrecognised type lands here — never a
      // blank card.
      default:
        return <RawJsonView data={data} />;
    }
  }

  /** The refresh/Run tooltip: the button's own words, then staleness, then the data update schedule. */
  const refreshTitle = (base?: string) =>
    [
      base,
      dataStale ? "Data is older than its stale time" : undefined,
      dataUpdateLine,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n") || undefined;

  return (
    <article
      className="widget-card"
      data-minimized={minimized || undefined}
      // The only feedback a manual Refresh gives once the body stops
      // blanking. Styled as a dimmed title plus a dot, not an animation:
      // nothing else in this stylesheet moves.
      data-refreshing={status === "loading" && data !== null ? "true" : undefined}
    >
      <header
        className="card-header"
        // The header BACKGROUND only. `e.target === e.currentTarget` is the
        // whole guard: .card-controls is `display: contents`, so the only
        // other double-click targets in this row are the title (which
        // renames), the buttons (which do their own jobs) and .card-params —
        // the controls row below, whose inputs, selects and group buttons now
        // sit inside this header too. None of them is the header element
        // itself, so the guard still holds.
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) void toggleMaximized();
        }}
      >
        {renaming ? (
          // Replaces the title span rather than nesting inside it: .card-title
          // is the grid's draggableHandle (DashboardGrid's GridLayout), so while the
          // field is open there is no drag handle for typing to fight with.
          <InlineRename
            value={card.title ?? widget?.name ?? card.widgetId}
            ariaLabel="Card title"
            onCommit={(next) => void commitTitle(next)}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span
            className={card.title === undefined ? "card-title" : "card-title card-title-custom"}
            // The widget's own name, so a renamed card still says what it is
            // showing. Omitted when there is no override: a tooltip repeating
            // the text it sits on is noise.
            title={card.title === undefined ? undefined : widget?.name}
            onDoubleClick={() => setRenaming(true)}
          >
            {card.title ?? widget?.name ?? card.widgetId}
          </span>
        )}
        {/* Only a runButton card can be stale — the hook reports a constant
            false for every other one. A real element rather than a ::after on
            the title, because it carries its own tooltip. */}
        {stale ? (
          <span
            className="card-stale"
            role="img"
            aria-label="Parameters changed — press Run"
            title="Parameters changed — press Run"
          >
            {"•"}
          </span>
        ) : null}
        <div
          className={
            collapseControls
              ? // Held open while the ⋯ menu is: focus and the pointer move to
                // the portalled menu, which ends this dropdown's :hover and
                // :focus-within, and the menu's trigger must stay on screen
                // for Escape to hand focus back to it.
                `card-controls card-controls-collapsed${controlsOpen || exportOpen ? " card-controls-open" : ""}`
              : "card-controls"
          }
        >
          {collapseControls ? (
            <button
              type="button"
              className="card-controls-chevron"
              aria-label="Show widget controls"
              aria-expanded={controlsOpen}
              onClick={() => setControlsOpen((v) => !v)}
            >
              ⌄
            </button>
          ) : null}
          <div className="card-controls-icons">
            {widget && DOCUMENT_TYPES.has(widget.type) ? null : (
              <ViewToggle
                modes={modes}
                current={view}
                onSelect={(v) =>
                  // Caught like commitTitle's write: the save can reject.
                  void patchCardField(card.id, "view", v ?? null).catch((err) =>
                    logError(`failed to save the view for card ${card.id}: ${err}`),
                  )
                }
              />
            )}
            {showsTable ? (
              <button
                type="button"
                className="card-action"
                aria-label="Filter rows"
                aria-pressed={filterRowOpen}
                onClick={() => setFilterRowOpen((v) => !v)}
              >
                {"⌕"}
              </button>
            ) : null}
            {widget?.runButton ? (
              // Run REPLACES Refresh rather than joining it: the manifest's
              // contract is "this widget does not execute on its own", and a
              // second button that fetched unconditionally would undo it.
              // Ctrl/Cmd-click goes to `retry` — a hard refetch of the armed
              // params — which is also what `run` itself falls through to when
              // nothing has been edited.
              <button
                type="button"
                className="card-action card-run"
                aria-label="Run"
                title={refreshTitle("Run (⌘-click: hard refresh)")}
                data-stale={dataStale || undefined}
                onPointerEnter={stampTitle}
                onFocus={stampTitle}
                onClick={(e) => (e.metaKey || e.ctrlKey ? retry() : run())}
              >
                Run
              </button>
            ) : (
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
            )}
            {hasMenu ? (
              <>
                <button
                  type="button"
                  className="card-action"
                  aria-label="Card menu"
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  onClick={(e) => {
                    setExportAnchor(e.currentTarget);
                    setExportNotice(null);
                    // Reopening starts collapsed, so the menu is the same
                    // shape every time it is opened.
                    setExportSubOpen(false);
                    setColumnsSubOpen(false);
                    setExportOpen((v) => !v);
                  }}
                >
                  {"⋯"}
                </button>
                {exportRect ? (
                  <MenuPanel
                    className="card-export-menu"
                    // Right-aligned under the toggle, hanging leftward over
                    // the card it belongs to.
                    x={exportRect.right}
                    y={exportRect.bottom}
                    openLeft
                    portal
                    anchor={exportAnchor}
                    returnFocusTo={exportAnchor}
                    onClose={() => setExportOpen(false)}
                    layoutKey={`${exportSubOpen} ${columnsSubOpen}`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        // The menu closes with it: the field replaces the
                        // title in the header behind this menu, and leaving
                        // the menu open would cover the thing being typed in.
                        setExportOpen(false);
                        setRenaming(true);
                      }}
                    >
                      {"Rename…"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportOpen(false);
                        void toggleMaximized();
                      }}
                    >
                      {maximized ? "Restore" : "Maximize"}
                    </button>
                    {canExport ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={exportSubOpen}
                          onClick={() => setExportSubOpen((v) => !v)}
                        >
                          {"Export ▸"}
                        </button>
                        {exportSubOpen ? (
                          <div role="group" className="card-submenu">
                            <button
                              type="button"
                              role="menuitem"
                              disabled={exportRows === null}
                              title={exportRows === null ? exportOffTitle : undefined}
                              onClick={() => void runExport("csv")}
                            >
                              CSV
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              // JSON now follows the view like CSV/Excel, so it is
                              // disabled the same way they are when the
                              // transposed view has nothing to transpose.
                              disabled={
                                data === null ||
                                data === undefined ||
                                (isTransposed && exportRows === null)
                              }
                              title={
                                isTransposed && exportRows === null
                                  ? NOTHING_TO_TRANSPOSE_TITLE
                                  : undefined
                              }
                              onClick={() => void runExport("json")}
                            >
                              JSON
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={exportRows === null}
                              title={exportRows === null ? exportOffTitle : undefined}
                              onClick={() => void runExport("xlsx")}
                            >
                              Excel
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {isMarkdownNote ? (
                      <>
                        <button type="button" role="menuitem" onClick={() => void openMarkdownFile()}>
                          {"Open file…"}
                        </button>
                        <button type="button" role="menuitem" onClick={() => void saveMarkdownAs()}>
                          {"Save as…"}
                        </button>
                      </>
                    ) : null}
                    {showsTable ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={columnsSubOpen}
                          onClick={() => setColumnsSubOpen((v) => !v)}
                        >
                          {"Columns ▸"}
                        </button>
                        {columnsSubOpen ? (
                          <div role="group" className="card-submenu">
                            {/* Visibility only. Pinning is the table header's
                                own right-click menu, which is where a column
                                that can BE pinned -- a visible one -- is. */}
                            {menuOrder.map((field) => (
                              <button
                                key={field}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={!menuHidden.includes(field)}
                                onClick={() => toggleColumn(field)}
                              >
                                {`${menuHidden.includes(field) ? "☐" : "☑"} ${
                                  menuColumns.find((c) => c.field === field)?.header ?? field
                                }`}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <button type="button" role="menuitem" onClick={resetTable}>
                          Reset table
                        </button>
                      </>
                    ) : null}
                  </MenuPanel>
                ) : null}
              </>
            ) : null}
            {/* Offered in the viewer too, unlike Minimize: maximizing writes
                nothing at all, and a single-dashboard window is exactly where
                one card most wants the whole area. */}
            <button
              type="button"
              // One name with aria-pressed, never a name that flips as well:
              // "Restore, pressed" reads as the opposite of what it is.
              aria-label="Maximize"
              aria-pressed={maximized}
              onClick={() => void toggleMaximized()}
            >
              {maximized ? "⤡" : "⤢"}
            </button>
            {/* Expand shows whenever the card is minimized, viewer included:
                a card persisted minimized would otherwise be stuck showing
                only its header. Minimize itself stays out of the viewer. */}
            {minimized || (!viewer && minimizeButtonEnabled) ? (
              <button
                type="button"
                aria-label={minimized ? "Expand card" : "Minimize card"}
                onClick={() => void toggleMinimized()}
              >
                {minimized ? "▢" : "—"}
              </button>
            ) : null}
            {viewer ? null : (
              <button type="button" aria-label="Remove card" onClick={onRemove}>
                ✕
              </button>
            )}
          </div>
        </div>
        {/* The controls row: its own line under the title (see .card-params).
            Inside the header, not after it, so the title stays the grid's
            drag handle and the header's double-click guard is unchanged —
            `e.target === e.currentTarget` is still only the header itself. */}
        {!minimized && hasControls && widget && dashboard ? (
          <ParamControls
            widget={widget}
            card={card}
            groups={dashboard.groups}
            groupsDisabled={groupsDisabled}
            effective={params}
            backend={backend}
            onApply={(edit) => void apply(edit)}
          />
        ) : null}
      </header>
      {exportNotice ? (
        <p className="card-notice" role="status">
          {exportNotice}
        </p>
      ) : null}
      {/* What the backend warned about this data (OBBject warnings), e.g. a
          result it truncated: otherwise the card shows partial data as whole. */}
      {!minimized && status === "ready" && warnings?.length ? (
        <p className="card-notice" role="status">
          {warnings.join(" ")}
        </p>
      ) : null}
      {minimized ? null : !widget || (tabs.length === 0 && forms.length === 0) ? (
        <div className="card-body">{body()}</div>
      ) : (
        // A card with body controls lays its body out as a column and gives
        // the renderer a track of its own. Every renderer sizes against a
        // parent with a definite height (.table-scroll is `height: 100%`),
        // which .card-body stops being the moment it has siblings above the
        // renderer. A card with none keeps the plain block above, unchanged —
        // this shape exists only where it is needed.
        <div className="card-body card-body-controls">
          {tabs.map((p) => (
            <WidgetTabs
              key={p.paramName}
              param={p}
              value={params[p.paramName] ?? ""}
              onSelect={(v) =>
                void apply(splitParamEdit({ [p.paramName]: v }, card, groups, widget, groupsDisabled))
              }
            />
          ))}
          {forms.map((p) =>
            p.form ? (
              <WidgetFormPanel
                key={p.paramName}
                cardId={card.id}
                formParamName={p.paramName}
                form={p.form}
                values={params}
                card={card}
                groups={groups}
                groupsDisabled={groupsDisabled}
                query={query}
                backend={backend}
                onEdit={(changes) =>
                  void apply(splitParamEdit(changes, card, groups, widget, groupsDisabled))
                }
                onSubmitted={retry}
              />
            ) : null,
          )}
          <div className="card-render">{body()}</div>
        </div>
      )}
    </article>
  );
}
