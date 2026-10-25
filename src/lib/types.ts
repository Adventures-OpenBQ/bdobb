// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { McpServerConfig } from "./agent/types";
import type { ShareTarget } from "./shareTargets";

export type AuthLocation = "header" | "query" | "cookie";

import type { CalendarBinding, Policy } from "./calendars/contracts";
import type { LinkedChartSettings, LinkedSource } from "./widgetData/types";

export type BackendConfig = {
  id: string;
  name: string;
  baseUrl: string;
  headerName?: string;
  headerValue?: string;
  /** Where the Key/Value credential is placed on each request. */
  authLocation: AuthLocation;
  /** When true, the Connections row reports what discovery dropped. */
  validateWidgets: boolean;
  /**
   * Ask for this backend's credential value at launch instead of storing it.
   * headerName (the key, e.g. "username") stays stored; headerValue reaches
   * backends.json only when the startup prompt's Remember me was ticked, and
   * otherwise lives in memory for the run (backendsStore.runtimeCredentials).
   */
  askOnStartup?: boolean;
};

export type BackendStatus = "online" | "offline" | "unknown";

/**
 * One entry of a param's choice list. Static options from widgets.json and
 * options fetched from an `optionsEndpoint` are the same shape and go through
 * the same normaliser (toOptions in widgetsJson.ts), so `value: 2026` lands
 * identically from either source. `value: ""` is a label-only option
 * ("All Years"): selecting it sends nothing, which is what buildWidgetUrl
 * already does for "".
 */
export type ParamOption = { label: string; value: string };

/**
 * How a `type: "settings"` widget asks to be drawn in the Settings dialog
 * (docs/settings-widgets.md). `unknown` is a `settings.ui` this app cannot
 * read at all -- a shape from a newer contract -- and is shown as "Needs a
 * newer app version", never guessed at.
 */
export type SettingsUi =
  | { kind: "form" }
  | { kind: "app"; name: string }
  | { kind: "page"; path: string }
  | { kind: "unknown" };

/**
 * One `inputParams` entry of a `type: "form"` param. `paramName` is the
 * field's own name: its value is stored on the card under
 * `${formParamName}.${paramName}` (see formFieldKey in src/lib/params.ts) and
 * is POSTed under the bare `paramName`.
 *
 * A `button` field is not a value — it is the submit control, and its `label`
 * is the text the user presses. `value` is the field's default; `multiSelect`
 * is only meaningful on a `dropdown`, exactly as it is on a WidgetParam.
 */
export type FormInput = {
  paramName: string;
  type: "text" | "number" | "date" | "dropdown" | "button";
  label?: string;
  value?: string;
  description?: string;
  multiSelect?: boolean;
  options?: ParamOption[];
};

/**
 * A `type: "form"` param's parsed contract: where a submit POSTs, and the
 * fields the card renders above its renderer. Present only on a form that
 * named an `endpoint` AND kept at least one `button` field — a form that
 * cannot be submitted has nothing to offer, so widgetsJson drops it and the
 * param falls back to being hidden and named once in the log.
 */
export type WidgetForm = { endpoint: string; inputs: FormInput[] };

/** v5.4.0 (spec §4.6): OpenBB's list. `year`, `month` and `day` all show a date-only field. */
export type Granularity = "year" | "month" | "day" | "hour" | "minute" | "second";

