// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { filterDateContext } from "../lib/dateFilters";
import { calendarOf } from "../lib/calendar";
import { CalendarRenderer } from "./renderers/CalendarRenderer";
import type { CalendarCardState } from "../lib/types";
import { PivotParamRow } from './PivotParamRow';
import { PivotToggle } from "./renderers/pivot-drawer/PivotToggle";
import { PivotIcon } from "./PivotIcon";

import { StatementWorkerView } from "./renderers/StatementWorkerView";
import type { StatementSnapshot } from "../lib/statementExecution";
import { LinkedChartRenderer } from "./renderers/LinkedChartRenderer";
import { type ComponentProps, lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { saveBinaryFile, saveTextFile } from "../lib/saveTextFile";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useStatementRows } from "../hooks/useStatementRows";
import { useWidgetData } from "../hooks/useWidgetData";
import type { SocketStatus } from "../hooks/useReconnectingSocket";
import { useCardRequest } from "../hooks/useCardRequest";

import { UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, SSRM_TYPES, fetchesData } from "../lib/builtins";
import { isCardAgentOffLimits, keyMaintBackendIds } from "../lib/providerKeys";
import { availableViews } from "../lib/cardViews";
import { rowsOf } from "../lib/chartShapes";
import { authHeaders } from "../lib/dataClient";
import { originOf } from "../lib/iframeProtocol";
import { exportFilename, collectPresentedExport, rowsForExport, toCsv, toJson, toJsonRows, toXlsx } from "../lib/export";
import { logError, logOnce } from "../lib/logger";
import { clampLogName } from "../lib/logNames";
import { markdownFileRefusal } from "../lib/markdownNote";
import { importRefusal } from "../lib/importLimits";
import { NEWS_RAIL_TITLE, defaultNewsBase, trimBase } from "../lib/news";
import { NEWS_FILE_NAME, parseNewsFile, serializeNewsState } from "../lib/newsFile";
import { bodyParams, paramsKey, visibleParams, wireParams } from "../lib/params";
import { splitParamEdit, type ParamEdit } from "../lib/paramGroups";
import { parseFyEndMonth } from "../lib/periods";
import { relativeTime } from "../lib/relativeTime";
import { FISCAL_AS_REPORTED } from "../lib/statementFiscal";
import { hiddenFields, orderFields, tableColumns, tableRows } from "../lib/tableColumns";
import { NOTHING_TO_TRANSPOSE, transposeRows } from "../lib/transpose";
import type { DashboardCard, NewsCardState, PinEdge, WidgetDef } from "../lib/types";
import { DOCKS_ID } from "../lib/dashboardsFile";
import { useBackendsStore } from "../stores/backendsStore";
import { useChatStore } from "../stores/chatStore";
import { ownerOfCard, useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { ErrorBoundary } from "./ErrorBoundary";
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
import { LinkedWidgetDialog } from "./LinkedWidgetDialog";
import { canUseLinkedSource } from "../lib/widgetData/sources";
import { tableExecutionStore } from "../stores/tableExecutionStore";
import { fitsTableWorker, isBackendTable, isManagedTable, isWorkerTableProducer } from "../lib/tableExecution/eligibility";
import { SsrmTableRenderer } from "./renderers/SsrmTableRenderer";
import { LocalTableRenderer, schemaColumns } from "./renderers/LocalTableRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricRenderer } from "./renderers/MetricRenderer";
import { MultiFileRenderer } from "./renderers/MultiFileRenderer";
import { NoteRenderer } from "./renderers/NoteRenderer";
import { DateProbeRenderer } from "./renderers/DateProbeRenderer";
import { ParamEchoRenderer } from "./renderers/ParamEchoRenderer";
import { YouTubeRenderer } from "./renderers/YouTubeRenderer";
import { NewsfeedRenderer } from "./renderers/NewsfeedRenderer";
import { LiveChartRenderer } from "./renderers/LiveChartRenderer";
import { LiveGridRenderer } from "./renderers/LiveGridRenderer";
import { OmniRenderer } from "./renderers/OmniRenderer";
import { vegaLiteToPlotly } from "../lib/vegaLite";
import { highchartsToPlotly } from "../lib/highcharts";
import { NewsRenderer, type NewsAutoScroll } from "./renderers/NewsRenderer";
import { RssRenderer } from "./renderers/RssRenderer";
import { NewsFeedsDialog } from "./dialogs/NewsFeedsDialog";
import { TradingViewRenderer } from "./renderers/TradingViewRenderer";
import { PdfRenderer } from "./renderers/PdfRenderer";
import { RawJsonView } from "./renderers/RawJsonView";
import {
  TableRenderer,
  type CellClickEvent,
  type TableStatePatch,
} from "./renderers/TableRenderer";
import type { WidgetMessaging } from "./renderers/useWidgetMessages";
import { ViewToggle, type ViewMode } from "./ViewToggle";

type Props = {
  card: DashboardCard;
  dashboardId?: string;
  onRemove: () => void;
  /** The "Open in new window" window: no Remove, no Minimize. */
  viewer?: boolean;
  /**
   * v8: a locked widget outside Settings ▸ Locked Widgets' editor. The body is
   * live (scroll, tabs, sort, zoom, Refresh, Export ▸), but nothing that
   * changes the card is offered: no Rename, Parameters, Duplicate, Copy to,
   * Pin widget, linked cards, Configure/Import feeds, Minimize or Close.
   * Every change goes through the editor, whose OK and Cancel then mean
   * what they say.
   */
  locked?: boolean;
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
/**
 * Types whose renderer takes `refreshKey` and reloads itself on a Refresh,
 * whatever fetchesData says about the card. Kept in step with body(): every
 * renderer there handed `refreshKey={attempt + refreshEpoch}` is listed.
 */
const SELF_REFRESHING_TYPES = new Set(["rss", "local_table", "multi_file_viewer", "live_grid", "live_chart"]);

/** The card types that render nothing but "Waiting for widget…" until their widget is discovered. */
const WAITS_FOR_WIDGET = new Set<string>(["iframe", "note", "markdown_editor", "clock", "rss", "local_table"]);

/** The News card's Auto-scroll param, narrowed; anything unknown is Off. */
function autoScrollOf(v: string | undefined): NewsAutoScroll {
  return v === "slow" || v === "medium" || v === "fast" ? v : "off";
}

export function WidgetCard({ card, dashboardId: explicitDashboardId, onRemove, viewer = false, locked = false }: Props) {
  // Everything the viewer window hides, a locked card hides too.
  const readOnly = viewer || locked;
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
  // The card's OWN dashboard -- the docks for a locked card (v8), which is
  // mounted outside the dashboard switch: binding its groups and params to
  // whatever dashboard is on screen would read and change another's.
  const dashboard = useDashboardStore((s) => {
    if (explicitDashboardId === DOCKS_ID) return s.docks;
    if (explicitDashboardId !== undefined) return s.dashboards.find(d => d.id === explicitDashboardId);
    return ownerOfCard(s, card.id) ?? s.dashboards.find(d => d.id === s.activeId);
  });
  const dashboardId = dashboard?.id ?? "";
  /** In the docks: locked, or in the Locked Widgets editor. */
  const inDocks = dashboardId === DOCKS_ID;
  const executionView = useSyncExternalStore(tableExecutionStore.subscribe, () => tableExecutionStore.readView(dashboardId, card.id));
  const allBackends = useBackendsStore((s) => s.backends);
  const [chooseSource, setChooseSource] = useState(false);
  const applyCardParams = useDashboardStore((s) => s.applyCardParams);
  const savePresetAction = useDashboardStore((s) => s.savePreset);
  const savePreset = (name: string, expr: string) => savePresetAction(dashboardId, name, expr);
  const deletePresetAction = useDashboardStore((s) => s.deletePreset);
  const deletePreset = (name: string) => deletePresetAction(dashboardId, name);
  const setCardMinimized = useDashboardStore((s) => s.setCardMinimized);
  const patchCardField = useDashboardStore((s) => s.patchCardField);
  const refreshEpoch = useDashboardStore((s) => s.refreshEpoch);
  const setMaximized = useDashboardStore((s) => s.setMaximized);
  const pinCard = useDashboardStore((s) => s.pinCard);
  const dropUngroupable = useDashboardStore((s) => s.dropUngroupable);
  // A boolean selector, not the id: only the card that gains or loses the
  // state re-renders, not every card on the tab.
  const maximized = useDashboardStore((s) => s.maximizedCardId === card.id);
  const duplicateCard = useDashboardStore((s) => s.duplicateCard);
  const copyCardTo = useDashboardStore((s) => s.copyCardTo);
  // Copy to ▸'s own list — every dashboard's tabs, not just the active one.
  const dashboards = useDashboardStore((s) => s.dashboards);
  const minimizeButtonEnabled = useSettingsStore((s) => s.settings.minimizeButton);
  const collapseControls = useSettingsStore((s) => s.settings.collapseWidgetControls);
  const contextSharing = useSettingsStore((s) => s.settings.contextSharing);
  const ritaUrl = useSettingsStore((s) => s.settings.ritaUrl);
  const sharedWithRita = useChatStore((s) => s.sharedCardIds.includes(card.id));
  const toggleShared = useChatStore((s) => s.toggleShared);
  // useResolvedTheme, not settings.theme: from v4.1.0 the setting can be
  // "system", which the vega-lite/highcharts translators cannot take -- they
  // want the resolved "dark" | "light", the same value ChartRenderer uses for
  // a figure it builds itself.
  const chartTheme = useResolvedTheme();
  const minimized = card.minimized ?? false;

  const [controlsOpen, setControlsOpen] = useState(false);
  /**
   * Is the title an InlineRename field right now? Transient by design: an
   * interrupted rename is not state worth persisting, and closing the field
   * is the only thing Escape has to do.
   */
  const [renaming, setRenaming] = useState(false);
  /** The News feed manager. Transient: closing it is the only thing it remembers. */
  const [feedsOpen, setFeedsOpen] = useState(false);
  // When a live_grid's renderer last took data (see timerTitle).
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<SocketStatus>("idle");
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
  /** Copy to ▸: which dashboard/tab list is expanded. Same in-place-section
   * contract as exportSubOpen/columnsSubOpen above. */
  const [copySubOpen, setCopySubOpen] = useState(false);
  /** Quick actions ▸: Autosize columns and Reset columns. */
  const [quickSubOpen, setQuickSubOpen] = useState(false);
  /** Pin widget ▸ (v8): Pin to top, Pin to bottom, Unpin. */
  const [pinSubOpen, setPinSubOpen] = useState(false);
  /** A `.catch` for one of this card's store writes: logs "failed to <what> for card <id>". */
  const logFail = (what: string) => (err: unknown) => logError(`failed to ${what} for card ${card.id}: ${err}`);
  /**
   * The Parameters panel — the chips row again, with labels showing, docked
   * under the title bar. v5.5.1 (user ruling 2026-09-30): opened and closed
   * from the title bar's ▸/▾ chevron (and the ⋯ menu's Parameters item),
   * closed by default, and saved per card in `paramsOpen`. It was a
   * light-dismiss popover in v5.5.0; a panel whose open state is saved
   * cannot also close on the first click elsewhere, so it docks instead and
   * stays until its chevron closes it.
   */
  const [paramsOpen, setParamsOpenState] = useState(card.paramsOpen === true);
  /** Set by a user's open, so focus moves in then -- never for a card that mounts open. */
  const focusParamsOnOpen = useRef(false);
  function setParamsOpen(open: boolean) {
    if (open === paramsOpen) return;
    focusParamsOnOpen.current = open;
    setParamsOpenState(open);
    void patchCardField(card.id, "paramsOpen", open ? true : null).catch(logFail("save the Parameters panel state"));
  }
  /**
   * Bumped by Quick actions ▸ Autosize columns. TableRenderer measures its
   * visible columns and patches `widths` each time this changes — the same
   * "bump a counter, effect fires" shape as tableResetKey below.
   */
  const [autosizeKey, setAutosizeKey] = useState(0);
  /**
   * The ⌕ toggle. Transient on purpose — the design's persisted list is sort,
   * filter, order, visibility and widths, and does not include whether the
   * filter row is showing.
   */
  const [filterRowOpen, setFilterRowOpen] = useState(false);
  /** A backend table's in-thread pivot panel (TableRenderer's own engine). */
  const [pivotPanelOpen, setPivotPanelOpen] = useState(false);
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
  const paramsRef = useRef<HTMLDivElement | null>(null);

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

  // v5.5.1: the Parameters panel no longer closes on Escape or an outside
  // mousedown. It docks inside the card and its open state is saved, so only
  // its own chevron (or the ⋯ menu's Parameters item) closes it.

  /**
   * Focus moves into the Parameters panel when the user opens it — otherwise
   * it stays on the ⋯ menu button that opened it, and a keyboard or screen
   * reader user never lands in the panel they just asked for. Not when a card
   * mounts with its panel saved open: a dashboard of those would otherwise
   * hand focus to whichever card mounted last.
   */
  useEffect(() => {
    if (!paramsOpen || !focusParamsOnOpen.current) return;
    focusParamsOnOpen.current = false;
    paramsRef.current
      ?.querySelector<HTMLElement>("input, select, button, [tabindex]")
      ?.focus();
  }, [paramsOpen]);

  /**
   * Escape restores. Registered only while THIS card is the maximized one, so
   * a dashboard of twenty cards has at most one such listener and a dashboard
   * with nothing maximized has none — Escape then reaches whatever else wants
   * it, unchanged.
   *
   * One Escape does ONE thing: the ⋯ menu, being
   * the innermost thing open, consumes the press and the card stays
   * maximized — the next press restores it. No guard is needed here for
   * that: the menu's own listener (MenuPanel) is on window in the CAPTURE
   * phase and stops the press there, so this bubble-phase one never sees it,
   * even though it was registered first (maximizing precedes opening the
   * menu over a maximized card). A rename needs no guard either: its field is
   * a React onKeyDown inside this subtree, which runs before this window
   * listener and calls stopPropagation (InlineRename.tsx).
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

  const { groups, groupsDisabled, exchange, fiscal, fiscalYearEnd, params, trading, hold, query } =
    useCardRequest(card, widget, backend, dashboard);
  // "Display on title bar": a Date expression card starts unchecked (user,
  // 2026-10-04), so for it an explicit `false` is what keeps the box checked.
  const hideTitleDefault = widget?.type === "date_probe";
  const hideTitleParams = card.hideTitleParams ?? hideTitleDefault;
  // A table's date filter expressions (T-1bd ...) step on the same exchange
  // calendar as the card's date params.
  const dateContext = useMemo(
    () => filterDateContext(calendarOf(widget, undefined, exchange, params).mic, trading.calendars),
    [widget, exchange, params, trading.calendars],
  );

  /**
   * v5.4.0 (spec §4.3; ruling 4): a saved binding to a param the widget now
   * marks `groupable: false` leaves the file once the widget is known — the
   * store cannot do it on load, since widgets are discovered after the
   * dashboards are read. groupedParamNames already ignores the binding, so
   * the renders before this write are right too. The viewer writes nothing.
   */
  useEffect(() => {
    if (!widget || viewer) return;
    const names = (card.bindings ?? [])
      .map((b) => b.paramName)
      .filter((name) => widget.params.some((p) => p.paramName === name && p.groupable === false));
    if (names.length === 0) return;
    void dropUngroupable(card.id, names).catch((err) =>
      logError(`failed to drop ungroupable bindings for card ${card.id}: ${err}`),
    );
  }, [widget, viewer, card.id, card.bindings, dropUngroupable]);


  // The manifest's flag, not a card setting: nothing about it is persisted.
  // `widget` is undefined for the first renders of every card, so this is
  // false until discovery resolves it — which is exactly the render on which
  // the hook arms its first fetch.
  const { status, data: rawData, error, warnings, retry, attempt, run, stale, intervalMs, completedAt, stalePastInterval } =
    useWidgetData(card, query, widget?.runButton, fiscalYearEnd, hold, exchange);
  // Statement fiscal relabelling (useStatementRows says why). Named `fiscalRows`:
  // `fiscal` above is the card's own FY-ends lookup.
  const fiscalRows = useStatementRows(widget, backend, query, rawData);
  const data = fiscalRows.data;
  // Rows the table runtime holds (local, managed, linked) carry the same "as reported" mark as a diagnostic.
  const fiscalNote = fiscalRows.asReported || !!executionView.ready?.diagnostics.some((d) => d.code === FISCAL_AS_REPORTED.code);
  const localFiscal = widget?.type === "local_table" && (fiscalNote || !!card.params.fiscalYearEndBackend);

  /** A card whose renderer owns its feed and reports through onLive/onStatus. */
  const liveFeed = widget?.type === "live_grid" || widget?.type === "live_chart";
  // The timer's tooltip, as the Workspace words it. `stale` (un-run edits) is
  // the run-button card's message; `stalePastInterval` (an old answer) only
  // colours the control, it does not change the words.
  const timerTitle = (() => {
    // The card never fetches a live_grid or a live_chart (their renderers
    // do), so completedAt stays null while rows tick; the renderer reports
    // when it last took data.
    // A live_chart without a wsEndpoint has no feed: it is a fetched chart,
    // and its tooltip is an ordinary card's, timed by the renderer's seed
    // (review F14).
    if (widget?.type === "live_chart" && !widget.wsEndpoint && status !== "error") {
      return liveAt === null
        ? "Not fetched yet"
        : `Last refresh ${relativeTime(liveAt)} · ${new Date(liveAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    }
    if (liveFeed && status !== "error") {
      return liveAt === null
        ? "Waiting for the feed"
        : `Live · last update ${relativeTime(liveAt)} · ${new Date(liveAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}`;
    }
    if (widget?.runButton) {
      // ⌘/Ctrl-click refreshes without adopting the edited parameters; the
      // tooltip is the only place that says so.
      const hint = "⌘-click: hard refresh";
      if (stale) return `Parameters changed — click to run · ${hint}`;
      return completedAt === null
        ? `Click to run · ${hint}`
        : `Click to run · Last run: ${new Date(completedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · ${hint}`;
    }
    if (status === "error") return "Click to retry";
    if (completedAt === null) return "Not fetched yet";
    return `Last refresh ${relativeTime(completedAt)} · ${new Date(completedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
  })();
  const doneAt = liveFeed ? liveAt : completedAt;
  // A live grid that has data but no open socket -- retrying, a first connect
  // still waiting, or minimised -- is stale, whatever its last row's age. So
  // is a live chart, but only one that has a socket to lose: without a
  // wsEndpoint it is a seeded chart and its socket is idle by design.
  const feedDown =
    (widget?.type === "live_grid" || (widget?.type === "live_chart" && !!widget.wsEndpoint)) &&
    liveAt !== null &&
    liveStatus !== "live";
  const timerTone = status === "error" || stalePastInterval || feedDown ? "stale" : doneAt === null ? "idle" : "fresh";

  // Declared controls that render in the BODY rather than in the header row:
  // tabs are meant to be seen, and a form is the card's main verb.
  const tabs = widget ? bodyParams(widget, "tabs") : [];
  const forms = widget ? bodyParams(widget, "form") : [];
  const hasControls = widget ? visibleParams(widget).length > 0 : false;
  // Does the ◷ do anything on this card? Yes when the hook has a request to
  // repeat (fetchesData), or when the renderer takes `refreshKey` and does
  // its own reload. Otherwise -- a framed page, a note, the clock, the keys
  // notice, a server-side table -- clicking it changed nothing and its
  // tooltip said "Not fetched yet" forever, so it is not drawn (v5.5.1, user
  // ruling 2026-09-30). A run-button card's ▶ always runs, so it stays.
  // Drawn while the widget is still resolving, as before.
  const refreshable = !!card.linkedSource || widget === undefined || fetchesData(widget) || SELF_REFRESHING_TYPES.has(widget.type);
  const view = card.view;
  /**
   * What the card's own error boundary calls this region — and, through
   * `componentDidCatch`, what it writes to the log. The widget's name, NOT
   * `card.title`: a title is free text the user typed, and `commitTitle`
   * below deliberately logs the card and the error and never the title, so
   * the boundary must not become the second route by which it reaches the
   * file. The widget name identifies the crashed card just as well — it is
   * what the header shows for a card that was never renamed, and a renamed
   * card keeps a `title=` tooltip carrying it.
   */
  const cardLabel = widget?.name ?? card.widgetId;
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
  const isStatement = view === "statement" && (TRANSPOSABLE_TYPES.has(widget?.type ?? "") || !!card.linkedSource || isManagedTable(card));
  const [statementSnapshot, setStatementSnapshot] = useState<StatementSnapshot>();
  const statementDefinition = useMemo(() => card.tableDefinition ?? (card.table ? { table: card.table, search: "" } : undefined), [card.tableDefinition, card.table]);
  const statementCollapsed = useMemo(() => new Set(card.statement?.collapsed ?? []), [card.statement?.collapsed]);
  const isTransposed = view === "transposed" && TRANSPOSABLE_TYPES.has(widget?.type ?? "");
  // A backend table's whole payload is on the client, so the table worker owns
  // it like a local file (Pivot drawer, linked tables) -- unless the payload is
  // past the worker's ceiling. SSRM tables are other widget types and never
  // get here. The rest pivot in-thread with TableRenderer's own panel.
  const backendTable = isBackendTable(card);
  // Memoised: the table's date filters start from these rows, recomputed per payload.
  const backendRows = useMemo(() => (backendTable ? tableRows(data) ?? undefined : undefined), [backendTable, data]);
  const workerTable = isWorkerTableProducer(card) && (!backendTable || fitsTableWorker(data));
  const backendPivot =
    widget?.type === "table" && !isTransposed && (view === undefined || view === "table") && !card.linkedSource && !workerTable;
  // Every outcome reaches the store -- an oversized payload and a failed fetch
  // too -- so linked children show the source's error, not its previous rows.
  // A retry's "loading" keeps whichever was handed over last.
  const failed = status === "error" || status === "incomplete";
  useEffect(() => {
    if (!dashboardId || !backendTable) return;
    if (failed) tableExecutionStore.setBackendRows(dashboardId, card.id, new Error(error ?? "Request failed"));
    else if (status === "ready" && data !== null) tableExecutionStore.setBackendRows(dashboardId, card.id, data);
  }, [dashboardId, backendTable, card.id, data, status, failed, error]);

  const modes: ViewMode[] = useMemo(() => availableViews(widget, data, { linkedSource: card.linkedSource }), [widget, data, card.linkedSource]);

  // No export surface at all for the built-in and document cards: fetchesData
  // is already the "this card has a fetched payload" predicate (it is false
  // for iframe, keys, multi_file_viewer and every builtin, i.e. note and
  // clock), and `pdf` is excluded on top of it because its payload IS one
  // base64 document, not data.
  // A worker table (local file or linked table) fetches nothing, but its
  // worker holds the rows it presents: runExport reads those instead (D-018).
  // Not in the Statement view: that exports the Statement it presents.
  const workerExport = workerTable && dashboard !== undefined && !isStatement;
  const canExport = isStatement || workerExport || (widget !== undefined && fetchesData(widget) && widget.type !== "pdf");
  // The markdown note has a ⋯ menu without an Export section: its two items
  // move a .md file in or out of the note. canExport means "this card has a
  // fetched payload, or is a worker table"; this is the menu's gate, not export's.
  const isMarkdownNote = widget?.type === "markdown_editor";
  /**
   * v8: the News card is a rail, not a window: no header, a vertical strip
   * down the right with a chevron for the menu and the title, so its top line
   * is a headline. Everything the header offered lives in that menu instead.
   */
  const railChrome = widget?.type === "news";
  const cardTitle = card.title ?? (railChrome ? NEWS_RAIL_TITLE : (widget?.name ?? card.widgetId));
  // Tagging a card for Rita. Only while Context Sharing is on (off sends
  // nothing, so a tag would mean nothing); never on keys, which
  // buildWidgetRefs never sends; never in a viewer window, which runs its own
  // stores, so a tag set there would never reach the main window's chat.
  // "Keys" is isAgentOffLimits since the settings add-ins: the provider_api_keys
  // table and settings widgets are never shared either.
  // Fix round 2: the whole registry decides it -- a widget on a backend that
  // serves key-maint is off limits too -- so the selector returns a boolean.
  // A linked table built on an off-limits card carries its rows: off limits too.
  const offLimits = useWidgetRegistryStore((s) =>
    s.find(card.backendId, card.widgetId) !== undefined &&
    isCardAgentOffLimits(card, dashboard?.tabs.flatMap((t) => t.cards) ?? [card], s.find, keyMaintBackendIds(s.widgets)));
  const canShare = !viewer && contextSharing && widget !== undefined && !offLimits;
  const hasMenu = widget !== undefined || workerTable || !!card.linkedSource;
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
    () => (isStatement ? (statementSnapshot?.statement?.rows ?? null) : isTransposed ? (transposed?.rows ?? null) : rowsForExport(data)),
    [isStatement, statementSnapshot, isTransposed, transposed, data],
  );
  // Explicit order for the exporters; undefined lets them derive it as today.
  const exportColumns = isStatement ? statementSnapshot?.statement?.columns : isTransposed ? transposed?.columns : undefined;
  // CSV and Excel head each column with the backend's headerName; JSON keeps
  // the field keys. Not the transposed or Statement view, whose columns are not fields.
  const exportLabels = useMemo(
    () => isTransposed || isStatement ? {} : Object.fromEntries(
      (widget?.table?.columns ?? []).flatMap((c) => (c.headerName ? [[c.field, c.headerName]] : [])),
    ),
    [isTransposed, isStatement, widget?.table?.columns],
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
      !isTransposed && !isStatement &&
      tableRows(data) !== null) ||
    // A local-file card's rows live inside its renderer, not in `data`: it
    // fetches nothing. The ⌕ toggle is the only thing this gate reaches for
    // such a card -- the Columns and Reset items below sit inside the ⋯ menu,
    // which no built-in card has (see canExport).
    ((isManagedTable(card) || widget?.type === "local_table" || (card.linkedSource && !card.linkedChart)) && !isTransposed && !isStatement);

  /**
   * The same column list the renderer builds, from the same pure function.
   * The checklist must not re-derive it, or the menu and the table could
   * disagree about which columns exist.
   */
  const menuColumns = useMemo(() => {
    if (workerTable && executionView.ready) return schemaColumns(executionView.ready.inspection.inputColumns, widget?.table);
    const rows = tableRows(data);
    return rows && rows.length > 0 ? tableColumns(rows, widget?.table) : [];
  }, [data, widget?.table, workerTable, executionView.ready]);
  const menuOrder = orderFields(menuColumns, card.table?.columnOrder);
  const menuHidden = hiddenFields(menuColumns, card.table?.hidden);

  const apply = (edit: ParamEdit) => applyCardParams(card.id, edit).catch(logFail("apply params"));
  /** A note card's one param. */
  const setText = (text: string) => apply({ cardParams: { ...card.params, text }, groupEdits: [] });

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
      splitParamEdit({ [click.paramName]: click.value }, card, groups, widget, groupsDisabled, fiscalYearEnd),
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
        `widget frame set undeclared param ${clampLogName(dropped[0])} on ${card.id}`,
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
    await apply(splitParamEdit(accepted, target, groups, w, groupsDisabled, fiscalYearEnd));
  }

  /** This card as the store holds it NOW, which a render's `card` may predate. */
  function currentCard(): DashboardCard | undefined {
    const active = useDashboardStore.getState().dashboards.find(d => d.id === dashboardId);
    return active?.tabs.flatMap((t) => t.cards).find((c) => c.id === card.id);
  }

  const setMinimized = (next: boolean) => setCardMinimized(card.id, next).catch(logFail("toggle minimized"));

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
    // The card and the error, never the typed title.
    await patchCardField(card.id, "title", next === widget?.name ? null : next).catch((err) =>
      logError(`failed to rename card ${card.id}: ${err}`),
    );
  }

  /**
   * The table toolkit's only write path. `null` clears the card's whole table
   * state ("Reset table"). The log line names the card and the error and
   * nothing else — a patch carries user-typed filter text, which is payload,
   * not diagnostics.
   */
  const saveTable = (patch: TableStatePatch | null) => patchCardField(card.id, "table", patch).catch(logFail("save table state"));

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

  async function pin(edge: PinEdge | null) {
    setExportOpen(false);
    try {
      await pinCard(card.id, edge);
    } catch (err) {
      await logError(`failed to pin card ${card.id}: ${err}`);
    }
  }

  async function saveNews(next: NewsCardState | null) {
    await patchCardField(card.id, "news", next).catch(logFail("save news feeds"));
  }

  /**
   * The card's feeds, tabs, highlights and tab order as one file, so a
   * configuration can travel between dashboards and machines. Default name
   * rss-agg.json; the notice reports what happened, as the export menu does.
   */
  async function exportNews() {
    setExportOpen(false);
    setExportNotice(null);
    const state = card.news ?? { feeds: [] };
    try {
      const written = await saveTextFile(NEWS_FILE_NAME, NEWS_FILE_NAME, serializeNewsState(state));
      if (!written) return;
      const n = state.feeds.length;
      setExportNotice(`Exported ${n} ${n === 1 ? "feed" : "feeds"} to ${NEWS_FILE_NAME}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice(`Export failed: ${message}`);
      await logError(`failed to export ${NEWS_FILE_NAME} for card ${card.id}: ${message}`);
    }
  }

  /** Replaces the card's whole configuration with the file's, all or nothing. */
  async function importNews() {
    setExportOpen(false);
    setExportNotice(null);
    try {
      const path = await openFileDialog({ multiple: false, filters: [{ name: NEWS_FILE_NAME, extensions: ["json"] }] });
      if (path === null) return;
      // Sized before it is read, as the other imports do.
      const oversize = importRefusal((await stat(path)).size);
      if (oversize !== null) {
        setExportNotice(oversize);
        return;
      }
      const parsed = parseNewsFile(await readTextFile(path));
      if (!parsed.ok) {
        setExportNotice(parsed.refusal);
        return;
      }
      await saveNews(parsed.state);
      const n = parsed.state.feeds.length;
      setExportNotice(`Imported ${n} ${n === 1 ? "feed" : "feeds"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice(`Import failed: ${message}`);
      await logError(`failed to import ${NEWS_FILE_NAME} for card ${card.id}: ${message}`);
    }
  }

  function resetTable() {
    setExportOpen(false);
    // The renderer seeds its widths once, so remounting is what re-seeds them.
    setTableResetKey((n) => n + 1);
    void saveTable(null);
  }

  /**
   * One ⋯-menu file action: closes the menu, clears the old notice, and turns
   * a failure into "<verb> failed: <message>" on the card and `<log> failed:
   * <message>` in the log.
   */
  async function menuAction(verb: string, log: string, work: () => Promise<void>) {
    setExportOpen(false);
    setExportNotice(null);
    try {
      await work();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExportNotice(`${verb} failed: ${message}`);
      await logError(`${log} failed: ${message}`);
    }
  }

  /**
   * A worker table exports what it shows: the presented() stream a linked
   * table consumes, but every eligible row rather than the row selection
   * (ignoreSelection), flattened by presentedForExport, through the same
   * writers. Named for the card's title (the dropped file's name), with no
   * params: a local card's only param is the stored copy's id.
   */
  async function runExport(kind: ExportKind) {
    const name = widget?.name ?? card.widgetId;
    // The widget's name and the error, never a row, a cell or a param
    // value: a payload can carry anything the backend holds.
    // The name is the WIDGET's, which came from whatever backend the user
    // added -- not a string this app wrote. Clamped for the log only; the
    // notice and the filename are not line-structured records.
    await menuAction("Export", `widget ${clampLogName(name)} export`, async () => {
      const view = workerExport ? tableExecutionStore.readView(dashboard!.id, card.id) : undefined;
      const executor = workerExport ? tableExecutionStore.readExecutor(dashboard!.id, card.id) : undefined;
      if (workerExport && (!executor || !view?.active || !["ready", "empty"].includes(view.status))) throw new Error("the table is not ready");
      // `query`, not `params`: the filename names the QUESTION the payload
      // answers, and a form's fields are not part of it. They would also
      // put a `<form>.<field>=` pair — the user's own typed input — into a
      // filename that lands on disk.
      const fileName = workerExport
        ? exportFilename(card.title ?? widget?.name ?? card.widgetId, backendTable ? query : {}, kind)
        : exportFilename(name, query, kind);
      // Through the shared helpers, not save() + write: on iOS the content
      // must exist BEFORE the picker opens (see saveTextFile), so rows are
      // gathered first. A cancel resolves false -- not a failure, and
      // nothing is written.
      // exportRows is non-null off the worker path: the CSV and Excel items
      // are disabled otherwise. The ?? [] is only what makes that legible to
      // the compiler.
      const table = executor && view?.active
        ? { ...(await collectPresentedExport(executor, view.active, new AbortController().signal)), labels: undefined }
        : { rows: exportRows ?? [], columns: exportColumns, dates: undefined, labels: exportLabels };
      if (kind === "json") {
        // JSON follows the view too, same as CSV/Excel (spec D5): the
        // transposed rows when the transposed view is showing, the raw
        // payload otherwise. toJsonRows, not toJson, for the reason toCsv
        // takes an explicit list -- a transposed row's own keys put an
        // integer-like header ("2024") ahead of `Field`.
        await saveTextFile(fileName, EXPORT_LABELS[kind], workerExport || isTransposed || isStatement ? toJsonRows(table.rows, table.columns) : toJson(data), kind);
      } else if (kind === "csv") {
        await saveTextFile(fileName, EXPORT_LABELS[kind], toCsv(table.rows, table.columns, table.labels), kind);
      } else {
        await saveBinaryFile(fileName, EXPORT_LABELS[kind], await toXlsx(table.rows, table.columns, table.dates, table.labels), kind);
      }
    });
  }

  async function openMarkdownFile() {
    await menuAction("Open", `card ${card.id} open markdown file`, async () => {
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
      await setText(await readTextFile(path));
    });
  }

  async function saveMarkdownAs() {
    await menuAction("Save", `card ${card.id} save markdown file`, async () => {
      // The card's own title when it has one, else the widget's name -- the
      // same label the header shows. No params: the note's one param IS the
      // text, and prose does not belong in a filename.
      const text = card.params.text ?? "";
      // ponytail: writes the param, which trails the editor by up to the
      // 500 ms debounce (the ⋯ click usually blurs the editor, which flushes).
      // Thread a flush() up from the renderer if that ever bites.
      await saveTextFile(
        exportFilename(card.title ?? cardLabel, {}, "md"),
        "Markdown",
        text.endsWith("\n") ? text : `${text}\n`,
        "md",
      );
    });
  }

  const saveCalendar = (patch: Partial<CalendarCardState>) => patchCardField(card.id, "calendar", patch).catch(logFail("save calendar state"));
  const declaresRange = widget !== undefined && ["start_date", "end_date"].every(name => widget.params.some(p => p.paramName === name));
  // What Static draws: the range the request sends, resolved the same way --
  // a date expression ("T-6w", "T") is not a date the calendar can parse.
  const calendarRange = useMemo(() => {
    if (!widget || !declaresRange) return undefined;
    const wired = wireParams(widget, { start_date: params.start_date ?? "", end_date: params.end_date ?? "" }, { fiscalYearEnd, calendars: trading.calendars, exchange });
    return { start: wired.start_date, end: wired.end_date };
  }, [widget, declaresRange, params.start_date, params.end_date, fiscalYearEnd, trading.calendars, exchange]);
  const onCalendarRange = useMemo(() => {
    if (!widget || !declaresRange) return undefined;
    return (range: { start_date: string; end_date: string }) => {
      const target = currentCard() ?? card;
      if (target.params.start_date === range.start_date && target.params.end_date === range.end_date) return;
      void apply(splitParamEdit(range, target, groups, widget, groupsDisabled, fiscalYearEnd));
    };
    // Read the current card for every edit, rather than retaining a stale payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, declaresRange, groups, groupsDisabled, fiscalYearEnd]);

  async function createLinked(presentation: 'table' | 'chart') {
    const owner = dashboard;
    const tabId = useDashboardStore.getState().activeTabIds[dashboardId] ?? dashboard?.tabs[0]?.id ?? null;
    if (!owner || !tabId) return;
    setExportOpen(false);
    try { await useDashboardStore.getState().addLinkedCard({ dashboardId: owner.id, tabId, sourceWidgetId: card.id, presentation }); }
    catch (error) { setExportNotice('Could not save the linked widget. Try again.'); await logError(`failed to create linked widget: ${error}`); }
  }

  function body() {
    if (isStatement && dashboard) return <StatementWorkerView
      dashboardId={dashboard.id} widgetId={card.id} owned={isManagedTable(card) || card.widgetId === "local_table" || !!card.linkedSource}
      data={data} spec={widget?.table} definition={statementDefinition} selection={card.tableSelection}
      sourceLoading={status === "loading"} sourceError={status === "error"}
      collapsed={statementCollapsed} onSnapshot={setStatementSnapshot}
      onToggle={section => {
        const folded = currentCard()?.statement?.collapsed ?? [];
        const collapsed = folded.includes(section) ? folded.filter(name => name !== section) : [...folded, section];
        void patchCardField(card.id, "statement", collapsed.length ? { collapsed } : null).catch(() => setExportNotice("Could not save Statement sections."));
      }} />;
    if (card.linkedSource && dashboard) return <LinkedCardBody dashboardId={dashboard.id} card={card} refreshKey={attempt} filterRow={filterRowOpen} onStateChange={(patch) => void saveTable(patch)} chooseSource={() => setChooseSource(true)} viewer={viewer} />;

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
          onChange={setText}
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
            onChange={setText}
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

    // The date scratchpad. Given the group-merged params for the same reason
    // the echo is: a grouped `expr` should probe whatever the group holds.
    // It fetches nothing -- resolution is the client's, through the same
    // resolveValue a fetching card's params go through, which is what makes
    // the card worth having.
    if (widget?.type === "date_probe") {
      if (status === "unresolved") return <p className="empty-state">Waiting for widget…</p>;
      return <DateProbeRenderer widget={widget} params={params} calendars={trading.calendars} exchange={exchange} />;
    }

    // The echo shows the group-merged params, not card.params: a group's
    // effect on this card is exactly what it exists to display.
    if (widget?.type === "param_echo") {
      if (status === "unresolved") return <p className="empty-state">Waiting for widget…</p>;
      return (
        <ParamEchoRenderer
          widget={widget}
          params={params}
          fiscalYearEnd={fiscalYearEnd}
          calendars={trading.calendars}
          exchange={exchange}
        />
      );
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

    // v8: same shape as rss above -- a built-in that owns its own connection,
    // so data is always null and the gate below would otherwise claim it.
    if (widget?.type === "news") {
      if (status === "unresolved") return <p className="empty-state">Waiting for widget…</p>;
      return (
        <NewsRenderer
          // Keyed by server: articles join their feed by the server's own
          // numeric feed id, so another server's rows kept across the switch
          // would be shown under whichever of its feeds shares the id. A new
          // server remounts empty; a reconnect or Refresh on the same one keeps
          // its rows.
          key={trimBase(card.params.url || defaultNewsBase())}
          // Empty means "the one server this page can reach": "" in the app (the
          // card asks for one), the preview's own /news relay on the web
          // (defaultNewsBase). The preview's seeded News card ships empty.
          base={card.params.url || defaultNewsBase()}
          feeds={card.news?.feeds ?? []}
          highlights={card.news?.highlights ?? []}
          refreshKey={attempt + refreshEpoch}
          // A locked card or a viewer window offers no edits (its write would be refused).
          onConfigure={readOnly ? undefined : () => setFeedsOpen(true)}
          tabOrder={card.news?.tabOrder ?? []}
          layout={card.params.layout === "horizontal" ? "horizontal" : "vertical"}
          autoScroll={autoScrollOf(card.params.autoScroll)}
          // The whole state is rewritten (patchCardField replaces `news`),
          // so the feeds and highlights ride along unchanged.
          onReorderTabs={readOnly ? undefined : (order) => void saveNews({ ...(card.news ?? { feeds: [] }), tabOrder: order })}
        />
      );
    }

    // Same shape as the note and clock early returns above, and for the same
    // reason: a local-file card fetches nothing, so `data` is always null and
    // the `data === null` gate below would claim it. Ordinary tables use the
    // dashboard runtime; the legacy transposed view reads its stored file.
    if (widget?.type === "local_table") {
      return (
        <LocalTableRenderer
          executionIdentity={isWorkerTableProducer(card) && dashboard ? { dashboardId: dashboard.id, widgetId: card.id } : undefined}
          file={card.params.file ?? ""}
          label={card.title ?? card.widgetId}
          // The runtime handles refresh-all across every tab. The renderer
          // receives only this card's Refresh; legacy transpose uses both.
          refreshKey={isWorkerTableProducer(card) && dashboard ? attempt : attempt + refreshEpoch}
          state={card.table}
          onStateChange={(patch) => void saveTable(patch)}
          filterRow={filterRowOpen}
          transposed={isTransposed}
          dateContext={dateContext}
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
      return <OmniRenderer widget={widget} backend={backend} params={query} context={{ exchange, fiscalYearEnd, calendars: trading.calendars }} />;
    }

    if (widget?.type === "live_grid" && backend) {
      // Like multi_file_viewer: fetchesData is false for live_grid, so the
      // card's data===null gate would otherwise claim it. The renderer fetches
      // its own snapshot and opens the socket. `query` carries the resolved
      // symbol selection, the same params a GET would send -- the EFFECTIVE
      // ones, so a group-bound symbol subscribes from the group (donor
      // b3d7ac4c). A live grid is a table card with a feed behind it, so it
      // gets everything the table case below gets (donor 811b7905), and
      // refreshKey is how the header's Refresh re-fetches its snapshot.
      return (
        <LiveGridRenderer
          // Reset table remounts the table, not the socket.
          tableKey={tableResetKey}
          widget={widget}
          backend={backend}
          params={query}
          refreshKey={attempt + refreshEpoch}
          onLive={setLiveAt}
          onStatus={setLiveStatus}
          state={card.table}
          onStateChange={(patch) => void saveTable(patch)}
          onCellClick={(click) => void handleCellClick(click)}
          // Gated like the table case below (canShare): a streamed row is card data too.
          onSendToAgent={
            !canShare || ritaUrl === "" ? undefined : (text, agentId) => useChatStore.getState().pushUserMessage({ text, agentId })
          }
          filterRow={filterRowOpen}
          autosizeKey={autosizeKey}
        />
      );
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

    // live-grid's Live Chart (V10-P4). The live_grid case's shape and reasons:
    // fetchesData is false, the renderer seeds itself from `/series` (the
    // first symbol of the EFFECTIVE params) and streams over the grid's
    // socket, and reports to the same refresh tooltip and stale tone.
    if (widget?.type === "live_chart" && backend) {
      return (
        <LiveChartRenderer
          widget={widget}
          backend={backend}
          params={query}
          refreshKey={attempt + refreshEpoch}
          onLive={setLiveAt}
          onStatus={setLiveStatus}
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
          // v5.4.0 (spec §5): the dashboard's exchange, as the siblings get it.
          exchange={exchange}
        />
      );
    }

    if (widget && SSRM_TYPES.has(widget.type)) {
      return <SsrmTableRenderer key={tableResetKey} card={card} widget={widget} backend={backend} dashboardId={dashboardId ?? ""} params={query} context={{exchange,fiscalYearEnd,calendars:trading.calendars}} held={hold.pending} refreshKey={attempt+refreshEpoch} readonly={viewer} autosizeKey={autosizeKey} filterRow={filterRowOpen} onStateChange={patch=>void saveTable(patch)}/>;
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

    // Raw is returned BEFORE type dispatch, which is why a widget type that
    // must suppress the raw view has to do so explicitly (SP5's keys widget).
    if (view === "raw") return <RawJsonView data={data} />;
    if (view === "chart") return <ChartRenderer data={data} uirevision={paramsKey(query)} />;
    if (view === "calendar") {
      const rows = rowsOf(data);
      if (rows?.length) return <CalendarRenderer rows={rows} state={card.calendar ?? {}} onPatch={patch => void saveCalendar(patch)} onRange={onCalendarRange} readOnly={viewer} table={widget?.table} range={calendarRange} />;
    }
    // Before the type dispatch, like raw and chart: the transposed grid is a
    // view of the payload, not of the widget's declared columns. local_table
    // is not here -- its rows never reach `data`, so its own renderer turns
    // them (see the early return above).
    if (isTransposed && widget?.type === "table") {
      if (transposed === null) {
        return <p className="empty-state">{NOTHING_TO_TRANSPOSE}</p>;
      }
      return <TableRenderer data={transposed.rows} columns={transposed.columns} />;
    }

    const type = widget?.type;

    switch (type) {
      case "table":
        if (workerTable && dashboard)
          return (
            <LocalTableRenderer
              executionIdentity={{ dashboardId: dashboard.id, widgetId: card.id }}
              file=""
              label={card.title ?? card.widgetId}
              // New rows reach the worker through setBackendRows; Refresh refetches them.
              refreshKey={0}
              state={card.table}
              onStateChange={(patch) => void saveTable(patch)}
              filterRow={filterRowOpen}
              dateContext={dateContext}
              spec={widget?.table}
              boundsRows={backendRows}
              onCellClick={(click) => void handleCellClick(click)}
            />
          );
        return (
          <TableRenderer
            key={tableResetKey}
            data={data}
            spec={widget?.table}
            pivotPreset={widget?.pivot}
            state={card.table}
            onStateChange={(patch) => void saveTable(patch)}
            onCellClick={(click) => void handleCellClick(click)}
            // A viewer window's chat store is not the main window's, with no
            // Rita URL there is nobody to send to, and a row is card data, so
            // it follows Context sharing and off-limits like any share (canShare).
            onSendToAgent={
              !canShare || ritaUrl === "" ? undefined : (text, agentId) => useChatStore.getState().pushUserMessage({ text, agentId })
            }
            filterRow={filterRowOpen}
            autosizeKey={autosizeKey}
            dateContext={dateContext}
            pivotOpen={pivotPanelOpen}
            onPivotOpen={locked ? undefined : () => setPivotPanelOpen(true)}
          />
        );
      case "chart":
        return <ChartRenderer data={data} uirevision={paramsKey(query)} />;
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

  // The two ParamControls instances (chips row, Parameters panel) differ
  // only in idPrefix; everything else is built once here.
  // A locked card offers no parameters at all: the chips, the panel and its
  // chevron all read this, and every one of them changes the card.
  const controlProps: ComponentProps<typeof ParamControls> | null =
    widget && dashboard && !locked
      ? {
          widget,
          card,
          groups: dashboard.groups,
          groupsDisabled,
          effective: params,
          backend,
          fiscalYearEnd,
          calendars: trading.calendars,
          exchange,
          presets: dashboard.presets,
          onSavePreset: (name, expr) => void savePreset(name, expr).catch(logFail("save preset")),
          onDeletePreset: (name) => void deletePreset(name).catch(logFail("delete preset")),
          // The viewer window's store refuses both preset writes and only
          // logs it, so a Save there would look as if it worked: its
          // Relative tab hides Save as preset and the saved chips' ×, and
          // keeps the chips and Apply.
          presetsReadOnly: viewer,
          onApply: (edit) => void apply(edit),
          fiscalReasons: fiscal.reasons,
          fiscalControl: fiscal.control
            ? {
                ...fiscal.control,
                override: parseFyEndMonth(card.fiscalYearEnd),
                onChange: (month) =>
                  void patchCardField(card.id, "fiscalYearEnd", month ?? null).catch(logFail("set the FY ends override")),
              }
            : undefined,
        }
      : null;

  function toggleMenu(e: React.MouseEvent<HTMLButtonElement>) {
    setExportAnchor(e.currentTarget);
    setExportNotice(null);
    // Reopening starts collapsed, so the menu is the same shape every time
    // it is opened.
    setExportSubOpen(false);
    setColumnsSubOpen(false);
    setCopySubOpen(false);
    setQuickSubOpen(false);
    setPinSubOpen(false);
    // The Parameters panel is NOT closed here any more: it is docked and
    // saved (v5.5.1), not a popover the menu replaces.
    setExportOpen((v) => !v);
  }

  /** The ⋯ menu, shared by the header's toggle and (v8) the News rail's chevron. */
  const menu = exportRect ? (

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
                    // Every section that opens in place: each grows the menu
                    // after it was clamped, Copy to ▸ by a row per tab of
                    // every dashboard.
                    layoutKey={`${exportSubOpen} ${columnsSubOpen} ${copySubOpen} ${quickSubOpen} ${pinSubOpen}`}
                  >
                    {locked ? null : (
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
                    )}
                    {railChrome ? (
                      <>
                        {locked ? null : (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setExportOpen(false);
                              setFeedsOpen(true);
                            }}
                          >
                            {"Configure feeds…"}
                          </button>
                        )}
                        <button type="button" role="menuitem" onClick={() => void exportNews()}>
                          {"Export feeds…"}
                        </button>
                        {readOnly ? null : (
                          <button type="button" role="menuitem" onClick={() => void importNews()}>
                            {"Import feeds…"}
                          </button>
                        )}
                      </>
                    ) : null}
                    {hasControls && !locked ? (
                      <button
                        type="button"
                        role="menuitem"
                        aria-expanded={paramsOpen}
                        onClick={() => {
                          setExportOpen(false);
                          setParamsOpen(!paramsOpen);
                        }}
                      >
                        {paramsOpen ? "Hide parameters" : "Parameters"}
                      </button>
                    ) : null}
                    {readOnly ? null : (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setExportOpen(false);
                          void duplicateCard(card.id).catch((err) =>
                            logError(`failed to duplicate card ${card.id}: ${err}`),
                          );
                        }}
                      >
                        Duplicate
                      </button>
                    )}
                    {readOnly ? null : (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={copySubOpen}
                          onClick={() => setCopySubOpen((v) => !v)}
                        >
                          {"Copy to ▸"}
                        </button>
                        {copySubOpen ? (
                          <div role="group" className="card-submenu">
                            {dashboards.flatMap((d) =>
                              d.tabs.map((t) => (
                                <button
                                  key={t.id}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setExportOpen(false);
                                    void copyCardTo(card.id, d.id, t.id).catch((err) =>
                                      logError(`failed to copy card ${card.id}: ${err}`),
                                    );
                                  }}
                                >
                                  {d.tabs.length === 1 ? d.name : `${d.name} › ${t.name}`}
                                </button>
                              )),
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
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
                    {/* A docks card never pins (pinCard refuses it), in the editor too. */}
                    {readOnly || inDocks ? null : (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={pinSubOpen}
                          onClick={() => setPinSubOpen((v) => !v)}
                        >
                          {"Pin widget ▸"}
                        </button>
                        {pinSubOpen ? (
                          <div role="group" className="card-submenu">
                            {([["top", "Pin to top"], ["bottom", "Pin to bottom"], [null, "Unpin"]] as const).map(([edge, label]) => (
                              <button key={label} type="button" role="menuitem" disabled={card.pinned === (edge ?? undefined)} onClick={() => void pin(edge)}>
                                {label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                    {!readOnly && !inDocks && workerTable ? <>
                      <button type="button" role="menuitem" onClick={() => void createLinked('chart')}>Create linked chart</button>
                      <button type="button" role="menuitem" onClick={() => void createLinked('table')}>Create linked table</button>
                    </> : null}
                    {!readOnly && card.linkedSource ? <button type="button" role="menuitem" onClick={() => { setExportOpen(false); setChooseSource(true); }}>Choose source</button> : null}
                    {canShare ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setExportOpen(false);
                          toggleShared(card.id);
                        }}
                      >
                        {sharedWithRita ? "Stop sharing with Rita" : "Share with Rita"}
                      </button>
                    ) : null}
                    {showsTable ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          aria-haspopup="menu"
                          aria-expanded={quickSubOpen}
                          onClick={() => setQuickSubOpen((v) => !v)}
                        >
                          {"Quick actions ▸"}
                        </button>
                        {quickSubOpen ? (
                          <div role="group" className="card-submenu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setExportOpen(false);
                                setAutosizeKey((n) => n + 1);
                              }}
                            >
                              Autosize columns
                            </button>
                            <button type="button" role="menuitem" onClick={resetTable}>
                              Reset columns
                            </button>
                          </div>
                        ) : null}
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
                      </>
                    ) : null}
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
                            {(["csv", "json", "xlsx"] as const).map((kind) => {
                              const rowsOff = !workerExport && exportRows === null;
                              return (
                                <button
                                  key={kind}
                                  type="button"
                                  role="menuitem"
                                  // JSON now follows the view like CSV/Excel, so it is
                                  // disabled the same way they are when the
                                  // transposed view has nothing to transpose.
                                  disabled={
                                    kind === "json"
                                      ? isStatement ? exportRows === null : !workerExport && (data === null || data === undefined || (isTransposed && exportRows === null))
                                      : rowsOff
                                  }
                                  title={
                                    kind === "json"
                                      ? isTransposed && exportRows === null ? NOTHING_TO_TRANSPOSE_TITLE : undefined
                                      : rowsOff ? exportOffTitle : undefined
                                  }
                                  onClick={() => void runExport(kind)}
                                >
                                  {EXPORT_LABELS[kind]}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {isMarkdownNote ? (
                      <>
                        {locked ? null : (
                          <button type="button" role="menuitem" onClick={() => void openMarkdownFile()}>
                            {"Open file…"}
                          </button>
                        )}
                        <button type="button" role="menuitem" onClick={() => void saveMarkdownAs()}>
                          {"Save as…"}
                        </button>
                      </>
                    ) : null}
                    {/* The rail has no header, so the header's own controls -- the
                        timer's Refresh and the ✕ -- live at the menu's tail. */}
                    {railChrome ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setExportOpen(false);
                            retry();
                          }}
                        >
                          Refresh
                        </button>
                        {/* A rail saved minimized has no header ▢ to expand it from. */}
                        {minimized ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setExportOpen(false);
                              void toggleMinimized();
                            }}
                          >
                            Expand
                          </button>
                        ) : null}
                        {readOnly ? null : (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setExportOpen(false);
                              onRemove();
                            }}
                          >
                            Close
                          </button>
                        )}
                      </>
                    ) : null}
                  </MenuPanel>
  ) : null;

  return (
    <article
      className={railChrome ? "widget-card card-rail" : "widget-card"}
      data-minimized={minimized || undefined}
      // The only feedback a manual Refresh gives once the body stops
      // blanking. Styled as a dimmed title plus a dot, not an animation:
      // nothing else in this stylesheet moves.
      data-refreshing={status === "loading" && data !== null ? "true" : undefined}
    >
      {railChrome ? null : (
      <header
        className="card-header"
        // The header BACKGROUND only. `e.target === e.currentTarget` is the
        // whole guard: .card-controls is `display: contents`, so the only
        // other double-click targets in this row are the title (which
        // renames), the buttons (which do their own jobs) and .card-params —
        // the controls row below, whose inputs, selects and group buttons now
        // sit inside this header too. None of them is the header element
        // itself, so the guard still holds. `.card-chips` (Task 2) is a real
        // element too, not `display: contents` — a double-click landing in
        // its own padding rather than on a chip is still not
        // `e.currentTarget`, so it does nothing, which is intended: only the
        // header's bare background maximizes.
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) void toggleMaximized();
        }}
      >
        {/* The Workspace's timer: left-most in the row, click refreshes (or
            runs), the colour says whether the answer is still fresh, and the
            tooltip says how old it is. It carries `card-stale` while a
            run-button card has un-run edits — the class the e2e reads — so
            the separate dot span below is gone. */}
        {widget?.runButton || refreshable ? (
        <button
          type="button"
          className={`card-timer${widget?.runButton && stale ? " card-stale" : ""}`}
          aria-label={widget?.runButton ? "Run" : "Refresh"}
          aria-describedby={`${card.id}-timer-desc`}
          title={timerTitle}
          data-tone={timerTone}
          onClick={(e) => (widget?.runButton && !(e.metaKey || e.ctrlKey) ? run() : retry())}
        >
          {widget?.runButton ? "▶" : "◷"}
        </button>
        ) : null}
        {/* The timer's tooltip, restated for assistive tech: `title` alone
            never reaches a screen reader. */}
        {widget?.runButton || refreshable ? (
          <span id={`${card.id}-timer-desc`} className="sr-only">
            {timerTitle}
          </span>
        ) : null}
        {/* v5.5.1 (user ruling 2026-09-30): the Parameters panel's own
            toggle, on every card with parameters. ▸ is closed, ▾ is open;
            the state is saved on the card (see paramsOpen). */}
        {hasControls && !minimized && !locked ? (
          <button
            type="button"
            className="card-params-chevron"
            aria-expanded={paramsOpen}
            title={paramsOpen ? "Hide parameters" : "Show parameters"}
            aria-label={paramsOpen ? "Hide parameters" : "Show parameters"}
            onClick={() => setParamsOpen(!paramsOpen)}
          >
            {paramsOpen ? "▾" : "▸"}
          </button>
        ) : null}
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
            onDoubleClick={locked ? undefined : () => setRenaming(true)}
          >
            {card.title ?? widget?.name ?? card.widgetId}
          </span>
        )}
        {/* The controls row, promoted to its own real flex item (Task 2) so it
            sits beside the title on one line instead of forcing a second one
            (see .card-chips). Hidden along with the icon cluster while the
            controls are collapsed and the chevron hasn't been opened — a
            collapsed card that still showed its chips would defeat the
            chevron's whole point. Inside the header, not after it, so the
            title stays the grid's drag handle and the header's double-click
            guard is unchanged — `e.target === e.currentTarget` is still only
            the header itself. */}
        {!minimized && card.tableDefinition?.analytical === undefined && hasControls && !hideTitleParams && controlProps ? (
          <div
            className={`card-chips${collapseControls && !controlsOpen ? " card-chips-hidden" : ""}`}
          >
            <ParamControls {...controlProps} />
          </div>
        ) : null}
        {sharedWithRita && canShare ? (
          <span
            className="card-rita"
            role="img"
            aria-label="Shared with Rita"
            title="Shared with Rita for this conversation"
          >
            {"Rita"}
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
                  void patchCardField(card.id, "view", v ?? null).catch(logFail("save the view"))
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
            {hasMenu ? (
              <>
                <button
                  type="button"
                  className="card-action"
                  aria-label="Card menu"
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  onClick={toggleMenu}
                >
                  {"⋯"}
                </button>
                {menu}
              </>
            ) : null}
            {dashboard && !locked && !isTransposed && !isStatement && (workerTable || (!!card.linkedSource && !card.linkedChart)) ? <PivotToggle dashboardId={dashboard.id} widgetId={card.id}/> : null}
            {backendPivot && !locked ? (
              <button
                type="button"
                className="card-action pivot-toggle"
                aria-label="Pivot"
                title="Pivot · Icon by Matt Garbarino, Noun Project · CC BY 3.0 (cropped and recoloured)"
                aria-expanded={pivotPanelOpen}
                data-pivot={card.table?.pivot?.enabled ? "on" : "off"}
                onClick={() => setPivotPanelOpen((open) => !open)}
              >
                <PivotIcon />
              </button>
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
            {minimized || (!readOnly && minimizeButtonEnabled) ? (
              <button
                type="button"
                aria-label={minimized ? "Expand card" : "Minimize card"}
                onClick={() => void toggleMinimized()}
              >
                {minimized ? "▢" : "—"}
              </button>
            ) : null}
            {readOnly ? null : (
              <button type="button" aria-label="Remove card" onClick={onRemove}>
                ✕
              </button>
            )}
          </div>
        </div>
        {/* The Parameters panel: the chips row again, as a form with its
            labels showing (styles.css makes .param-label-hidden static inside
            .card-params-panel). A child of <header>, after .card-controls,
            on a line of its own under the bar (the header wraps). Docked,
            not floating, since v5.5.1 -- see paramsOpen. */}
        {paramsOpen && !minimized && controlProps ? (
          <div className="card-params-panel" role="region" aria-label="Parameters" ref={paramsRef}>
            <ParamControls
              {...controlProps}
              // Same viewer read-only contract as the chips instance.
              // Distinguishes this panel's ids from the chips row's (both mount ParamControls for the same card while the panel is open).
              idPrefix="params-"
            />
            {/* v5.5.1: whether the chips also sit on the title bar. Unchecked,
                this panel is the only place they are edited. Viewer
                windows can't save it, so the box is read-only there. Below the
                parameters so the open-focus still lands on the first one. */}
            <label className="card-params-titlebar">
              <input
                type="checkbox"
                checked={!hideTitleParams}
                disabled={viewer}
                onChange={(e) =>
                  void patchCardField(card.id, "hideTitleParams", e.target.checked === hideTitleDefault ? !e.target.checked : null).catch(
                    logFail("set title-bar parameters"),
                  )
                }
              />
              Display on title bar
            </label>
          </div>
        ) : null}
        {!minimized && dashboard && card.tableDefinition?.analytical !== undefined ? <PivotParamRow dashboardId={dashboard.id} widgetId={card.id} raw={card.tableDefinition.analytical} viewer={readOnly} ordinary={hasControls && !hideTitleParams && controlProps && (!collapseControls || controlsOpen) ? <ParamControls {...controlProps} inline /> : undefined} /> : null}
      </header>
      )}
      {railChrome ? (
        // v8: the strip -- the menu's chevron at the top, the title running
        // down. The title carries .card-title, which is the grid's drag
        // handle, and double-clicks to rename like any card title.
        <aside className="card-rail-chrome">
          <button
            type="button"
            className="card-action card-rail-chevron"
            aria-label="Card menu"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={toggleMenu}
          >
            {exportOpen ? "▾" : "◂"}
          </button>
          {menu}
          <span
            className={card.title === undefined ? "card-title card-rail-title" : "card-title card-rail-title card-title-custom"}
            title={card.title === undefined ? undefined : widget?.name}
            onDoubleClick={locked ? undefined : () => setRenaming(true)}
          >
            {cardTitle}
          </span>
        </aside>
      ) : null}
      {railChrome && renaming ? (
        <div className="card-rail-rename">
          <InlineRename
            value={cardTitle}
            ariaLabel="Card title"
            onCommit={(next) => void commitTitle(next)}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : null}
      {/* The rail's Parameters panel: the same docked, saved panel every card
          opens from its menu (paramsOpen), placed here because a rail has no
          header to hang it under. No "Display on title bar": there is no
          title bar. */}
      {railChrome && paramsOpen && !minimized && controlProps ? (
        <div className="card-params-panel card-rail-params" role="region" aria-label="Parameters" ref={paramsRef}>
          <ParamControls {...controlProps} idPrefix="rail-" />
        </div>
      ) : null}
      {feedsOpen ? (
        <NewsFeedsDialog
          state={card.news}
          onDone={(next) => {
            setFeedsOpen(false);
            void saveNews(next);
          }}
          onClose={() => setFeedsOpen(false)}
        />
      ) : null}
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
        // One boundary per card, around the BODY only: a renderer that
        // throws must not take the grid down with it, and the header stays
        // so the card can still be removed, renamed or refreshed. `view` as
        // the reset key, because switching Table/Chart/Raw is the user
        // asking for a different renderer than the one that failed.
        <div className="card-body">
          <ErrorBoundary label={cardLabel} resetKey={view}>
            {body()}
          </ErrorBoundary>
        </div>
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
                void apply(splitParamEdit({ [p.paramName]: v }, card, groups, widget, groupsDisabled, fiscalYearEnd))
              }
            />
          ))}
          {forms.map((p) =>
            p.form ? (
              <WidgetFormPanel
                key={p.paramName}
                formParamName={p.paramName}
                form={p.form}
                values={params}
                card={card}
                groups={groups}
                groupsDisabled={groupsDisabled}
                query={query}
                backend={backend}
                wire={{ widget, fiscalYearEnd, calendars: trading.calendars, loading: trading.loading, exchange }}
                onEdit={(changes) =>
                  void apply(splitParamEdit(changes, card, groups, widget, groupsDisabled, fiscalYearEnd))
                }
                onSubmitted={retry}
              />
            ) : null,
          )}
          <div className="card-render">
            <ErrorBoundary label={cardLabel} resetKey={view}>
              {body()}
            </ErrorBoundary>
          </div>
        </div>
      )}
      {/* Under the body, a sibling of it: the renderers size to 100% of
          .card-body, so a line INSIDE the body would push them past it. */}
      {!minimized && (fiscalNote || localFiscal) ? (
        <p className="card-fiscal-note">
          {fiscalNote ? "Fiscal labels as reported" : null}
          {/* A local table has no backend of its own: the card names whose fiscal-year-end endpoint to ask. */}
          {localFiscal ? (
            <label>
              {" "}FY ends from{" "}
              <select aria-label="FY ends from" disabled={viewer} value={card.params.fiscalYearEndBackend ?? ""}
                onChange={(e) => {
                  const { fiscalYearEndBackend: _, ...rest } = card.params;
                  void applyCardParams(card.id, { cardParams: e.target.value ? { ...rest, fiscalYearEndBackend: e.target.value } : rest, groupEdits: [] });
                }}>
                <option value="">None</option>
                {allBackends.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          ) : null}
        </p>
      ) : null}
      {chooseSource && dashboard ? <LinkedWidgetDialog dashboardId={dashboard.id} tabId={dashboard.tabs.find(t => t.cards.some(c => c.id === card.id))!.id} cardId={card.id} onClose={() => setChooseSource(false)} /> : null}
    </article>
  );
}

/** Linked presentations share the dashboard runtime status and source repair action. */
function LinkedCardBody({ dashboardId, card, refreshKey, filterRow, onStateChange, chooseSource, viewer }: {
  dashboardId: string; card: DashboardCard; refreshKey: number; filterRow: boolean;
  onStateChange: (patch: TableStatePatch) => void; chooseSource: () => void; viewer: boolean;
}) {
  const view = useSyncExternalStore(tableExecutionStore.subscribe, () => tableExecutionStore.readView(dashboardId, card.id));
  useEffect(() => { tableExecutionStore.ensureTable(dashboardId, card.id); }, [dashboardId, card.id, card.linkedSource?.sourceWidgetId]);
  const dashboard = useDashboardStore(s => s.dashboards.find(d => d.id === dashboardId));
  // Recoverable model/worker failures retain the mounted presentation and its
  // completed result. Missing, cyclic, foreign and legacy source ancestry does not.
  const unavailable = view.status === 'unavailable' || !dashboard || !card.linkedSource
    || !canUseLinkedSource(dashboard, card.id, card.linkedSource.sourceWidgetId);
  const content = <>
    {!viewer ? <button type="button" onClick={chooseSource}>Choose source</button> : null}
    {!unavailable && view.stale ? <p role="status">Showing completed data (stale).</p> : null}
    {!unavailable && card.linkedChart && view.error ? <p role="alert">{view.error}</p> : null}
    {unavailable ? <div><p className="empty-state">Source unavailable</p><p role="status">{view.error}</p></div>
      : card.linkedChart ? <LinkedChartRenderer dashboardId={dashboardId} card={card} refreshKey={refreshKey} viewer={viewer} onSettingsChange={settings => useDashboardStore.getState().commitLinkedChartSettings(dashboardId, card.id, settings)} />
      : <LocalTableRenderer executionIdentity={{ dashboardId, widgetId: card.id }} file="" label={card.title ?? card.widgetId} refreshKey={refreshKey} state={card.table} onStateChange={onStateChange} filterRow={filterRow} />}
  </>;
  return card.linkedChart ? <div className="linked-chart-card">{content}</div> : content;
}
