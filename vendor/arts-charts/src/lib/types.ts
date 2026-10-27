// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

export type Granularity = "year" | "month" | "day" | "hour" | "minute" | "second";

export type ParamOption = { label: string; value: string };

export type FormInput = {
  paramName: string;
  type: "text" | "number" | "date" | "dropdown" | "button";
  label?: string;
  value?: string;
  description?: string;
  multiSelect?: boolean;
  options?: ParamOption[];
};

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
  /**
   * The five period fields of v5.2.0, each meaningful on the type it names
   * and parsed leniently by widgetsJson.ts regardless of type — a field of
   * the wrong shape is dropped, never coerced, exactly like every field here.
   */
  /** `datetime`: how far the picker's field goes. The wire is always to the second. */
  granularity?: Granularity;
  /**
   * `datetime`: the instant goes on the wire as naive UTC, `YYYY-MM-DD
   * HH:MM:SS` with no offset, for a backend whose time grammar admits none --
   * the Delta store, which stores-explorer declares it on for the explorer's
   * start/end. Absent means zoned ISO to the second. Not an OpenBB field.
   */
  naive?: boolean;
  /**
   * `date_range`: the SECOND query param the composite `start/end` value is
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

export type ParamBinding = { groupId: string; paramName: string };

export type ParamGroup = {
  id: string;
  name: string;
  /** The name the group was created for, and the name apps.json carries. */
  paramName: string;
  /** Compatibility key, see paramGroupType. Defaults to paramName. */
  groupType: string;
  value: string;
};

export type SeriesType = "candlestick" | "ohlc" | "line" | "area" | "volume" | "performance" | "study";

export type Series = {
  id: string;
  type: SeriesType;
  name?: string;
  params: Record<string, number | string>;
  anchor?: string;
  symbol?: string;
  panel: number;
  side: "left" | "right";
  color: string;
  /**
   * Carried over from a pre-12.3.1 study instance and IGNORED everywhere: a
   * chart has one source, its own `source` parameter. It survives here only
   * so a card migrated off `studies` still compares equal to a saved preset
   * bundle that was written with one (T6 review, finding 9).
   */
  source?: "local" | "eodhd";
  /**
   * `pen` (custom studies): one of the five line styles in lib/chart/pen.ts,
   * overriding the registry's per-output default for every line of the
   * series; `fillPattern` is the banded study's hatch, likewise overriding
   * the registry's. Absent means the registry's own, which is why neither is
   * written unless the picker was moved off "Default".
   *
   * `axisValue` (user, 2026-09-27) puts this series' value on its panel's
   * price axis, in the series' OWN colour -- one label per output line, so a
   * banded study contributes three. It is chosen per study in the picker's
   * config pane, which is what "defined in the study setup" asked for, and it
   * is independent of the parameters row's "Display study values": that one
   * governs the crosshair READOUT above the plot, this one the axis.
   *
   * Absent reads as TRUE -- the label is SHOWN unless a study says otherwise
   * (user, 2026-09-27: "keep the crosshair values gray, but color the last
   * tick values"). So this is the one style field written when it is OFF
   * rather than when it is on: the default is the interesting state, and a
   * card saved before this existed should get the coloured labels, not be
   * grandfathered out of them.
   */
  /**
   * `outputs` (spec 2026-09-27) names which of a STUDY's output lines to
   * draw -- `["bb_mid"]` on a `bbands` keeps the level and drops the bands.
   * Absent draws them all, and an empty list is read as absent, so nothing
   * can compute a study and then draw none of it.
   */
  style?: { width?: number; shade?: string; fillOpacity?: number; fill?: boolean; pen?: string; fillPattern?: string; axisValue?: boolean; outputs?: string[] };
  expr: string;
};

export type StudyInstance = {
  expr: string;
  name: string;
  params: Record<string, number | string>;
  color: string;
  /**
   * v12.3.1 (user ruling 2026-09-17): a chart has ONE source of truth -- the
   * card's own `source` parameter -- so this is no longer chosen per study.
   * The field stays for saved cards and presets written before the ruling
   * and is IGNORED everywhere: nothing reads it for the wire.
   */
  source?: "local" | "eodhd";
  /**
   * `shade` (v12.3.1) is the translucent fill between a BANDED study's
   * `*_up` and `*_lo` outputs, a `#RRGGBB` drawn at `fillOpacity`; it is a
   * separate colour from `color`, which is the study's main line.
   */
  style?: { width?: number; fill?: boolean; fillOpacity?: number; shade?: string; pen?: string; fillPattern?: string };
};

export type ChartPoint = { time: number; value: number };

export type GannSlopes = [number, number, number];

export type ChartDrawing =
  | { kind: "segment"; a: ChartPoint; b: ChartPoint }
  | { kind: "ray"; a: ChartPoint; slope: number }
  | { kind: "fib"; a: ChartPoint; b: ChartPoint }
  | { kind: "gann"; a: ChartPoint; slopes: GannSlopes };

export type ChartLevel = { price: number; origin?: "rita" | "eodhd" };

export type ChartAddition =
  | { facet: "anchors"; item: string }
  | { facet: "levels"; item: ChartLevel }
  | { facet: "drawings"; item: ChartDrawing };