export type WidgetParam = {
  paramName: string;
  label?: string;
  type?: string;
  value?: string;
  description?: string;
  show?: boolean;
  /** openbb-api marks a param the endpoint cannot do without with `optional: false`. */
  optional?: boolean;
  options?: ParamOption[];
  optionsEndpoint?: string;
  /**
   * Templating for the options request. A literal is copied stringified; a
   * `"$name"` entry resolves to the strip's current value for param `name`.
   * Numbers and booleans survive because the live manifest sends both
   * (`{"is_workspace": true}`).
   */
  optionsParams?: Record<string, string | number | boolean>;
  /** True when the param takes several values at once, comma-joined in the query string. */
  multiSelect?: boolean;
  /**
   * openbb-api's role hints, e.g. `["fileSelector"]`. MultiFileRenderer reads
   * `fileSelector` to find the param that names the document to show.
   */
  roles?: string[];
  /**
   * A `type: "form"` param's own contract, once it has survived validation.
   * Absent on every other param, and absent on a form that named no endpoint
   * or no button — controlKind reports such a param "unsupported", which is
   * what it did before this field existed.
   */
  form?: WidgetForm;
  /**
   * The grouping-compatibility key, when the manifest names one. Two
   * controls may share a group only when their keys match; a control that
   * declares none is keyed by its own paramName (or by its type for a
   * period control — date, week, quarter and the rest) — see paramGroupType
   * in paramGroups.ts. Only the built-ins declare it today; no OpenBB
   * backend does.
   */
  groupType?: string;
  /*
   * The five period fields of v5.2.0, each meaningful on the type it names
   * and parsed leniently by widgetsJson.ts regardless of type — a field of
   * the wrong shape is dropped, never coerced, exactly like every field here.
   */
  /** `datetime`: how far the picker's field goes. The wire is always to the second. */
  granularity?: Granularity;
  /**
   * `date_range` / `quarter_range` (isRangeType): the SECOND query param the composite `start/end` value is
   * sent as. Required — a range with nowhere to put its end is unsupported.
   */
  rangeEnd?: string;
  /** `quarter` / `fiscal_year`: the static year-END month, 1..12, already parsed. */
  fiscalYearEnd?: number;
  /** `quarter` / `fiscal_year`: a sibling param whose current value is the year-end month. */
  fiscalYearEndParam?: string;
  /**
   * `quarter` / `fiscal_year`: a path answering the year end for the
   * symbol, templated from `optionsParams` exactly as an options endpoint is.
   */
  fiscalYearEndEndpoint?: string;
  /**
   * The exchange whose calendar this param's trading anchors and `bd` offsets
   * read, as a MIC (`XNYS`, `XLON`, …). Overrides the widget's; absent means
   * the widget's, and XNYS when the widget names none either. Parsed by
   * widgetsJson.ts, never written anywhere.
   */
  exchange?: string;
  /**
   * v5.4.0, OpenBB's `groupable`. Only ever `false` or absent — true is the
   * default and saying so changes nothing. A `false` param shows no chain
   * link and is never bound (paramGroups.ts), even by a saved binding.
   */
  groupable?: boolean;
  /**
   * v5.4.0, OpenBB's `multiple`: a dropdown that also takes values the list
   * does not carry. Drawn as a text field with the options as suggestions
   * (controlKind "suggest"). Only ever `true` or absent.
   */
  multiple?: boolean;
  /**
   * v5.4.0, OpenBB's `style.popupWidth`, clamped to 200–1000 px: the width of
   * the popovers the app draws for this control. A native `<select>` popup
   * cannot be sized by a page, so a plain dropdown ignores it.
   */
  popupWidth?: number;
};

/**
 * The `formatterFn` values the widgets.json reference documents for a column
 * and for `data.table` as a whole. Anything else in the manifest is dropped
 * rather than guessed at.
 */
export type ColumnFormatterFn =
  | "int"
  | "none"
  | "percent"
  | "normalized"
  | "normalizedPercent"
  | "dateToYear";

/**
 * One entry of `data.table.columnsDefs`. Every field is optional except
 * `field`, which is the row key the column reads — an entry without one names
 * no column and is dropped.
 *
 * `renderFn` is normalised to a list even when the manifest sends a bare
 * string. `renderFnParams` is kept opaque: `colorRules` is acted on (see
 * src/lib/columnRender.ts) and so is `cellOnClick`'s groupBy block (see
 * cellClickOf in src/lib/tableColumns.ts), and so is `hoverCard` (see
 * hoverCardOf there); `columnColor` is parsed and deliberately ignored.
 */
