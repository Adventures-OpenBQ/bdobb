// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export type AuthLocation = "header" | "query" | "cookie";

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
   * The param's value is source code in this language, which the backend runs
   * (the reference backend's Python Chart omni widget: `language: "python"`,
   * executed with exec()). The backend's server decides whether it runs.
   */
  language?: string;
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
   * declares none is keyed by its own paramName (or `date` for a date
   * control) — see paramGroupType in paramGroups.ts. Only the built-ins
   * declare it today; no OpenBB backend does.
   */
  groupType?: string;
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
 * hoverCardOf there); `colorValueKey` points colorRules at another field of the row (see cellVisual).
 */
export type ColumnSpec = {
  field: string;
  headerName?: string;
  headerTooltip?: string;
  cellDataType?: "text" | "number" | "boolean" | "date" | "dateString" | "object";
  formatterFn?: ColumnFormatterFn;
  decimalPlaces?: number;
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
  /**
   * How a chart built from the rows treats this column: x is the first `time`
   * column, else the first `category` one; y is every `series` column;
   * `excluded` is never plotted. See rowChartAxes in src/lib/chartShapes.ts.
   */
  chartDataType?: "category" | "series" | "time" | "excluded";
};

/**
 * A widget's `data.table`. `showAll` and `enableAdvanced` are in the
 * reference and are deliberately not parsed — nothing reads them.
 */
export type TableSpec = {
  columns: ColumnSpec[];
  /** The default applied to any column that names no formatterFn of its own. */
  formatterFn?: ColumnFormatterFn;
};

/**
 * The candle and volume colours an `advanced_charting` widget's
 * `data.chartConfig` may declare. Each key is optional, and an absent key means
 * lightweight-charts' own default (see src/lib/lwChart.ts).
 */
export type CandleColors = Partial<
  Record<
    | "upColor"
    | "downColor"
    | "borderUpColor"
    | "borderDownColor"
    | "wickUpColor"
    | "wickDownColor"
    | "volumeUpColor"
    | "volumeDownColor",
    string
  >
>;

/** An `advanced_charting` widget's `data` block, normalised. See toUdfChart in widgetsJson.ts. */
export type UdfChartSpec = {
  defaultSymbol: string;
  /** Milliseconds between refetches; at least 5000. */
  updateFrequency: number;
  colors: CandleColors;
  showVolume: boolean;
};

export type WidgetDef = {
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
   * `data.table.chartView`. `enabled: true` opens a NEW card in chart view
   * (addCardTo); `chartType` picks the trace of a chart built from rows (see
   * rowFigure in src/lib/chartShapes.ts). Absent when it declares neither.
   */
  chartView?: { enabled?: true; chartType?: string };
  /**
   * Only on a `type: "advanced_charting"` widget: what its TradingView card
   * charts and how. Its renderer issues its own UDF request (see
   * src/lib/udf.ts), so nothing here goes through the generic fetch.
   */
  udfChart?: UdfChartSpec;
  /** Provider name(s). Consumed by the library badges in SP5. */
  source: string[];
  /** An http(s) image the Widget Library previews on hover or focus. Any other scheme is dropped. */
  imgUrl?: string;
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
   * `exportable: false` hides the card's Export ▸ (CSV, JSON, Excel). Only
   * ever `false` or absent: any other value keeps export available.
   */
  exportable?: false;
  /**
   * `raw: true` on an html or youtube widget: its Raw view re-asks the
   * endpoint with `raw=true` for the data behind the rendering (see
   * RawRequestView). Only ever `true` or absent.
   */
  raw?: true;
  /**
   * Milliseconds between automatic refreshes. A positive number wins over the
   * `autoRefreshMinutes` setting; anything else (0, a negative number, or the
   * `false` the manifest sometimes sends, which means "never auto-refresh
   * this widget") falls back to the setting. See refreshIntervalMs in
   * src/hooks/useWidgetData.ts.
   */
  refetchInterval?: number | false;
  /**
   * Only on a `type: "settings"` widget: which of the contract's UI modes
   * its section uses. Such a widget is a section of the Settings dialog, not
   * a card -- see serviceSettingsEntries in src/lib/settingsSections.ts.
   */
  settingsUi?: SettingsUi;
};

export type CardLayout = { x: number; y: number; w: number; h: number };

export type CardView = "table" | "chart" | "raw" | "transposed";

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

/**
 * A table card's own view of its table: what the user sorted, filtered,
 * reordered, hid, resized and pinned. Absent until the user touches
 * something, and removed again by "Reset table". Carried only by the explicit BDOBB-compatible
 * apps.json extension; ordinary OpenBB export omits it.
 */
export type TableCardState = {
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

export type DashboardCard = {
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
  /** Bumped on every save of a user edit; sync compares it with its link (spec: Link records). Absent means 0. */
  revision?: number;
  /** Set on a dashboard that came from a dashboard server. */
  extensions?: { workspace?: DashboardWorkspaceState };
};

export type Settings = {
  theme: "dark" | "light";
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
};