export type ChartCardState = {
  /** ISO 8601 anchor times; each is one AVWAP series. */
  anchors?: string[];
  levels?: ChartLevel[];
  drawings?: ChartDrawing[];
  /**
   * What the user added, oldest first: undo's stack. Saved with the card, so
   * undo survives a relaunch or a tab switch. Capped in the renderer.
   */
  added?: ChartAddition[];
  /** The interval button the user last chose; falls back to the card param. */
  interval?: string;
  /** ADJ: the indicators' price basis. It does NOT adjust the candles. */
  adjusted?: boolean;
  /**
   * The two legend blocks above the plot, each hidden when its flag is FALSE
   * (user, 2026-09-27). Absent means shown, so every card saved before this
   * existed keeps the legend it had and nothing needs migrating.
   *
   * `studyValues` is the crosshair readout line -- "BBANDS(20, 2.0) 1.14 /
   * 1.14 / 1.15" -- which is the row that changes as the pointer moves.
   * `seriesPills` is the chip strip under it, one chip per series. Card
   * state, not a setting, and saved with the card the way `adjusted` and
   * `railHidden` are: a chart kept for reading wants a different amount of
   * chrome from one kept for editing, and that is a property of the card.
   */
  studyValues?: boolean;
  seriesPills?: boolean;
  /**
   * Whether the PNG export carries the card's header -- symbol, name, last
   * price and change -- in a band above the panels (owner, 2026-09-27: "we
   * need an option to include the chart header in the screenshot"). Absent
   * reads as TRUE: a chart shared without saying what it is of is the less
   * useful default, and the band costs 58px of a 4x image.
   */
  snapshotHeader?: boolean;
  /**
   * Relative pane weights by pane id (v12.3.0): `price` and `volume` for the
   * chart's own two, `study:<pane id>` for each own-pane study -- namespaced
   * because the backend registers an indicator literally named `volume`
   * with pane="own", which would otherwise share this record's "volume"
   * key with the chart's own volume pane. Absent means the defaults (price
   * 3, volume 1, a study pane 1). Weights, not pixels, so a card renders
   * correctly at any dashboard-cell size.
   *
   * DEPRECATED (v12.4.0): superseded by the card's `panels` parameter,
   * which lays panels out in percentages instead of weights. Kept optional
   * for cards saved by v12.3.x, and read by the renderer until it switches
   * over.
   */
  panes?: Record<string, number>;
  /**
   * The view's range as two expressions (v12.3.0), resolved at every apply
   * and every chart open with the v5 grammar: `{ from: "now-1d", to: "now" }`
   * is the 1D chip, an ISO date is a literal. Absent means the fitted view.
   * A range is a ZOOM: it never touches the interval or the studies' window.
   */
  range?: { from: string; to: string };
  /**
   * Redo's stack: what undo took off `added`, newest last. Any new addition
   * empties it, as on every platform. Saved with the card like `added`.
   */
  redo?: ChartAddition[];
  /**
   * The studies on this card (v12.3.0, studies addendum §5.1), in strip
   * order -- which drives z-order for overlays and pane stacking for
   * own-pane studies. Absent means the card still draws its `indicators`
   * and `macro` parameters as before; present, it is the source of truth
   * and the socket's `indicators` string is derived from it.
   *
   * DEPRECATED (v12.4.0): superseded by `series`, which places every study
   * in a panel on a side. Kept optional so a card saved by v12.3.x still
   * reads; `migrateChart` turns it into `series`, and the renderer keeps
   * reading it until it switches over.
   */
  studies?: StudyInstance[];
  /**
   * Everything the card draws (v12.4.0): the price drawing, the volume,
   * performance lines and the studies, each in a panel. Present means it
   * is the source of truth and `studies`/`panes` above are dead data;
   * absent means the card predates the panels work and `migrateChart`
   * derives this list (and the widened `panels` text) from them.
   */
  series?: Series[];
  /**
   * The session filter (v12.3.0 slice 4, session addendum §4.4): `regular`
   * veils the extended-hours bars and has the study socket compute every
   * study on the regular session only. Absent means `extended`. A card
   * facet like `range`, patched on its own and never on the undo stack;
   * it applies only while the interval is intraday and the symbol has an
   * exchange, and is otherwise carried along untouched. So the `{ }` spec
   * (which writes this stored facet) and the status bar (which reads the
   * filter IN FORCE) disagree by design on a daily or crypto card: the spec
   * says what the card chose, the bar says what the chart is doing.
   */
  session?: "extended" | "regular" | "24hr";
  /**
   * Whether this card's drawing rail (the left toolbar) is hidden (spec
   * 2026-09-24, D8). Absent on every card saved before this version, which
   * reads as SHOWN. Written by the Left toolbar switch through the chart's own
   * patch path. Hiding it unmounts the rail element only -- the tool, the
   * magnet and every drawing live in the renderer and are untouched -- and
   * PanelHost's existing resize observer reflows the charts into the reclaimed
   * width with no new plumbing.
   */
  railHidden?: boolean;
};

/**
 * The backend a card talks to -- only what chart code reads. The host's own
 * BackendConfig satisfies it; fetchWidgetPath/buildWidgetWsUrl receive it back.
 */
export type BackendConfig = {
  id: string;
  name: string;
  baseUrl: string;
  /** A kdb tick-cache socket. Absent: bars come over /series (see ArtsChartsRenderer). */
  tickUrl?: string;
  headerName?: string;
  headerValue?: string;
  authLocation?: string;
};

/** The widget manifest entry -- only what chart code reads. */
export type WidgetDef = {
  id: string;
  wsEndpoint?: string;
  exchange?: string;
  params: WidgetParam[];
};

/** A dashboard card -- only what chart code reads. */
export type DashboardCard = {
  id: string;
  params: Record<string, string>;
  bindings?: ParamBinding[];
  chart?: ChartCardState;
};