export type ColumnSpec = {
  aggregation?: AggregationHint;
  field: string;
  headerName?: string;
  headerTooltip?: string;
  cellDataType?: "text" | "number" | "boolean" | "date" | "dateString" | "object";
  formatterFn?: ColumnFormatterFn;
  decimalPlaces?: number;
  abbreviate?: boolean;
  prefix?: string;
  suffix?: string;
  pinned?: "left" | "right";
  hide?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  renderFn?: string[];
  renderFnParams?: Record<string, unknown>;
  /** A live_grid column opts out of the showCellChange flash with `false`. */
  enableCellChangeWs?: boolean;
  /**
   * columnsDefs `sparkline` — the opaque `{ type, options }` object. Parsed into
   * a resolved config by parseSparkline (src/lib/sparkline.ts) when the column
   * is built; kept opaque here like renderFnParams.
   */
  sparkline?: Record<string, unknown>;
};

/**
 * A widget's `data.table`. `showAll` and `enableAdvanced` are in the
 * reference and are deliberately not parsed — nothing reads them.
 */
export type TableSpec = {
  pivot?: PivotConfig;
  columns: ColumnSpec[];
  /** The default applied to any column that names no formatterFn of its own. */
  formatterFn?: ColumnFormatterFn;
};

/**
 * The candle and volume colours an `advanced_charting` widget's
 * `data.chartConfig` may declare. Each key is optional, and an absent key means
 * lightweight-charts' own default (see src/lib/lwChart.ts).
 */
export const UDF_COLOR_KEYS = [
  "upColor",
  "downColor",
  "borderUpColor",
  "borderDownColor",
  "wickUpColor",
  "wickDownColor",
  "volumeUpColor",
  "volumeDownColor",
] as const;
export type CandleColors = Partial<Record<(typeof UDF_COLOR_KEYS)[number], string>>;

/** An `advanced_charting` widget's `data` block, normalised. See toUdfChart in widgetsJson.ts. */
export type UdfChartSpec = {
  defaultSymbol: string;
  /** Milliseconds between refetches; at least 5000. */
  updateFrequency: number;
  colors: CandleColors;
  showVolume: boolean;
};

export type ManagedSourceReference = { sourceId: string; kind: "upload" | "backend"; version: 1 };

