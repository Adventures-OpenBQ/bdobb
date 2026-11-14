// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { Stamp } from "../../lib/chartDocument";
import {
  AreaSeries, BarSeries, CandlestickSeries, CrosshairMode, HistogramSeries, LineSeries, LineStyle, LineType,
} from "lightweight-charts";
import type { IChartApi, IPriceLine, ISeriesApi, SeriesDefinition, SeriesType as PlotSeriesType } from "lightweight-charts";
import { configureArtsCharts, getHost, type ArtsChartsHost } from "../../host";
import { useTickCache, type AvwapSeries, type Candle } from "../../hooks/useTickCache";
import { chartTickRelay } from "../../lib/chartTickRelay";
import { useSeriesBars } from "../../hooks/useSeriesBars";
import { useStudySeries, type StudyFeed, type StudySeries } from "../../hooks/useStudySeries";
import { useTaRegistry } from "../../hooks/useTaRegistry";
import { useChartDocument } from "../../hooks/useChartDocument";
import { useWatches } from "../../hooks/useWatches";
import { type FillPattern, isFillPattern, lineStyleOf } from "../../lib/chart/pen";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { buildWidgetWsUrl, fetchWidgetPath } from "../../lib/dataClient";
import { distanceTo, gannSlopes, pointsOf, slopeBetween } from "../../lib/chartDrawings";
import { isRecord } from "../../lib/isRecord";
import { logOnce, reportError } from "../../lib/logger";
import { saveBinaryFile } from "../../lib/saveTextFile";
import { loadChartPresets, type ChartPreset } from "../../lib/chartPresetsFile";
import {
  loadChartFavorites, saveChartFavorites, upsertFavorite, removeFavorite as removeFavoriteFrom,
  type ChartFavorite,
} from "../../lib/chartFavoritesFile";
import { cardFromLayout, layoutMatches } from "../../lib/chart/layouts";
import { INTERVAL_WIRE_VALUES } from "../../lib/chart/intervalLabel";
import { useChartLayoutsStore } from "../../stores/chartLayoutsStore";
import type {
  BackendConfig, ChartAddition, ChartCardState, ChartDrawing, ChartLevel, ChartPoint, DashboardCard, ParamGroup, Series,
  StudyInstance, WidgetDef,
} from "../../lib/types";
import { ChartControls } from "./arts-charts/ChartControls";
import { Header } from "./arts-charts/Header";
import { LayoutEditor } from "./arts-charts/LayoutEditor";
import { RangePopover } from "./arts-charts/RangePopover";
import { IntervalPopover } from "./arts-charts/IntervalPopover";
import { SeriesPalette } from "./arts-charts/SeriesPalette";
import { StudiesStrip } from "./arts-charts/StudiesStrip";
import { ToolRail, confirmClear, type ChartTool } from "./arts-charts/ToolRail";
import { Legend, type LegendSink, type LegendStudy, type LegendValues } from "./arts-charts/Legend";
import { StatusBar } from "./arts-charts/StatusBar";
import { PanelHost, type PanelApi } from "./arts-charts/PanelHost";
import { chartTimeLabels, createTimeScaleBehavior } from "../../lib/chartTime";
import { chartTheme, readChartTokens, withAlpha } from "../../lib/chart/createChartTheme";
import { formatDelta, formatPrice, priceDecimals } from "../../lib/chart/formats";
import { chartSummary } from "../../lib/chart/summary";
import { buildChartSpec, parseChartSpec, specJson } from "../../lib/chart/chartSpec";
import { DEFAULT_PANELS_TEXT, encodePanels, parsePanels, scaleOrder } from "../../lib/chart/panels";
import { closeData, ohlcData, performanceData, volumeData } from "../../lib/chart/derived";
import {
  GROUP_PREFIX, MAX_LIST, SERIES_TYPE_LABELS, bareStudyExpr, indicatorsFromSeries, migrateChart, parseSymbolList,
  resolveVersus, seriesFromMacro, seriesLabel, seriesTicker, versusLabel,
} from "../../lib/chart/series";
import { TICKER_PARAM, matchSeries, studiesFromParam } from "../../lib/chart/indicatorsParam";
import { sendRaw } from "../../lib/chart/wireAnchor";
// The card's `start`/`end` as instants, read exactly as the wire reads them
// for `S`/`E` in any other widget parameter -- one parser, one answer.
import { paramInstant } from "../../lib/params";
import { argText, expressionLabel, isBusinessDays, type CatalogEntry } from "../../lib/chart/studyExpression";
import { anchorResolver, exchangeFor, type AssetClass } from "../../lib/chart/exchangeFor";
import { attachBandFill, DEFAULT_SHADE_OPACITY } from "../../lib/chart/bandFill";
import { sessionBars } from "../../lib/chart/sessionFilter";
import { liveCandles, liveNote, streamOnGrid, volumeNote } from "../../lib/chart/liveBars";
import { studySocketUrl } from "../../lib/chartServer";
import { bundledCalendar, weekdayCalendar } from "../../lib/tradingCalendar";
import { snapToBar } from "../../lib/chart/magnet";
import { measureBetween } from "../../lib/chart/measure";
import { heroDelta } from "../../lib/chart/priceDelta";
import { RANGE_PRESETS, presetFor, resolveInstant, resolveRange } from "../../lib/chart/rangeExpr";
import { boundLayoutName, effectiveChartState, encodeRange, type ChartEdit } from "../../lib/chart/chartGroups";
import { barsWindow, firstBarOnOrAfter, weekdaysBefore, wholeDayFrom } from "../../lib/chart/window";
import { padStart, parseIntervalSeconds, warmupBars } from "../../lib/chart/warmup";
import { canvasBytes, composePanels, loadMark, shootAt, SNAPSHOT_SCALE, snapshotName } from "../../lib/chart/snapshot";
import { watermarkStyle } from "../../lib/chart/watermark";
import { outputShown } from "../../lib/chart/outputs";
import { createAxisLabel } from "../../lib/chart/axisLabel";

// The interval buttons come from the widget's own `interval` parameter, so
// the toolbar follows the manifest (widgets.json) rather than a list kept
// here. These seven are the fallback for a manifest that declares no
// options at all: a chart with no way to change interval is worse than one
// offering the set every arts_charts backend has shipped so far. That
// fallback list is now the shared INTERVAL_WIRE_VALUES (spec 2026-09-25,
// G1), so the Custom… box and the chips speak the same interval vocabulary.

/** The rail's selectable tools, measure included; magnet is a mode. */
const TOOL_COUNT = 8;

/** The tools an EODHD chart cannot serve (v12.3.1): the anchored VWAP. */
const EODHD_DISABLED: ChartTool[] = ["anchor"];
/** A stable empty list: the avwap effect is keyed on the array's identity. */
const NO_AVWAPS: AvwapSeries[] = [];
/** Ditto, for the rail's `disabled` prop on a local chart. */
const NO_TOOLS: ChartTool[] = [];
/** A live card's /series poll: the chart server reuses live-grid's tape for 5 s (step 1 ruling 6). */
const LIVE_POLL_MS = 5_000;

/** Below this card width the range chips collapse and the legend drops Vol (spec §15 criterion 10). */
const NARROW_WIDTH = 540;

/** The layout a card with no `panels` parameter (and no readable one) draws in. */
const DEFAULT_PANELS = parsePanels(DEFAULT_PANELS_TEXT).panels;

/**
 * How many OTHER symbols one card's bar series may name: list entries, literals and groups compete for the same slots (spec 2026-11-13 §2).
 *
 * ponytail: a fixed ceiling, because a hook cannot be called in a loop whose
 * length changes and every extra ticker is one `useSeriesBars`. Four covers
 * a symbol against three benchmarks, which is the case the spec describes;
 * a fifth is left off with a note on its chip. Upgrade path: one
 * <SeriesBars symbol=… onBars=…/> child per ticker, lifting its bars up.
 */
const MAX_EXTRA_SYMBOLS = 4;
const NO_FEEDS: StudyFeed[] = [];

/** An area series' fill opacity when the series does not name one (spec, Series). */
const AREA_FILL_OPACITY = 0.15;

/**
 * A volume series ALONE on its scale grows off the floor of it (spec §8.3):
 * only the top breathing room is left, the bottom stays flush on the axis.
 */
const VOLUME_SCALE_MARGINS = { top: 0.1, bottom: 0 };
/**
 * lightweight-charts' own price-scale margins, written back when a volume
 * series stops being alone on its side (T6 review, finding 6) -- sharing a
 * scale does not rebuild the chart, so the volume's margins have to be taken
 * off explicitly or the newcomer is squashed into the top 90%.
 */
const DEFAULT_SCALE_MARGINS = { top: 0.2, bottom: 0.1 };

/** A bar time (unix seconds) as an instant, or undefined when there is no bar. */
function barInstant(time: number | undefined): Date | undefined {
  return time === undefined ? undefined : new Date(time * 1000);
}

// A click within this many screen pixels of a drawing selects it. Compared
// against `distanceTo`'s output, which is in the same screen units -- see
// the scale computed in the click handler's "panning" branch below.
const HIT_PIXELS = 8;

// The three tools that are a press-drag-release rather than a click. Two
// discrete clicks was the old shape, and it read as "nothing happened" twice
// over: the first click showed nothing, and a second click on the same bar
// was dropped by the zero-width guard in silence.
// Measure is a drag too, but the one that records nothing: its release
// leaves a floating label, not a figure on the card (spec §7.2).
const DRAG_TOOLS = new Set<ChartTool>(["segment", "ray", "fib", "measure"]);

// onPatch is how every change this card makes reaches the dashboard store.
// onClear (drop the whole `chart` field) stays in the shape WidgetCard
// passes, but nothing in here calls it any more -- see clearPatch below.
/** Undo's saved stack keeps the newest hundred additions; older ones fall off. */
const UNDO_LIMIT = 100;

/** `stack` with `entry` pushed on top, trimmed to UNDO_LIMIT. */
function pushAdded(stack: readonly ChartAddition[] | undefined, entry: ChartAddition): ChartAddition[] {
  return [...(stack ?? []), entry].slice(-UNDO_LIMIT);
}

/** Where `item` last appears in `list`, matched by value: a patch round-trips
 * through the dashboard store, so the saved figure is an equal copy of the
 * one this session pushed, not the same object. -1 when it is gone. */
function lastIndexOfEqual(list: readonly unknown[] | undefined, item: unknown): number {
  const key = JSON.stringify(item);
  return (list ?? []).map((x) => JSON.stringify(x)).lastIndexOf(key);
}

/**
 * Why a study pasted into the spec popover is not one, or null. The same
 * shape check parseStudyExpression makes on typed text -- a name the catalog
 * knows and params keyed by that entry's declared params -- plus the record
 * fields the strip and the socket read (`expr`, `color`, `source`), since a
 * pasted document is the one place an instance reaches the card without
 * having been built by instanceFromParse.
 * ponytail: `expr` is not checked against normalizeExpression(name, params),
 * so a pasted expr can disagree with its own params until the next edit
 * rebuilds it. Upgrade path: recompute it here and compare.
 *
 * v12.3.0 (slice 4): `allowBusinessDays` admits a `"50bd"` string on a
 * numeric param -- the one non-number the wire carries there -- and only
 * when the symbol has an exchange to count sessions on.
 *
 * v12.3.0 (slice 4, follow-up): a `bd` window is only legal on the names
 * `entry.windows` lists, and a study carries ONE unit for all of them --
 * the same two rules parseStudyExpression enforces on typed text (see
 * unifyWindows there). A pasted document skips that parser entirely, so
 * `bbands:k=2bd` (not a window) or a mixed `macd:fast=12bd:slow=26:signal=9`
 * would otherwise validate here, reach the wire, and have live-grid refuse
 * the whole request -- closing the socket and blanking every study on the
 * card, not just the bad one. Refusing here, inline with the same loop that
 * already reads each param's value, is the smaller fix: normalising the
 * paste (as the popover would) needs parseChartSpec to hand back a rewritten
 * study, which is a wider contract change than this bug calls for.
 */
function studyProblem(
  study: unknown, lookup: (name: string) => CatalogEntry | undefined, allowBusinessDays: boolean,
): string | null {
  if (!isRecord(study) || typeof study.name !== "string") return "a study needs a name";
  const entry = lookup(study.name);
  // The case as well as the name: `lookup` is deliberately case-insensitive
  // (a user types RSI), but nothing downstream is. indicatorsParam would
  // send `RSI:period=14`, live-grid's registry.get("RSI") raises KeyError
  // inside build_payload, and ta_series_ws answers that by closing the
  // socket -- the whole feed, not the one study. Even a lenient server
  // would leave matchSeries (study.name === req.name) and the editor's
  // catalog.find failing. parseStudyExpression and studiesFromParam avoid
  // this by returning `entry.name`; the spec document is the one path that
  // keeps the user's own spelling, and parseChartSpec carries `raw.studies`
  // through untouched, so refusing here is the honest answer.
  if (entry === undefined || study.name !== entry.name) return `unknown study "${study.name}"`;
  if (!isRecord(study.params)) return `${study.name} needs params`;
  const declared = new Set(entry.params.map((p) => p.name));
  for (const key of Object.keys(study.params)) {
    if (!declared.has(key)) return `${study.name} has no param "${key}"`;
  }
  // The VALUE's type as well as the key: matchSeries compares params with
  // `===`, so a period pasted as the string "20" against the wire's number
  // 20 would validate, go out on the socket, come back, and then silently
  // never match its instance -- the line losing the instance's colour and
  // the legend its expression label, with nothing said anywhere.
  // Whether any window param this study actually names carries `bd`, and
  // whether any names a plain number -- both flip true only for the params
  // in `entry.windows`, so a non-window's own type (bbands' `k`) never
  // contributes to the "mixed" verdict below.
  let anyWindowBd = false;
  let anyWindowPlain = false;
  for (const p of entry.params) {
    const value = (study.params as Record<string, unknown>)[p.name];
    if (value === undefined) continue;
    const bd = allowBusinessDays && typeof value === "string" && isBusinessDays(value);
    const okay = p.text ? typeof value === "string" : typeof value === "number" || bd;
    if (!okay) {
      return `${study.name}'s "${p.name}" must be a ${p.text ? "string" : allowBusinessDays ? "number or a bd window" : "number"}`;
    }
    // A window unit belongs on a window (parseStudyExpression's own rule):
    // `bbands:k=2bd` is well-typed above but not a window, and live-grid
    // refuses it same as the parser does.
    if (bd && !entry.windows.includes(p.name)) return `${study.name}'s "${p.name}" takes no business-day window`;
    if (entry.windows.includes(p.name)) { if (bd) anyWindowBd = true; else anyWindowPlain = true; }
  }
  // ONE unit per study (unifyWindows' rule, enforced here instead of applied:
  // a pasted `macd:fast=12bd:slow=26:signal=9` is refused rather than
  // silently rewritten to `slow=26bd:signal=9bd`, since normalising a paste
  // would need parseChartSpec to hand back a changed study, not just a
  // pass/fail).
  if (anyWindowBd && anyWindowPlain) return `${study.name} mixes a bd window with a plain one`;
  if (typeof study.expr !== "string" || typeof study.color !== "string") return `${study.name} needs expr and color`;
  // `source` is NOT required (v12.3.1 ruling: the chart has one source, its
  // own parameter). A document round-tripped from a card saved before the
  // ruling still carries one, so it is tolerated when well-formed and
  // ignored everywhere downstream.
  if (study.source !== undefined && study.source !== "local" && study.source !== "eodhd") {
    return `${study.name}'s source must be "local" or "eodhd"`;
  }
  return null;
}

function ChartCard({
  backend, widget, params, state: rawState, onPatch, exchange: dashboardExchange, onParam, groups, groupsDisabled,
  card,
  controlsSlot, paramsOpen, onOpenParams, onOk, onCancel, paramsDirty,
  refreshKey, host, stampRef,
}: {
  /**
   * The app this chart runs in (arts-charts-openbq). Optional: an app that
   * calls configureArtsCharts(host) at startup need not pass it again.
   */
  host?: ArtsChartsHost;
  /** S14: the card hands its resolvers up here for the document save path. */
  stampRef?: MutableRefObject<Stamp | null>;
  backend: BackendConfig;
  widget: WidgetDef;
  params: Record<string, string>;
  state: ChartCardState;
  onPatch: (partial: ChartEdit) => void;
  /** v12.3.0 (slice 4): the dashboard's exchange, as every calendar-reading sibling gets it. */
  exchange?: string;
  /**
   * The dashboard's parameter groups (v12.4.0), for a performance series
   * whose symbol is `$group:<Name>`. The card resolves the reference by
   * NAME on every render rather than storing the value, so a renamed or
   * deleted group reads as unresolved -- an inline note on the chip -- and
   * never silently draws some other symbol's bars.
   */
  groups?: ParamGroup[];
  /**
   * The card and the dashboard's grouping toggle (spec 2026-09-25, F5), for the
   * two facets a group may bind and for the row's group chips. `card` carries
   * the bindings effectiveChartState reads and the group chips act on. Both
   * optional so the renderer still mounts without a group context.
   */
  card?: DashboardCard;
  groupsDisabled?: boolean;
  // Still in the shape WidgetCard passes -- it drops the whole `chart` field
  // -- but unused here: Clear is about drawings, not about the card's
  // settings (see clearPatch).
  onClear: () => void;
  /**
   * Writes one of the card's own parameters. Today the chart writes exactly
   * one, `symbol`, from the header's inline editor -- the source is fixed per
   * widget by the manifest, so there is no SOURCE control to write. The
   * signature stays generalised by name for the next one. The card owns its
   * parameters (and any group they are bound to), so the card supplies the
   * writer; the chart never writes params itself.
   */
  /**
   * The card's widget PARAMETERS, written as one patch. A patch rather than
   * a name and a value (2026-09-24): the card builds its edit from the
   * params it closed over, so two calls in a tick would each start from the
   * same stale copy and the second would drop the first -- and the macro
   * conversion below writes `panels` and `macro` together.
   */
  onParam: (patch: Record<string, string>) => void;
  /* `keepOpen` / `onKeepOpen` are GONE (user, 2026-09-27: "remove the keep
     open, it's redundant with the parameter widget on the card's title bar"),
     and `keepParamsOpen` went with them later the same day ("we can deprecate
     keepParamsOpen"). With no control able to clear it, the field left every
     chart card's row open for good while no other widget behaved that way. It
     is read off disk and round-tripped, and acted on nowhere: the row opens
     from the card's own title-bar control, like every other card's. */
  /**
   * The card's Parameters-row slot (Task 4/5): a setter WidgetCard passes
   * so the chart's command strip (`ChartControls`) renders inside the
   * card's own row instead of the chart's render tree -- the same
   * register-with-parent shape as the legend sink, but through a prop
   * (WidgetCard's own state setter) rather than a ref, since the strip is
   * a node the parent mounts, not a value the parent merely reads. Called
   * with the built strip whenever a value it shows changes, and with
   * `null` on unmount.
   */
  controlsSlot?: (node: ReactNode) => void;
  /**
   * The card's Parameters-row open state and its opener (spec 2026-09-24, D7),
   * the same shape as the controls slot: the renderer renders the collapsed
   * summary only while the row is closed, and the summary's double-click /
   * Enter/Space reopens it through `onOpenParams`. Supplied by WidgetCard.
   */
  paramsOpen?: boolean;
  onOpenParams?: () => void;
  /**
   * The Parameters transaction (spec 2026-09-24, D1/D5/D9), supplied by
   * WidgetCard: OK closes the row (or leaves it showing with Keep open),
   * Cancel restores the owned facets and closes, and `paramsDirty` reports
   * whether Cancel has anything to undo. The renderer only threads them to the
   * controls strip and routes Escape to Cancel; the recorder and the two
   * writes live in the card.
   */
  onOk?: () => void;
  onCancel?: () => void;
  paramsDirty?: boolean;
  /**
   * The card's refresh tick, summed by WidgetCard as `attempt + refreshEpoch`
   * exactly as every other renderer that issues its own request gets it (the
   * header's Refresh and ⌘R, and the dashboard's refresh-all). This renderer
   * fetches over its own sockets/`/series` rather than through useWidgetData,
   * so without this prop the card's Refresh never reached it at all and a
   * relative range (`now-5d`) stayed frozen on the instant it first resolved
   * -- the correctness bug the ◷ badge's "updates when the card refreshes"
   * promise was contradicting. The `asked` window below advances only when
   * this tick changes.
   */
  refreshKey: number;
}) {
  if (host !== undefined) configureArtsCharts(host);
  const node = useRef<HTMLDivElement | null>(null);
  // The card's own root, measured for the narrow-card collapse below -- a
  // separate ref from `node`, which is the plot div one level down.
  const rootRef = useRef<HTMLDivElement | null>(null);
  /**
   * The panel handles PanelHost last handed over (v12.4.0), one per panel in
   * panel order. A REF, not state, for the reason every chart handle in this
   * file is one: PanelHost rebuilds its charts inside a CHILD effect, whose
   * body runs before this component's effects on the same commit, so an
   * effect reading `apis` out of state could touch a chart that was removed
   * a moment ago -- which throws. `panelEpoch` below is the state that marks
   * a rebuild and re-runs every effect here; the handles themselves are
   * always read fresh off this ref.
   */
  const panels = useRef<PanelApi[]>([]);
  /**
   * Panel 1's price series -- the candlestick, OHLC, line or area drawn
   * there -- which is what levels hang off, what a click's y is read
   * through and what the drawing tools measure against. Null on a card
   * whose panel 1 draws nothing price-like.
   */
  const priceSeries = useRef<ISeriesApi<PlotSeriesType> | null>(null);
  /**
   * The SIDE that price series prices against (T6 review, finding 5). The
   * axis gestures and the legend's decimals all read a price scale by name,
   * and panel 1's price is not always on the right -- the spec's own
   * acceptance 2 puts an OHLC on the left with a performance line on the
   * right. "right" is the answer for a panel drawing nothing price-like,
   * which is also the scale every chart has.
   */
  const priceSide = useRef<"left" | "right">("right");
  const seeded = useRef(false);
  // The legend's setter, registered by <Legend> on mount. Called from the
  // crosshair handler and the candle effect; never React state here, for the
  // reason the old DOM write existed: a crosshair move fires per pixel and
  // must not re-render the component holding the chart.
  const legendSink = useRef<LegendSink | null>(null);
  const theme = useResolvedTheme();
  const [tool, setTool] = useState<ChartTool>("panning");
  // The index into state.drawings the user last clicked near, or null. Lives
  // in React state (not a ref) because it drives a render -- the highlight
  // colour in the drawnLines effect below.
  const [selected, setSelected] = useState<number | null>(null);
  // The toolbar's Rita toggle. Hides Rita's proposed levels from the chart
  // without discarding them: the Proposed levels row keeps its Keep and
  // Discard buttons either way. A view choice for this session, not saved.
  const [hideRita, setHideRita] = useState(false);
  // Magnet mode (spec §7.2): a drawing endpoint snaps to the nearest of its
  // bar's OHLC. A session choice like the armed tool, not card state -- and
  // in the `live` ref below, because the drag and click handlers are
  // subscribed once per chart instance and would otherwise snap (or not)
  // according to whatever was set when that instance was created.
  const [magnet, setMagnet] = useState(false);
  // The measure tool's floating label, or null: the two ends it was dragged
  // between, where to put it (plot-relative pixels) and what it reads.
  // ponytail: the label does not follow the view -- a pan or zoom under it
  // leaves it where it was drawn, until the next click dismisses it.
  const [measure, setMeasure] = useState<{ a: ChartPoint; b: ChartPoint; x: number; y: number; text: string } | null>(null);
  // The Custom… range popover. The renderer owns it (not <Header>) because
  // Escape and the spec's keyboard map close it from here.
  const [rangeOpen, setRangeOpen] = useState(false);
  // The Custom… interval box's open state (spec 2026-09-25, G8), the same
  // transient flag the range's Custom… uses -- opened by the chip, closed on
  // Apply, on Escape (Popover) and when panning takes over.
  const [intervalOpen, setIntervalOpen] = useState(false);
  // The one Layout editor (spec 2026-09-24, C): whether it is open and on
  // which tab. The Panels button opens the Panels tab, the Series button / I
  // / a chip edit the Series tab. Replaces the old studies popover state --
  // owned here for the same reason the range popover is: the keyboard map's
  // `I` has to reach it.
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [layoutTab, setLayoutTab] = useState<"series" | "panels">("series");
  // Not while a Layout group owns the arrangement: the editor would edit nothing.
  const openLayout = (tab: "series" | "panels") => { if (layoutLockedRef.current) return; setLayoutTab(tab); setLayoutOpen(true); };
  const layoutLockedRef = useRef(false);
  // The header's inline symbol editor, opened by a click on the block or `/`.
  const [symbolEditing, setSymbolEditing] = useState(false);
  // The expression of the chip being edited in the modal, or null.
  const [editing, setEditing] = useState<string | null>(null);
  // The saved bundles (studies addendum §5.5), loaded once from the
  // per-user presets file; Save as… writes back through it.
  const [presets, setPresets] = useState<ChartPreset[]>([]);
  // Favorites (spec 2026-09-26, PART C): the user's saved one-click series,
  // loaded once from their own versioned file (chartFavoritesFile), like the
  // presets above rather than the shared layout store -- a favorite is a
  // per-user pick, not a card-shared library.
  const [favorites, setFavorites] = useState<ChartFavorite[]>([]);
  // The shared saved layout library (spec 2026-09-24, D6): one store the whole
  // app reads, loaded once. A save on any card lands here and re-renders every
  // open card's Layout list -- unlike the per-card series presets above (D10),
  // which stay exactly as they are.
  const layouts = useChartLayoutsStore((s) => s.layouts);
  const saveLayoutToLibrary = useChartLayoutsStore((s) => s.save);
  // Import writes the whole merged file in one store call (spec 2026-09-25, E6).
  const importLayoutsToLibrary = useChartLayoutsStore((s) => s.importLayouts);
  const loadLayouts = useChartLayoutsStore((s) => s.load);
  useEffect(() => { void loadLayouts(); }, [loadLayouts]);
  // The symbol's name and logo for the header block, best-effort: a backend
  // without /symbol_meta leaves this null and the header shows the ticker
  // alone. Never an error state -- see the effect below. `asset` (slice 4)
  // is live-grid's own classification of the symbol, which decides the
  // exchange below; absent on a backend that predates it.
  // `symbol` (the final review's I3) is the symbol the row answered FOR: a
  // switch must not let the previous symbol's asset class drive the new
  // symbol's first connection (AAPL's XNYS on a BTC-USD card, one fetch long).
  const [meta, setMeta] = useState<{ symbol: string; name: string | null; logoUrl: string | null; asset?: AssetClass } | null>(null);
  // Bumped whenever the panels' charts are torn down and recreated (a theme
  // flip, a changed `panels` parameter). Every effect that touches a chart
  // keys on this, not just on its own data -- a rebuild does not touch the
  // candles' or the studies' identity, so without it the new charts would
  // stay empty until the next real tick (never, while the market is closed).
  const [chartEpoch, setChartEpoch] = useState(0);
  // Bumped when panel 1's PRICE series handle changes (a rebuild, or the
  // user swapping candlesticks for a line): the levels, drawings, click and
  // pointer effects read prices through it and must resubscribe when it
  // is replaced.
  const [priceEpoch, setPriceEpoch] = useState(0);
  // The narrow-card collapse (spec §15 criterion 10): true once the card's
  // measured width drops below NARROW_WIDTH. Set by the ResizeObserver effect
  // below, never derived from the window -- see that effect's comment.
  const [narrow, setNarrow] = useState(false);
  // Taller than wide (user, 2026-10-01: "wrap the summary of the parameters if
  // height is bigger than width"). On a portrait card the status bar's three
  // columns are each a sliver, and the centred parameter summary ellipsised to
  // "5min · 2026-09-30 to …" -- the one line that says what the chart shows.
  // Measured by the same observer as `narrow`, for the same reason: only the
  // element knows its size, and container queries are off the table here.
  const [portrait, setPortrait] = useState(false);

  // spec 2026-09-25, F5: what the chart SHOWS. A group bound to `chart.interval`
  // or `chart.range` outranks the card's own facet, so the whole renderer --
  // the interval derivation, barsWindow, the seed and re-zoom effects reached
  // through `live`, the lit preset chip, the Custom popover -- reads the group's
  // value with no per-site change, because they all read `state`. Memoised so a
  // bound range is a STABLE object across renders until the group's value moves:
  // decodeRange builds a fresh object, and an unstable `state.range` would
  // re-fire the zoom effect keyed on it every render (Review Focus 1). When
  // nothing is bound this returns rawState's own facets by reference, so an
  // unbound card behaves exactly as before F.
  const state = useMemo(
    () => (card ? effectiveChartState(card, rawState, groups, groupsDisabled) : rawState),
    [card, rawState, groups, groupsDisabled],
  );

  // Upper-cased: the tick plane's symbols are kdb symbols, case-sensitive,
  // and an iPad's keyboard capitalises the first letter it is handed, so a
  // card typed there asked for "Btc-usd" and drew nothing while the Mac's
  // "BTC-USD" drew 1440 bars off the same socket (2026-09-14).
  // The card's symbol list (spec 2026-11-13 §1): `symbol` is list:1, the one ticker the study
  // socket, the tick cache, the symbol-meta lookup and the card's own /series ever see.
  const { list: symbols, truncated: listTruncated } = useMemo(() => parseSymbolList(params.symbol ?? ""), [params.symbol]);
  const symbol = symbols[0] ?? "";
  const interval = state.interval ?? params.interval ?? "1m";
  const declared = widget.params.find((p) => p.paramName === "interval")?.options?.map((o) => String(o.value));
  // Spread the shared list into a mutable array: it is `readonly string[]`,
  // and ChartControls' `intervals` prop is a plain `string[]`. The copy is
  // free -- `intervalsKey` (the join), not this array's identity, is the dep.
  const intervals = declared !== undefined && declared.length > 0 ? declared : [...INTERVAL_WIRE_VALUES];
  // The package's one interval parser (warmup.ts); an unparseable label reads as a minute.
  const intervalSeconds = parseIntervalSeconds(interval) ?? 60;
  // Whether the time scale weighs its ticks in local time (see
  // createTimeScaleBehavior): every intraday interval, never daily bars. A
  // ref, read by the behaviour on each recalculation, so a change of
  // interval needs no new chart; the fresh bars that follow reweigh.
  const localWeights = useRef(intervalSeconds < 86400);
  localWeights.current = intervalSeconds < 86400;
  // The session machinery (slice 4, session addendum §4.4) applies to
  // intraday bars only: a daily bar has no session to be outside of, so the
  // toggle hides, no bar is filtered and the socket is not asked to filter.
  const intraday = intervalSeconds < 86400;
  // The symbol's exchange from its asset class, and that exchange's
  // calendar -- hours, zone and the bundled NYSE holidays. `null` for
  // crypto, forex and an unclassified symbol: no toggle, no `bd`, no
  // `@open`/`@close`, and the clocks read the viewer's zone.
  // ponytail: the bundled file or the weekday table, never the backend's
  // calendar endpoint -- the v5 hook needs a datetime-typed widget param to
  // hang its fetch on, and this widget declares none. Upgrade path: a
  // synthetic param through useTradingCalendar once a backend serves a
  // calendar this chart would read differently.
  // ponytail: `exchange` is null until /symbol_meta answers, so a card saved
  // with session: "regular" always connects once without session=regular and
  // once with it, not only the ones carrying an expression anchor. Upgrade
  // path: none without guessing the exchange ahead of the backend's answer.
  // The asset class counts only while it is THIS symbol's (I3): a switch is
  // unclassified until the backend answers for the new symbol, which is the
  // "unknown -> null" ruling's own reading. Otherwise AAPL -> BTC-USD would
  // connect once on XNYS -- toggle, filter, `session=regular` and New York
  // anchors -- and only then drop them.
  const exchange = exchangeFor(meta?.symbol === symbol ? meta.asset : undefined, widget, dashboardExchange);
  const calendar = useMemo(() => (exchange === null ? null : (bundledCalendar(exchange) ?? weekdayCalendar(exchange))), [exchange]);
  // The clock every chrome element reads: the exchange's when there is one,
  // else the viewer's (undefined, which is what Intl and the resolver take
  // for "local").
  const zone = calendar?.timezone;
  // Whether the regular-session filter is IN FORCE: the card's choice, and
  // the two conditions under which it means anything.
  const regular = intraday && exchange !== null && state.session === "regular";
  // The session as this card's date expressions must read it (`@SOD`/`@EOD`,
  // 2026-09-29) -- the same reading the chart spec below reports, so the two
  // cannot disagree. `regular` rather than `state.session`: a daily chart, or a
  // symbol with no exchange, has no regular filter in force whatever it says.
  const sessionMode: "regular" | "24hr" | "extended" = regular ? "regular" : (state.session === "24hr" ? "24hr" : "extended");
  // The chart's ONE source (user ruling 2026-09-17, its `source`
  // parameter): where the BARS and every study come from, what the wire
  // says per study, and what a series with `req.source: null` was served
  // from, for matching it back.
  const source: "local" | "eodhd" = params.source?.toLowerCase() === "eodhd" ? "eodhd" : "local";
  const eodhd = source === "eodhd";
  // The managed web grid can use its opt-in ticketed data relay. Native and
  // other private connections retain their explicit tick URL; EODHD needs
  // neither. Never persist a short-lived ticket or rewrite saved connections.
  const relayUrl = chartTickRelay(backend.baseUrl);
  const tickUrl = relayUrl ?? backend.tickUrl ?? null;
  const anchors = useMemo(() => state.anchors ?? [], [state.anchors]);
  // arts-charts-openbq: a backend with no tick cache serves its bars over
  // /series -- the EODHD plane's route -- from the server's own default
  // provider, or the card's `provider` parameter when it declares one. An
  // empty provider is omitted on the wire, so the client names no vendor.
  const httpBars = eodhd || tickUrl === null;
  const barsProvider = eodhd ? "eodhd" : (params.provider ?? "");
  // Live composed bars §5: a card the host added live (`live: "true"`), with a
  // chart server, asks the server's composed /series -- the bars Rita and the
  // watches read -- every LIVE_POLL_MS. On a tick backend only the forming bar
  // comes from the stream; with no tick socket (v12 BDOBB, ruling B7) /series'
  // own forming bar is drawn as it stands. Not on the EODHD plane, whose bars
  // are EODHD's; every other card is the card it was.
  const charts = getHost().chartsFetch;
  const liveCard = params.live === "true" && !eodhd && charts !== undefined;
  // Its studies come from the chart server's /ta_series_ws, over those same
  // composed bars, when the host says where that socket is (user ruling
  // 2026-10-26); without it, from the backend's study socket, as before.
  const chartsSocket = getHost().chartsSocketUrl;
  const liveStudies = liveCard && chartsSocket !== undefined;

  // Exactly one plane is ever connected. `url: null` keeps the tick socket
  // idle in EODHD mode rather than streaming kdb's bars under EODHD's
  // indicators -- the single-source ruling's whole point.
  const tick = useTickCache({ url: httpBars ? null : tickUrl, symbol, intervalSeconds, anchors, relay: relayUrl !== null });
  // The window EODHD is asked for: the card's own start/end when it set
  // them, else five days (intraday) or a year -- a range is a zoom and only
  // moves the START earlier when it reaches back past that (barsWindow). Both
  // /series and the studies socket get the same pair -- bars and indicators
  // computed over different windows would not line up.
  // The instant a RELATIVE range end is resolved against. Held in state and
  // advanced ONLY when the card's refresh tick changes -- the seenRefresh-ref
  // pattern DeltaExplorerRenderer uses (:154-165), acting on a CHANGE, not on
  // the mount value. It must not be a live `new Date()` in the memo's deps:
  // that would re-resolve on every render, rebuild `studyUrl`, and drive
  // useStudySeries into a refetch loop. It advances on the discrete tick
  // instead. `now` moves the window's END (and the default start) on a refresh,
  // whatever the range: a range is a zoom and no longer bounds the fetch.
  const [now, setNow] = useState(() => new Date());
  const seenRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === seenRefresh.current) return;
    seenRefresh.current = refreshKey;
    setNow(new Date());
  }, [refreshKey]);
  const asked = useMemo(
    () => barsWindow(state.range, interval, now, calendar, { session: sessionMode }, /^\d{4}-\d\d-\d\d/.exec(params.end ?? "")?.[0]),
    [state.range, interval, calendar, now, sessionMode, params.end],
  );
  const start = params.start !== undefined && params.start !== "" ? params.start : asked.start;
  // Where the range's reach was clipped to the bar budget (barsWindow), for the
  // note and the zoom. The card's own `start` outranks the window, so it clips nothing.
  const clippedTo = params.start !== undefined && params.start !== "" ? undefined : asked.clippedTo;
  // Where the studies (and the `S`/`earliest` anchors) start: the UNRANGED
  // window's start. A range may extend the bars' start to have something to
  // zoom to, but a study that accumulates from its window start (VWAP, OBV,
  // SAR) must report the unranged card's latest value (user ruling
  // 2026-10-21; review fix). The card's own `start` parameter is the same
  // either way.
  const studyBase = params.start !== undefined && params.start !== "" ? params.start : barsWindow(undefined, interval, now, calendar).start;
  const end = params.end !== undefined && params.end !== "" ? params.end : asked.end;
  // v12.4.0 (T9): the card's `start`/`end` PARAMETERS fix the window (spec,
  // Widget properties) whenever either is set -- explicitly, or by a group,
  // which arrives in `params` the same way. The range chips then have
  // nothing left to choose (below), and the popover shows the window
  // read-only rather than an expression Apply could ever act on.
  const rangeFixed = (params.start !== undefined && params.start !== "") || (params.end !== undefined && params.end !== "");
  const cardBars = useSeriesBars({
    backend, symbol, interval, provider: barsProvider, start, end, enabled: httpBars || liveCard,
    ...(liveCard ? { chartsFetch: charts, pollMs: LIVE_POLL_MS, session: sessionMode } : {}),
  });
  // A failed poll clears `meta` but useSeriesBars keeps its candles, whose last
  // bar is then a stale partial. Hold the last forming time seen for this
  // series so the cut stays put and the stream's complete bar is not overwritten.
  const heldForming = useRef<{ key: string; forming: number | null }>({ key: "", forming: null });
  const heldKey = `${symbol}|${interval}`;
  if (cardBars.meta) heldForming.current = { key: heldKey, forming: cardBars.meta.forming ?? null };
  else if (heldForming.current.key !== heldKey) heldForming.current = { key: heldKey, forming: null };
  const forming = heldForming.current.forming;
  const onGrid = streamOnGrid(intervalSeconds);
  const liveBars = useMemo(
    () => (liveCard ? liveCandles(cardBars.candles, forming, tick.candles, onGrid) : null),
    [liveCard, cardBars.candles, forming, tick.candles, onGrid],
  );
  const liveText = liveCard ? liveNote(symbol, cardBars.meta?.live ?? null, cardBars.meta?.liveReason ?? null) : null;
  const volumeText = liveCard ? volumeNote(cardBars.meta?.liveVolume ?? null) : null;
  // Regular FILTERS the bars (user ruling 2026-09-24, reversing "dims, never
  // deletes"): every series below is fed only the in-session bars, so the
  // time scale is built without the extended hours and the axis omits them.
  // Identity is kept when the filter is off -- `candles` keys the effects.
  const allCandles = httpBars ? cardBars.candles : (liveBars ?? tick.candles);
  const candles = useMemo(
    () => (regular && calendar !== null ? sessionBars(allCandles, calendar) : allCandles),
    [allCandles, regular, calendar],
  );
  const status = httpBars ? cardBars.status : tick.status;
  const latencyMs = httpBars ? null : tick.latencyMs;
  // v12.4.2: which of the EODHD plane's two sources answered, for the status
  // bar. `null` before `/series` has ever answered (there is nothing to
  // report), `"vault"` when the tick vault covered every weekday the card
  // asked for (`vaultDays.length` matching `weekdaysBefore` exactly),
  // `"mixed"` when it covered some, `"history"` when it covered none.
  const barsSource = useMemo(() => {
    // `?? null`: NOT for a backend a version behind -- `parseMeta`
    // (useSeriesBars.ts) always returns an object, defaulting every field a
    // missing `cache` key would otherwise leave undefined, so that backend
    // still lands on `"history"` below rather than `null`. The `?? null`
    // guards a caller whose `useSeriesBars` predates `meta` altogether --
    // this renderer's own test mock included -- where `cardBars.meta` is
    // `undefined`, not `null`, and the `=== null` check just below needs it
    // to be one or the other.
    const meta = cardBars.meta ?? null;
    if (meta === null) return null;
    if (meta.rowsFromVault > 0 && meta.vaultDays.length === weekdaysBefore(start, new Date())) return "vault";
    return meta.rowsFromVault > 0 ? "mixed" : "history";
  }, [cardBars.meta, start]);
  /**
   * The widget's own start and end as instants, for the `S` and `E` anchors
   * (spec, Date grammar): the card's explicit `start`/`end` parameters when
   * it has them -- a group's value arrives here as one -- and the loaded
   * window's first and last bar otherwise.
   */
  // Keyed on the two bar TIMES, not on the array (T6 review, finding 4): the
  // tick cache republishes `candles` per trade batch, and an anchor window
  // keyed on its identity churned `resolveWindowed` -> `performance` ->
  // `extraBars` several times a second, which in turn re-ran the whole draw
  // pass. Only a bar appearing or the window sliding changes either edge.
  // One memo per EDGE, so the start keeps its identity while the end slides
  // (the branch-end round, finding 1): the study resolver is keyed on the
  // start, and a fresh Date for it on every arriving bar would rebuild the
  // socket URL and re-run the studies' draw pass.
  // On the EODHD plane the first bar OF THE UNRANGED WINDOW: a range that
  // extended the fetch earlier must not move `S` / `earliest` (see studyBase).
  const firstBarTime = useMemo(
    () => httpBars && start !== studyBase
      ? firstBarOnOrAfter(studyBase, candles.map((c) => c.time), calendar?.timezone)
      : candles[0]?.time,
    [httpBars, start, studyBase, candles, calendar],
  );
  const lastBarTime = candles.at(-1)?.time;
  const windowStart = useMemo(() => paramInstant(params.start) ?? barInstant(firstBarTime), [params.start, firstBarTime]);
  const windowEnd = useMemo(() => paramInstant(params.end) ?? barInstant(lastBarTime), [params.end, lastBarTime]);
  // v5.3.0 `data_bounds`: what `earliest` / `latest` mean on a chart is the bars it
  // has loaded -- first and last -- whatever the card's own start/end say. Keyed on the
  // two bar times, so a push that moves neither end rebuilds nothing.
  const dataBounds = useMemo(() => ({ min: barInstant(firstBarTime), max: barInstant(lastBarTime) }), [firstBarTime, lastBarTime]);
  const anchorWindow = useMemo(() => ({ start: windowStart, end: windowEnd, bounds: dataBounds, session: sessionMode }), [windowStart, windowEnd, dataBounds, sessionMode]);
  // ONE resolver for the study anchors (`T@14:00`, `FQ0@open`, `S@09:30`),
  // handed to indicatorsParam AND to every matchSeries call below: the wire
  // carries the resolved instant, the series echoes it, and only the same
  // closure on both sides matches them back up (the C2 report's binding note
  // -- a resolver on one side alone unmatches every anchored study in
  // silence).
  //
  // The window reaches it through a REF, and the memo is keyed on the
  // window's START alone (the branch-end round, finding 1). `S`/`E` in a
  // study anchor must resolve -- an unresolved one is dropped from the wire
  // -- but a resolver rebuilt on every arriving bar would rewrite the
  // `indicators` string, and with it the socket URL, several times a minute.
  // The start only moves when the card's parameter or the loaded window's
  // first bar does, which is also when a rebuilt URL is the right answer.
  // ponytail: `E` is therefore as old as the last thing that changed the
  // start -- one bar's worth of drift on an `E`-anchored study. Upgrade path:
  // a debounced end in the key if anyone ever anchors to the live edge.
  const anchorWindowRef = useRef(anchorWindow);
  anchorWindowRef.current = anchorWindow;
  const resolveAnchor = useMemo(
    () => anchorResolver(calendar, new Date(), { start: windowStart, end: anchorWindowRef.current.end }),
    [calendar, windowStart],
  );
  // Only `OBS-n` rides raw, on either plane (spec 2026-11-04 §2): only the
  // server can count trades. Every other expression is resolved to an instant
  // by the host's grammar here, so the wire carries instants and the matcher
  // compares instants.
  const wireResolver = useCallback((text: string) => {
    return sendRaw(text, eodhd) ? text : resolveAnchor(text);
  }, [eodhd, resolveAnchor]);
  // The kdb tick plane is the ONLY source of an anchored VWAP's running
  // totals (the addendum's ruling), so a saved anchor draws nothing here.
  // A module constant, not a fresh []: the avwap effect is keyed on this
  // array's identity and would tear its lines down on every render.
  const avwaps = httpBars ? NO_AVWAPS : tick.avwaps;
  const disabledTools = httpBars ? EODHD_DISABLED : NO_TOOLS;
  // A chart already armed with the anchor when the source flips falls back
  // to the crosshair: the rail's button greys out, but the plot's click
  // handler would otherwise keep persisting anchors nothing can draw.
  useEffect(() => {
    if (httpBars && tool === "anchor") setTool("panning");
  }, [httpBars, tool]);
  // The far endpoint a ray/gann/fib drawing extends to, and what the
  // "panning" click branch measures distance against -- both MUST read the
  // same value, or a click can land visually on a drawing and miss it (or
  // the reverse), since pointsOf's far endpoint depends on it. Before
  // candles has loaded there's no live edge yet, so this falls back to 0
  // rather than to the click's own time -- an arbitrary click has no more
  // claim to being "the edge" than any other value would.
  const drawingEdge = useMemo(() => candles.at(-1)?.time ?? 0, [candles]);
  // ADJ does not touch the candles (tick-derived bars carry no adjustment
  // data) -- it is only the indicators' price basis, read by /ta_series_ws
  // as `basis` off the connect URL (live-grid's app/main.py, defaulting to
  // "adjusted" when absent, same as here).
  const basis = state.adjusted === false ? "raw" : "adjusted";
  // The registry's catalog (studies addendum §3): every indicator's params,
  // pane, defaults and render hints come from here, never from this file.
  const registry = useTaRegistry(backend);
  // Tokens in, options out (spec §11): the adapter is the only place a
  // colour is named.
  //
  // Read in an EFFECT, never at render (T6 review, finding 2). The document's
  // `data-theme` -- which is what repaints every CSS variable -- is stamped by
  // App's own effect, and a parent's effect runs AFTER its children's on the
  // same commit. A render-phase getComputedStyle on the commit that first
  // reports the new mode therefore sees the OLD palette, and since the memo's
  // only dependency (the mode) is already current it would never recompute:
  // the card would come back from a flip wearing the previous theme's
  // colours. Reading it from an effect keyed on the mode AND on `chartEpoch`
  // -- the state a rebuild bumps, which lands on the NEXT commit, by which
  // time the attribute is on the document -- closes that window. The
  // comparison keeps `tokens` identity stable when nothing actually changed,
  // so this cannot loop.
  const [tokens, setTokens] = useState(readChartTokens);
  useEffect(() => {
    const next = readChartTokens();
    setTokens((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [theme, chartEpoch]);
  const t = useMemo(() => chartTheme(tokens, theme), [tokens, theme]);
  // The colour a series gets when neither the user nor the registry named
  // one: the adapter's `drawings.study`.
  const studyFallback = t.drawings.study;
  // A pre-12.3.0 card's studies (studies addendum §5.1, §5.4): no `studies`
  // field, so its chips are read out of its own `indicators` string, which
  // then still goes to the socket UNCHANGED (below) -- the instances only
  // become the card's record on the first patch that writes them. The
  // registry's `lookup` closes over the cached catalog, whose identity is
  // fixed once `status` is "ready", so `status` stands in for it here
  // rather than re-deriving on every render for a fresh closure.
  // `allowBusinessDays` (slice 4): a pre-12.3.0 string's `period=50bd` is
  // kept on a symbol with an exchange and skipped on one without.
  // v12.4.0: this feeds the MIGRATION rather than the chart -- the card's
  // drawn things are `series` below, and a card that never had `studies`
  // still arrives at the same list through it.
  const legacyStudies = useMemo(
    () => state.studies ?? studiesFromParam(params.indicators ?? "", registry.lookup, studyFallback, { allowBusinessDays: exchange !== null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.studies, params.indicators, registry.status, studyFallback, exchange],
  );
  /**
   * Everything the card draws (v12.4.0), and the `panels` text it draws it
   * in. A card that already carries `series` is itself; one that does not is
   * MIGRATED here -- implicit candles and volume become explicit series,
   * each study becomes one, and an own-pane study appends a panel, which is
   * why the text comes back too.
   *
   * Held, never written on load: `migration.migrated` is the cue to write
   * both on the user's NEXT change (patchSeries below), so opening a
   * dashboard rewrites nothing. The deps are narrow on purpose -- migrateChart
   * mints a fresh id per series, so a memo keyed on `state` itself would
   * re-key (and so re-add) every series on every unrelated patch.
   */
  // A card bound to a Layout group (2026-10-01) draws the NAMED saved layout:
  // its series and panels replace the card's own as the migration's input, so
  // every reader below sees the layout and nothing downstream changes. The
  // card's own series/panels are never written while bound (layoutLocked), so
  // unbinding returns them untouched. A name the library lacks is no override.
  const layoutBinding = card ? boundLayoutName(card, groups, groupsDisabled) : null;
  const boundLayout = layoutBinding === null ? undefined : layouts.find((l) => l.name === layoutBinding);
  const layoutLocked = boundLayout !== undefined;
  const boundPanelsText = useMemo(() => (boundLayout ? encodePanels(boundLayout.panels) : undefined), [boundLayout]);
  const seriesInput = boundLayout ? boundLayout.series : state.series;
  const panelsInput = boundPanelsText ?? params.panels;
  const migrated = useRef<{ key: string; value: ReturnType<typeof migrateChart> } | null>(null);
  const migration = useMemo(() => {
    // By VALUE, not by identity: `migrateChart` mints a fresh id per series,
    // and a card's state arrives as a new object on every store read -- so a
    // memo keyed on identity alone would re-key (and so tear down and re-add)
    // every chart series on renders that changed nothing. The signature is a
    // handful of chips long; stringifying it is cheaper than one setData.
    const key = JSON.stringify([seriesInput ?? null, legacyStudies, panelsInput ?? null, registry.status]);
    if (migrated.current?.key !== key) {
      migrated.current = { key, value: migrateChart({ series: seriesInput, studies: legacyStudies }, panelsInput, registry.lookup) };
    }
    return migrated.current.value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesInput, legacyStudies, panelsInput, registry.status]);
  const series = migration.series;
  const panelsText = migration.panelsText;
  const parsedPanels = useMemo(() => parsePanels(panelsText), [panelsText]);
  // A text nothing could be read out of (an empty parameter, a row of
  // letters) draws the default two panels: a card with no chart at all is
  // worse than a card ignoring an unreadable parameter, and the status bar
  // below carries the problem either way.
  const panelDefs = parsedPanels.panels.length > 0 ? parsedPanels.panels : DEFAULT_PANELS;
  // The dependency order the panels are scaled in, and the reference loops
  // that have no order (spec, Y links): a looped panel simply autoscales --
  // PanelHost leaves out every panel `order` does not name -- and the loop
  // is named in the status bar.
  const { order: panelOrder, cycles } = useMemo(() => scaleOrder(panelDefs), [panelDefs]);
  const panelWarning = useMemo(() => {
    if (cycles.length > 0) {
      // Each loop is closed for the reading: [1, 2] is `P1 → P2 → P1`, which
      // is how the spec names it and how the editor refuses it.
      const loops = cycles.map((loop) => [...loop, loop[0]].map((n) => `P${n}`).join(" → "));
      return `panel links: circular (${loops.join(", ")})`;
    }
    return parsedPanels.problems[0] ?? null;
  }, [cycles, parsedPanels]);
  // The card's study series as the instances every study path here still
  // speaks: the socket's matcher, the palette, the presets. Their `expr` is
  // the key back to the series that owns each one.
  const studies = useMemo(
    () => series
      .filter((s) => s.type === "study" && s.name !== undefined)
      // `source` rides along even though nothing reads it for the wire (the
      // chart has ONE source, its own parameter): `activePreset` below
      // compares these instances against a saved bundle by value, and a
      // bundle written before v12.4.0 carries one. Dropping it here is what
      // stopped those bundles ever matching again (T6 review, finding 9).
      .map((s): StudyInstance => ({
        expr: s.expr, name: s.name as string, params: s.params, color: s.color, source: s.source, style: s.style,
      })),
    [series],
  );
  const seriesByExpr = useMemo(() => new Map(series.map((s) => [s.expr, s])), [series]);
  // Which of a panel's two scales any series actually uses: a side nothing
  // draws on shows no axis at all (spec, Rendering).
  const usedSides = useMemo(
    () => panelDefs.map((_def, i) => ({
      left: series.some((s) => s.panel === i + 1 && s.side === "left"),
      right: series.some((s) => s.panel === i + 1 && s.side === "right"),
    })),
    [panelDefs, series],
  );
  /**
   * The time-scale behaviour every panel's chart is built with: the LOCAL
   * day/month/year tick weighting, reading `localWeights` on each
   * recalculation so an interval change needs no new chart. One stable
   * factory, so a rerender is never mistaken for a reason to rebuild.
   */
  const timeScaleBehavior = useCallback(() => createTimeScaleBehavior(() => localWeights.current), []);

  /**
   * A date expression as unix seconds, on THIS card's calendar and window:
   * a panel's `xs`/`xe` and a performance series' rebase anchor both ask it.
   * `new Date()` per call rather than a memoised now -- unlike the study
   * wire, nothing has to agree with anything else about what `T` meant a
   * minute ago; this only decides where a line starts on screen.
   *
   * `$group:<Name>` in a DATE position (spec, Group references; the
   * branch-end round, finding 5) is the same lookup the symbol branch
   * below does: the group's own value -- an ISO date, or an expression of
   * its own -- is substituted in and then parsed like anything else. A
   * reference naming no group resolves to nothing, which every caller
   * already reads as the unresolvable note it gives a bad anchor.
   */
  const resolveWindowed = useCallback(
    (expr: string): number | null => {
      const text = expr.startsWith(GROUP_PREFIX)
        ? (groups ?? []).find((g) => g.name === expr.slice(GROUP_PREFIX.length))?.value
        : expr;
      if (text === undefined || text === "") return null;
      return resolveInstant(text, new Date(), calendar, anchorWindow);
    },
    [calendar, anchorWindow, groups],
  );
  const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
  // S14: the save path stamps each expression with what this card resolves it to now.
  if (stampRef) stampRef.current = {
    at: (expr) => { const s = resolveWindowed(expr); return s === null ? null : iso(s); },
    range: (r) => { const w = resolveRange(r, new Date(), calendar, anchorWindow); return w && { from: iso(w.from), to: iso(w.to) }; },
  };
  /** The loaded window in unix seconds: what an `xs`/`xe` that resolves to nothing falls back to. */
  const loadedWindow = useMemo(
    () => ({ start: candles[0]?.time ?? null, end: candles.at(-1)?.time ?? null }),
    [candles],
  );

  /**
   * Each bar series' and each study's ticker, resolved by `seriesTicker` (spec 2026-11-13 §2; studies, spec 2026-11-13 studies §2): list:1 is the
   * card's own bars; any other ticker takes an extra-bars slot, one per distinct ticker. A
   * reference that does not resolve leaves its series off with a note, and so does a
   * performance line with no anchor it can rebase on.
   */
  const performance = useMemo(() => {
    const byId = new Map<string, string>();
    const notes: Record<string, string> = {};
    const extras: string[] = [];
    for (const s of series) {
      const resolved = seriesTicker(s, symbols, groups ?? []);
      if ("note" in resolved) { notes[s.id] = resolved.note; continue; }
      const ticker = resolved.ticker;
      // An empty card's own series draw its (empty) bars quietly, as they always have.
      if (ticker === "" && (s.type === "performance" || symbol !== "")) { notes[s.id] = "no symbol"; continue; }
      if (s.type === "performance") {
        // A series with no anchor at all has nothing to quote back (T6 review, finding 10).
        if (s.anchor === undefined || s.anchor === "") { notes[s.id] = "no rebase anchor"; continue; }
        if (resolveWindowed(s.anchor) === null) { notes[s.id] = `anchor "${s.anchor}" does not resolve`; continue; }
      }
      if (ticker !== symbol && !extras.includes(ticker)) {
        if (extras.length >= MAX_EXTRA_SYMBOLS) { notes[s.id] = `only ${MAX_EXTRA_SYMBOLS} extra symbols per card`; continue; }
        extras.push(ticker);
      }
      byId.set(s.id, ticker);
    }
    return { byId, notes, extras };
  }, [series, symbols, symbol, groups, resolveWindowed]);

  /**
   * Each cross-symbol study's `vs`, resolved as a series symbol is (spec 2026-11-13
   * cross-symbol §5). `wired` is the card's series with every `vs` a ticker: what a socket is
   * asked for, and what a frame's `req` echoes back. A `vs` that does not resolve leaves its
   * study off the wire with a note. A cross-study takes no slot: `performance` is untouched.
   * ponytail: until the catalog loads, a cross-study goes out with `vs` as written and the
   * server notes it; the url changes once, when the catalog lands.
   */
  const versus = useMemo(() => {
    const tickers = new Map<string, string>();
    const notes: Record<string, string> = {};
    const wired: Series[] = [];
    for (const s of series) {
      const resolved = resolveVersus(s, symbols, groups ?? [], registry.lookup);
      if (resolved === null) { wired.push(s); continue; }
      if ("note" in resolved) { notes[s.id] = resolved.note; continue; }
      tickers.set(s.id, resolved.ticker);
      wired.push({ ...s, params: { ...s.params, [resolved.key]: resolved.ticker } });
    }
    return { tickers, notes, wired };
    // `registry.catalog` is the lookup's identity (see studyStart).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, symbols, groups, registry.catalog]);

  /**
   * Why a STUDY is not on the chart, keyed by series id: an anchor
   * `resolveAnchor` cannot answer is left off the wire by
   * `indicatorsParam` -- the raw expression would fail the whole socket --
   * and used to vanish without a word (the branch-end round, finding 1).
   * The same test `wireValue` applies, and the same note a performance
   * series' bad anchor gets, so a chip never goes quiet.
   */
  const studyNotes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of series) {
      if (s.type !== "study") continue;
      for (const [key, value] of Object.entries(s.params)) {
        if (key === TICKER_PARAM) continue;
        if (typeof value !== "string" || !getHost().dates.isExpression("datetime", value)) continue;
        if (resolveAnchor(value) === null) { out[s.id] = `anchor "${value}" does not resolve`; break; }
      }
    }
    return out;
  }, [series, resolveAnchor]);
  /** A series drawn off another ticker reads under it, chip and legend alike: "MSFT Candlestick". */
  const overlayLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of series) {
      const vs = versus.tickers.get(s.id);
      const entry = s.name === undefined ? undefined : registry.lookup(s.name);
      const own = performance.byId.get(s.id);
      if (vs !== undefined && entry !== undefined && own !== undefined) {
        const rest = entry.params.filter((p) => !entry.tickers?.includes(p.name))
          .map((p) => argText(p, s.params[p.name] ?? p.default ?? ""));
        out[s.id] = versusLabel(entry, own, vs, rest);
        continue;
      }
      const ticker = performance.byId.get(s.id);
      if (ticker === undefined || ticker === symbol || s.type === "performance") continue;
      out[s.id] = s.type === "study"
        ? `${ticker} ${expressionLabel({ expr: bareStudyExpr(s.expr, s.symbol), name: s.name ?? "", params: s.params, color: s.color })}`
        : `${ticker} ${SERIES_TYPE_LABELS[s.type]}`;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, performance.byId, symbol, versus.tickers, registry.catalog]);

  // The other symbols' bars, one hook per slot (see MAX_EXTRA_SYMBOLS): an
  // unused slot is disabled and fetches nothing. The provider follows the
  // card's one source -- an EODHD chart's benchmark comes from EODHD, a
  // local one's from the same kdb history `/series` serves -- and the
  // window is the card's, so the two lines rebase over the same bars.
  /**
   * Which slot each extra ticker holds, kept across renders (T6 review,
   * finding 7). Positional assignment (`performance.extras[i]`) moved every
   * survivor down a slot when an earlier performance series was deleted, and
   * a `useSeriesBars` whose `symbol` changed refetches from scratch -- so
   * removing one benchmark blanked the others for a beat. A ticker keeps the
   * slot it was first given; a new one takes the lowest FREE slot.
   */
  const slots = useRef<(string | undefined)[]>([]);
  const extraSlots = useMemo(() => {
    const held = Array.from({ length: MAX_EXTRA_SYMBOLS }, (_unused, i) => slots.current[i]);
    for (let i = 0; i < held.length; i += 1) {
      if (held[i] !== undefined && !performance.extras.includes(held[i] as string)) held[i] = undefined;
    }
    for (const ticker of performance.extras) {
      if (held.includes(ticker)) continue;
      const free = held.indexOf(undefined);
      // `performance.extras` is capped at MAX_EXTRA_SYMBOLS, so there is
      // always one -- the guard is for the reader, not for a live case.
      if (free === -1) continue;
      held[free] = ticker;
    }
    // `performance.extras` is a new array on every candle tick; the slots it names are what the
    // panes and the study sockets key on, so an unchanged assignment keeps its identity.
    if (held.length === slots.current.length && held.every((ticker, i) => ticker === slots.current[i])) return slots.current;
    slots.current = held;
    return held;
  }, [performance.extras]);
  /** The tickers a bar series draws: a slot whose ticker only has studies fetches no bars (plan Q2). */
  const barTickers = useMemo(
    () => new Set(series.filter((s) => s.type !== "study").map((s) => performance.byId.get(s.id)).filter((t): t is string => t !== undefined)),
    [series, performance.byId],
  );
  const extra0 = useSeriesBars({ backend, symbol: extraSlots[0] ?? "", interval, provider: httpBars ? barsProvider : "kdb", start, end, enabled: barTickers.has(extraSlots[0] ?? "") });
  const extra1 = useSeriesBars({ backend, symbol: extraSlots[1] ?? "", interval, provider: httpBars ? barsProvider : "kdb", start, end, enabled: barTickers.has(extraSlots[1] ?? "") });
  const extra2 = useSeriesBars({ backend, symbol: extraSlots[2] ?? "", interval, provider: httpBars ? barsProvider : "kdb", start, end, enabled: barTickers.has(extraSlots[2] ?? "") });
  const extra3 = useSeriesBars({ backend, symbol: extraSlots[3] ?? "", interval, provider: httpBars ? barsProvider : "kdb", start, end, enabled: barTickers.has(extraSlots[3] ?? "") });
  const extraBars = useMemo(() => {
    const out = new Map<string, Candle[]>();
    [extra0, extra1, extra2, extra3].forEach((slot, i) => {
      const ticker = extraSlots[i];
      // Filtered like the card's own bars: an unfiltered comparison series
      // would put the extended hours back on the shared time scale.
      if (ticker !== undefined) out.set(ticker, regular && calendar !== null ? sessionBars(slot.candles, calendar) : slot.candles);
    });
    return out;
    // The candle arrays are what this map is made of; the slots themselves
    // are new objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraSlots, extra0.candles, extra1.candles, extra2.candles, extra3.candles, regular, calendar]);

  // /ta_series_ws is query-scoped (unlike live_grid's socket-frame
  // subscription): it reads symbol/interval/etc straight off the connect
  // URL and defaults to AAPL/1d when absent. `symbol` and `interval` here
  // are the EFFECTIVE values (interval honours state.interval, same as the
  // tick cache above) so the study socket can never drift from what the
  // chart itself is showing. `basis` is in this object (not appended
  // separately) so a toggle rebuilds the URL and reconnects the socket --
  // otherwise the studies would keep streaming the old basis after ADJ flips.
  // `indicators` is derived from the instances once the card carries them
  // (studies addendum §4: `name:key=value:...:source=eodhd`); a card that
  // never has sends its own parameter string exactly as it did before.
  // `session` (slice 4) is in the object ONLY while the regular filter is
  // in force, so the extended URL is byte-identical to slice 3's and a
  // toggle rebuilds the URL, reconnects the socket and has every study
  // recomputed server-side on the regular window -- the same reason
  // `basis` lives here rather than being appended.
  // How much history the card's studies need behind the visible window so
  // their first VISIBLE point is honest (warmup.ts, owner report 2026-09-27):
  // an SMA(200) computed from the window's own first bar swings wildly before
  // it settles. `studyStart` moves the study socket's `start` that far earlier
  // -- ONLY the resolved window start, the interval and the studies feed it,
  // never `now`, so it is the same "one time call" the owner asked for and the
  // socket URL does not churn. Keyed on `registry.catalog` (its stable
  // identity), not `registry.lookup`, which is a fresh closure every render.
  /** The series list:1's socket is asked for: every series when no study names another ticker (plan R5). */
  const ownSeries = useMemo(
    () => versus.wired.filter((s) => s.type !== "study" || performance.byId.get(s.id) === symbol),
    [versus.wired, performance.byId, symbol],
  );
  const studyStart = useMemo(
    () => padStart(studyBase, warmupBars(ownSeries, registry.lookup), interval, calendar),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studyBase, ownSeries, registry.catalog, interval, calendar],
  );
  // `provider` and the bounded window ride along in EODHD mode. `/series` gets
  // the user's window; the studies socket gets `studyStart` -- the same window
  // padded earlier so the studies warm up before the first candle (the extra
  // points fall outside the visible range the chart already sets). `end` and a
  // no-study `start` are the card's own parameters when it set them, so with no
  // studies `studyStart === start` and this is a no-op rather than an override.
  /** One socket's parameters: list:1's, with the ticker, its own studies and its own warm-up (plan R6). */
  const studyParamsFor = useCallback(
    (own: Series[], ticker: string, from: string) => ({
      ...params, symbol: ticker, interval, basis,
      // v12.4.0: the string is derived from the card's STUDY SERIES, which
      // is the same wire indicatorsParam wrote for the same studies. The
      // condition is unchanged: a card that has never carried a list of its
      // own (no `series`, no `studies` -- only a raw `indicators`
      // parameter) still sends that parameter byte for byte.
      ...(state.series === undefined && state.studies === undefined
        ? {}
        : { indicators: indicatorsFromSeries(own, wireResolver, { allowBusinessDays: exchange !== null, source }) }),
      ...(regular ? { session: "regular" } : {}),
      // The PADDED start, whatever the provider (owner, 2026-09-27: "lookback
      // feature not fixed"). It used to ride ONLY in the EODHD branch below,
      // so a local/kdb card whose own `start` parameter was set spread that
      // RAW start through `...params` above and every study on it warmed up
      // from the window's own first bar -- the very thing padStart exists to
      // prevent. One branch was fixed and the other was not; this is the other.
      //
      // A card with NO `start` parameter still sends none, deliberately: the
      // backend then defaults to a year of history (live-grid `_window`, which
      // falls back to today-365), which is far more warm-up than padStart
      // would ask for. Sending a padded start there would NARROW the window,
      // not widen it, and make the lookback worse on exactly the cards that
      // are fine today.
      ...(params.start === undefined || params.start === "" ? {} : { start: from }),
      // A live card's studies socket is the chart server's: the window and the
      // provider its /series is asked for, as on the EODHD plane.
      ...(httpBars || liveStudies ? { provider: barsProvider, start: from, end } : {}),
    }),
    [params, interval, basis, state.series, state.studies, wireResolver, regular, exchange, source, httpBars, liveStudies, barsProvider, end],
  );
  const studyParams = useMemo(() => studyParamsFor(ownSeries, symbol, studyStart), [studyParamsFor, ownSeries, symbol, studyStart]);
  const studyUrlOf = useCallback(
    (p: Record<string, string>) => (liveCard && chartsSocket !== undefined
      ? studySocketUrl(chartsSocket("/ta_series_ws"), p)
      : buildWidgetWsUrl(backend, widget, p)),
    [liveCard, chartsSocket, backend, widget],
  );
  const studyUrl = useMemo(() => studyUrlOf(studyParams), [studyUrlOf, studyParams]);
  /**
   * Each slot's study socket (spec 2026-11-13 studies §2 Slots): open only while its ticker has
   * a study, asked for that ticker's studies alone. A ticker's url depends on its own studies
   * only, so removing another ticker's study never reconnects it. `macro: "none"`: a backend
   * macro is list:1's, and another socket would serve it twice.
   */
  const extraStudyUrls = useMemo(
    () => extraSlots.map((ticker) => {
      const own = versus.wired.filter((s) => s.type === "study" && ticker !== undefined && performance.byId.get(s.id) === ticker);
      if (ticker === undefined || own.length === 0) return null;
      const from = padStart(studyBase, warmupBars(own, registry.lookup), interval, calendar);
      return studyUrlOf({ ...studyParamsFor(own, ticker, from), macro: "none" });
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extraSlots, versus.wired, performance.byId, studyBase, registry.catalog, interval, calendar, studyUrlOf, studyParamsFor],
  );
  const { panes: mainPanes, extras: extraFeeds = NO_FEEDS } = useStudySeries({ url: studyUrl, extraUrls: extraStudyUrls });
  /** list:1's panes, then each extra ticker's, tagged; an extra pane id is prefixed so its guides stay its own (plan R4). */
  const panes = useMemo(() => [
    ...mainPanes.map((pane) => ({ ...pane, ticker: symbol })),
    ...extraFeeds.flatMap((feed, i) => {
      const ticker = extraSlots[i];
      return ticker === undefined || feed.note !== null ? [] : feed.panes.map((pane) => ({ ...pane, id: `${ticker}|${pane.id}`, ticker }));
    }),
  ], [mainPanes, extraFeeds, extraSlots, symbol]);
  /** Each ticker's study instances: a frame's line is matched only against its own ticker's (plan R4). */
  const studyTickers = series.map((s) => (s.type === "study" ? performance.byId.get(s.id) ?? "" : "")).join("\n");
  const studiesOn = useMemo(() => {
    const out = new Map<string, StudyInstance[]>();
    for (const s of versus.wired) {
      const ticker = performance.byId.get(s.id);
      if (s.type !== "study" || s.name === undefined || ticker === undefined) continue;
      out.set(ticker, [...(out.get(ticker) ?? []),
        { expr: s.expr, name: s.name, params: s.params, color: s.color, source: s.source, style: s.style }]);
    }
    return out;
    // `performance` is new on every candle tick (its anchors read the window); the tickers it
    // resolved are what the map is made of, so the effect that draws from it does not rerun per tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versus.wired, studyTickers]);
  /** An extra ticker's socket refused, or its bars unavailable: each of its studies says why (spec §2 Failures). */
  const feedNotes = useMemo(() => {
    const out: Record<string, string> = {};
    extraFeeds.forEach((feed, i) => {
      const ticker = extraSlots[i];
      if (ticker === undefined || feed.note === null) return;
      for (const s of series) if (s.type === "study" && performance.byId.get(s.id) === ticker) out[s.id] = feed.note;
    });
    return out;
  }, [extraFeeds, extraSlots, series, performance.byId]);
  /** The engine's own word on a line (a gap, a vs it could not serve), from its frame (plan R8). */
  const engineNotes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const pane of panes) {
      for (const line of pane.series) {
        if (line.note === undefined) continue;
        const hit = matchSeries(line, studiesOn.get(pane.ticker) ?? [], source, wireResolver);
        const card = hit === undefined ? undefined : seriesByExpr.get(hit.expr);
        if (card !== undefined) out[card.id] = line.note;
      }
    }
    return out;
  }, [panes, studiesOn, source, wireResolver, seriesByExpr]);
  /** Every reason a chip is not drawing, performance and study alike. */
  const seriesNotes = useMemo(
    () => ({ ...performance.notes, ...studyNotes, ...versus.notes, ...feedNotes, ...engineNotes }),
    [performance.notes, studyNotes, versus.notes, feedNotes, engineNotes],
  );

  /**
   * Every instant that must exist on EVERY panel's time scale: the card's bar
   * times UNION every time a study holds (the misalignment reported
   * 2026-09-25).
   *
   * The panels are separate charts kept on one axis by mirroring a LOGICAL
   * range -- bar indices (panelSync.ts, setVisibleLogicalRange) -- so they only
   * agree where index N is the same instant on all of them. A chart's index
   * space is the UNION of the times its own series hold, and the spine was
   * built from the candles alone: it could ADD the candles' times to a study
   * panel (fixing a dropped warm-up) but could not stop that study
   * CONTRIBUTING a time the candles lack. One such time makes the panel's union
   * one longer than the candles', every index above it names a different
   * instant, and the whole panel sits shifted at even bar spacing -- the
   * constant offset that was measured. Candles arrive from the kdb tick plane
   * over the socket; study points arrive from the backend's ta_series over HTTP
   * and are converted to epoch seconds by useStudySeries, and nothing
   * reconciled the two grids, so a different bucketing origin on either side
   * was enough.
   *
   * Taking the UNION rather than filtering studies down to the candle grid is
   * deliberate: filtering would silently drop a study value whose bar has not
   * arrived yet (the study payload can lead the candle batch), trading a
   * misaligned chart for a missing line. Growing the spine loses nothing --
   * every panel ends up with exactly this set, because a panel's own series
   * times are always a subset of it.
   */
  const spineTimes = useMemo(() => {
    const times = new Set<number>(candles.map((c) => c.time));
    /**
     * CLAMPED to the card's own bars (owner, 2026-09-27: "why does the x axis
     * jump", "redraw still not fixed").
     *
     * The spine is the union of every instant any series holds, and every
     * panel is drawn on it, so it IS the card's index space -- which means a
     * study point outside the candles' span stretches the x-axis to reach it,
     * with nothing to draw in between. The library then labels that empty span
     * at its own scale: months and years beside the intraday ticks, which is
     * the "jump", and the candles squeezed into whatever is left.
     *
     * Study data outside the window is WARM-UP, and warm-up exists so the
     * first VISIBLE point is honest -- it was never meant to be drawn. Two
     * sources of it, both real and both seen: `padStart` deliberately asks the
     * study socket for bars before the window, and a card that sends no
     * `start` at all gets live-grid's own default of today-365, so a local
     * BTC-USD card with a day of ticks was drawing an axis a YEAR wide.
     *
     * Clamping keeps the property the spine exists for -- every panel gets the
     * identical set, so bar N is the same instant everywhere -- while refusing
     * to widen the card past its bars. With no candles there is nothing to
     * clamp to and the union stands, which is the empty-chart case the seed
     * effect already handles.
     */
    const first = candles[0]?.time;
    const last = candles.at(-1)?.time;
    const add = (time: number) => {
      if (first !== undefined && last !== undefined && (time < first || time > last)) return;
      times.add(time);
    };
    // Every socket's lines and every overlay's bars (spec 2026-11-13 cross-symbol §5, X8): a time
    // list:2 has and list:1 lacks is on every panel too, clamped like the rest.
    for (const pane of panes) for (const line of pane.series) for (const point of line.data) add(point.time);
    for (const bars of extraBars.values()) for (const bar of bars) add(bar.time);
    return [...times].sort((a, b) => a - b);
  }, [candles, panes, extraBars]);
  // What the socket ACTUALLY served each instance from, keyed by the
  // instance's expression, for the strip's parity mark (studies addendum
  // §4): an eodhd instance the backend had to compute locally is marked
  // `local`. An instance no series has answered for yet is simply absent.
  const served = useMemo(() => {
    const out: Record<string, "local" | "eodhd"> = {};
    for (const pane of panes) {
      for (const line of pane.series) {
        const servedSource = line.render.source;
        const hit = matchSeries(line, studiesOn.get(pane.ticker) ?? [], source, wireResolver);
        if (hit !== undefined && (servedSource === "local" || servedSource === "eodhd")) out[hit.expr] = servedSource;
      }
    }
    return out;
  }, [panes, studiesOn, source, wireResolver]);

  // Read inside the click handler, which is subscribed once per chart
  // instance: a stale closure would leave every click applying whichever
  // tool (or callback) was active when that instance was created, or hit-
  // testing against a `drawingEdge` frozen at mount instead of the one the
  // drawings are actually rendered against. `onPatch` lives here too, not
  // just in the effect's deps -- see the click-handler effect below for
  // why. Same discipline as useWidgetSocket's `batch` ref for onBatch. The
  // crosshair-move handler below is subscribed once per chartEpoch too, and
  // needs the same discipline for `candles` -- without it the legend would
  // read whichever bars that chart instance was created with. (`symbol` and
  // `interval` were here for the same reason until v12.3.0; <Legend> takes
  // them as props now and re-renders on its own when they change.)
  // `intervalSeconds` belongs here too: the gann branch below reads it to
  // size its surrounding-bars window, and (like every other value here) a
  // stale closure would keep measuring against whatever interval was active
  // when this chart instance was created, not the current one -- an
  // interval switch bumps neither chartEpoch nor this effect's subscription.
  // `panes` is read by legendValues below, for the same reason: the crosshair
  // handler is subscribed once per chart instance and would otherwise report
  // whichever studies existed when it was created. It is also why this ref is
  // declared here rather than with the other values -- `panes` does not exist
  // until useStudySeries above has returned it.
  // `magnet` and `measure` are here for the same reason as `tool`: the drag
  // and click handlers are subscribed once per chart instance, so a closure
  // over either would snap (or dismiss) according to whatever was set when
  // that instance was created rather than what is set now.
  // `studies` and `source` are read by legendValues below, the same
  // way `panes` is: the legend labels and colours a series from the instance
  // it matches, and must match against the instances the card has NOW.
  // `wireResolver` rides with them for the same match (v12.4.2: the raw
  // wire resolver, not `resolveAnchor` alone, since EODHD's series echo the
  // raw text), and `calendar` is read by the seed's range resolution, which
  // is keyed on the bars, not on the exchange.
  // `series`, `t` and `perf` (v12.4.0) ride along for the same reason
  // `panes` does: the legend reads them out of a handler subscribed once
  // per set of charts, and must report the card as it is NOW.
  const live = useRef({ tool, state, onPatch, onParam, drawingEdge, candles, intervalSeconds, panes, magnet, measure, studies, studiesOn, symbol, series, overlayLabels, t, theme, source, wireResolver, calendar, anchorWindow, clippedTo });
  live.current = { tool, state, onPatch, onParam, drawingEdge, candles, intervalSeconds, panes, magnet, measure, studies, studiesOn, symbol, series, overlayLabels, t, theme, source, wireResolver, calendar, anchorWindow, clippedTo };
  /**
   * Every chart series this card has drawn, keyed by what it draws:
   * `<series id>` for a card series with one line, `<series id>|<column>`
   * for a study, whose one card series is one or more of the socket's
   * outputs (bbands is three). Each entry remembers the chart and panel it
   * lives on, so a series moved to another panel is taken off the old
   * chart rather than orphaned on it, and the kind it was created as, so a
   * candlestick changed to a line is recreated rather than fed the wrong
   * data shape.
   */
  const drawn = useRef(new Map<string, {
    api: ISeriesApi<PlotSeriesType>; chart: IChartApi; panel: number; kind: string;
  }>());
  /**
   * The crosshair-following axis label attached to each drawn series, keyed
   * exactly as `drawn` is (lib/chart/axisLabel.ts). One per series, so a
   * banded study has one per output it draws.
   */
  const labels = useRef(new Map<string, ReturnType<typeof createAxisLabel>>());
  /** The performance data last drawn, by series id, for the legend's reading. */
  const perf = useRef(new Map<string, { time: number; value: number }[]>());
  // The guide lines (studies addendum §6: RSI's 30/70, MACD's 0) drawn on
  // each own pane's first series, keyed by pane id. Held so the studies
  // effect can take the previous run's down before drawing the next.
  const guideLines = useRef(new Map<string, { series: ISeriesApi<PlotSeriesType>; lines: IPriceLine[] }>());
  // Keyed by anchor -- the ISO timestamp the anchor tool persisted, which is
  // also what the tick cache echoes back on every rebuild. The hook
  // republishes `avwaps` on every trade batch, so a series has to be found
  // again by anchor and reused; minting a new one per rebuild would flicker
  // the line several times a second.
  const avwapLines = useRef(new Map<string, ISeriesApi<"Line">>());
  // The band shades (v12.3.1), keyed by the instance's `expr`: one fill
  // primitive per banded study whose `style.shade` is set, attached to the
  // panel its two lines are on. Held so the studies pass can reuse,
  // recolour and release them.
  const bandFills = useRef(new Map<string, {
    fill: ReturnType<typeof attachBandFill>; panel: number; up: ISeriesApi<PlotSeriesType>; lo: ISeriesApi<PlotSeriesType>;
  }>());
  // The live press-drag, or null. `press` is where the pointer went down (in
  // chart units, not pixels -- the view can scroll under a drag), `preview`
  // is the throwaway line series drawn between it and the pointer. A ref, not
  // state: every pointermove would otherwise re-render the component that
  // holds the chart, which is exactly what the crosshair handler above avoids.
  const drag = useRef<{ press: ChartPoint; preview: ISeriesApi<"Line"> } | null>(null);

  // The symbol's name and logo for the header block (spec §4.1). The same
  // best-effort favicon pattern the live grid uses for its logo column: a
  // backend without /symbol_meta 404s straight into the catch, and the
  // header renders with the ticker alone. Never throws, never an error
  // state, and logged once per widget rather than once per symbol -- a card
  // whose symbol is edited letter by letter must not write a log line each
  // keystroke.
  useEffect(() => {
    if (symbol === "") { setMeta(null); return; }
    let current = true;
    void (async () => {
      try {
        const payload = await fetchWidgetPath(backend, "symbol_meta", { symbol });
        if (!current) return; // a stale response must not decorate another symbol
        const row = (Array.isArray(payload) ? payload : []).find((r) => typeof r === "object" && r !== null) as
          { name?: unknown; logo_url?: unknown; asset?: unknown } | undefined;
        const name = typeof row?.name === "string" && row.name !== "" ? row.name : null;
        // "NA" is what forex and crypto answer for a symbol with no logo --
        // the same literal the live grid's normaliseMeta folds to absent.
        const logo = typeof row?.logo_url === "string" && row.logo_url !== "" && row.logo_url !== "NA" ? row.logo_url : null;
        // The asset class (slice 4), only in the three spellings live-grid's
        // classify writes; anything else is "unclassified" and gets no
        // exchange rather than a guessed one.
        const asset = row?.asset === "us" || row?.asset === "crypto" || row?.asset === "forex" ? row.asset : undefined;
        setMeta(row === undefined ? null : { symbol, name, logoUrl: logo, asset });
      } catch (err) {
        if (!current) return;
        setMeta(null);
        void logOnce(`symbol_meta:${widget.id}`, `symbol_meta unavailable: ${String(err)}`);
      }
    })();
    return () => { current = false; };
    // Only widget.id is read below (for the log key); the object itself
    // would re-run this fetch on every unrelated widget-prop change.
  }, [backend, symbol, widget.id]);

  // Switching tool drops a leftover selection: a Delete pressed after
  // switching away from "panning" must not remove a drawing the user is no
  // longer looking at.
  useEffect(() => { setSelected(null); }, [tool]);

  // A patch this component didn't just make (a rita-proposed drawing, a
  // second window editing the same card) can shift every index after the
  // edit point. `selected` is a plain index, so it has no way to tell "the
  // drawing I selected" from "whatever now sits at that position" -- and
  // deleting the wrong one is worse than deleting nothing, so any change to
  // the list clears the selection rather than trusting a stale index. This
  // also covers this component's own delete, which is otherwise already
  // cleared inline.
  useEffect(() => { setSelected(null); }, [state.drawings]);

  /**
   * PanelHost hands the live handles over on every build -- one per panel,
   * in panel order -- and takes them away before each teardown. Nothing here
   * touches a chart: the effects below do that, keyed on `chartEpoch`.
   *
   * The handles live in a ref rather than in state because a rebuild happens
   * inside the HOST's effect, whose body (and this callback) runs before
   * this component's own effects on the same commit. An effect reading the
   * previous render's state would reach into a chart that has already been
   * removed, which throws; reading the ref always finds the live set.
   */
  const onPanelsReady = useCallback((ready: PanelApi[]) => {
    panels.current = ready;
    // A fresh set of charts has no view worth preserving, so the next bars
    // fit (or apply the card's saved range) as they do on a first load.
    seeded.current = false;
    // The watermark is PanelHost's own element now, centred on the card
    // rather than on panel 1, so nothing here attaches or refreshes it.
    setChartEpoch((n) => n + 1);
  }, []);
  /**
   * Before a rebuild, and on unmount -- and while the charts are still
   * ALIVE: PanelHost calls this before `remove()` precisely so the
   * primitives this component attached can come off the panes they are on.
   * The series handles are simply forgotten (the charts take them), but a
   * primitive is held by its pane, so an undetached one is a leak.
   */
  const onPanelsDispose = useCallback(() => {
    panels.current = [];
    // The band fills come off their panes first; detachPrimitive after
    // remove() is what would throw, and the host has not removed anything
    // yet. (The mark is a DOM element now and owns no pane.)
    for (const held of bandFills.current.values()) held.fill.detach();
    drawn.current.clear();
    guideLines.current.clear();
    avwapLines.current.clear();
    bandFills.current.clear();
    perf.current.clear();
    priceSeries.current = null;
    priceSide.current = "right";
  }, []);

  // The narrow-card collapse (spec §15 criterion 10) keys on the CARD's
  // width, which only the element itself can report: a media query would
  // read the window, and the project's own gate (src/lib/iosFloor.test.ts)
  // forbids container queries. Guarded: jsdom has no ResizeObserver, and a
  // browser without one simply never collapses.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? root.clientWidth;
      const height = entries[0]?.contentRect.height ?? root.clientHeight;
      setNarrow(width < NARROW_WIDTH);
      setPortrait(height > width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // A new symbol is a new seed. The chart itself survives a symbol change
  // (it is rebuilt only on theme/tickUrl), and so did its view: an axis pan,
  // pinch or drag had turned the price scale's autoscale off, nothing turned
  // it back on, and Bitcoin's ~100k range stayed up with AAPL's ~230 candles
  // below it, off the chart (2026-09-15). Declared BEFORE the candle effect,
  // so the flag is down before the new symbol's first bars can arrive.
  //
  // A new symbol also empties the chart field (spec ruling): a drawing is
  // symbol-RELATIVE -- a trendline drawn on AAPL's 230s is nonsense over
  // Bitcoin's 100k -- so drawings, levels, anchors and both stacks go. The
  // studies stay: an indicator is a function of whatever bars are loaded.
  // `previousSymbol` starts null so the FIRST render never clears: a card
  // reopened with saved drawings must keep them. `onPatch` is read through
  // the `live` ref rather than closed over, so this effect can stay keyed on
  // `symbol` alone -- WidgetCard passes a fresh closure every render, and a
  // dependency on it would put `seeded.current = false` back up on each one
  // and re-fit the view on every tick.
  const previousSymbol = useRef<string | null>(null);
  useEffect(() => {
    seeded.current = false;
    if (previousSymbol.current !== null && previousSymbol.current !== symbol) {
      live.current.onPatch({ drawings: [], levels: [], anchors: [], added: [], redo: [] });
    }
    previousSymbol.current = symbol;
  }, [symbol]);

  /**
   * Add, reuse or re-place one drawn thing, and hand back its handle. A
   * series that moved panel -- or changed type, or changed SIDE, under the
   * same id -- is a NEW series: a handle belongs to one chart instance and
   * cannot be carried across them, a candlestick fed line data throws, and
   * lightweight-charts binds a series to its price scale at CREATION, so an
   * `applyOptions({ priceScaleId })` leaves the line on the old axis while
   * the legend, the strip prefix and `usedSides` all say otherwise (T6
   * review, finding 3 -- which is why `kind` carries the side).
   *
   * A callback rather than a local, because the two draw passes below share
   * the one handle map.
   */
  /**
   * The axis label for one drawn series: attached when the series wants one,
   * recoloured when it already has one, and detached when it does not.
   *
   * Keyed like `drawn`, and attached to the SERIES (not the pane), which is
   * what makes the label the series' own -- its colour, its formatter, its
   * points. `axisValue === false` is the study's own opt-out.
   */
  const label = useCallback((key: string, api: ISeriesApi<PlotSeriesType>, colour: string, wants: boolean) => {
    const held = labels.current.get(key);
    if (!wants) {
      if (held !== undefined) { api.detachPrimitive(held); labels.current.delete(key); }
      return;
    }
    if (held !== undefined) { held.setColor(colour); return; }
    const made = createAxisLabel(colour);
    api.attachPrimitive(made);
    labels.current.set(key, made);
  }, []);

  const place = useCallback((
    key: string, api: PanelApi, kind: string,
    definition: SeriesDefinition<PlotSeriesType>, options: Record<string, unknown>, data: unknown[],
  ): ISeriesApi<PlotSeriesType> => {
    const held = drawn.current.get(key);
    let line: ISeriesApi<PlotSeriesType>;
    if (held === undefined || held.panel !== api.index || held.kind !== kind) {
      if (held !== undefined) held.chart.removeSeries(held.api);
      line = api.chart.addSeries(definition, options as never);
      drawn.current.set(key, { api: line, chart: api.chart, panel: api.index, kind });
    } else {
      line = held.api;
      // The look is re-applied rather than diffed: a colour or width
      // edited, or the catalog landing after the line did.
      // ponytail: applyOptions on every delta frame for every line; cheap
      // next to the setData below. Upgrade path: remember the last look
      // per key and skip an unchanged one.
      line.applyOptions(options as never);
    }
    line.setData(data as never);
    return line;
  }, []);

  /**
   * One crosshair across the card (spec, Rendering): each panel mirrors the
   * pointer onto the first series drawn on it, and a panel drawing nothing is
   * skipped. Read off the handle map rather than assembled inside one pass,
   * because both passes below contribute to it.
   *
   * A NON-study beats a study on the same panel whatever the insertion order
   * (T6 fix round 1 re-review, A): `drawn` keeps a key at the position it was
   * first inserted at, so deleting panel 1's candlestick and adding an OHLC
   * as two edits leaves the new key behind an overlay study's -- and the
   * panel would hang its crosshair on the study's line instead of the price.
   */
  const syncCrosshairSeries = useCallback(() => {
    const first = new Map<number, { api: ISeriesApi<PlotSeriesType>; study: boolean }>();
    for (const held of drawn.current.values()) {
      // The spine draws nothing and prices nothing: a panel with only a
      // spine is a panel drawing nothing, and is skipped.
      if (held.kind === "spine") continue;
      const study = held.kind.startsWith("study");
      const have = first.get(held.panel);
      if (have === undefined || (have.study && !study)) first.set(held.panel, { api: held.api, study });
    }
    for (const api of panels.current) api.setCrosshairSeries(first.get(api.index)?.api ?? null);
  }, []);

  /**
   * What a pass owes the host once it has changed what a scale autoscales to
   * (a setData, a series added or taken away): each panel's `xs`/`xe`
   * sub-window, then the `ymin`/`ymax` links. `applyLinks` is host-wide, so
   * once is enough.
   */
  const settlePanels = useCallback(() => {
    for (const api of panels.current) api.applyWindow();
    panels.current[0]?.applyLinks();
  }, []);

  /**
   * The series the card draws out of BARS (v12.4.0): the price drawing, the
   * volume and every performance line, each on the panel and side its series
   * names. Keyed on the bars, so a live tick redraws exactly these -- the
   * studies, their guides and the band fills are the pass below, keyed on the
   * socket's frames instead (T6 review, finding 4: as one pass, a kdb card
   * republishing candles per trade batch re-`setData`'d every study column
   * and tore down and rebuilt every guide several times a second).
   *
   * ponytail: this runs TWICE per rebuild -- once on the commit that made
   * the new charts (the host's effect and its onReady run before this one,
   * so `panels.current` is already fresh) and once when `chartEpoch` lands.
   * The pass is idempotent (`place` reuses every handle), so the cost is one
   * extra setData per series per rebuild -- a theme flip or a panels edit,
   * not a frame. Upgrade path: remember the handle set this pass drew for
   * and skip a repeat, if a very wide card ever makes the flip visible.
   */
  useEffect(() => {
    const apis = panels.current;
    if (apis.length === 0) return;
    const wanted = new Set<string>();
    let price: ISeriesApi<PlotSeriesType> | null = null;
    let priceOn: "left" | "right" = "right";
    /** `place`, recording the key as one this pass still wants. */
    const draw = (
      key: string, api: PanelApi, kind: string,
      definition: SeriesDefinition<PlotSeriesType>, options: Record<string, unknown>, data: unknown[],
    ): ISeriesApi<PlotSeriesType> => {
      wanted.add(key);
      return place(key, api, kind, definition, options, data);
    };

    // A series' own colour, or the adapter's when it carries none: the
    // migration writes "" for the types the THEME colours (candles, OHLC
    // bars, volume), and a line the user never recoloured takes the study
    // colour, as a study does.
    const colourOf = (s: Series): string => (s.color === "" ? t.drawings.study : s.color);
    const widthOf = (s: Series) => (s.style?.width ?? 1) as 1 | 2 | 3 | 4;
    // A price series has no registry default to fall back on: absent is solid.
    const penOf = (s: Series) => lineStyleOf(s.style?.pen);
    // Which of the panel's two scales a series prices against. The host
    // reads the scale itself for a `ymin=P<n>` link (getVisibleRange), so a
    // series owes it nothing beyond being on the scale.
    const onScale = (side: "left" | "right") => ({ priceScaleId: side });
    /**
     * The axis label and the dotted horizontal, for the series drawn here.
     *
     * `lastValueVisible` is the series' own value on the price axis, filled by
     * the library with that series' colour -- the same control the study pass
     * below reads, and the same `axisValue` choice, so a line and a study
     * answer to one rule rather than two (owner, 2026-09-27: these were still
     * bare while studies had labels).
     *
     * Candlesticks and OHLC bars are NOT drawn through this: they take the
     * library's defaults, so the price has carried both a label and its dotted
     * horizontal all along. Only the four below ever suppressed them.
     *
     * `priceLineVisible` stays off regardless. That is the dotted line across
     * the whole panel, not the axis label, and one of those (the price's) is
     * all a panel should carry.
     */
    const annotation = () => ({
      // OFF, always: the axis label is the `axisLabel` primitive now, which
      // follows the crosshair where the library's own reads the last VISIBLE
      // bar. Leaving both on would put two labels per series on the axis
      // while hovering -- six on a card with a band and a MACD.
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // The spine (user ruling 2026-09-24, the grid marks that did not line
    // up): the panels are kept on one time axis by mirroring a LOGICAL
    // range -- bar indices -- so they only agree where bar N is the same
    // instant on every panel. A panel holding only a study was not: its
    // scale was built from the study's own points, warm-up dropped, so its
    // bar 0 was panel 1's bar 14 and every grid line sat a warm-up to the
    // right. Every panel now carries the card's bar TIMES as whitespace on
    // a hidden overlay series -- nothing drawn, nothing priced, but every
    // time on the scale -- so every panel's index space is the candles'.
    // Set BEFORE the series below, so every pass ends on real data: re-setting
    // this whitespace after a series refilled from empty (bars that were still
    // loading) left lightweight-charts 5.0.8's time scale with no visible range,
    // and the panel painted nothing until a later pass (hand check 2026-11-14).
    for (const api of apis) {
      draw(`spine|${api.index}`, api, "spine", LineSeries, {
        visible: false, priceScaleId: "", lastValueVisible: false, priceLineVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        // The union, not `candles`: see spineTimes. Every panel gets the same
        // set, so bar N is the same instant everywhere and the logical-range
        // mirror lands them on top of each other.
      }, spineTimes.map((time) => ({ time })));
    }

    for (const s of series) {
      const api = apis[s.panel - 1];
      // A series naming a panel the text does not have draws nothing. The
      // palette only offers panels that exist, so this is a hand-typed
      // `panels` that lost a row -- and an invisible series is a better
      // answer than one silently moved somewhere it was not put.
      if (api === undefined) continue;
      if (s.type === "study") continue; // from the socket, below
      // Every bar series draws off its resolved ticker's bars (spec 2026-11-13 §2): the card's
      // own for list:1, an extra-bars slot otherwise; unresolved (the chip says why), nothing.
      const ticker = performance.byId.get(s.id);
      if (ticker === undefined) continue;
      const bars = ticker === symbol ? candles : extraBars.get(ticker) ?? [];
      const colour = colourOf(s);
      // The side is part of the identity (finding 3): a series whose side
      // flipped has to be recreated on the other scale, not re-optioned.
      const kind = `${s.type}|${s.side}`;
      let line: ISeriesApi<PlotSeriesType> | null = null;
      if (s.type === "candlestick") {
        line = draw(s.id, api, kind, CandlestickSeries, { ...t.candles, ...onScale(s.side) }, ohlcData(bars));
      } else if (s.type === "ohlc") {
        // Black-and-white bars (spec, Series): both directions the text
        // colour, thin, so the open and close ticks read as the reading and
        // the colour says nothing at all.
        line = draw(s.id, api, kind, BarSeries, {
          thinBars: true, upColor: t.bars, downColor: t.bars, ...onScale(s.side),
        }, ohlcData(bars));
      } else if (s.type === "line") {
        line = draw(s.id, api, kind, LineSeries, {
          color: colour, lineWidth: widthOf(s), lineStyle: penOf(s), ...onScale(s.side), ...annotation(),
        }, closeData(bars));
      } else if (s.type === "area") {
        line = draw(s.id, api, kind, AreaSeries, {
          lineColor: colour, lineStyle: penOf(s),
          topColor: withAlpha(colour, s.style?.fillOpacity ?? AREA_FILL_OPACITY),
          // Fading to nothing at the baseline, so the fill reads as a wash
          // under the line rather than a block behind it.
          bottomColor: withAlpha(colour, 0),
          ...onScale(s.side), ...annotation(),
        }, closeData(bars));
      } else if (s.type === "volume") {
        line = draw(s.id, api, kind, HistogramSeries, {
          priceFormat: { type: "volume" }, color: t.volume.up, ...onScale(s.side), ...annotation(),
          // Tinted per bar to its own direction at under half opacity
          // (spec §8.3), so the auction's shape reads without competing
          // with price.
        }, volumeData(bars, t.volume.up, t.volume.down));
      } else if (s.type === "performance") {
        // Left off entirely when its symbol or its anchor does not resolve
        // -- the chip carries the reason (see `performance` above), which is
        // the same reading an unresolvable study anchor gets.
        const anchorAt = s.anchor === undefined ? null : resolveWindowed(s.anchor);
        if (anchorAt === null) continue;
        const data = performanceData(bars, anchorAt);
        perf.current.set(s.id, data);
        line = draw(s.id, api, kind, LineSeries, {
          color: colour, lineWidth: widthOf(s), lineStyle: penOf(s),
          // Percent of the rebase, not a price: the axis says so.
          priceFormat: { type: "percent" },
          ...onScale(s.side), ...annotation(),
        }, data);
      }
      // The series' own value on the axis, following the crosshair. Candles
      // and OHLC bars keep the library's label instead: they never went
      // through `annotation`, their "colour" is a direction rather than one
      // pen, and the price's label is the one label a panel has always had.
      if (line !== null && s.type !== "candlestick" && s.type !== "ohlc") {
        label(s.id, line, colourOf(s), s.style?.axisValue !== false);
      }
      // An overlay reads in the legend as a performance line does, off the data drawn for it.
      if (s.type !== "performance") {
        if (ticker === symbol) perf.current.delete(s.id);
        else perf.current.set(s.id, s.type === "volume" ? bars.map((b) => ({ time: b.time, value: b.volume })) : closeData(bars));
      }
      // Panel 1's price drawing is what the levels hang off, what a click's
      // y is read through and what the drawing tools measure against. The
      // volume is not one of those, even in panel 1. Its SIDE is remembered
      // beside it (finding 5): every axis gesture and the legend's decimals
      // address a scale by name, and this one is not always the right.
      if (line !== null && api.index === 1 && price === null && s.type !== "volume") {
        price = line;
        priceOn = s.side;
      }
    }

    // Volume bars grow off the floor of their scale. Only where nothing else
    // shares that scale, though: a volume series dropped into the price panel
    // must not squash the candles into the top 90%. Written for EVERY used
    // side rather than from inside the volume branch (T6 fix round 1
    // re-review, B): adding or removing a series rebuilds no chart, so a side
    // the volume has LEFT would keep the volume's margins and squash whatever
    // took its place until the next rebuild.
    const margined = new Set<string>();
    for (const s of series) {
      const api = apis[s.panel - 1];
      const slot = `${s.panel}:${s.side}`;
      if (api === undefined || margined.has(slot)) continue;
      margined.add(slot);
      const alone = !series.some((other) => other.id !== s.id && other.panel === s.panel && other.side === s.side);
      api.chart.priceScale(s.side).applyOptions({
        scaleMargins: alone && s.type === "volume" ? VOLUME_SCALE_MARGINS : DEFAULT_SCALE_MARGINS,
      });
    }

    // Whatever this pass did not want is off the card: a series deleted, a
    // performance line whose group stopped resolving, one moved to a panel
    // the text no longer has. Only the keys THIS pass owns -- the study
    // lines belong to the pass below and are recognised by their kind.
    for (const [key, held] of drawn.current) {
      if (held.kind.startsWith("study") || wanted.has(key)) continue;
      // The label goes with the series. Not detached first: removeSeries
      // takes its primitives with it, and detaching from a removed series
      // throws.
      labels.current.delete(key);
      held.chart.removeSeries(held.api);
      drawn.current.delete(key);
    }
    // The performance readings of series that are gone go with them, so the
    // legend cannot report a line that is no longer drawn.
    for (const id of perf.current.keys()) {
      if (!wanted.has(id)) perf.current.delete(id);
    }

    syncCrosshairSeries();
    settlePanels();

    priceSide.current = priceOn;
    if (priceSeries.current !== price) {
      priceSeries.current = price;
      setPriceEpoch((n) => n + 1);
    }
    // `chartEpoch` first, as every chart effect in this file: a rebuild
    // empties `drawn` and this rerun is what refills the new charts.
    // `spineTimes` joins the list because the spine is drawn here and a stale
    // grid is the bug this guards: a study arriving with a new instant must put
    // that instant on EVERY panel, not only on its own. It is a memo over
    // [candles, panes], so it changes when candles change (this effect already
    // re-ran then) plus when a study's times change, which is a socket push and
    // not a per-trade event.
  }, [chartEpoch, series, candles, spineTimes, t, performance, extraBars, resolveWindowed, symbol, place, label, syncCrosshairSeries, settlePanels]);

  /**
   * The studies, their pane guides and the band fills (v12.4.0). A separate
   * pass from the bars above (T6 review, finding 4) and keyed on the socket's
   * frames rather than on the candles, so a live tick no longer re-`setData`s
   * every study column, tears down and rebuilds every guide price line and
   * re-walks the band pass several times a second.
   */
  useEffect(() => {
    const apis = panels.current;
    if (apis.length === 0) return;
    const wanted = new Set<string>();
    const draw = (
      key: string, api: PanelApi, kind: string,
      definition: SeriesDefinition<PlotSeriesType>, options: Record<string, unknown>, data: unknown[],
    ): ISeriesApi<PlotSeriesType> => {
      wanted.add(key);
      return place(key, api, kind, definition, options, data);
    };
    const onScale = (side: "left" | "right") => ({ priceScaleId: side });
    /**
     * `lastValueVisible` is what draws a series' OWN value on the price axis,
     * filled with that series' colour -- the library's `SeriesPriceAxisView`.
     * Every study line had it off, so the only thing a study panel's axis
     * carried was the chart's single built-in crosshair label, which is one
     * per chart and painted `--border`: the grey the user reported.
     *
     * It is now the study's own `axisValue` choice (user, 2026-09-27: "make
     * this an option on the study definition"), ON unless that study turned it
     * off ("keep the crosshair values gray, but color the last tick values").
     * One label per OUTPUT line, so a banded study puts up three, each in its
     * own line's colour -- which is what "1 per series" meant.
     *
     * `!== false`, not `=== true`: an unclaimed line (no card series, from a
     * backend too old to send `req`) and every card saved before this field
     * existed both read as shown, which is the default the user asked for.
     *
     * `priceLineVisible` stays off either way: that is the horizontal dashed
     * line across the plot, not the axis label, and nothing asked for it.
     *
     * KNOWN LIMIT, deliberate: this label reads the last VISIBLE bar, not the
     * bar under the crosshair -- `Series.lastValueData(false)` takes
     * `visibleBars.right()`. So it is the resting value, and it does not
     * follow the pointer. Making it track the crosshair needs a series
     * primitive with `priceAxisViews()` (lightweight-charts supports one per
     * series, with its own `backColor`), fed from the same per-line readings
     * `legendValues` already computes. That is the upgrade path, not a
     * different design.
     */
    /**
     * The card's own window, read off the ref so this pass keeps its
     * deliberate independence from `candles` (a tick must not redraw every
     * study). Study points outside it are WARM-UP: computed so the first
     * visible point is honest, never meant to be drawn.
     *
     * Clamping the spine alone was not enough (owner, 2026-09-27, "x axis
     * lineup is broken look at RSI"): the spine fixes the SHARED index set,
     * but a series carrying points beyond it extends its OWN chart's index
     * space, and the panels are kept together by mirroring a LOGICAL range.
     * So the RSI panel spanned a year while price and volume spanned a day,
     * and bar N meant a different instant on each.
     */
    const first = live.current.candles[0]?.time;
    const last = live.current.candles.at(-1)?.time;
    const inWindow = (time: number): boolean =>
      first === undefined || last === undefined || (time >= first && time <= last);

    const annotation = () => ({
      // OFF: the study's axis label is the `axisLabel` primitive attached
      // below, which follows the crosshair. The library's own reads the last
      // VISIBLE bar, and both would put two labels per line on the axis.
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // The studies arrive by COLUMN, not by card series: one study is one or
    // more outputs (bbands is three lines), each named by the socket and
    // tied back by the matcher to the instance that asked for it.
    const widthOf = (raw: unknown): 1 | 2 | 3 | 4 =>
      (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : 1) as 1 | 2 | 3 | 4;
    const lookOf = (line: StudySeries, card: Series | undefined) => {
      const entry = registry.lookup(card?.name ?? line.req?.name ?? "");
      return {
        // The instance's colour, else the server's, else the adapter's --
        // the same three-way fallback the legend's swatch makes below, so a
        // line and its legend entry can never disagree about its colour.
        color: card !== undefined && card.color !== ""
          ? card.color
          : (line.render.color as string | undefined) ?? t.drawings.study,
        // The instance's width, else the output's own from its render dict,
        // else 1; anything outside the library's 1..4 reads as 1.
        lineWidth: widthOf(card?.style?.width ?? line.render.width),
        // The instance's pen, else the output's own from its render dict
        // (the registry's per-output default, a macro's style over it),
        // else solid -- the same order as the colour above.
        lineStyle: lineStyleOf(card?.style?.pen ?? line.render.pen),
        // The registry's render hints: `dots` draws markers and no line
        // (SAR), `sessioned` draws steps (pivots hold a level across a
        // session).
        ...(entry?.render === "dots" ? { pointMarkersVisible: true, lineVisible: false } : {}),
        ...(entry?.sessioned ? { lineType: LineType.WithSteps } : {}),
      };
    };
    for (const pane of panes) {
      let firstLine: ISeriesApi<PlotSeriesType> | null = null;
      for (const line of pane.series) {
        const hit = matchSeries(line, studiesOn.get(pane.ticker) ?? [], source, wireResolver);
        const card = hit === undefined ? undefined : seriesByExpr.get(hit.expr);
        if (card === undefined && pane.ticker !== symbol) continue; // another ticker's unclaimed line: never on list:1's fallback (plan R4)
        // ponytail: a series no card series claims -- a backend too old to
        // send `req`, or a frame that lands between an edit and the socket
        // reconnecting -- is drawn on panel 1's right scale in the server's
        // own colour, which is where every study lived before panels
        // existed. Upgrade path: drop it, once no supported backend omits
        // `req`.
        const api = apis[(card?.panel ?? 1) - 1] ?? apis[0];
        if (api === undefined) continue;
        // An output this study does not draw (spec 2026-09-27): skipped
        // BEFORE `draw`, so its key never joins `wanted` and the sweep at the
        // end of this pass removes the line if it had one. Hiding a band's
        // edge also un-shades it for free -- the fill pass below refuses a
        // half band, so a missing `_up` leaves nothing to fill against.
        if (!outputShown(line.column, card?.style?.outputs, line.render)) continue;
        const side = card?.side ?? "right";
        // The side is part of the identity here too (finding 3): a study
        // moved to the other scale is a new series, not a re-optioned one.
        const lineKey = `${card?.id ?? "unclaimed"}|${line.column}`;
        const drawnLine = draw(lineKey, api, `study|${side}`, LineSeries, {
          ...lookOf(line, card), ...onScale(side), ...annotation(),
          // A null is missing, not zero: dropping the point leaves a gap,
          // which is what a warmup period or a nulled 0/0 actually looks
          // like.
        }, line.data
          .filter((point) => point.value !== null && inWindow(point.time))
          .map((point) => ({ time: point.time, value: point.value as number })));
        // One label per OUTPUT line, in that line's own colour -- which is
        // what "1 per series" meant. `lookOf` decides the colour, so the
        // label and the line it belongs to cannot disagree about it.
        label(lineKey, drawnLine, lookOf(line, card).color, card?.style?.axisValue !== false);
        if (firstLine === null) firstLine = drawnLine;
      }
      // The pane's guides (studies addendum §6), as dashed price lines on
      // its first drawn line, replaced on every run: the previous run's come
      // off first -- while their series is still on a chart; one the removal
      // pass below took away last run took its price lines with it -- and a
      // pane with no series left simply draws none. The overlay list ("price")
      // is not a pane and has no guides.
      // ponytail: torn down and redrawn on every delta frame rather than
      // diffed; two lines per pane. Upgrade path: keep them while the pane's
      // first series and guide list are unchanged.
      if (pane.id === "price") continue;
      const previous = guideLines.current.get(pane.id);
      if (previous !== undefined && [...drawn.current.values()].some((held) => held.api === previous.series)) {
        for (const guide of previous.lines) previous.series.removePriceLine(guide);
      }
      guideLines.current.delete(pane.id);
      if (firstLine === null) continue;
      const on = firstLine;
      guideLines.current.set(pane.id, {
        series: on,
        lines: pane.guides.map((price) => on.createPriceLine({
          price,
          color: t.drawings.level,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          // A guide is a reference, not a reading: no label on the axis.
          axisLabelVisible: false,
        })),
      });
    }

    // The band shades (v12.3.1): a translucent fill between a banded
    // study's `*_up` and `*_lo` outputs. The REGISTRY says which studies
    // band, the INSTANCE says whether it is shaded and in what colour --
    // neither fact is named here. Keyed by `expr`, the instance's identity,
    // so two BBANDS in different colours each get their own fill.
    const shaded = new Set<string>();
    for (const pane of panes) {
      const bands = new Map<string, {
        up?: ISeriesApi<PlotSeriesType>; lo?: ISeriesApi<PlotSeriesType>; panel: number; shade: string; opacity: number;
        pattern: FillPattern;
      }>();
      for (const line of pane.series) {
        const hit = matchSeries(line, studiesOn.get(pane.ticker) ?? [], source, wireResolver);
        const card = hit === undefined ? undefined : seriesByExpr.get(hit.expr);
        const entry = hit === undefined ? undefined : registry.lookup(hit.name);
        // The instance's shade, else the registry's default for the study
        // (custom studies declare one); a study with neither is not shaded.
        const shade = card?.style?.shade ?? entry?.shade ?? undefined;
        if (hit === undefined || card === undefined || entry === undefined || shade === undefined) continue;
        if (entry.band !== true) continue;
        // The output's own name, before the params the server suffixes onto
        // the column (`bb_up|period=20,k=2`): a band's two sides are the
        // `_up` and `_lo` outputs the registry's `colors` keys name. Any
        // other output of the same study -- bbands' `bb_mid` -- is not an
        // edge of the band and takes no part in the fill.
        const output = line.column.split("|")[0];
        const side = output.endsWith("_up") ? "up" : output.endsWith("_lo") ? "lo" : null;
        if (side === null) continue;
        const band = bands.get(hit.expr) ?? {
          panel: card.panel, shade,
          opacity: card.style?.fillOpacity ?? entry.fill_opacity ?? DEFAULT_SHADE_OPACITY,
          pattern: isFillPattern(card.style?.fillPattern) ? card.style.fillPattern
            : isFillPattern(entry.fill_pattern) ? entry.fill_pattern : "solid",
        };
        band[side] = drawn.current.get(`${card.id}|${line.column}`)?.api;
        bands.set(hit.expr, band);
      }
      for (const [expr, band] of bands) {
        // Half a band is no band: a study whose second line has not arrived
        // (or was just removed) is left unshaded rather than filled against
        // itself.
        if (band.up === undefined || band.lo === undefined) continue;
        const api = apis[band.panel - 1];
        if (api === undefined) continue;
        shaded.add(expr);
        const existing = bandFills.current.get(expr);
        // The primitive is bound to its chart and to those two series
        // handles: a study that moved panel, or whose lines were replaced,
        // needs a new fill rather than a recolour. Otherwise the colour is
        // re-applied rather than diffed, like the per-series look above.
        if (existing !== undefined && existing.panel === band.panel && existing.up === band.up && existing.lo === band.lo) {
          existing.fill.setColor(band.shade, band.opacity, band.pattern);
          continue;
        }
        existing?.fill.detach();
        bandFills.current.set(expr, {
          // Pane 0: one chart per panel, and a chart has exactly one pane.
          fill: attachBandFill(api.chart, 0, band.up, band.lo, band.shade, band.opacity, band.pattern),
          panel: band.panel, up: band.up, lo: band.lo,
        });
      }
    }
    // A study removed, unshaded, or no longer banded takes its fill with it.
    for (const [expr, held] of bandFills.current) {
      if (shaded.has(expr)) continue;
      held.fill.detach();
      bandFills.current.delete(expr);
    }

    // Whatever this pass did not want is off the card: a study the socket
    // stopped answering for, or one whose card series was deleted. The bars
    // pass owns every other key and sweeps its own.
    for (const [key, held] of drawn.current) {
      if (!held.kind.startsWith("study") || wanted.has(key)) continue;
      labels.current.delete(key);
      held.chart.removeSeries(held.api);
      drawn.current.delete(key);
    }
    // A pane that left the feed took its first series (and its guides) with
    // it above; drop the handle so the next run does not remove lines off a
    // series that is gone.
    for (const [paneId] of guideLines.current) {
      if (!panes.some((pane) => pane.id === paneId)) guideLines.current.delete(paneId);
    }

    syncCrosshairSeries();
    settlePanels();
    // `chartEpoch` first, as every chart effect in this file: a rebuild
    // empties `drawn` and this rerun is what refills the new charts.
    // `registry.status` stands in for `registry.lookup`, which is a fresh
    // closure over the cached catalog on every render (see the studies
    // memo); `source` is derived from `params`, whose change rebuilds the
    // socket URL and so `panes`. NOT `candles`: that is the whole point of
    // the split (finding 4).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chartEpoch, panes, studies, studiesOn, symbol, seriesByExpr, t, registry.status, source, wireResolver,
    place, syncCrosshairSeries, settlePanels,
  ]);

  // Fit ONCE per set of charts, on the first bars they are given. Re-fitting
  // on every push yanks the view out from under whatever the user just did
  // with it, but a freshly (re)built chart has no view worth preserving.
  // A seed also hands every panel's scales back to autoscale, for the symbol
  // change above; on fresh charts they are on it already.
  /** One re-zoom owed to the view after a range change; see the effect below the zoom. */
  const rezoomOwed = useRef(false);
  /** The fetch start of the previous commit, for the range effect below. */
  const askedStart = useRef(start);
  // Every zoom to a range goes through here (the seed, a range change, the owed
  // re-zoom). A CHIP shows whole days of what it loaded -- see wholeDayFrom --
  // while a Custom range is taken at its word: `2026-09-18T10:00..11:00` means
  // that hour, not that day. Read off `live`, so the three effects' dependency
  // lists stay what they were.
  const zoomTo = (chart: IChartApi, resolved: { from: number; to: number }) => {
    const chip = presetFor(live.current.state.range);
    const base = chip === null || chip === "Custom" ? resolved.from
      : wholeDayFrom(resolved.from, live.current.candles.map((c) => c.time), live.current.calendar?.timezone);
    // A range clipped to the bar budget starts its zoom at the first bar fetched.
    const bars = live.current.candles;
    const first = live.current.clippedTo === undefined ? undefined : bars[0]?.time;
    // A range wholly before the first fetched bar has nothing of its own to show:
    // fit the fetched bars rather than collapse the view to one slot (reviewer).
    const [from, to] = first === undefined ? [base, resolved.to]
      : resolved.to < first ? [first, bars[bars.length - 1].time] : [Math.max(base, first), resolved.to];
    chart.timeScale().setVisibleRange({ from: from as never, to: to as never });
  };
  useEffect(() => {
    const apis = panels.current;
    // A chart that has been EMPTIED has no view worth preserving either (an EODHD window
    // that came back with no bars): the next bars to arrive seed it afresh -- the saved
    // range, else the fit -- instead of landing at whatever spacing the old view left.
    if (candles.length === 0) { seeded.current = false; return; }
    if (apis.length === 0 || seeded.current) return;
    seeded.current = true;
    // The seed below IS the zoom to the saved range, so any re-zoom owed is paid by it.
    rezoomOwed.current = false;
    // The card's saved range wins over the fit, re-resolved here rather
    // than stored as instants: "now-5d" means five days before THIS open,
    // which is the whole point of keeping the expression (spec §4.3). An
    // unresolvable or absent range falls back to the fit. Panel 1 alone:
    // the host mirrors the time scale onto every other panel.
    const saved = live.current.state.range;
    const resolved = saved === undefined ? null : resolveRange(saved, new Date(), live.current.calendar, live.current.anchorWindow);
    const first = apis[0];
    if (first !== undefined) {
      if (resolved === null) first.chart.timeScale().fitContent();
      else zoomTo(first.chart, resolved);
    }
    for (const api of apis) {
      api.chart.priceScale("right").setAutoScale(true);
      api.chart.priceScale("left").setAutoScale(true);
      api.applyWindow();
    }
    // The seed just handed every scale back to autoscale, which is also how
    // a link is released: re-impose them, or a linked panel would stay free
    // until the next scroll.
    apis[0]?.applyLinks();
  }, [candles, chartEpoch]);

  // The card's range IS the view (spec §4.3): whoever writes it -- a chip,
  // the Custom… popover, a `range` pasted into the spec popover -- writes
  // only the card, and the zoom happens here. The chip and the popover used
  // to zoom inline, which is why the spec's own range patched the card and
  // moved nothing.
  //
  // Only after the seed: until the first bars arrive the seed above owns the
  // view, and its own range-or-fitContent branch handles the first one. A
  // card with no range is left alone -- that is the fit the seed already
  // did, not a window to zoom to.
  //
  // A consequence, deliberately: a second window editing the same card moves
  // this one's view too. Both read the same saved range, and a range that
  // did not follow the card would not be saved state at all.
  useEffect(() => {
    if (!seeded.current || state.range === undefined) return;
    // The window is read off the ref, not listed as a dependency: an `S..E`
    // range resolves against whatever the card's window is when the range
    // (or the charts) change, and a window that slid with the last bar must
    // not re-zoom the view out from under a user who has panned.
    // The view is owed ONE more zoom when the loaded bars do not yet cover the
    // range -- an empty chart, or a range reaching back before the first bar,
    // whose older bars are still to arrive (below). A range the bars already
    // cover owes nothing: it is a zoom, and a later arrival must not yank a
    // view the user has since panned.
    const loaded = live.current.candles;
    const resolved = resolveRange(state.range, new Date(), calendar, live.current.anchorWindow);
    // Older bars arrive only when the fetch START moved: a range change that
    // keeps the same (clipped) window brings none, and the debt would wait to
    // yank a view the user has since panned -- unless one is already owed for a
    // fetch still in flight, which this change does not pay.
    rezoomOwed.current = loaded.length === 0 || (resolved !== null && resolved.from < loaded[0].time && (start !== askedStart.current || rezoomOwed.current));
    // NEVER an empty chart: the library throws ("Value is null") when asked to zoom a
    // series that holds no bars, and that took the whole card down to its error
    // boundary (2026-09-21) -- a range whose window came back empty did exactly that.
    if (loaded.length === 0) return;
    const first = panels.current[0];
    if (resolved === null || first === undefined) return;
    zoomTo(first.chart, resolved);
    // `regular` joins the list, not `state.session` (owner, 2026-09-27:
    // "changing from extended to regular did not redraw the scale, it looks
    // like it left the same number of observations and just drew from right to
    // left"). A session flip changes the BAR SET -- `sessionBars` drops the
    // pre- and post-market bars, roughly 16 hours a day down to 6.5 -- while
    // leaving `state.range` untouched, so this effect never re-ran and nothing
    // re-imposed the view. The library keeps its visible LOGICAL range across a
    // setData, anchored to the right, so the same ~1950 bar slots stayed on
    // screen with only ~800 bars to fill them and the surplus opened up as
    // blank space down the left. Exactly the trap PanelHost's resize effect
    // carries a range across, in the other direction: there the view must be
    // KEPT, here it must be re-imposed.
    //
    // `regular`, because that is the flag the filter actually reads (it is
    // false without an intraday interval or an exchange, and for 24hr): a
    // session change that does not change the bars must not yank the view.
  }, [state.range, regular, chartEpoch, calendar]);

  // After the range effect above in every commit, so it reads the PREVIOUS commit's start.
  useEffect(() => { askedStart.current = start; });

  // "changing from 5 day to 1 month does not force a redraw" (2026-09-21). The zoom
  // above runs the instant the range changes -- against whatever bars are loaded, where
  // the library clamps it -- and deliberately does not list `candles`. But a range
  // reaching back past the default window moves the fetch START earlier (barsWindow;
  // never the end), and when those bars landed nothing re-applied the zoom: five days stayed on screen. So a range
  // change leaves exactly ONE re-zoom owed, paid on the next bars to arrive, whatever
  // they are. One, not "until the range is covered": a range older than the data would
  // never be covered, and every live push would then yank a view the user had panned.
  // "Bars" means bars: an EMPTY arrival is not one -- the debt stays until there is
  // something to zoom to, because zooming an empty chart throws (see above).
  useEffect(() => {
    if (!rezoomOwed.current || !seeded.current || candles.length === 0) return;
    rezoomOwed.current = false;
    const range = live.current.state.range;
    const first = panels.current[0];
    if (range === undefined || first === undefined) return;
    const resolved = resolveRange(range, new Date(), live.current.calendar, live.current.anchorWindow);
    if (resolved !== null) zoomTo(first.chart, resolved);
  }, [candles]);

  /* The mark is no longer a pane primitive (owner, 2026-09-27: "can the
     watermark be centered in the overall chart instead of just the first
     panel"). `createImageWatermark` attaches to a PANE, and since v12.4.0
     every panel is its own chart with one pane, so it could only ever centre
     on panel 1. PanelHost renders it as an element behind all the panels
     instead (`watermarkStyle`), which needs no attach/detach and no theme
     re-read -- it is rendered from `mode` and `theme` like anything else --
     so the effect that used to re-attach it on a palette flip is gone with
     it. The PNG export draws the same image itself (`composePanels`). */

  // The anchor tool persists an anchor and the tick cache fetches and
  // maintains its VWAP series, but until this effect existed nothing ever
  // read `avwaps`: three anchors on a card, 869 points apiece out of kdb, and
  // no line on screen. Shaped like the series pass above -- same ref map,
  // same add/reuse/remove pass -- because it has the same job. An AVWAP is
  // a price on the card's own symbol, so it draws on PANEL 1's right scale
  // beside the candles, like the drawings and the levels.
  useEffect(() => {
    const panel = panels.current[0];
    if (panel === undefined) return;
    const created = panel.chart;
    const wanted = new Set<string>();
    for (const { anchor, points } of avwaps) {
      // No points is a real answer, not a loading state: an anchor in the
      // future, or one kdb could not parse. setData([]) on a fresh series
      // draws nothing, but adding it would still put an empty line (and its
      // handle) on the chart, so skip the anchor entirely -- and if it HAD a
      // series, leaving it out of `wanted` takes it away below.
      if (points.length === 0) continue;
      wanted.add(anchor);
      let line = avwapLines.current.get(anchor);
      if (line === undefined) {
        line = created.addSeries(LineSeries, {
          // An AVWAP is a price, so it takes the adapter's text colour (the
          // registry's own avwap colour used to be named here, before the
          // adapter became the only place a colour is named). That registry
          // colour was chosen so the chart's AVWAP line and the live grid's
          // avwap column read as the same quantity at a glance. The token
          // move trades that away: the line now takes `--text`, the grid's
          // column keeps the registry colour, and the two no longer match
          // by colour.
          color: t.drawings.avwap,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          // On the scale, and autoscaling with it, unlike the drawings and
          // the drag preview below: an AVWAP is a price and belongs inside
          // the candles' range, which is also the range a `ymin=P1` link
          // borrows.
          priceScaleId: "right",
        });
        avwapLines.current.set(anchor, line);
      }
      // setData for the whole series on every rebuild, not update() of the
      // last point: the hook republishes `avwaps` per trade batch (~4Hz) and
      // a series is about one point per bar interval, so this is cheap. If it
      // ever stutters, updating only the last point is the upgrade.
      line.setData(points.map((point) => ({ time: point.time as never, value: point.value })));
    }
    // An anchor the user discarded (the card's Discard button, or clear) is
    // gone from `avwaps` and its line has to go with it. `created` is the
    // chart read at the top of this body, so removeSeries can never land on
    // a chart a rebuild already destroyed -- which throws.
    for (const [anchor, line] of avwapLines.current) {
      if (wanted.has(anchor)) continue;
      created.removeSeries(line);
      avwapLines.current.delete(anchor);
    }
    // An AVWAP is on panel 1's right scale, so it moves what a `ymin=P1`
    // link borrows -- same reason the series pass above ends this way.
    panel.applyLinks();
    // `chartEpoch` too, not just `avwaps`: a rebuild replaces the charts
    // without touching that array's identity, and onPanelsDispose just
    // emptied this map -- this rerun is what redraws every anchor onto the
    // new chart. Same failure mode the series pass above guards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avwaps, chartEpoch]);

  /**
   * Panel 1's own div inside the host, which every pointer gesture below
   * measures AGAINST: they map screen pixels to chart units, and `node` --
   * where the listeners themselves sit, so a press anywhere in the card
   * body reaches them by bubbling -- spans every panel. PanelHost stamps
   * `data-panel` on each panel div; the attribute is part of its contract.
   * Falling back to the host's root keeps the arithmetic defined before the
   * panels have rendered (and under jsdom, where every rect is 0x0).
   */
  const plotRect = (): HTMLElement | null =>
    (node.current?.querySelector('[data-panel="1"]') as HTMLElement | null) ?? node.current;

  useEffect(() => {
    const panel = panels.current[0];
    const price = priceSeries.current;
    if (panel === undefined || price === null) return;
    const created = panel.chart;
    const handler = (param: { time?: unknown; point?: { x: number; y: number } }) => {
      // Any click dismisses a standing measure label (spec §7.2), before
      // every guard below: a click the chart cannot measure is still a
      // click, and leaving the label up would make it look stuck.
      if (live.current.measure !== null) setMeasure(null);
      // A click outside the plot carries no time. There is nothing to record.
      if (param.time === undefined || param.point === undefined) return;
      // The pane guard v12.3.x needed here is gone with the panes: this
      // handler is subscribed to PANEL 1's chart alone, so a click on the
      // volume or a study panel reaches that panel's chart and not this one.
      const time = Number(param.time);
      const value = price.coordinateToPrice(param.point.y);
      const {
        tool: active, state: current, onPatch: patch, drawingEdge: edge,
        intervalSeconds: liveIntervalSeconds,
      } = live.current;
      // Magnet (spec §7.2) applies to the one-click tools too: the anchor
      // takes the snapped bar's time, the level the snapped OHLC price.
      const snapped = (point: ChartPoint): ChartPoint =>
        live.current.magnet ? snapToBar(live.current.candles, point, liveIntervalSeconds) : point;
      if (value === null) {
        // An unmeasurable click can't be hit-tested against, but while
        // "panning" is armed it must not leave a PRIOR selection standing --
        // same reasoning as the unmeasurable-view guard inside the "panning"
        // branch below. A Delete right after would otherwise remove a
        // drawing this click had nothing to do with.
        if (active === "panning") setSelected(null);
        return;
      }
      if (active === "panning") {
        const element = plotRect();
        const range = created.timeScale().getVisibleRange();
        // Panel 1's own plot height, not the card body's: the panels below
        // it are other charts entirely, and a bottom measured against the
        // whole body maps to a price no candle ever had.
        const paneHeight = created.paneSize(0).height;
        const top = price.coordinateToPrice(0);
        const bottom = element === null ? null : price.coordinateToPrice(paneHeight);
        // An unmeasurable view can't be hit-tested against, but it must not
        // leave a PRIOR selection standing either -- a Delete right after
        // would remove a drawing unrelated to this click. Clearing here is
        // what makes "selects nothing" true rather than "selects nothing
        // new, but keeps whatever was already selected."
        if (element === null || range === null || top === null || bottom === null) {
          setSelected(null);
          return;
        }
        // Chart units per screen pixel, so the test measures how far the
        // click looks, not how far it is in price -- a flat line on a narrow
        // price range would otherwise never be reachable.
        const scale = {
          price: (Number(top) - Number(bottom)) / paneHeight,
          time: (Number(range.to) - Number(range.from)) / element.clientWidth,
        };
        const drawings = current.drawings ?? [];
        let nearest: number | null = null;
        let best = Number.POSITIVE_INFINITY;
        drawings.forEach((drawing, index) => {
          const distance = distanceTo(drawing, { time, value }, edge, scale);
          if (distance < best) { best = distance; nearest = index; }
        });
        setSelected(best <= HIT_PIXELS ? nearest : null);
        return;
      }
      if (active === "anchor") {
        const anchor = new Date(snapped({ time, value }).time * 1000).toISOString();
        // A second tap on a bar already anchored is ignored: an identical
        // anchor draws the same line on top of itself, and would only add a
        // no-op entry to undo's stack.
        if ((current.anchors ?? []).includes(anchor)) return;
        // The figure and its entry on undo's stack go in ONE patch, so the
        // two can never disagree about what is on the card.
        patch({
          anchors: [...(current.anchors ?? []), anchor],
          added: pushAdded(current.added, { facet: "anchors", item: anchor }),
          // A new figure empties redo, as on every platform: the branch the
          // user undid is no longer the one they are on.
          redo: [],
        });
        return;
      }
      if (active === "level") {
        // A level IS a price, so it gets one exact click and the platform's
        // own price-line primitive: full width, axis label.
        const level: ChartLevel = { price: snapped({ time, value }).value };
        patch({
          levels: [...(current.levels ?? []), level],
          added: pushAdded(current.added, { facet: "levels", item: level }),
          redo: [],
        });
        return;
      }
      if (active === "gann") {
        // A relative low fans up, a relative high fans down: judged against
        // the surrounding bars' range, not against the click alone.
        const window = price.data().filter(
          (bar) => Math.abs(Number(bar.time) - time) <= 5 * liveIntervalSeconds,
        ) as { high?: number; low?: number; value?: number }[];
        // A line/area/performance price series carries `value`, not high/low.
        const high = window.length > 0 ? Math.max(...window.map((b) => b.high ?? b.value ?? value)) : value;
        const low = window.length > 0 ? Math.min(...window.map((b) => b.low ?? b.value ?? value)) : value;
        const sign: 1 | -1 = value - low <= high - value ? 1 : -1;
        // Degrees are measured on screen HERE, then recorded as slopes.
        const element = plotRect();
        const range = created.timeScale().getVisibleRange();
        // Panel 1's own plot height, for the same reason as the hit-test
        // above: the fan is drawn on the candles, so its degrees are
        // measured on the panel they are in, not on the whole card body.
        const paneHeight = created.paneSize(0).height;
        const top = price.coordinateToPrice(0);
        const bottom = element === null ? null : price.coordinateToPrice(paneHeight);
        if (element === null || range === null || top === null || bottom === null) return;
        const perPixel = {
          price: (Number(top) - Number(bottom)) / paneHeight,
          time: (Number(range.to) - Number(range.from)) / element.clientWidth,
        };
        const slopes = gannSlopes(sign, perPixel.price, perPixel.time);
        // A detached or not-yet-laid-out container reports 0 for
        // clientWidth/clientHeight, which turns the divisions above into NaN
        // or Infinity. Recording that would persist a fan that can never
        // render, so an unmeasurable view is treated the same as the null
        // checks above: the click is dropped.
        // The two ratios are checked as well as the slopes they produce:
        // gannSlopes divides one by the other, and a zero-width container
        // (price 0, time Infinity) makes that quotient a perfectly finite 0
        // -- a flat fan that is an unmeasured view, not a measurement.
        if (!Number.isFinite(perPixel.price) || !Number.isFinite(perPixel.time)) return;
        if (slopes.some((slope) => !Number.isFinite(slope))) return;
        const fan: ChartDrawing = { kind: "gann", a: { time, value }, slopes };
        patch({
          drawings: [...(current.drawings ?? []), fan],
          added: pushAdded(current.added, { facet: "drawings", item: fan }),
          redo: [],
        });
        return;
      }
      // segment/ray/fib are press-drag-release now (the pointer effect
      // below), so a plain click on the plot under one of them records
      // nothing. This handler still serves panning-select, anchor, level and
      // gann, which are all genuinely one-click tools.
    };
    created.subscribeClick(handler);
    return () => created.unsubscribeClick(handler);
    // `chartEpoch`/`priceEpoch`, not `onPatch`: `onPatch` is read from the `live` ref
    // above, not closed over, specifically so this effect does not need to
    // depend on it. WidgetCard currently passes a fresh `onPatch` closure on
    // every render, which would otherwise make this resubscribe on every
    // render too (harmless today, but pinned by nothing). The real
    // correctness requirement is the one every chart/series effect in this
    // file shares: a theme flip tears the chart down and creates a new one,
    // and only `chartEpoch` marks that -- an effect keyed on anything else
    // would stay subscribed to the destroyed chart and go silently dead.
    // `priceEpoch` beside it: the y of every click is read through panel 1's
    // price series, which the user can swap for a line or an OHLC bar
    // without rebuilding a single chart.
  }, [chartEpoch, priceEpoch]);

  // Time labels for the interval showing: the viewer's clock on an
  // intraday axis, UTC dates on a daily one (see chartTimeLabels). Declared
  // BEFORE the pan gate below, so on a fresh chart the gate's applyOptions is
  // still the last one made. `chartEpoch` because a rebuild makes new charts
  // with the library's defaults, which label in UTC with no time. EVERY
  // panel: they share one axis, and only the panels whose `xmargin` shows it
  // draw it, but the crosshair's own time label is on all of them.
  useEffect(() => {
    const labels = chartTimeLabels(intervalSeconds);
    for (const api of panels.current) api.chart.applyOptions({
      timeScale: {
        timeVisible: labels.timeVisible,
        secondsVisible: labels.secondsVisible,
        tickMarkFormatter: labels.tickMarkFormatter,
        // A short mark from the axis to each label, so a label reads as
        // pointing at a place on the axis rather than floating under it.
        ticksVisible: true,
      },
      // The same marks on the price axis.
      rightPriceScale: { ticksVisible: true },
      localization: { timeFormatter: labels.timeFormatter },
    });
  }, [intervalSeconds, chartEpoch]);

  // The library's default crosshair is Magnet: its horizontal line, and the
  // price label it puts on the y axis, snap to the hovered bar's close. Under
  // the level tool that label read as the price a click would place, when
  // the click places the price under the pointer (coordinateToPrice in the
  // click handler), so the line follows the pointer there. Segment and ray
  // too: their press and release are pointer prices the same way (the drag
  // path's coordinateToPrice). Declared BEFORE the pan gate for the same
  // reason as the time labels above.
  useEffect(() => {
    const free = tool === "level" || tool === "segment" || tool === "ray";
    for (const api of panels.current) {
      api.chart.applyOptions({ crosshair: { mode: free ? CrosshairMode.Normal : CrosshairMode.Magnet } });
    }
  }, [tool, chartEpoch]);

  // Pan and scale belong to "panning" alone. Under a drawing tool the drag IS
  // the drawing gesture, and a time scale that moved under it would pull the
  // chart out from beneath the line being drawn -- the press point is
  // recorded in chart units, so the committed drawing would land somewhere
  // the user never pressed. `chartEpoch` for the reason every chart effect in
  // this file carries it, and here with teeth: a rebuild makes NEW charts
  // with the library's DEFAULTS, which have both handles on. Every panel,
  // not just panel 1: the panels share a time scale, so a scroll on the
  // volume panel would drag the price panel's view with it.
  useEffect(() => {
    for (const api of panels.current) api.chart.applyOptions({
      handleScroll: tool === "panning",
      handleScale: tool === "panning",
    });
  }, [tool, chartEpoch]);

  // Modifier drags on panel 1's price axis. lightweight-charts has one axis
  // gesture -- a plain drag SCALES the price about the press -- and no
  // modifier of its own, but it does expose each scale's visible range:
  //   shift-drag   PANS the price scale: same spacing, moved up or down.
  // The library starts its scale from a `mousedown` listener on the axis
  // canvas. A capture-phase listener on the panel runs before that and stops
  // the event there, so a modifier press never reaches it. NOT by toggling
  // handleScale.axisPressedMouseMove off at the press and on at the release:
  // that shipped first, and in the packaged app's WKWebView a release could
  // go missing, leaving the gate off -- and every plain drag after it dead.
  // Nothing here is toggled, so nothing can be left the wrong way round.
  // Under "panning" only, like the library's own axis drag (the gate above).
  // The axis is the rightmost `width()` pixels of the panel; below it is the
  // time axis, which this must not claim.
  //
  // v12.4.0 drops the alt-drag: it scaled the VOLUME PANE's scale from the
  // price pane's axis, because the volume overlay had no axis of its own to
  // drag. The volume is a series in a panel of its own now, with its own
  // chart and its own axis, so the library's plain drag scales it there --
  // and an alt-drag on panel 1 would be scaling whatever happens to be in
  // panel 2, which is no longer the volume by definition. Panel 1 alone is
  // special-cased here for the same reason: every other panel's axis is a
  // real axis the library already drags.
  useEffect(() => {
    const panel = panels.current[0];
    const price = priceSeries.current;
    // The listeners sit on the host's root, so a press on panel 1 reaches
    // them by bubbling; the geometry is panel 1's own.
    const element = node.current;
    const plot = plotRect();
    if (panel === undefined || price === null || element === null || plot === null) return;
    const created = panel.chart;
    // Shift alone (v12.4.0): alt used to claim the press for the volume
    // overlay's scale, which no longer exists as an overlay -- an alt-drag
    // now reaches the library untouched, like any other unclaimed press.
    const claimed = (event: MouseEvent) => event.shiftKey && live.current.tool === "panning";
    // The pointer's pane-relative y, or null when it is not on the axis.
    const onAxis = (point: { clientX: number; clientY: number }): number | null => {
      const rect = plot.getBoundingClientRect();
      const y = point.clientY - rect.top;
      // The axis the PRICE series is on (T6 review, finding 5), which the
      // spec's own acceptance 2 puts on the left; a left scale's pixels are
      // at the other edge of the panel.
      const axis = created.priceScale(priceSide.current).width();
      const on = (priceSide.current === "left"
        ? point.clientX - rect.left <= axis
        : point.clientX - rect.left >= rect.width - axis)
        && y < created.paneSize(0).height;
      return on ? y : null;
    };
    // The price under the press stays under the pointer: shift whatever
    // range is showing by however far that price has strayed from the
    // pointer. Read off the candle series' own pixel mapping, not
    // span/height -- the range spans the pane LESS its scale margins, so a
    // span/height pan trails the pointer by the margin fraction.
    const panTo = (pressed: number, y: number) => {
      // The scale the pressed price was READ off (finding 5): panning the
      // right scale by a price taken through a left-scale series moves a
      // range the pointer was never over.
      const scale = created.priceScale(priceSide.current);
      const showing = scale.getVisibleRange();
      const under = price.coordinateToPrice(y);
      if (showing === null || under === null) return;
      const delta = pressed - under;
      scale.setVisibleRange({ from: showing.from + delta, to: showing.to + delta });
    };
    const claim = (event: MouseEvent) => {
      if (claimed(event) && onAxis(event) !== null) event.stopPropagation();
    };
    let drag: ((y: number) => void) | null = null;
    const down = (event: PointerEvent) => {
      drag = null;
      if (!claimed(event)) return;
      const y0 = onAxis(event);
      if (y0 === null) return;
      const pressed = price.coordinateToPrice(y0);
      if (pressed === null) return;
      drag = (y) => panTo(pressed, y);
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (drag === null) return;
      // A release that never arrived must not turn every later hover into
      // a pan: no button down, no drag.
      if ((event.buttons & 1) === 0) { drag = null; return; }
      drag(event.clientY - plot.getBoundingClientRect().top);
    };
    const up = () => { drag = null; };
    // iPad: the same two gestures with no modifier keys to hang them on.
    // One finger on the axis PANS it (the library's own one-finger axis
    // drag would scale, the gesture a mouse gets from a plain drag); two
    // fingers on the axis pinch or spread to SCALE it about the range's
    // centre, at the library's own clamp. Touch events, not pointer events:
    // two fingers are one gesture here, not two pointers. The library takes
    // its axis touch from a touchstart on the axis canvas, stopped here the
    // way a modifier mousedown is. touchmove is prevented so the page does
    // not scroll under the finger -- the library's own preventDefault sits
    // in the listener this one keeps from ever being armed.
    let touch: { pan: number } | { spread: number; from: number; to: number } | null = null;
    const touchStart = (event: TouchEvent) => {
      const first = event.touches[0];
      if (first === undefined || live.current.tool !== "panning") return;
      const y0 = onAxis(first);
      if (y0 === null) return;
      event.stopPropagation();
      const second = event.touches[1];
      if (second !== undefined) {
        const visible = created.priceScale(priceSide.current).getVisibleRange();
        if (visible === null) return;
        touch = { spread: Math.max(Math.abs(second.clientY - first.clientY), 1), ...visible };
        return;
      }
      const pressed = price.coordinateToPrice(y0);
      touch = pressed === null ? null : { pan: pressed };
    };
    const touchMove = (event: TouchEvent) => {
      if (touch === null) return;
      event.preventDefault();
      const first = event.touches[0];
      const second = event.touches[1];
      if (first === undefined) return;
      if ("pan" in touch) { panTo(touch.pan, first.clientY - plot.getBoundingClientRect().top); return; }
      if (second === undefined) return;
      // Fingers apart, range in.
      const coeff = Math.max(touch.spread / Math.max(Math.abs(second.clientY - first.clientY), 1), 0.1);
      const centre = (touch.from + touch.to) / 2;
      const half = ((touch.to - touch.from) * coeff) / 2;
      created.priceScale(priceSide.current).setVisibleRange({ from: centre - half, to: centre + half });
    };
    const touchEnd = (event: TouchEvent) => { if (event.touches.length === 0) touch = null; };
    element.addEventListener("touchstart", touchStart, true);
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd);
    element.addEventListener("touchcancel", touchEnd);
    element.addEventListener("mousedown", claim, true);
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("touchstart", touchStart, true);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd);
      element.removeEventListener("touchcancel", touchEnd);
      element.removeEventListener("mousedown", claim, true);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [chartEpoch, priceEpoch]);

  /**
   * How many decimals the price scale currently needs (spec §6, adaptive).
   * Read off the live chart through a ref, so it is keyed on nothing and an
   * effect can list it without resubscribing whenever the view moves. Shared
   * by the legend and the measure label, which must never disagree about how
   * precisely this symbol is quoted.
   */
  const decimalsNow = useCallback((): number => {
    // Panel 1's PRICE scale, whichever side that is (finding 5): on a card
    // whose price sits on the left, the right scale is a percent axis and
    // its span says nothing about how this symbol is quoted.
    const showing = panels.current[0]?.chart.priceScale(priceSide.current).getVisibleRange() ?? null;
    return priceDecimals(showing === null ? Number.NaN : showing.to - showing.from);
  }, []);

  // Pointer events, not mouse events: this app ships to iPad, where a drawing
  // gesture is a touch. Nothing here is newer than WebKit for iOS 16.2.
  useEffect(() => {
    const panel = panels.current[0];
    const price = priceSeries.current;
    // As the axis effect above: listeners on the host's root, geometry from
    // panel 1 -- a drag that starts in another panel is refused by the
    // pane-height guard in pointAt below.
    const element = node.current;
    const plot = plotRect();
    if (panel === undefined || price === null || element === null || plot === null) return;
    const created = panel.chart;

    // Screen pixels -> chart units. Either half returning null means the
    // pointer is off the loaded data or outside the pane, so there is no
    // point there to press on or release onto.
    //
    // Magnet (spec §7.2) lands HERE rather than at the release, so both ends
    // of a drag snap and the preview shows where the line will actually go
    // -- a preview that ignored the magnet would jump on release.
    const pointAt = (event: PointerEvent): ChartPoint | null => {
      const rect = plot.getBoundingClientRect();
      // Below panel 1's plot (its time axis, if it carries one) there is no
      // price to press on.
      if (event.clientY - rect.top > created.paneSize(0).height) return null;
      const time = created.timeScale().coordinateToTime(event.clientX - rect.left);
      const value = price.coordinateToPrice(event.clientY - rect.top);
      if (time === null || value === null) return null;
      const point = { time: Number(time), value: Number(value) };
      return live.current.magnet ? snapToBar(live.current.candles, point, live.current.intervalSeconds) : point;
    };

    // setData wants strictly ascending times, and a drag crosses its own
    // press bar all the time, so the pair is sorted here and a degenerate one
    // collapses to a single point rather than being handed over twice.
    const paint = (preview: ISeriesApi<"Line">, press: ChartPoint, at: ChartPoint) => {
      const points = press.time === at.time ? [press]
        : press.time < at.time ? [press, at] : [at, press];
      preview.setData(points.map((point) => ({ time: point.time as never, value: point.value })));
    };

    // Ends the drag whatever the outcome, and hands back what it was. The
    // "is this still the live chart" guard is the one the drawing cleanup
    // below uses, for the same reason: a rebuild that lands mid-drag has
    // already called remove() on this chart, and removeSeries after that
    // throws.
    const end = () => {
      const current = drag.current;
      drag.current = null;
      if (current !== null && panels.current[0]?.chart === created) created.removeSeries(current.preview);
      return current;
    };

    const down = (event: PointerEvent) => {
      if (!DRAG_TOOLS.has(live.current.tool)) return;
      const press = pointAt(event);
      // No usable press point, no drag: arming one anyway would commit a
      // NaN-timed drawing on release.
      if (press === null) return;
      // Without capture, a release past the chart's edge -- which is where a
      // drag out toward the live edge naturally ends -- never arrives, and
      // the preview would hang there with no way to finish or drop it.
      element.setPointerCapture(event.pointerId);
      const preview = created.addSeries(LineSeries, {
        // The preview is the adapter's accent at 60% opacity, which none of
        // the committed accent lines are, and it is the thinnest line on the
        // plot -- so an in-progress line can never be mistaken for something
        // already saved.
        color: live.current.t.drawings.preview,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        // The preview annotates the view, it must not drive it: without this
        // the candles rescale under every pointermove that leaves the current
        // price range.
        autoscaleInfoProvider: () => null,
      });
      paint(preview, press, press);
      drag.current = { press, preview };
    };

    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      const at = pointAt(event);
      // Dragged off the data: keep the last drawable preview rather than
      // blanking it, the same way the crosshair legend falls back instead of
      // going empty.
      if (at === null) return;
      paint(current.preview, current.press, at);
    };

    const up = (event: PointerEvent) => {
      const current = end();
      if (current === null) return;
      const release = pointAt(event);
      if (release === null) return;
      const { tool: active, state: card, onPatch: patch } = live.current;
      const first = current.press;
      // Measure records nothing (spec §7.2): the release leaves a floating
      // label reading Δprice, bars and duration, and the next click on the
      // plot dismisses it. Placed at the release, in plot-relative pixels.
      // Checked before the zero-width guard below: a drag that lands back in
      // its own bar still has a real Δprice to report (0 bars, not "nothing
      // happened"), unlike a drawing tool, which has no line without width.
      if (active === "measure") {
        const rect = plot.getBoundingClientRect();
        setMeasure({
          a: first, b: release,
          x: event.clientX - rect.left, y: event.clientY - rect.top,
          text: measureBetween(first, release, live.current.intervalSeconds, decimalsNow()).text,
        });
        return;
      }
      // Zero width: no line to record and no slope to derive. `end` above has
      // already taken the preview away, which is what makes this a VISIBLE
      // no-op -- the two-click path dropped the same case with nothing on
      // screen to show for it, and users read that as a broken tool.
      if (release.time === current.press.time) return;
      const { time, value } = release;
      const [a, b] = first.time < time ? [first, release] : [release, first];
      const drawing: ChartDrawing =
        active === "ray"
          // The release only ever fixes the RATE. The far end is always
          // a.value + slope * dt, ridden out to the latest bar.
          ? { kind: "ray", a, slope: slopeBetween(a, b) }
          : active === "fib"
            // Press order, not time order: 100% sits at the swing START, and
            // a retracement is routinely dragged backwards in time.
            ? { kind: "fib", a: first, b: { time, value } }
            : { kind: "segment", a, b };
      patch({
        drawings: [...(card.drawings ?? []), drawing],
        added: pushAdded(card.added, { facet: "drawings", item: drawing }),
        redo: [],
      });
    };

    const cancel = () => { end(); };

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      // A chartEpoch bump mid-drag leaves `drag.current` holding a series on a
      // chart that no longer exists. `end` drops the drag either way and
      // skips the removeSeries once this is not the live instance, so the
      // next pointerup finds nothing armed instead of committing against a
      // dead press.
      end();
    };
    // `chartEpoch`/`priceEpoch`, same discipline as the click and crosshair
    // effects above: these handlers close over ONE chart instance and one
    // price series, and a rebuild (or a price series swapped for another
    // type) replaces them. `tool`/`state`/`onPatch`/`magnet` are read
    // through `live.current` rather than the closure, so a tool switch never
    // has to tear the listeners down and re-add them. `decimalsNow` is
    // keyed on nothing (it reads refs), so listing it costs no resubscribe.
  }, [chartEpoch, priceEpoch, decimalsNow]);

  /**
   * The legend's reading for one bar: the bar, the decimals the visible
   * price range needs (spec §6, adaptive), and every study's value at that
   * bar's time in the study's colour. A study with no point at that time --
   * a warm-up gap -- reads as null, which the legend shows as a dash.
   *
   * Reads refs only, so it is keyed on nothing: the effects below can list
   * it without re-subscribing whenever a value it reads changes.
   */
  const legendValues = useCallback((bar: Candle | null): LegendValues => {
    const decimals = decimalsNow();
    // A series that matches an instance reads as the chip does -- the
    // expression, in the instance's colour -- so the legend and the strip
    // name one study one way; anything else keeps the server's label and
    // the same colour fallback the line itself takes.
    const {
      panes: livePanes, studiesOn: liveStudiesOn, symbol: liveSymbol, series: cardSeries, overlayLabels: liveLabels, t: liveTheme,
      source: liveSource, wireResolver: liveResolve,
    } = live.current;
    if (bar === null) return { bar, decimals, studies: [] };
    const byExpr = new Map(cardSeries.map((s) => [s.expr, s]));
    // Where each reading sits in the CARD's own order (the branch-end round,
    // finding 12): the socket's readings arrive in pane order and the
    // performance lines are appended after them, so a panel's rows came out
    // studies-first whatever order the card has its series in -- which the
    // spec says governs the legend as it governs the strip. A reading no
    // series claims sorts last in its panel.
    const order = new Map(cardSeries.map((s, i) => [s.id, i]));
    const rank = (s: Series | undefined): number => (s === undefined ? Number.MAX_SAFE_INTEGER : order.get(s.id) ?? Number.MAX_SAFE_INTEGER);
    const readings: (LegendStudy & { order: number })[] = livePanes.flatMap((pane) =>
      pane.series.flatMap((line) => {
        const hit = matchSeries(line, liveStudiesOn.get(pane.ticker) ?? [], liveSource, liveResolve);
        const card = hit === undefined ? undefined : byExpr.get(hit.expr);
        if (card === undefined && pane.ticker !== liveSymbol) return [];
        // Undrawn, unread: an output the study hides must not appear in the
        // crosshair readout either, or the legend names a line that is not on
        // the chart (spec 2026-09-27).
        if (!outputShown(line.column, card?.style?.outputs, line.render)) return [];
        return [{
          // The study INSTANCE this line belongs to (2026-09-26): every line
          // of one multi-output study (a band's three lines) matches the same
          // card series, so its id groups them under one label in the legend.
          // The expr, then the socket's own label, are the fallbacks for a
          // line no card series claims (a macro's expansion).
          key: card?.id ?? hit?.expr ?? line.label,
          label: card === undefined ? line.label : liveLabels[card.id] ?? seriesLabel(card),
          color: card !== undefined && card.color !== ""
            ? card.color
            : (line.render.color as string | undefined) ?? liveTheme.drawings.study,
          value: line.data.find((point) => point.time === bar.time)?.value ?? null,
          // The same fallback the line itself takes when nothing claims it.
          panel: card?.panel ?? 1,
          order: rank(card),
        }];
      }));
    // A performance line, and a bar series drawn off another ticker, read in the legend too
    // (spec, acceptance 2a: an NVDA card carrying SPX shows both) -- off the data last drawn for
    // it, not off the bars, since a performance reading IS the rebased percentage.
    for (const s of cardSeries) {
      if (s.type === "study") continue;
      const points = perf.current.get(s.id);
      if (points === undefined) continue;
      readings.push({
        // A performance line is one line, so its own id is its group.
        key: s.id,
        label: liveLabels[s.id] ?? seriesLabel(s),
        color: s.color === "" ? liveTheme.drawings.study : s.color,
        value: points.find((point) => point.time === bar.time)?.value ?? null,
        panel: s.panel,
        order: rank(s),
      });
    }
    // Panel order, then the card's own series order within a panel -- the
    // strip's reading order (spec, Series), which the legend shares.
    readings.sort((a, b) => a.panel - b.panel || a.order - b.order);
    return { bar, decimals, studies: readings };
  }, [decimalsNow]);

  /**
   * A macro read back as the card's own series and panels (user ruling
   * 2026-09-24, "macros should contain series and panels").
   *
   * A macro is a saved pane layout the SERVER expands, so its lines arrive
   * claiming nothing on this card: they drew on panel 1 in the server's own
   * colours and wore no chip -- "no studies pills when you apply a macro".
   * The first frame carrying its requests is converted, and the parameter is
   * cleared in the SAME patch: live-grid combines a macro with `indicators`
   * (`assign(macro, parse_indicators(...))`) rather than letting one win, so
   * a macro left set would serve every line a second time once the card has
   * a list of its own.
   *
   * Once per macro value: the socket keeps pushing frames while the writes
   * land, and converting twice would mint fresh ids for lines the card
   * already has. Clearing the parameter resets the guard, so picking the
   * same macro again converts again.
   */
  const convertedMacro = useRef<string | null>(null);
  const macro = params.macro ?? "";
  useEffect(() => {
    if (macro === "" || macro === "none") { convertedMacro.current = null; return; }
    if (convertedMacro.current === macro) return;
    const built = seriesFromMacro(mainPanes, panelsText, registry.lookup, live.current.t.drawings.study);
    // No request in the frame yet (a `series` frame can land before the
    // server has named what asked for it): wait for the next one rather
    // than blanking the card.
    if (built === null) return;
    convertedMacro.current = macro;
    live.current.onPatch({ series: built.series });
    live.current.onParam({ panels: built.panelsText, macro: "none" });
    // The callbacks come off `live` (the card hands down a fresh closure
    // every render), so this runs on the frames and the macro alone.
  }, [macro, mainPanes, panelsText, registry]);

  // The legend's default reading: the last loaded bar. Through the sink like
  // the crosshair's, so only the legend re-renders -- candle pushes are
  // nowhere near per-pixel frequency, but the path is the same one.
  useEffect(() => {
    legendSink.current?.(legendValues(candles.at(-1) ?? null));
    // `panes` too: a study arriving has to reach the resting legend, whose
    // values are read out of `live.current.panes` above. `studies` for the
    // same reason: a chip recoloured or relabelled in the editor has to
    // reach the resting legend before the crosshair next moves. `series`,
    // `extraBars` and `resolveWindowed` because they are what the bars pass
    // above refills `perf` from: an overlay whose bars land after the first
    // draw kept its "—" until something else re-rendered (hand check 2026-11-14).
  }, [candles, panes, studies, series, extraBars, resolveWindowed, legendValues]);

  useEffect(() => {
    const apis = panels.current;
    if (apis.length === 0) return;
    const handler = (param: { time?: unknown; point?: unknown }) => {
      const { candles: liveCandles } = live.current;
      // No point means the pointer left the plot; no time means it's over
      // the plot but off the loaded data. Either way, fall back to the last
      // bar rather than blank the legend.
      const bar = param.point === undefined || param.time === undefined
        ? (liveCandles.at(-1) ?? null)
        : (liveCandles.find((c) => c.time === Number(param.time)) ?? liveCandles.at(-1) ?? null);
      legendSink.current?.(legendValues(bar));
      // The axis labels follow the same pointer. A time is pushed, not a
      // value: each label looks its own point up, so a series with no point
      // there (a study inside its warm-up) hides itself rather than being
      // told a number that is not its own. Off the plot, null returns every
      // label to its series' last point -- the resting label.
      const at = param.point === undefined || param.time === undefined ? null : param.time;
      for (const held of labels.current.values()) held.setTime(at);
    };
    // Every panel, not just panel 1: hovering a study panel has to move the
    // legend too, and the host mirrors the crosshair across the panels
    // anyway -- each mirror fires the hovered panel's own subscription.
    for (const api of apis) api.chart.subscribeCrosshairMove(handler);
    return () => { for (const api of apis) api.chart.unsubscribeCrosshairMove(handler); };
    // `chartEpoch`, not the values the handler reads -- same discipline as
    // the click-handler effect above, so a theme flip's chart teardown
    // doesn't leave this subscribed to the destroyed instance.
  }, [chartEpoch, legendValues]);

  useEffect(() => {
    const price = priceSeries.current;
    if (price === null) return;
    const d = t.drawings;
    const shown = (state.levels ?? []).filter((level) => !(hideRita && level.origin === "rita"));
    const lines = shown.map((level) => price.createPriceLine({
      price: level.price,
      color: level.origin === undefined ? d.level : d.proposed,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: level.origin === undefined ? "S/R" : level.origin,
    }));
    // This cleanup runs against `price` even after a later render has torn
    // that instance down (the host's chart.remove() on a rebuild) and moved
    // on to a new one. Unlike removeSeries, removePriceLine does not throw
    // synchronously on a dead series -- but it still routes through to a
    // requestAnimationFrame paint on the destroyed widget, so the same
    // "is this still the live instance" guard applies here too.
    return () => {
      if (priceSeries.current === price) for (const line of lines) price.removePriceLine(line);
    };
    // `chartEpoch`/`priceEpoch` too, not just `state.levels`: a rebuild
    // replaces the charts (and their series) without touching
    // `state.levels`' identity. The cleanup above ran against the OLD
    // (now-destroyed) series -- harmless -- but without them this effect
    // would never rerun to redraw the lines onto the NEW one, and every
    // level would silently vanish after a theme flip. Same failure mode the
    // series pass above already guards against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.levels, chartEpoch, priceEpoch, hideRita]);

  const drawnLines = useRef<ISeriesApi<"Line">[]>([]);
  useEffect(() => {
    // Panel 1 (spec, Rendering): the drawings, the levels and the tool rail
    // act on the price panel by convention.
    const panel = panels.current[0];
    if (panel === undefined) return;
    const created = panel.chart;
    const d = t.drawings;
    (state.drawings ?? []).forEach((drawing, index) => {
      for (const line of pointsOf(drawing, drawingEdge)) {
        const figure = created.addSeries(LineSeries, {
          color: index === selected ? d.selected
            : drawing.kind === "gann" ? d.gann
            : drawing.kind === "fib" ? d.fib : d.segment,
          lineWidth: index === selected ? 2 : 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          // Drawings annotate the price scale, they must not drive it: a
          // gann fan's 60° far end squashes the candles otherwise.
          autoscaleInfoProvider: () => null,
        });
        figure.setData(line.map((point) => ({ time: point.time as never, value: point.value })));
        drawnLines.current.push(figure);
      }
    });
    return () => {
      // `created` is this effect's own chart instance, captured when it last
      // ran. PanelHost removes its charts inside a CHILD effect, which runs
      // before this cleanup on the same commit; in lightweight-charts,
      // remove() empties the series map and a removeSeries() after that
      // throws. Only touch `created` while it is still a chart this
      // component currently holds.
      if (panels.current[0]?.chart === created) {
        for (const figure of drawnLines.current) created.removeSeries(figure);
      }
      drawnLines.current = [];
    };
    // `chartEpoch` too, not just `state.drawings`/`drawingEdge`: a rebuild
    // replaces the charts (and their series) without touching either of
    // those identities. Same failure mode the series/levels effects above
    // already guard against -- without it, every drawing would silently
    // vanish after a theme flip. `selected` too:
    // it drives the highlight colour above, so a selection change must
    // redraw. Colour alone cannot mark a selected fib or gann, whose family
    // colour is the accent already -- so the selected drawing is also drawn
    // a pixel wider. `t` is NOT listed: the adapter's output only changes
    // with the theme mode, which rebuilds every chart and so bumps
    // `chartEpoch` -- and an effect that also listed it would run once
    // against the charts that flip had already removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.drawings, drawingEdge, chartEpoch, selected]);

  // Undo pops the card's saved stack: the newest figure the user added that
  // is still on the card, and the LAST equal copy of it, since the newest is
  // the one to go. Entries whose figure is already gone (Delete, Discard) are
  // dropped on the way down. The removal and the shorter stack go in one
  // patch, like the add, so a relaunch can never catch them disagreeing.
  const onUndo = () => {
    const stack = [...(state.added ?? [])];
    for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
      const at = lastIndexOfEqual(state[entry.facet], entry.item);
      if (at === -1) continue;
      // Indices shift under a removal, so a selection would point at the
      // wrong drawing afterwards -- the same reason Delete clears it.
      setSelected(null);
      // The entry goes onto redo in the SAME patch that takes the figure
      // away, so the two stacks can never be caught disagreeing -- the same
      // discipline the add already keeps between `added` and the facet.
      const redo = [...(state.redo ?? []), entry];
      if (entry.facet === "anchors") onPatch({ anchors: (state.anchors ?? []).filter((_, i) => i !== at), added: stack, redo });
      else if (entry.facet === "levels") onPatch({ levels: (state.levels ?? []).filter((_, i) => i !== at), added: stack, redo });
      else onPatch({ drawings: (state.drawings ?? []).filter((_, i) => i !== at), added: stack, redo });
      return;
    }
    // Nothing on the stack is still on the card: forget the dead entries.
    // Redo is untouched -- there was nothing to put on it.
    onPatch({ added: [] });
  };
  const canUndo = (state.added ?? []).some((entry) => lastIndexOfEqual(state[entry.facet], entry.item) !== -1);

  // Redo puts back exactly what the last undo took: the newest entry on the
  // redo stack, re-added to its own facet and pushed back onto `added` so a
  // second undo can take it away again. One patch, like the undo.
  const onRedo = () => {
    const stack = [...(state.redo ?? [])];
    const entry = stack.pop();
    if (entry === undefined) return;
    const added = pushAdded(state.added, entry);
    if (entry.facet === "anchors") onPatch({ anchors: [...(state.anchors ?? []), entry.item as string], added, redo: stack });
    else if (entry.facet === "levels") onPatch({ levels: [...(state.levels ?? []), entry.item as ChartLevel], added, redo: stack });
    else onPatch({ drawings: [...(state.drawings ?? []), entry.item as ChartDrawing], added, redo: stack });
  };
  const canRedo = (state.redo ?? []).length > 0;

  // Every figure the card holds, for Clear's confirm threshold below.
  const drawingCount = (state.drawings ?? []).length + (state.levels ?? []).length + (state.anchors ?? []).length;

  /**
   * The chart as a PNG (spec §4.6). takeScreenshot composes a chart's panes
   * and the watermark into one canvas; saveBinaryFile runs the platform's
   * save dialog. A failure is logged, never thrown at the user mid-chart.
   *
   * EVERY panel, not just the first (owner, 2026-09-27: "the PNG renderer
   * only exports panel1"). Each panel is its own chart with its own canvas
   * since v12.4.0, and the library can only compose the panes of ONE of them,
   * so the export had been panel 1 alone -- losing the volume and every study
   * pane. `composePanels` draws each panel's screenshot into an offscreen
   * canvas at that panel's own rect, which is what the note here used to name
   * as the upgrade path.
   *
   * The card's own background is painted under them: the chart layout is
   * deliberately transparent so a live card's colour shows through, which in
   * a PNG would otherwise mean a transparent image with transparent gaps
   * between the panels.
   *
   * A compose that cannot run -- no panel laid out yet, or no 2D context --
   * falls back to panel 1's canvas, which is what shipped before. Better the
   * old export than none.
   */
  const snapshot = async () => {
    const shots = panels.current.flatMap((panel) => {
      const rect = panel.rect();
      if (rect === null) return [];
      const canvas = shootAt(panel.chart, rect, SNAPSHOT_SCALE);
      return canvas === null ? [] : [{ canvas, rect }];
    });
    // The mark the CARD is showing, drawn into the export as well: it is a DOM
    // element now, and `takeScreenshot` captures only the chart canvas.
    const style = watermarkStyle(theme, t);
    const image = await loadMark(style.src);
    // The header band, on unless the card turned it off. Composed from the
    // same strings the header itself shows -- the renderer formatted them --
    // rather than rasterised off the DOM, which a canvas cannot do.
    // ponytail: the crosshair READINGS are not in it. They live in Legend's
    // own state behind the sink, and the resting band reads well without
    // them; plumbing them up is the upgrade if a shared chart needs the OHLC.
    const header = state.snapshotHeader === false ? null : {
      symbol,
      ...(meta?.name === null || meta?.name === undefined ? {} : { name: meta.name }),
      ...(hero === null ? {} : { price: hero.price }),
      ...(hero?.delta == null ? {} : { change: hero.delta.text, direction: hero.delta.direction }),
      colors: { text: tokens["--text"], muted: tokens["--text-muted"], up: tokens["--up"], down: tokens["--down"] },
    };
    const canvas = composePanels(
      shots,
      tokens["--bg-card"],
      image === null ? null : { image, opacity: style.opacity, padding: style.padding },
      header,
    ) ?? panels.current[0]?.chart.takeScreenshot();
    if (canvas === undefined || canvas === null) return;
    await saveBinaryFile(snapshotName(symbol, interval), "PNG image", await canvasBytes(canvas), "png");
  };
  const onSnapshot = () => { void reportError("chart snapshot", snapshot()); };

  /**
   * What Clear forgets: exactly the drawing facets, the same patch a symbol
   * change makes. NOT the `onClear` prop, which drops the card's whole
   * `chart` field -- that field also holds the interval, ADJ, the pane
   * weights and the range, and Clear is a drawing action: it must not make
   * the user re-pick settings they never asked to forget.
   */
  const clearPatch = () => onPatch({ drawings: [], levels: [], anchors: [], added: [], redo: [] });

  /**
   * Clear, going through the rail's own confirmClear (spec §7.2) so the
   * keyboard path asks the same question the button would have.
   */
  const clearDrawings = async () => {
    if (await confirmClear(drawingCount)) clearPatch();
  };
  // The saved bundles, once. Best-effort like every JSON store: a missing
  // or quarantined file is an empty list, never an error state.
  useEffect(() => {
    let current = true;
    void loadChartPresets().then((list) => { if (current) setPresets(list); });
    return () => { current = false; };
  }, []);
  // The favorites, once, best-effort like every JSON store.
  useEffect(() => {
    let current = true;
    void loadChartFavorites().then((list) => { if (current) setFavorites(list); });
    return () => { current = false; };
  }, []);
  // Add the just-built series to Favorites: the name is seriesLabel(built) --
  // the same label the chip and the pill show -- so two equal configurations
  // collapse to one entry through upsertFavorite (which keys on the name).
  const addFavorite = (built: Series) => {
    const next = upsertFavorite(favorites, { name: seriesLabel(built), series: built });
    setFavorites(next);
    void reportError("save chart favorites", saveChartFavorites(next));
  };
  const removeFavorite = (name: string) => {
    const next = removeFavoriteFrom(favorites, name);
    setFavorites(next);
    void reportError("save chart favorites", saveChartFavorites(next));
  };

  /**
   * Every series patch writes `series` and nothing else: series are not on
   * the undo stack, so `added`/`redo` are never touched here.
   *
   * It is also where a MIGRATED card is written down for the first time
   * (spec, Migration): the derived list and the widened `panels` text go
   * out together, on the user's first change and never on load. `panels` is
   * a widget PARAMETER, so it rides `onParam` -- which routes it through the
   * group the card may have it bound to -- while the series are card state.
   */
  layoutLockedRef.current = layoutLocked;
  const patchSeries = (next: Series[]) => {
    if (layoutLocked) return;
    onPatch({ series: next });
    if (migration.migrated) onParam({ panels: panelsText });
  };
  // The palette builds the whole series -- its panel and its side included
  // (spec, Placement) -- so adding one is an append and nothing else.
  const addSeries = (next: Series) => { patchSeries([...series, next]); };
  const removeSeries = (id: string) => patchSeries(series.filter((s) => s.id !== id));
  // The strip's order IS the card's order; an id the drag payload no longer
  // names (removed mid-drag) is simply dropped, as the strip itself does.
  const reorderSeries = (ids: string[]) =>
    patchSeries(ids.flatMap((id) => series.filter((s) => s.id === id)));
  // The editor's Apply replaces the edited series in place: the palette
  // rebuilds the whole thing (it keeps the id it was given), so the card's
  // list takes it as it comes, at the position the chip already held. A
  // rebuilt expression that now equals ANOTHER chip's is refused as a no-op
  // (the palette's own guard refuses it first) -- the editor closes either
  // way.
  const applySeries = (next: Series) => {
    const at = series.findIndex((s) => s.id === editing);
    setEditing(null);
    if (at === -1) return;
    if (series.some((s, i) => i !== at && s.expr === next.expr
      && (next.type === "study" || (s.panel === next.panel && s.side === next.side)))) return;
    patchSeries(series.map((s, i) => (i === at ? next : s)));
  };
  // Closing the picker abandons the edit with it: the panel IS the editor
  // now, so a chip left under edit would reopen it on the next I.
  const closeLayout = () => { setLayoutOpen(false); setEditing(null); };
  /* The saved-BUNDLE actions are gone with the controls that called them
     (user, 2026-09-27). `applyPreset` replaced the card's whole series list
     from a snapshot; `savePreset` wrote one. Macros already carry panels AND
     series and Favorites covers the single-series case, so the bundle was the
     redundant third concept.

     chart-presets.json is NOT touched: it is still loaded into `presets`
     above, `activePreset` below still derives the strip's "saved series" note
     from it, and an older build still lists and applies every bundle on disk.
     What went is the way in from this card's UI. */
  // The strip's "saved series" note names the bundle the card currently
  // EQUALS, derived rather than remembered: the note goes away by itself the
  // moment a chip is edited, added or removed.
  //
  // By the chips' identities, not by value: a `series` bundle's ids are
  // minted fresh on every Apply (above), so a structural comparison could
  // never match one. A study bundle is matched on its expressions alone, as
  // it always was in substance -- key order in a hand-edited
  // chart-presets.json no longer decides whether the note appears.
  const seriesSig = (list: Series[]) => list.map((s) => `${s.expr}|${s.panel}|${s.side}`).join(" ");
  const studySig = (list: { expr: string }[]) => list.map((s) => s.expr).join(" ");
  const activePreset = presets.find((p) => (p.kind === "series"
    ? seriesSig(p.series) === seriesSig(series)
    : p.kind === "studies" && studySig(p.studies) === studySig(studies)))?.name ?? null;
  // Which saved layout this card matches exactly, or "Custom" (spec 2026-09-24,
  // D9). Full equality, id-blind -- a colour or a pen edit drops the name.
  // "<Chart Specific>" when nothing matches (user, 2026-09-26), not "Custom".
  // The angle brackets are the point: it reads as a STATE rather than as the
  // name of a saved macro called Custom, which is what a bare word in a list of
  // macro names looks like. The option stays `disabled` below, so it can be
  // shown but never picked -- there is nothing to apply.
  const layoutMatch = layouts.find((l) => layoutMatches(l, panelDefs, series))?.name ?? "<Chart Specific>";
  const layoutNames = layouts.map((l) => l.name);
  // Applying (D4): fresh series ids and a deep-copied panels list, written as
  // the same pair patchSeries writes -- series through onPatch, panels through
  // onParam -- so editing the card never reaches back into the library.
  const applyLayout = (name: string) => {
    // Bound to a Layout group: the pick moves the group, so every member switches.
    if (layoutBinding !== null) { onPatch({ layout: name }); return; }
    const chosen = layouts.find((l) => l.name === name);
    if (chosen === undefined) return;
    const built = cardFromLayout(chosen);
    onPatch({ series: built.series });
    onParam({ panels: encodePanels(built.panels) });
  };
  // The series under edit, if it is still on the card: a chip removed while
  // its editor was open (a second window, say) closes the editor by absence.
  // `editing` is a series ID now, not an expression: two performance lines
  // can carry the same notation, and an expression stopped being an
  // identity the moment the card drew things that are not studies.
  const editingSeries = editing === null ? undefined : series.find((s) => s.id === editing);
  // ...and the dead id goes with it. Without this the editor would reopen
  // unasked the moment a series with that id came back -- an Apply preset
  // that contains it, say.
  useEffect(() => {
    if (editing !== null && editingSeries === undefined) setEditing(null);
  }, [editing, editingSeries]);
  // Which chip is lit: a stored range that matches a preset by value, else
  // Custom. Derived from the card, not from "what was last clicked" -- the
  // range is saved state now, and survives a relaunch. Forced to Custom
  // once `rangeFixed` (T9): the card's own start/end own the window, and
  // every chip reads as the one state that isn't a preset the chips chose.
  const preset = rangeFixed ? "Custom" : presetFor(state.range);

  // The strip that used to live in the header, handed up to the card's
  // Parameters row (spec 2026-09-24). Built fresh each render so its handlers
  // close over the latest onPatch/onParam, but pushed to the card only when a
  // value it SHOWS changes -- the effect's deps are those values, never
  // `controls` itself. If it fired every commit, WidgetCard's setState would
  // re-render this component and fire it again: a render loop. Keying on the
  // values breaks it.
  // `ponytail: a handler captured on the last value-change is used until the
  // next one; onPatch/onParam are store dispatchers, so a stale closure calls
  // the same action -- upgrade to refs if that stops being true. Any strip
  // INPUT added here must join the dep list too, or the row shows it stale;
  // the "re-registers when Series is toggled" test guards the palette case.`
  const controls = (
    <ChartControls
      intervals={intervals}
      interval={interval}
      onInterval={(iv) => onPatch({ interval: iv })}
      onCustomInterval={setIntervalOpen}
      intervalOpen={intervalOpen}
      intervalChildren={
        <IntervalPopover
          interval={interval}
          // A custom interval is the same `interval` field as a chip (spec
          // 2026-09-25, G6/G10): the wire string goes through the same patch
          // path, so F's interval group and every downstream reader get it
          // with no extra work.
          onApply={(wire) => onPatch({ interval: wire })}
          onClose={() => setIntervalOpen(false)}
        />
      }
      preset={preset}
      onPreset={(label) => {
        const chosen = RANGE_PRESETS.find((entry) => entry.label === label);
        if (chosen === undefined) return;
        onPatch({ range: chosen.range });
      }}
      rangeFixed={rangeFixed}
      onCustomRange={setRangeOpen}
      rangeOpen={rangeOpen}
      rangeChildren={
        <RangePopover
          range={state.range}
          calendar={calendar}
          window={anchorWindow}
          fixed={rangeFixed}
          onApply={(r) => onPatch({ range: r })}
          onClose={() => setRangeOpen(false)}
        />
      }
      // The session toggle (slice 4): shown for an intraday chart of a
      // symbol with an exchange, and nowhere else. `session` is a card
      // facet patched like `range` -- on its own, never on the undo stack.
      exchange={intraday ? exchange : null}
      session={state.session ?? "extended"}
      onSession={(session) => onPatch({ session })}
      adjusted={basis === "adjusted"}
      onAdjusted={(adjusted) => onPatch({ adjusted })}
      // The one Layout editor (spec 2026-09-24, C): both buttons just open it
      // now, on their own tab; the editor itself -- panels, the Series pane,
      // OK's commit -- is mounted once below, at the renderer's top level.
      layoutTab={layoutOpen ? layoutTab : null}
      onOpenLayout={openLayout}
      layouts={layoutNames}
      layoutMatch={layoutMatch}
      onApplyLayout={applyLayout}
      // Live counts for the Series/Panels badges (spec 2026-09-25, J18).
      // Both come from the EFFECTIVE arrays this renderer actually draws --
      // `series` (the migrated list, the same value fed to the reading row's
      // `series={series.length}` above) and `panelDefs` (the parsed panel
      // defs, or the default two) -- never a literal or the raw card, so the
      // badge can never disagree with what is on the chart.
      seriesCount={series.length}
      panelCount={panelDefs.length}
      // The EFFECTIVE series and panels, not the raw card: on a card that
      // predates v12.4.0 both are DERIVED (the migration above), so a
      // document built from the raw state would show `"series": []` --
      // and `[]` is a NAMED value to parseChartSpec, so an Apply of the
      // unmodified document (or one where only the timeframe was touched)
      // would patch the card with an empty list and every line would
      // vanish with no way back. The document should be the card as the
      // user sees it; an unchanged Apply then writes the derived list as
      // the card's record, which is the same "first change turns what is
      // drawn into the card's own record" path patchSeries documents.
      // `studies`/`panes` reach nothing: `buildChartSpec` stopped emitting
      // them (the branch-end round, finding 7), so a document can no
      // longer invite an Apply that writes the deprecated pair back.
      specJson={specJson(buildChartSpec(symbol, interval, { ...state, series }, panelsText))}
      onApplySpec={(text) => {
        // Each pasted study is checked against the catalog (studies
        // addendum §7): the popover reports the first bad one inline.
        // Only once the catalog is actually there, though: `lookup`
        // answers undefined for every name while the registry is loading
        // or unavailable, so validating then would refuse the card's OWN
        // round-tripped studies and leave no way to apply anything at all
        // -- the "registry unavailable degrades" ruling. With no validator
        // parseChartSpec carries `studies` through untouched.
        const read = parseChartSpec(
          text, { symbol, panels: panelsText },
          registry.status === "ready" ? (study) => studyProblem(study, registry.lookup, exchange !== null) : undefined,
        );
        if (read.patch === null) return read.error;
        if (layoutLocked) return `The layout comes from group Layout · ${layoutBinding}; unlink it to paste one.`;
        // `panels` rides back on the patch like `interval` does, but it is
        // a widget PARAMETER, not card state: it goes out through onParam
        // (which routes it through any group the card binds it to) and is
        // kept out of the card patch entirely.
        const { panels: pastedPanels, ...patch } = read.patch;
        onPatch(patch);
        // A MIGRATED card writes its panels text whether or not the paste
        // changed it (T6 review, finding 1): the document is built from the
        // DERIVED text, so an unchanged Apply on a migrated card returns the
        // same string -- and skipping the write would land `series` (studies
        // on panels 3, 4) with no `panels` parameter behind it. The next
        // render would then migrate nothing, fall back to the default two
        // panels, and silently drop every series naming a third. Same
        // "write both together" rule `patchSeries` keeps.
        if (migration.migrated || (pastedPanels !== undefined && pastedPanels !== panelsText)) {
          onParam({ panels: pastedPanels ?? panelsText });
        }
        return null;
      }}
      onSnapshot={onSnapshot}
      // Absent means SHOWN: a card saved before these existed keeps the legend
      // it had, and the flag is only written once one is turned off.
      studyValues={state.studyValues ?? true}
      onStudyValues={(show) => onPatch({ studyValues: show })}
      seriesPills={state.seriesPills ?? true}
      snapshotHeader={state.snapshotHeader ?? true}
      onSnapshotHeader={(on) => onPatch({ snapshotHeader: on })}
      onSeriesPills={(show) => onPatch({ seriesPills: show })}
      onOk={onOk}
      onCancel={onCancel}
      paramsDirty={paramsDirty}
      railHidden={state.railHidden ?? false}
      onRailHidden={(hidden) => onPatch({ railHidden: hidden })}
      card={card}
      groups={groups}
      groupsDisabled={groupsDisabled ?? false}
      // Symbol is a DECLARED parameter (Header edits it through the parameter
      // path, so a grouped symbol already moves its group); F adds only the
      // chip. Range seeds a new group from the card's current range, or the 5D
      // preset when the card has none (a fitted view has no range expression to
      // carry). `ponytail: 5D default seed; a smarter seed is a follow-up.`
      symbolParam={widget.params.find((p) => p.paramName === "symbol")}
      macroParam={widget.params.find((p) => p.paramName === "macro")}
      macroValue={macro}
      sourceParam={widget.params.find((p) => p.paramName === "source")}
      // The RAW parameter when the card has one, so the select matches the
      // widget's own option value whatever its case; the derived `source`
      // only when it has none, which reads as the local default.
      sourceValue={params.source ?? source}
      onSource={(value) => onParam({ source: value })}
      // Picking a backend macro from the Layout select writes the parameter and
      // nothing else: the conversion effect above expands it into this card's
      // series and panels and clears it back to "none", exactly as it does for
      // a macro set any other way.
      onApplyMacro={(value) => { if (!layoutLocked) onParam({ macro: value }); }}
      layoutLockedBy={layoutLocked ? `Layout · ${layoutBinding}` : undefined}
      narrow={narrow}
      symbolValue={params.symbol ?? ""}
      chartRangeValue={encodeRange(state.range ?? RANGE_PRESETS[0].range)}
    />
  );
  const cyclesKey = JSON.stringify(cycles);
  // A value that changes whenever a series is added, removed, reordered or
  // edited, so the palette/spec the row shows stay current without listing
  // the array itself (a new identity every render would loop like `controls`).
  const seriesKey = JSON.stringify(series);
  // `intervals` is `INTERVAL_WIRE_VALUES` (a module constant, stable) unless the widget
  // DECLARES its own options, in which case it is a fresh `.map()` result
  // every render -- same trap as `cycles`/`series`, so it gets the same
  // string-key treatment rather than joining the deps list by reference.
  const intervalsKey = intervals.join(",");
  useEffect(() => {
    controlsSlot?.(controls);
    // The strip's value inputs; `controls` is deliberately excluded so a
    // parent re-render does not re-fire this and loop.
    //
    // `card`, `groups` and `groupsDisabled` ARE listed (spec 2026-09-25, F5).
    // They are stable references, unlike `controls`, so they do not reintroduce
    // that loop -- and without them the strip goes stale on exactly the action
    // that binds a facet: joining an interval group seeds the group FROM the
    // card's current interval, so `interval` does not change, `state.range`
    // does not change, no dep moves, and the just-clicked chip keeps drawing
    // its unbound face until some unrelated render happens to re-push. (The
    // range facet escaped this by accident -- `decodeRange` mints a fresh
    // object, so `state.range`'s identity flips on any recompute -- but
    // interval is a plain string and the symbol chip's affordance is neither.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsSlot, intervalsKey, interval, preset, rangeFixed, rangeOpen, intervalOpen, intraday ? exchange : null,
      state.range, state.session, state.railHidden, state.studyValues, state.seriesPills, basis, panelsText, cyclesKey, layoutOpen, layoutTab, editing, seriesKey,
      layouts, layoutMatch, card, groups, groupsDisabled]);
  useEffect(() => () => controlsSlot?.(null), [controlsSlot]);

  /**
   * The keyboard map (spec §10.2). It sits on the chart's ROOT, not the
   * plot, so a key pressed with the rail or the header focused still reaches
   * it -- and is inert while a text control anywhere inside has focus, or
   * typing "s" into the range popover would arm the segment tool.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    // The Layout editor is a modal: nothing behind it should react to a key,
    // the same way a focused text control already makes this map inert. Its
    // own Escape/close paths are handled entirely inside LayoutEditor's own
    // document-level listener (spec 2026-09-24, C) -- this map must not race
    // it, especially when the Parameters row happens to be open too: Escape
    // reaching THIS handler while the modal is up would fire the ROW's Cancel
    // (reverting recorded facets) as a side effect of dismissing the modal,
    // which the user never asked for.
    if (layoutOpen) return;
    const target = event.target as HTMLElement;
    // Shortcuts are inert while a text control has focus (spec §10.2).
    if (target.closest("input, textarea, select, [contenteditable]") !== null) return;
    // Ctrl alongside Cmd: the same chord on a keyboard without a Cmd key.
    const chord = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (chord && key === "s") { event.preventDefault(); onSnapshot(); return; }
    if (chord && key === "m") { event.preventDefault(); setMagnet((on) => !on); return; }
    if (chord && key === "z") { event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo(); return; }
    // Every other chord belongs to the app or the platform, not to the chart.
    if (chord) return;
    if (event.key === "Escape") {
      // spec 2026-09-24, D5: Escape acts as Cancel while the Parameters row is
      // open -- closing the row without OK always discards. With the row
      // closed, Escape keeps its old job of dropping the tool and popovers.
      if (paramsOpen && onCancel) { onCancel(); return; }
      setTool("panning"); setRangeOpen(false); setIntervalOpen(false); closeLayout(); setMeasure(null); return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      // Under the crosshair, Delete removes the SELECTED drawing (the v12.2
      // behaviour); under any other tool there is no selection to remove,
      // and the key is Clear's shortcut instead.
      if (tool === "panning") {
        if (selected === null) return;
        onPatch({ drawings: (state.drawings ?? []).filter((_, i) => i !== selected) });
        setSelected(null);
      } else {
        void clearDrawings();
      }
      return;
    }
    if (key === "/") { event.preventDefault(); setSymbolEditing(true); return; }
    // `I` OPENS the Layout editor on the Series tab (studies addendum §3,
    // spec 2026-09-24, C) and only opens it. Once it is up the editor is a
    // focus-capturing modal -- it focuses its search input on mount and stops
    // every key it does not use -- so a second `I` never reaches this map.
    // The closers are the editor's own ✕, Cancel and Escape.
    if (key === "i") { openLayout("series"); return; }
    const byKey: Record<string, ChartTool> = {
      c: "panning", s: "segment", r: "ray", f: "fib", g: "gann", v: "anchor", l: "level", m: "measure",
    };
    const picked = byKey[key];
    // A tool the rail shows disabled is inert on the keyboard too: `V` must
    // not arm an anchor an EODHD chart can never draw.
    if (picked !== undefined && !disabledTools.includes(picked)) setTool(picked);
  };

  /**
   * The header's hero reading (spec §4.5): the last bar's close, and the
   * delta against the previous close on the 1D chip or against the first
   * bar in the range otherwise -- `heroDelta` decides which and says so in
   * `basis`, which the chip carries as its tooltip. Both are formatted at
   * the decimals the visible price range needs, the same as the legend, so
   * the two readings of the same price can never disagree.
   */
  const lastBar = candles.at(-1) ?? null;
  const heroChange = heroDelta(candles, state.range === undefined ? null : (resolveRange(state.range, new Date(), calendar, anchorWindow)?.from ?? null), preset);
  const heroDecimals = decimalsNow();
  const hero = lastBar === null ? null : {
    price: formatPrice(lastBar.close, heroDecimals),
    delta: heroChange === null ? null
      : { ...formatDelta(heroChange.change, heroChange.percent, heroDecimals), basis: heroChange.basis },
  };

  // The collapsed row's summary (spec 2026-09-24, D7): the interval, the range
  // resolved the same way every reader of it resolves it, the session and the
  // exchange. Built here because the renderer is what knows all four; the text
  // itself is a pure function so it is tested without a chart.
  const summary = chartSummary({
    interval,
    range: state.range === undefined ? null : resolveRange(state.range, new Date(), calendar, anchorWindow),
    session: sessionMode,
    exchange,
    timeZone: zone,
  });

  // The card's regions (spec §3), top to bottom: the command strip
  // (`ChartControls`, handed up to the card's Parameters row through
  // `controlsSlot` above -- not rendered in this tree at all), the top
  // block (symbol block, the crosshair legend with the price hero, the
  // series strip), Rita's proposed levels when she has any, the body (the
  // tool rail beside the plot), and the status bar. A flex column, so the
  // plot can take flex: 1
  // with min-height: 0 and stay
  // inside the card -- the chart div used to fill its parent with
  // height: 100%, which resolves against the flex container rather than
  // "what is left after siblings" and pushed the total past the card's
  // bottom once anything sat above it. The old inline style lives on
  // .arts-charts now, which is also the element the narrow-card collapse
  // above measures with its ResizeObserver.
  //
  // tabIndex={-1} on the root: a click anywhere inside focuses it, so the
  // keyboard map below works without the plot itself having been clicked --
  // and without adding a tab stop of its own.
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the same false positive the plot div below carries: a focusable surface that takes its own shortcut keys (spec §10.2) is exactly what jsx-a11y has no role for. Every key here also has a button on the header or the rail, so nothing is keyboard-only.
    <div
      ref={rootRef}
      className="arts-charts"
      data-narrow={narrow ? "true" : undefined}
      data-portrait={portrait ? "true" : undefined}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {/* The card's top block (spec A1): symbol block at the left spanning
          both rows; the legend (with the price hero hard right, through the
          hint's margin-left: auto) over the series strip. The legend and
          the series strip are today's components in the opposite order,
          and the old .chart-header row is gone. */}
      <div className="chart-top">
        {/* The list as typed (spec 2026-11-13 §3); everything the header looks up reads list:1. */}
        <Header
          symbol={(params.symbol ?? "").toUpperCase()}
          meta={meta}
          symbolEditing={symbolEditing}
          onSymbolEditing={setSymbolEditing}
          onSymbol={(next) => onParam({ symbol: next })}
        />
        <div className="chart-legend-row">
          <Legend
            studyValues={state.studyValues ?? true}
            interval={interval}
            intervalSeconds={intervalSeconds}
            sink={legendSink}
            timeZone={zone}
          />
        </div>
        {/* The hero is the top block's own third column, not a child of the
            legend row (user ruling 2026-09-24): the crosshair readings wrap
            in the column BETWEEN the symbol block and the price, and the
            price and its pill stay put at the right edge whatever the
            readings do. Inside the legend's flex row it rode the wrap and
            dropped to a second line whenever the readings got long. */}
        {hero === null ? null : (
          <div className="chart-hero">
            <div className="chart-hero-price">{hero.price}</div>
            {hero.delta === null ? null : (
              <div className="chart-delta" data-direction={hero.delta.direction} title={hero.delta.basis}>{hero.delta.text}</div>
            )}
          </div>
        )}
        {/* The chip strip (studies addendum §5.4, §6): one chip per SERIES,
            in panel order, prefixed with where each one draws once the card
            has more than one panel to tell apart. Now the top block's third
            row, under the legend rather than the old header (spec A1).
            Hidden entirely by "Display series pills" (user, 2026-09-27) --
            not merely made invisible, so the row it occupies goes with it and
            the plot takes the height back. */}
        {(state.seriesPills ?? true) && <StudiesStrip
          series={series}
          served={served}
          source={source}
          notes={seriesNotes}
          labels={overlayLabels}
          showPanels={panelDefs.length > 1}
          onReorder={reorderSeries}
          onEdit={(id) => { setEditing(id); openLayout("series"); }}
          onRemove={removeSeries}
          activePreset={activePreset}
        />}
      </div>
      {clippedTo === undefined ? null : <div className="chart-range-note" role="status">Range limited to {clippedTo} at this interval</div>}
      {listTruncated ? <div className="chart-range-note" role="status">list truncated to {MAX_LIST}</div> : null}
      {/* Mounted on every live card, empty or not, so a screen reader announces the note that arrives in it. */}
      {liveCard ? <div className="chart-live-note" role="status">{liveText}{volumeText === null ? null : <div>{volumeText}</div>}</div> : null}
      {(state.levels ?? []).some((level) => level.origin !== undefined) && (
        <div role="group" aria-label="Proposed levels">
          {(state.levels ?? []).map((level, index) =>
            level.origin === undefined ? null : (
              <span key={index}>
                <button
                  type="button"
                  onClick={() => onPatch({
                    levels: (state.levels ?? []).map((l, i) => (i === index ? { price: l.price } : l)),
                  })}
                >
                  Keep {level.price} ({level.origin})
                </button>
                <button
                  type="button"
                  onClick={() => onPatch({
                    levels: (state.levels ?? []).filter((_, i) => i !== index),
                  })}
                >
                  Discard {level.price} ({level.origin})
                </button>
              </span>
            ),
          )}
        </div>
      )}
      <div className="chart-body">
        {(state.railHidden ?? false) ? null : (
          <ToolRail
            tool={tool}
            onSelect={setTool}
            disabled={disabledTools}
            magnet={magnet}
            onMagnet={() => setMagnet((on) => !on)}
            canUndo={canUndo}
            onUndo={onUndo}
            canRedo={canRedo}
            onRedo={onRedo}
            // The rail runs confirmClear itself and then calls this.
            onClear={clearPatch}
            drawingCount={drawingCount}
            hasRita={(state.levels ?? []).some((level) => level.origin === "rita")}
            hideRita={hideRita}
            onToggleRita={() => setHideRita((hidden) => !hidden)}
          />
        )}
        {/* Positioned, so the measure label can be placed in plot pixels. */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <div
            ref={node}
            style={{ width: "100%", height: "100%" }}
            data-testid="arts-charts"
            role="application"
            aria-label="Chart"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the chart has to take focus to take the keyboard map on the root above
            tabIndex={0}
          >
            {/* One lightweight-charts instance per panel (spec, Rendering),
                positioned by the `panels` parameter's percentages and
                sharing one time axis and one crosshair. The host owns the
                instances; this component draws into the handles it hands
                back through onReady. */}
            <PanelHost
              panels={panelDefs}
              usedSides={usedSides}
              theme={t}
              mode={theme}
              timeScaleBehavior={timeScaleBehavior}
              order={panelOrder}
              window={loadedWindow}
              resolve={resolveWindowed}
              onReady={onPanelsReady}
              onDispose={onPanelsDispose}
            />
          </div>
          {measure === null ? null : (
            <div className="chart-measure" style={{ left: measure.x, top: measure.y }}>{measure.text}</div>
          )}
        </div>
      </div>
      <StatusBar
        status={status}
        // Which plane is actually connected, so the bar names the route the
        // bars came over rather than the one this widget started life on.
        plane={eodhd ? "eodhd" : httpBars ? "series" : "kdb"}
        // /series' failure text, on the EODHD plane only -- the tick plane
        // reports its own state through the dot and has no message to add.
        error={httpBars ? cardBars.error : null}
        // Which of the EODHD plane's two sources answered (v12.4.2);
        // unused on the kdb plane, which has no vault to name.
        barsSource={barsSource}
        latencyMs={latencyMs ?? null}
        lastBarTime={candles.at(-1)?.time ?? null}
        intervalSeconds={intervalSeconds}
        timeZone={zone}
        // Three cases, not two (head-of-line follow-up #11): a 24hr Session
        // choice used to read "extended hours" here.
        session={regular ? "regular" : state.session === "24hr" ? "24hr" : "extended"}
        exchange={exchange}
        // The strip's chips, not the feed's series: a band is one study and
        // three lines, and a macro's series are not studies on this card.
        // Every chip since v12.4.0, not the study ones alone (the branch-end
        // round): the card's series ARE what it draws.
        series={series.length}
        summary={summary}
        paramsOpen={paramsOpen}
        onOpenParams={onOpenParams}
        tools={TOOL_COUNT}
        // A layout the card is living with rather than refusing: a reference
        // loop in a `panels` parameter that came from outside the editor
        // (spec, Cycles are warned, not followed), or the first thing
        // parsePanels could not read in it.
        warning={panelWarning}
      />
      {layoutOpen && (
        <LayoutEditor
          // A fresh draft each open; the key also remounts on a chip edit so the
          // Series pane restages on the edited series.
          key={editing ?? "layout"}
          initialTab={layoutTab}
          panels={panelDefs}
          series={series}
          // Master-detail (2026-09-26): the editor hands its selected panel down
          // so the palette scopes its list -- and its "+ Add series" -- to the
          // panel picked in the sidebar. The palette is not remounted on a panel
          // change (the key is the edited series), so an in-progress edit
          // survives clicking a different card; only the list and the add-default
          // re-scope.
          seriesTab={(selectedPanel, pendingEdit) => (
            <SeriesPalette
              panelFilter={selectedPanel}
              pendingEdit={pendingEdit}
              catalog={registry.catalog}
              status={registry.status}
              onRefresh={registry.refresh}
              active={series}
              favorites={favorites}
              onAddFavorite={addFavorite}
              onRemoveFavorite={removeFavorite}
              editing={editingSeries ?? null}
              // The panels the Panel picker offers: the card's own, already
              // parsed for the host above.
              panels={panelDefs}
              symbol={symbol}
              symbols={symbols}
              symbolGroups={(groups ?? []).filter((g) => g.paramName === "symbol").map((g) => g.name)}
              onAdd={addSeries}
              onApply={applySeries}
              fallbackColor={studyFallback}
              allowBusinessDays={exchange !== null}
              // One source per chart (v12.3.1): an EODHD card's selector lists
              // only the studies EODHD can actually serve.
              source={source}
              // Finishing a pick clears the edited chip and leaves the LAYOUT
              // EDITOR open on its Series tab; the editor's own Cancel / ✕ /
              // Escape close that. Since 2026-09-27 an ADD also closes the
              // "Add series" modal the catalog now opens in -- that is the
              // modal's own doing, not this callback's, and it is why the
              // add/look/add rhythm this comment used to describe now costs
              // one more press of "+ Add series".
              onClose={() => setEditing(null)}
              // J6 select-to-edit: the Series tab's item-list hands a series id
              // up here rather than editing locally, because applySeries above
              // resolves the target by THIS `editing` id -- a locally-picked
              // row would overwrite the wrong series. Same channel the chip
              // strip's onEdit uses (setEditing + openLayout), so the key change
              // remounts the palette on the clicked series and keeps the Series
              // tab up; `null` is the "+ Add series" fresh-pick.
              onEditSeries={(id) => { setEditing(id); openLayout("series"); }}
              // J6 reorder: the item-list grips reuse the chip strip's own
              // within-panel reorder.
              onReorderSeries={reorderSeries}
            />
          )}
          // OK writes the panels text and the remapped series together -- the same
          // pair-write patchSeries makes. Series is written whenever the draft
          // commits, so a migrated card that only edited panels still gains its own
          // `series` and does not migrate again next render.
          onCommitPanels={(nextPanels, nextSeries) => {
            if (layoutLocked) return;
            onPatch({ series: nextSeries });
            onParam({ panels: encodePanels(nextPanels) });
          }}
          layoutNames={layoutNames}
          // Save as layout writes through the shared store (D7): false surfaces the
          // failure in the editor and adds nothing.
          onSaveLayout={saveLayoutToLibrary}
          // The full library (spec 2026-09-25, E8): Export's checkbox list, since the
          // sidebar shows panels, not layouts, and cannot supply a selection of its own.
          savedLayouts={layouts}
          // The study catalog planLayoutImport validates against and regenerates
          // expressions through (E11) -- the same lookup the Series palette uses.
          lookup={registry.lookup}
          // Import writes through the shared store (E6): every open card sees the
          // new layouts at once (D6); it never touches this card's chart (E7).
          onImportLayouts={importLayoutsToLibrary}
          // OK applies a series edit the pane staged but was not Updated.
          onApplySeries={applySeries}
          onClose={closeLayout}
        />
      )}
    </div>
  );
}

/**
 * The chart card. With a host chart server (`chartsFetch`) it is kept in
 * step with its document (useChartDocument) and carries the sync's one-line
 * note, and -- once it has a `chart_id` with watches on it -- a bell with
 * their count (step 3b; no watch editor, spec §3); without one it is
 * ChartCard itself, element for element (extraction R4).
 */
export function ArtsChartsRenderer(props: Parameters<typeof ChartCard>[0]) {
  if (props.host !== undefined) configureArtsCharts(props.host);
  const registry = useTaRegistry(props.backend);
  const stampRef = useRef<Stamp | null>(null);
  const sync = useChartDocument({ params: props.params, state: props.state, onPatch: props.onPatch, onParam: props.onParam, registry, stamp: () => stampRef.current });
  const watches = useWatches(props.params.chart_id ?? "");
  if (sync === null) return <ChartCard {...props} stampRef={stampRef} />;
  const n = watches.length;
  return (
    <div className="chart-doc">
      <ChartCard {...props} stampRef={stampRef} onPatch={sync.onPatch} onParam={sync.onParam} />
      {sync.note === null ? null : <div className="chart-doc-note" role="status">{sync.note}</div>}
      {n === 0 ? null : (
        <span className="chart-doc-bell" role="img" aria-label={`${n} watch${n === 1 ? "" : "es"}`} title={watches.map((w) => w.condition).join("\n")}>
          🔔 {n}
        </span>
      )}
    </div>
  );
}