export type WidgetDef = {
  /** Versioned calendar opt-in; legacy exchange fields remain readable. */
  calendarBinding?: CalendarBinding;
  calendarResolutionPolicy?: Policy;
  /** Explicit protocol metadata from the managed service; absent means standard SSRM. */
  provider?: string;
  protocolVersion?: number;
  ssrm?: import("./tableExecution/remote/openbbTypes").OpenbbSsrmConfig["capabilities"];
  /** Widget id as it appears in widgets.json. */
  id: string;
  /** Reserved id "builtin" is used from SP4 onward. */
  backendId: string;
  name: string;
  description: string;
  type: string;
  category: string;
  subCategory: string;
  endpoint: string;
  /** A live_grid widget's WebSocket path; absent means "not a live grid". */
  wsEndpoint?: string;
  /** The column that identifies a row for a live_grid's streamed updates. */
  wsRowIdColumn?: string;
  gridData: { w: number; h: number };
  params: WidgetParam[];
  dataKey?: string;
  /**
   * The widget's `data.table` block: `columnsDefs` plus the table-level
   * `formatterFn` default. Absent for a widget that declares no
   * `columnsDefs`, and such a widget renders exactly as it did before this
   * field existed.
   */
  table?: TableSpec;
  /**
   * The manifest's `data.table.pivot` preset: how the table first pivots
   * until the card saves its own (`card.table.pivot` wins). Independent of
   * `columnsDefs`.
   */
  pivot?: PivotConfig;
  /**
   * Only on a `type: "advanced_charting"` widget: what its TradingView card
   * charts and how. Its renderer issues its own UDF request (see
   * src/lib/udf.ts), so nothing here goes through the generic fetch.
   */
  udfChart?: UdfChartSpec;
  /** Provider name(s). Consumed by the library badges in SP5. */
  source: string[];
  /**
   * "Do not execute automatically when parameters change; the user clicks
   * Run." The card fetches once on load with its stored params and then only
   * on Run — `refetchInterval` and refresh-all still apply, against the params
   * that were last run. Only ever `true` or absent: the manifest is untrusted
   * JSON, and a `"true"` string is not the boolean the reference documents.
   * See useWidgetData's `runButton` option.
   */
  runButton?: boolean;
  /**
   * Milliseconds between automatic refreshes. A positive number wins over the
   * `autoRefreshMinutes` setting; anything else (0, a negative number, or the
   * `false` the manifest sometimes sends, which means "never auto-refresh
   * this widget") falls back to the setting. See refreshIntervalMs in
   * src/hooks/useWidgetData.ts.
   */
  refetchInterval?: number | false;
  /**
   * `storage.mcpUrl`: an MCP server Workspace auto-connects when this widget
   * (documented for iframe widgets) is on the dashboard. http(s) only.
   * Offered to Rita only while Context Sharing is on -- see dashboardMcpUrls.
   */
  mcpUrl?: string;
  /** The widget-level default for every param's `exchange`; see WidgetParam.exchange. */
  exchange?: string;
  /**
   * v5.4.0 (spec §1.2 step 3): the fiscal fields declared on the widget,
   * same names and formats as WidgetParam's, consulted for any param whose
   * own fields do not answer. `fiscal_year_start_month` is folded into
   * `fiscalYearEnd` by widgetsJson.ts, as it is on a param.
   */
  fiscalYearEnd?: number;
  fiscalYearEndParam?: string;
  fiscalYearEndEndpoint?: string;
  /**
   * Only on a `type: "settings"` widget: which of the contract's UI modes
   * its section uses. Such a widget is a section of the Settings dialog, not
   * a card -- see serviceSettingsEntries in src/lib/settingsSections.ts.
   */
  settingsUi?: SettingsUi;
};

/**
 * The four fiscal fields, shared shape between WidgetParam and WidgetDef.
 * Declared once here so Task 7 imports it instead of redeclaring it.
 */
export type FiscalFields = Pick<WidgetParam, "fiscalYearEnd" | "fiscalYearEndParam" | "fiscalYearEndEndpoint">;

export type CardLayout = { x: number; y: number; w: number; h: number };

export type CardView = "table" | "chart" | "raw" | "transposed" | "calendar" | "statement";

/**
 * One persisted sort. Structurally identical to TanStack's `ColumnSort`
 * (`{ desc: boolean; id: string }`) on purpose, and spelled out here so no
 * library type reaches the on-disk shape.
 */
export type TableSort = { id: string; desc: boolean };

/**
 * One persisted column filter. `value`'s shape belongs to the filter control
 * that produced it (a string for "contains", `{ min, max }` for a number
 * range, `{ from, to }` for a date range, `"true"`/`"false"` for a boolean),
 * which is why it is `unknown` here: the spec says filters persist by value,
 * and this type does not need to enumerate them.
 */
export type TableFilter = { id: string; value: unknown };

/** Which edge a column sticks to. Structurally what ColumnSpec.pinned holds. */
export type PinSide = "left" | "right";

/** Explicit operators only: no aggregation is inferred from numeric data. */
export const AGG_NAMES = [
  "sum",
  "min",
  "max",
  "mean",
  "median",
  "count",
  "uniqueCount",
  "first",
  "last",
] as const;
export type AggName = (typeof AGG_NAMES)[number];

/** How a date field in a group list is bucketed. `native` is the data's own periodicity. */
export const BUCKETS = ["native", "week", "month", "quarter", "year"] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * A provider's per-column aggregation hint, as openbb-eodhd's dictionary puts
 * it on a `columnsDefs` entry (`aggregation`, via OpenBB's `x-widget_config`
 * merge). `time` is the suggested operator or null; `frequencies` the
 * frequencies it was reviewed at, in the PROVIDER'S tokens (`annual`,
 * `quarter`, `1d`, `1W`, `1M`) -- src/lib/pivotSuggestion.ts maps them to
 * buckets; `entity` is always `require_selection`, because no provider rule
 * combines issuers; `status` is `conditional` (a rule exists, subject to
 * checks), `requires_selection` (reviewed, no rule) or `dimension` (a key,
 * not a measure). A column with no hint at all belongs to a model the
 * dictionary does not cover -- a different thing from `requires_selection`,
 * and kept distinguishable.
 *
 * A hint is never applied by itself: the panel shows it and applies it on one
 * click, Rita reads it and chooses. The dictionary's own `auto_apply` is false.
 */
export const HINT_STATUSES = ["conditional", "requires_selection", "dimension"] as const;
export type AggregationHint = {
  time: AggName | null;
  frequencies: string[];
  entity: "require_selection";
  status: (typeof HINT_STATUSES)[number];
  ruleset: string;
};

/** A Data measure binds a current input column, independently of its provenance. */
export type PivotMeasure = {
  id: string;
  sourceFieldId: string;
  aggregation?: AggName;
  customLabel?: string;
};

/**
 * A table card's pivot. `grouping` and `expanded` are TanStack's GroupingState
 * and ExpandedState by shape; `split`, `buckets` and `enabled` are ours,
 * because TanStack has no column pivot at all.
 *
 * One departure from TanStack's reading of `expanded`: a path ABSENT from the
 * record is open, not folded, so a group that first appears after a refresh is
 * visible. Only an explicit `false` folds.
 *
 * Ordinary source-column order is `TableCardState.columnOrder`. Independent
 * pivot Data instances use the ordered `measures` array when present.
 */
export type PivotConfig = {
  /** Off keeps the arrangement; the table draws its ordinary rows. */
  enabled: boolean;
  /** Row Groups, outermost first. */
  grouping: string[];
  /** Column Groups, outermost header first. */
  split: string[];
  expanded?: true | Record<string, boolean>;
  keyEncoding?: "typed-v1";
  legacyExpanded?: Record<string, boolean>;
  /** Ordered independent Data instances; absence loads legacy field settings. */
  measures?: PivotMeasure[];
  aggregationFns?: Record<string, AggName>;
  buckets?: Record<string, Bucket>;
};

/**
 * A table card's own view of its table: what the user sorted, filtered,
 * reordered, hid, resized and pinned. Absent until the user touches
 * something, and removed again by "Reset table". Carried only by the explicit BDOBB-compatible
 * apps.json extension; ordinary OpenBB export omits it.
 */
export type TableCardState = {
  pivot?: PivotConfig;
  sorting?: TableSort[];
  columnFilters?: TableFilter[];
  columnOrder?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
  /**
   * The user's pin overrides, by field: a side, or `null` for "the user
   * unpinned a column the widget pins". A field absent from the map uses the
   * widget's own ColumnSpec.pinned, and setPinned never writes an entry that
   * agrees with it — so a card whose choices all match the widget leaves no
   * residue here.
   */
  pinned?: Record<string, PinSide | null>;
};

/** The calendar view's grid unit. `continuous` is an endless scroll of weeks. */
export type CalendarUnit = "day" | "week" | "month" | "continuous";
/** How a day cell shows its events: a time-sorted list, or a vertical hour axis. */
export type CalendarCellMode = "list" | "timeline";
/**
 * The calendar's view mode (rework, 2026-09-07). Static draws the widget's own
 * date params and nothing else; Vertical and Horizontal are endless scrolls;
 * Paged is the ‹ Today › Day/Week/Month grid the `unit` above describes. A
 * card written before the rework carries no `mode` at all, so `resolveMode`
 * in calendar.ts reads its `unit` as one of these; `CalendarUnit` keeps
 * `continuous` for exactly those files.
 */
export type CalendarMode = "static" | "vertical" | "horizontal" | "paged";
/** What one row of the Vertical scroll is: a week of columns, or one day. */
export type CalendarRowUnit = "day" | "week";

/**
 * The calendar view's persisted state, one facet per field so a unit change
 * cannot wipe the business-day set (patchCardField merges "calendar" the way
 * it merges "chart"). Every field is optional: a card that has only ever been
 * looked at in the defaults leaves no residue here.
 *
 * `businessDays` are ISO weekday numbers, Monday = 1 through Sunday = 7, in
 * any order; the grid sorts them. `cursor` is a civil date, `YYYY-MM-DD`,
 * never an instant: a day cell is a date, and a date does not move when the
 * machine changes zone. `dateField` / `titleField` override the columns the
 * view detected, for the one payload where detection guesses wrong.
 */
export type CalendarCardState = {
  mode?: CalendarMode;
  rowUnit?: CalendarRowUnit;
  unit?: CalendarUnit;
  businessDays?: number[];
  cellMode?: CalendarCellMode;
  evenRows?: boolean;
  cursor?: string;
  dateField?: string;
  titleField?: string;
  /**
   * The Type of the Type / Series filter: the column the kept values are read
   * from. Absent means the title column, which is what a reader filtering an
   * earnings calendar means by "the names" nine times in ten. A field the
   * payload does not carry falls back to the title column rather than
   * bucketing every row against a missing key.
   */
  seriesField?: string;
  /**
   * The values of `seriesField` kept. Absent or empty is no filter at all,
   * not a filter that matches nothing. Matching is case-insensitive and
   * tolerates an exchange suffix, so `AAPL` keeps EODHD's `AAPL.US`; see
   * `filterSeries` in calendar.ts.
   */
  series?: string[];
  /**
   * The tree filter's two rule lists, each a path of one to three segments
   * over Source → Release → Statistic. The most specific rule that is a
   * prefix of a row's path wins, and with neither list present everything is
   * shown — so a default card carries neither key, and a statistic the
   * provider adds under an included release appears without an edit. Both are
   * arrays of arrays rather than joined strings because event names contain
   * slashes; see `treeAllows` in calendar.ts.
   */
  exclude?: string[][];
  include?: string[][];
};

export type DashboardCard = {
  /** Private source reference only. Bytes and connection credentials never enter the card. */
  managedSource?: ManagedSourceReference;
  linkedSource?: LinkedSource;
  linkedChart?: LinkedChartSettings;
  id: string;
  widgetId: string;
  backendId: string;
  params: Record<string, string>;
  layout: CardLayout;
  /**
   * The user's own title for this card. Absent means "use the widget's name",
   * which is why it is removed rather than set to the widget's name when a
   * rename is undone: the card then follows the widget if the manifest
   * renames it. Carried by BDOBB-compatible apps.json exports;
   * ordinary OpenBB export omits it.
   */
  title?: string;
  view?: CardView;
  /** Collapses the card to just its header bar when true. */
  minimized?: boolean;
  /**
   * Which of this card's params are bound to which group. By param NAME,
   * not storage key: a form field named `symbol` is stored as
   * `<form>.symbol` but binds as `symbol`, exactly as groupedParamNames has
   * always treated it. A name appears at most once — a param is in one
   * group or none. Replaced `groupIds` at v5.1.0; dashboardsFile.ts migrates
   * the old shape on read.
   */
  bindings?: ParamBinding[];
  /**
   * This card's table toolkit state. `dashboardsFile.withDefaults` passes
   * `tabs` — and therefore every card — through by reference, so this field
   * needs no work there to survive a read.
   */
  table?: TableCardState;
  /** Persisted worker model and symbolic selection, independent of rendered blocks. */
  tableDefinition?: import("./tableExecution/types").TableDefinition;
  tableSelection?: import("./tableExecution/types").SelectionSpec;
  /**
   * v5.4.0 (spec §1.5): the card's "FY ends" override, a month 1–12. Set, it
   * wins over the whole fiscal chain for this card only; absent is Automatic.
   * Saved with the card and exported in apps.json as bdobb's own layout-item
   * field (appsJson.ts). Read through parseFyEndMonth, so a malformed value
   * is simply Automatic.
   */
  fiscalYearEnd?: number;
  /**
   * v5.5.1: true when the Parameters popover's "Display on title bar" is
   * unchecked — the chips leave the header and the popover is the only way
   * to edit them. Absent (the default, and every pre-5.5.1 card) shows them.
   * Saved with the card like `minimized`; not exported to apps.json.
   */
  hideTitleParams?: boolean;
  /**
   * v5.5.1 (user ruling 2026-09-30): is the card's Parameters panel docked
   * open? The title bar's ▸/▾ chevron (and the ⋯ menu's Parameters item)
   * toggle it; absent is closed, the default for every card. Saved with the
   * card like `hideTitleParams`; not exported to apps.json.
   */
  paramsOpen?: boolean;
  calendar?: CalendarCardState;
  statement?: { collapsed?: string[] };
  /** Set on a card that came from a dashboard server (workspaceDashboards.ts). Never in apps.json. */
  extensions?: { workspace?: CardWorkspaceState };
};

/**
 * What an upload needs to rebuild a server card BDOBB does not model: the
 * original widget record, its grid entry, and the params as first mapped
 * (only params that differ from these are written back).
 */
export type CardWorkspaceState = {
  widget: Record<string, unknown>;
  layout: Record<string, unknown>;
  params: Record<string, string>;
};

/**
 * A synced dashboard's server shell: its content minus the widgets and grid
 * (rebuilt from the cards), each local tab's gridLayout key, the tab strip
 * widget with its grid entry per tab, and widget records no grid places.
 */
export type DashboardWorkspaceState = {
  content: Record<string, unknown>;
  tabKeys: Record<string, string>;
  nav?: { widget: Record<string, unknown>; layout: Record<string, Record<string, unknown>> };
  orphans: Record<string, unknown>[];
};

/** Which server store a synced dashboard lives in. */
export type SyncStore = "dashboard" | "app";

/** One synced dashboard on one connection (workspaceSync.json). `dismissed`: a shared dashboard deleted here, never downloaded again. */
export type SyncLink = {
  dashboardId: string;
  connectionId: string;
  store: SyncStore;
  uuid: string;
  serverUpdatedDate: string;
  localRevisionAtSync: number;
  shared: boolean;
  dismissed?: boolean;
};

/** A server delete still to send (workspaceSync.json). */
export type Tombstone = { connectionId: string; store: SyncStore; uuid: string };

/**
 * A dashboard's own grid of cards. Added at SP6, as a deliberate deviation
 * from v3.0.0-features.md — see
 * docs/superpowers/specs/2026-08-24-dashboard-tabs-design.md.
 */
export type DashboardTab = {
  id: string;
  name: string;
  cards: DashboardCard[];
};

export type ParamBinding = { groupId: string; paramName: string };

/** Declared at v3; created in-app from v5.1.0. */
export type ParamGroup = {
  id: string;
  name: string;
  /** The name the group was created for, and the name apps.json carries. */
  paramName: string;
  /** Compatibility key, see paramGroupType. Defaults to paramName. */
  groupType: string;
  value: string;
};

/**
 * A saved relative expression, on the dashboard it was saved from: the
 * Relative tab's chips list these after the built-in catalog, filtered to
 * the types whose rows can express them. Both fields are plain strings so
 * the shape persists, exports and imports like every other value.
 */
export type Preset = { name: string; expr: string };

export type Dashboard = {
  id: string;
  name: string;
  tabs: DashboardTab[];
  groups?: ParamGroup[];
  /**
   * The row menu's Disable grouping checkbox. When set, every card on this
   * dashboard uses its own params and no group value is applied — but the
   * groups themselves are kept, not deleted, so untoggling restores them.
   */
  groupsDisabled?: boolean;
  /**
   * The dashboard's saved presets (v5.3.0). Read leniently by
   * dashboardsFile.ts, written by savePreset / deletePreset, exported to
   * apps.json as an extra field Workspace ignores and restored on import.
   */
  presets?: Preset[];
  /**
   * v5.4.0 (spec §5): the dashboard's default exchange, a MIC, chosen from
   * the rail menu. A card's exchange is its param's, then its widget's, then
   * this, then XNYS. Read leniently (dashboardsFile.ts) and carried in
   * apps.json as an extra field, as `presets` is.
   */
  exchange?: string;
  /** Bumped on every save of a user edit; sync compares it with its link (spec: Link records). Absent means 0. */
  revision?: number;
  /** Set on a dashboard that came from a dashboard server. */
  extensions?: { workspace?: DashboardWorkspaceState };
};

export type Settings = {
  /** "system" follows the OS light/dark setting live (see useResolvedTheme). */
  theme: "dark" | "light" | "system";
  fontSize: "medium" | "large";
  defaultTicker?: string;
  matchDashboardSymbol: boolean;
  maxDecimalPlaces: 0 | 1 | 2 | 3 | 4 | 5;
  minimizeButton: boolean;
  collapseWidgetControls: boolean;
  cornerDragHandles: boolean;
  quickAddToolbar: boolean;
  /**
   * The collapsed left rail's width in px, clamped to RAIL_WIDTH_MIN..MAX on
   * load. A plain number rather than an enum: it is a slider, not a set of
   * radios, and every value in the range is meaningful.
   */
  railWidth: number;
  /**
   * The gap between dashboard cards, in px, clamped to WIDGET_GAP_MIN..MAX on
   * load. A plain number rather than an enum, same reasoning as railWidth.
   */
  widgetGap: number;
  /** Minutes between automatic card refreshes. Absent means Off. */
  autoRefreshMinutes?: 1 | 5 | 15 | 30 | 60;
  /**
   * The id of the connection settings are stored on: a Workspace connection
   * (workspace.json) or a data backend that serves the Workspace settings
   * API. Absent means Local. An id naming no connection is Local too --
   * see storageConnection in workspaceStore. It describes this machine, so
   * it is itself never synced and never in the export bundle.
   */
  settingsStorage?: string;
  dashboardOrder?: string[];
  /** Rita's base URL. "" means the agent is off. Set from the AI Library. */
  ritaUrl: string;
  /**
   * How long the Rita rail waits before expanding under the pointer, in ms,
   * clamped to RITA_HOVER_DELAY_MIN..MAX on load. 0 is instant.
   */
  ritaHoverDelayMs: number;
  /** Maximum client tool-execution rounds for each Rita turn (1-40, default 40). */
  ritaMaxFunctionRounds: number;
  /** Send the current dashboard's widgets to Rita as context. Off by default. */
  contextSharing: boolean;
  /**
   * The user's values for each agent's configurable agents.json features,
   * keyed by agent id then feature id. Sent as workspace_options, where a
   * value of the right type wins over the feature's default.
   */
  agentOptions: Record<string, Record<string, boolean | string>>;
  /** Show Rita's suggested follow-up prompts in chat. Client presentation only, not sent in any request. On by default. */
  agentPromptSuggestions: boolean;
  /** MCP servers whose tools are offered to Rita; disabled ones are kept but skipped. */
  mcpServers: McpServerConfig[];
  /**
   * Tools the user turned off, per MCP server, keyed by the server's
   * NORMALIZED URL -- one map for Settings servers and widget-derived ones,
   * which have no Settings entry to hang a field on. A tool not listed is
   * on, so a tool a server adds later arrives enabled.
   */
  mcpDisabledTools: Record<string, string[]>;
  /**
   * The effective tool names (call_tool's `name`, run_pipeline's step tools)
   * this profile has called through each MCP server's proxies, keyed by the
   * NORMALIZED URL like mcpDisabledTools: what the AI Library lists so a
   * proxied tool can be turned off. De-duplicated, sorted, at most 500 a server.
   */
  mcpSeenProxiedTools: Record<string, string[]>;
  /** Destinations for "Send chat to…". */
  shareTargets: ShareTarget[];
  workspaceOrder?: string[];
  numberShortcutTarget: "dashboards" | "workspaces";
};
