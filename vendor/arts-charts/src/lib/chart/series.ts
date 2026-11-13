// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The series model (v12.4.0, spec: panels and series): a card draws a LIST
 * of series -- the price drawing, the volume, performance lines and every
 * study -- each placed in a panel on a side of that panel's y-axis, instead
 * of the implicit candles-plus-volume and the separate `studies` list of
 * v12.3.x. This module is the pure part of that: the label a series shows,
 * the `Performance(...)` notation, the one-time migration off
 * `studies`/`panes`, and the socket's `indicators` string derived from the
 * study series. Nothing here touches lightweight-charts or React.
 */
import type { ChartCardState, Series, SeriesType, StudyInstance } from "../types";
import { indicatorsParam, type AnchorResolver } from "./indicatorsParam";
import { DEFAULT_PANELS_TEXT, encodePanels, parsePanels, type PanelDef } from "./panels";
import { expressionLabel, instanceFromParse, parseStudyExpression, type CatalogEntry, type ParseOptions } from "./studyExpression";
import { isFillPattern, isPen } from "./pen";

/**
 * The colour of a series the THEME colours: candlesticks, OHLC bars and the
 * volume read their up/down colours off the chart theme, so the card has
 * none of its own to save. Empty rather than a literal -- no chart file
 * names a colour (createChartTheme.test.ts greps for exactly that).
 */
const THEME_COLOR = "";

/** A performance series' stand-in for the card's own symbol. */
export const PERFORMANCE_SELF = "$ymbol";

/** A `$group:<Name>` reference, in a symbol position or a date one. */
export const GROUP_PREFIX = "$group:";

/** A card's symbol list holds one primary plus the four extra-bars slots (spec 2026-11-13 §1). */
export const MAX_LIST = 5;

/** A position in the card's symbol list, 1-based. */
const LIST_REF = /^list:([1-9]\d{0,5})$/;

/**
 * What a series' `symbol` may hold (spec 2026-11-13 §1): `$ymbol`, `$group:<Name>`, `list:<n>`,
 * or a ticker -- up to 64 characters with no comma, not starting `$` or `list:`. The same rule
 * as the server's chart_body.SYMBOL_REF, so a card never saves what the server refuses.
 */
export const SYMBOL_REF = /^(?:\$ymbol|\$group:.{1,64}|list:[1-9]\d{0,5}|(?![Ll][Ii][Ss][Tt]:)[^$,][^,]{0,63})$/;

/**
 * Whether a series of `type` may carry `symbol`. A bar series takes a SYMBOL_REF; a performance
 * line keeps its pre-list rule -- any 1-64 characters -- so one saved before lists (`$NOPE`,
 * `LIST:2`, a comma) still re-saves and imports. The server's chart_body makes the same split.
 */
export const symbolAllowed = (type: SeriesType, symbol: string): boolean =>
  type === "performance" ? symbol.length >= 1 && symbol.length <= 64 : SYMBOL_REF.test(symbol);

/**
 * The card's `symbol` parameter as its list: split on commas only, each entry trimmed and
 * upper-cased, empties dropped, duplicates kept in place so `list:2` always means position 2.
 * Entries past the fifth are dropped and `truncated` says so.
 */
export function parseSymbolList(text: string): { list: string[]; truncated: boolean } {
  const all = text.split(",").map((t) => t.trim().toUpperCase()).filter((t) => t !== "");
  return { list: all.slice(0, MAX_LIST), truncated: all.length > MAX_LIST };
}

/**
 * The ticker a series draws, or why it draws nothing (spec 2026-11-13 §2): absent, `$ymbol` and
 * `list:1` are the list's first entry; `list:n` its n-th; `$group:<Name>` that symbol group's
 * value (its first entry when the group holds a list); anything else a literal, upper-cased.
 */
export function seriesTicker(
  s: { type: SeriesType; symbol?: string },
  list: readonly string[],
  groups: readonly { name: string; paramName: string; value: string }[],
): { ticker: string } | { note: string } {
  const named = s.symbol ?? PERFORMANCE_SELF;
  if (named === PERFORMANCE_SELF || named === "list:1") return { ticker: list[0] ?? "" };
  const at = LIST_REF.exec(named);
  if (at !== null) {
    const n = Number(at[1]);
    if (n <= list.length) return { ticker: list[n - 1] };
    return { note: `list has ${list.length} ${list.length === 1 ? "entry" : "entries"}, no ${named}` };
  }
  if (named.startsWith(GROUP_PREFIX)) {
    const name = named.slice(GROUP_PREFIX.length);
    const group = groups.find((g) => g.name === name);
    if (group === undefined) return { note: `no group "${name}"` };
    // A group is a group OF a parameter; one bound to `interval` or `as_of` is not a symbol.
    if (group.paramName !== "symbol") return { note: `"${name}" is not a symbol group` };
    return { ticker: parseSymbolList(group.value).list[0] ?? "" };
  }
  return { ticker: named.toUpperCase() };
}

/**
 * A typed performance ticker as the card stores it: upper-cased, because
 * the tick plane's symbols are kdb symbols and an iPad capitalises only the
 * first letter it is handed -- the same reason the card's own symbol is
 * upper-cased (the branch-end round, finding 3). `$ymbol` and a `$group:`
 * reference are names, not tickers, and are left exactly as written.
 * A `list:<n>` position is lower-cased, so `LIST:2` typed on an iPad is still a position.
 */
export function performanceSymbol(text: string): string {
  const value = text.trim();
  if (value === "" || value === PERFORMANCE_SELF) return PERFORMANCE_SELF;
  if (/^list:/i.test(value)) return value.toLowerCase();
  return value.startsWith(GROUP_PREFIX) ? value : value.toUpperCase();
}

/** Percentages print into the `panels` text, so two decimals is the floor. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

let counter = 0;

/**
 * A series' identity, stable for the life of the card. `crypto.randomUUID`
 * as everywhere else in the app (the stores, appsJson); the counter is for
 * an insecure context or a test environment without it, where two ids only
 * have to differ from each other.
 */
export function seriesId(): string {
  const uuid = globalThis.crypto?.randomUUID;
  return typeof uuid === "function" ? globalThis.crypto.randomUUID() : `s${(counter += 1)}`;
}

/**
 * What each fixed series type is called -- the legend's label, the palette's
 * row name and, for these types, the series' own `expr`. Exported because
 * the palette lists them as rows and has to name them the same way the
 * label below does; `performance` and `study` are absent because neither
 * has a fixed name (both print their arguments).
 */
export const SERIES_TYPE_LABELS: Record<Exclude<SeriesType, "performance" | "study">, string> = {
  candlestick: "Candlestick", ohlc: "OHLC", line: "Line", area: "Area", volume: "Volume",
};

/**
 * What the legend and the series list call this series. A study's is its
 * expression without the colour (expressionLabel, unchanged); a
 * performance line's is its own notation, printing `$ymbol` when it tracks
 * the card's symbol; everything else has a fixed name.
 *
 * A performance series ALWAYS names both arguments -- never the
 * one-argument `Performance(<anchor>)` shorthand, which `parsePerformance`
 * reads as the anchor against the card's own symbol, not as a bare symbol.
 * Emitting that form here would print a symbol and read back an anchor:
 * the two ends of the notation would stop round-tripping.
 */
export function seriesLabel(s: Series): string {
  if (s.type === "study") return expressionLabel({ expr: s.expr, name: s.name ?? "", params: s.params, color: s.color });
  if (s.type === "performance") return `Performance(${s.symbol ?? PERFORMANCE_SELF}, ${s.anchor ?? ""})`;
  // A bar series on the card's own symbol keeps its bare name, so every existing expression
  // round-trips; one on another prints it: `Candlestick(list:2)` (spec 2026-11-13 §3).
  const own = s.symbol === undefined || s.symbol === PERFORMANCE_SELF || s.symbol === "list:1";
  return own ? SERIES_TYPE_LABELS[s.type] : `${SERIES_TYPE_LABELS[s.type]}(${s.symbol})`;
}

/**
 * `Performance(<symbol>, <anchor>)` read back: the symbol is a ticker,
 * `$ymbol` (the card's own) or `$group:<Name>`, and a ONE-argument
 * `Performance(T-3m)` is the anchor alone against the card's symbol --
 * the common case is not made to spell `$ymbol` out. Neither argument is
 * interpreted here: the anchor is a date expression the caller resolves,
 * and the symbol is whatever the widget can name.
 */
const PERFORMANCE = /^\s*Performance\s*\(\s*([^(),]*?)\s*(?:,\s*([^(),]*?)\s*)?\)\s*$/i;

export function parsePerformance(text: string): { symbol: string; anchor: string } | null {
  const match = PERFORMANCE.exec(text);
  if (match === null) return null;
  const [, first, second] = match;
  if (second === undefined) return first === "" ? null : { symbol: PERFORMANCE_SELF, anchor: first };
  if (second === "") return null;
  return { symbol: first === "" ? PERFORMANCE_SELF : first, anchor: second };
}

/** `Candlestick`, `Volume(MSFT)`, `OHLC(list:2)`: a bar series' notation read back (spec 2026-11-13 §3). */
const BAR_SERIES = /^\s*(candlestick|ohlc|line|area|volume)\s*(?:\(\s*([^(),]+?)\s*\))?\s*$/i;

export function parseBarSeries(text: string): { type: keyof typeof SERIES_TYPE_LABELS; symbol?: string } | null {
  const match = BAR_SERIES.exec(text);
  if (match === null) return null;
  const type = match[1].toLowerCase() as keyof typeof SERIES_TYPE_LABELS;
  return match[2] === undefined ? { type } : { type, symbol: match[2] };
}

/**
 * One study instance as a series, in the panel and on the side the caller
 * places it. `id` is minted unless the caller has one to keep -- the
 * palette's edit rebuilds the whole series and must not hand it a new
 * identity, and one builder for a study series beats two that drift apart
 * (T7 review, finding 5).
 */
export function seriesFromStudy(
  instance: StudyInstance, panel: number, side: "left" | "right", id: string = seriesId(),
): Series {
  return {
    id, type: "study", name: instance.name, params: instance.params,
    panel, side, color: instance.color,
    // `source` is dead weight on the wire (the chart has one source) but it
    // is part of a saved bundle's identity, so it survives the migration --
    // otherwise a pre-12.4.0 preset could never match again (T6, finding 9).
    // Neither key is written when there is nothing to write: an absent style
    // and a `style: undefined` read the same off a card's saved JSON, but not
    // to a test -- or to anything else counting the keys a series carries.
    ...(instance.source === undefined ? {} : { source: instance.source }),
    ...(instance.style === undefined ? {} : { style: instance.style }),
    expr: instance.expr,
  };
}

/**
 * The volume panel split into itself plus one panel per own-pane study:
 * the last panel's height (30 by default) divided evenly, stacked from
 * where it started. Only the volume panel keeps the original row's extras
 * (`xs`, `ymin`, ...) -- an appended study panel borrowing the volume
 * panel's y-scale would be nonsense.
 * Exported for the layout editor's Add panel, which splits the last panel in two (spec 2026-09-24, D4).
 */
export function widen(panels: PanelDef[], appended: number): PanelDef[] {
  const last = panels[panels.length - 1];
  if (appended === 0 || last === undefined) return panels;
  const parts = appended + 1;
  const edge = (i: number): number => round2(last.top + (last.height * i) / parts);
  const rows: PanelDef[] = [{ ...last, top: edge(0), height: round2(edge(1) - edge(0)) }];
  for (let i = 1; i < parts; i += 1) {
    rows.push({
      top: edge(i), left: last.left, width: last.width, height: round2(edge(i + 1) - edge(i)),
      xmargin: last.xmargin, ymargin: last.ymargin,
    });
  }
  return [...panels.slice(0, -1), ...rows];
}

/**
 * A card read as series, migrating it off `studies`/`panes` the first time
 * (spec, Migration): the implicit candles become an explicit candlestick
 * series in panel 1 and the implicit volume a volume series in the last
 * panel of the card's `panels` text, then each study in strip order --
 * overlays onto panel 1, own-pane studies onto a panel appended below the
 * volume, which is why the widened `panels` text comes back too.
 *
 * A card that already has `series` is returned untouched with
 * `migrated: false`. `migrated: true` is the renderer's cue to WRITE the
 * derived list (and the panels text, through `onParam`) on the user's next
 * change -- never on load, which would rewrite every saved card just by
 * opening a dashboard.
 *
 * A study whose name the registry no longer serves lands on the price
 * panel: `lookup` answers undefined for it, and an overlay on panel 1 is
 * the reading that loses nothing (an empty panel of its own would).
 */
export function migrateChart(
  state: ChartCardState,
  panelsText: string | undefined,
  lookup: (name: string) => CatalogEntry | undefined,
): { series: Series[]; panelsText: string; migrated: boolean } {
  const text = panelsText ?? DEFAULT_PANELS_TEXT;
  if (state.series !== undefined) return { series: state.series, panelsText: text, migrated: false };

  const studies = state.studies ?? [];
  const ownPane = (study: StudyInstance): boolean => lookup(study.name)?.pane === "own";
  const { panels } = parsePanels(text);
  const volumePanel = Math.max(panels.length, 1);
  const appended = studies.filter(ownPane).length;

  const series: Series[] = [
    { id: seriesId(), type: "candlestick", params: {}, panel: 1, side: "right", color: THEME_COLOR, expr: "Candlestick" },
    { id: seriesId(), type: "volume", params: {}, panel: volumePanel, side: "right", color: THEME_COLOR, expr: "Volume" },
  ];
  let next = volumePanel;
  for (const study of studies) {
    if (ownPane(study)) next += 1;
    series.push(seriesFromStudy(study, ownPane(study) ? next : 1, "right"));
  }

  // Re-encode only when a panel was actually appended: `widen` is a no-op
  // at `appended === 0`, but parsePanels/encodePanels is not -- it drops a
  // malformed row and reorders extras into canonical order, so running the
  // text through it when nothing changed would repair (silently, and with
  // `migrated: true` so it gets WRITTEN back) a row the user never touched.
  return { series, panelsText: appended === 0 ? text : encodePanels(widen(panels, appended)), migrated: true };
}

/** The pane a macro overlays on the price panel; every other pane gets one of its own. */
const OVERLAY_PANE = "price";

/**
 * One served pane, as the macro conversion reads it: its weight, the requests
 * its outputs name, and each output's `render` dict.
 *
 * `render` was missing until 2026-09-27, and its absence was the gap: a macro
 * carries per-series `style` (colour, width, pen, the band's hatch), live-grid
 * merges it over the registry's defaults into EVERY output's render, and the
 * conversion then dropped the lot -- so applying a macro to a card kept its
 * studies and lost everything the macro said about how they look.
 */
export type MacroPane = {
  id: string;
  height: number;
  series: readonly {
    req?: { name: string; params: Record<string, unknown> };
    render?: Record<string, unknown>;
  }[];
};

/**
 * A macro line's `render` as a card series' `style`.
 *
 * Read leniently: `render` is an opaque dict off the socket, so a value of the
 * wrong shape is no instruction rather than a bad style. Only what a card
 * series can actually carry is taken, and nothing is written when the macro
 * said nothing -- an untouched study keeps the registry's own look, which is
 * what an absent `style` means everywhere else.
 */
function macroStyle(render: Record<string, unknown> | undefined): Series["style"] | undefined {
  if (render === undefined) return undefined;
  const width = render.width;
  const shade = render.shade;
  const outputs = Array.isArray(render.outputs)
    ? render.outputs.filter((o): o is string => typeof o === "string")
    : [];
  const style = {
    ...(typeof width === "number" && Number.isInteger(width) && width >= 1 && width <= 4 ? { width } : {}),
    ...(isPen(render.pen) ? { pen: render.pen } : {}),
    ...(isFillPattern(render.fillPattern) ? { fillPattern: render.fillPattern } : {}),
    ...(typeof shade === "string" ? { shade } : {}),
    ...(typeof render.fillOpacity === "number" ? { fillOpacity: render.fillOpacity } : {}),
    ...(outputs.length === 0 ? {} : { outputs }),
  };
  return Object.keys(style).length === 0 ? undefined : style;
}

/** A request's params as an instance takes them; anything not a number or a string is not a param. */
function studyParams(params: Record<string, unknown>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number" || typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * A macro's served panes as the card's OWN series and panels (user ruling
 * 2026-09-24, "macros should contain series and panels").
 *
 * A macro is a saved pane layout the SERVER expands, so its lines arrive
 * claimed by nothing on the card: they drew on panel 1 in the server's
 * colours and wore no chip, which is what the report "no studies pills when
 * you apply a macro" describes. Converting them the moment the first frame
 * carries its requests gives every line a chip that can be recoloured,
 * moved, edited and removed like any other -- and the caller then clears the
 * `macro` parameter, because the server COMBINES a macro with the card's
 * `indicators` (live-grid's `assign(macro, parse_indicators(...))`) and
 * would otherwise serve both.
 *
 * The macro owns the whole card: the series it returns are a candlestick
 * plus the macro's own studies, replacing whatever the card held. Panel 1 is
 * the `price` pane's overlay; every other pane is a panel of its own, in the
 * order the frame lists them, and the panels are sized by the macro's OWN
 * pane weights (`height`) rather than an even split, which is the layout its
 * author wrote. Margins come from the card's current panel 1, so a card that
 * has tuned its axes keeps them.
 *
 * A request the catalog does not know is skipped: without an entry there is
 * no expression to name it by, and a chip with no expression could never be
 * edited or re-asked for. `volume` is the one request that becomes a series
 * of the card's own `volume` TYPE rather than a study -- the backend
 * registers an indicator by that name, but the card draws volume from its
 * bars as a histogram, which is what a macro naming it means.
 *
 * `null` when no request converted at all: the caller is watching a live
 * socket, and a frame that arrives before the requests do must not blank the
 * card.
 */
export function seriesFromMacro(
  panes: readonly MacroPane[],
  panelsText: string,
  lookup: (name: string) => CatalogEntry | undefined,
  fallbackColor: string,
): { series: Series[]; panelsText: string } | null {
  const overlay = panes.find((pane) => pane.id === OVERLAY_PANE);
  const lower = panes.filter((pane) => pane !== overlay);
  // Panel 1 is the price panel whether or not the macro named a `price`
  // pane; a macro that names none gets it at the weight of one lower pane.
  const ordered = [{ pane: overlay, panel: 1 }, ...lower.map((pane, i) => ({ pane, panel: i + 2 }))];

  const series: Series[] = [
    { id: seriesId(), type: "candlestick", params: {}, panel: 1, side: "right", color: THEME_COLOR, expr: "Candlestick" },
  ];
  let converted = false;
  for (const { pane, panel } of ordered) {
    // One study is one or more outputs (bbands is three lines) and every
    // output repeats the request that asked for it, so the same request is
    // taken once per pane.
    const seen = new Set<string>();
    for (const line of pane?.series ?? []) {
      const req = line.req;
      if (req === undefined) continue;
      if (req.name.toLowerCase() === "volume") {
        if (seen.has("volume")) continue;
        seen.add("volume");
        converted = true;
        series.push({ id: seriesId(), type: "volume", params: {}, panel, side: "right", color: THEME_COLOR, expr: "Volume" });
        continue;
      }
      const entry = lookup(req.name);
      if (entry === undefined) continue;
      // The macro's own COLOUR for this study, when it named one: every output
      // of the study carries the same merged `render`, so the first line the
      // conversion meets speaks for the instance. Without it a macro's recolour
      // survived on the server's lines and vanished the moment it was applied.
      const colour = typeof line.render?.color === "string" ? line.render.color : null;
      const instance = instanceFromParse({ name: entry.name, params: studyParams(req.params), color: colour }, entry, fallbackColor);
      if (seen.has(instance.expr)) continue;
      seen.add(instance.expr);
      converted = true;
      series.push(seriesFromStudy({ ...instance, style: macroStyle(line.render) }, panel, "right"));
    }
  }
  if (!converted) return null;

  const base = parsePanels(panelsText).panels[0];
  const weights = ordered.map(({ pane }) => (pane !== undefined && pane.height > 0 ? pane.height : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let top = 0;
  const panels: PanelDef[] = weights.map((weight, i) => {
    // The last panel takes the remainder rather than its own share, so the
    // rounding cannot leave a sliver of the card undrawn.
    const height = i === weights.length - 1 ? round2(100 - top) : round2((weight * 100) / total);
    const def: PanelDef = {
      top: round2(top), left: 0, width: 100, height,
      xmargin: base?.xmargin ?? 24, ymargin: base?.ymargin ?? 64,
    };
    top = round2(top + height);
    return def;
  });
  return { series, panelsText: encodePanels(panels) };
}

/** A symbol that leaves a study's expression bare: it is the card's own ticker (plan R2). */
const onListOne = (symbol: string | undefined) => symbol === undefined || symbol === PERFORMANCE_SELF || symbol === "list:1";

/**
 * A study's expression with its leading symbol (spec 2026-11-13 §1, S5): `SMA(list:2, 50)`.
 * Bare on list:1, so every expression saved before this round-trips byte for byte. The
 * symbol is in the expr because the card keys a series by it (plan R2).
 */
export function studyExpr(expr: string, symbol: string | undefined): string {
  if (onListOne(symbol)) return expr;
  const at = expr.indexOf("(") + 1;
  return `${expr.slice(0, at)}${symbol}${expr[at] === ")" ? "" : ", "}${expr.slice(at)}`;
}

/** `studyExpr` undone: the expression a study would have on list:1. */
export function bareStudyExpr(expr: string, symbol: string | undefined): string {
  if (onListOne(symbol)) return expr;
  const at = expr.indexOf("(") + 1;
  const rest = expr.slice(at);
  if (rest.startsWith(`${symbol}, `)) return expr.slice(0, at) + rest.slice((symbol as string).length + 2);
  if (rest.startsWith(`${symbol})`)) return expr.slice(0, at) + rest.slice((symbol as string).length);
  return expr;
}

/** A number, a `bd` window, an ISO date, OBS-n or an intraday anchor: never a symbol (plan R1). */
const NOT_A_SYMBOL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:bd)?$|^\d{4}-\d{2}-\d{2}|^OBS-\d+$|@/i;

export type ParsedStudy = NonNullable<ReturnType<typeof parseStudyExpression>> & { symbol?: string };

/**
 * A typed study with an optional leading symbol (spec 2026-11-13 §1). The first argument is a
 * symbol when it is a series reference (`SYMBOL_REF`), is not a number, window or time, and the
 * study's first parameter is not a text one it could be (plan R1: `AVWAP(2026-09-01)` is an
 * anchor, `AVWAP(MSFT, 2026-09-01)` MSFT's). The rest is `parseStudyExpression`'s, unchanged.
 */
export function parseStudy(
  text: string, lookup: (name: string) => CatalogEntry | undefined, options: ParseOptions = {},
): ParsedStudy | null {
  const head = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(([^()]*)\)/.exec(text);
  const entry = head === null ? undefined : lookup(head[1].toLowerCase());
  if (head !== null && entry !== undefined) {
    const args = head[2].split(",").map((a) => a.trim());
    const first = args[0];
    const textFirst = entry.params[0]?.text === true && args.length <= entry.params.length;
    if (first !== "" && SYMBOL_REF.test(first) && !NOT_A_SYMBOL.test(first) && !textFirst) {
      const parsed = parseStudyExpression(text.replace(/\(\s*[^(),]*?\s*(?:,\s*|(?=\)))/, "("), lookup, options);
      return parsed === null ? null : { ...parsed, symbol: first };
    }
  }
  return parseStudyExpression(text, lookup, options);
}

/**
 * The socket's `indicators` string from a card's series: the study ones,
 * read back as the instances `indicatorsParam` already knows how to
 * render, so the wire is byte-identical to v12.3.x's for the same studies
 * -- canonical order, resolved anchors, the chart's one source. Every
 * other series type is drawn from the card's own bars and never reaches
 * this string; a study series with no name never could (there is nothing
 * to ask the server for), and is dropped like an unresolvable anchor.
 */
export function indicatorsFromSeries(
  series: Series[],
  resolveAnchor: AnchorResolver | undefined,
  options: ParseOptions & { source: "local" | "eodhd" },
): string {
  const studies: StudyInstance[] = series
    // The caller hands it one socket's series: list:1's own, or one other ticker's (spec 2026-11-13 §2).
    .filter((s) => s.type === "study" && s.name !== undefined)
    .map((s) => ({
      expr: s.expr, name: s.name as string, params: s.params, color: s.color, source: s.source, style: s.style,
    }));
  return indicatorsParam(studies, resolveAnchor, options);
}

/**
 * Remove panel `index` (0-based) and keep every reference and every series
 * assignment pointing where it meant to (spec 2026-09-24, C0). One function
 * owns the whole remap, so a removal can never move the panels text without
 * moving the series with it -- which is the pair of live defects this fixes:
 * a series on a panel below the removed one used to keep a 1-based number that
 * no longer resolved and vanished (D4), and a `P<n>` margin reference above the
 * removed panel used to point at a different panel with no warning (D3).
 *
 * A single-panel layout is returned unchanged (spec D5): the editor already
 * refuses to remove the last row, and this does not lean on that guard.
 */
export function removePanel(
  panels: PanelDef[],
  series: Series[],
  index: number,
): { panels: PanelDef[]; series: Series[] } {
  if (panels.length <= 1) return { panels, series };
  // The 1-based number of the panel going away; the survivors are one shorter.
  const gone = index + 1;
  const length = panels.length - 1;

  // A `{ ref }` value (ymin/ymax): dropped when it named the removed panel,
  // decreased by one when it named a panel above it (spec D3). A fixed number
  // is not a reference and passes through. Same shape the editor used to carry
  // inline, now here where series move with it.
  const shift = (value: number | { ref: number } | undefined): number | { ref: number } | undefined => {
    if (typeof value !== "object") return value;
    if (value.ref === gone) return undefined;
    return value.ref > gone ? { ref: value.ref - 1 } : value;
  };
  // xs/xe carry a date STRING or a `{ ref }`; only the reference form shifts,
  // a date expression (or a `$group:` name) is left exactly as written.
  const shiftX = (value: string | { ref: number } | undefined): string | { ref: number } | undefined =>
    typeof value === "object" ? (shift(value) as { ref: number } | undefined) : value;
  // A margin reference is a bare number in xmarginRef/ymarginRef, beside the
  // ALREADY-RESOLVED pixels in xmargin/ymargin. Dropping the reference leaves
  // the pixels the panel had been inheriting, so nothing moves on screen
  // (spec D3): the parser stores both for exactly this.
  const shiftMargin = (value: number | undefined): number | undefined => {
    if (value === undefined || value === gone) return undefined;
    return value > gone ? value - 1 : value;
  };

  const remapped: PanelDef[] = panels
    .filter((_p, i) => i !== index)
    .map((p) => ({
      ...p,
      xmarginRef: shiftMargin(p.xmarginRef),
      ymarginRef: shiftMargin(p.ymarginRef),
      xs: shiftX(p.xs),
      xe: shiftX(p.xe),
      ymin: shift(p.ymin),
      ymax: shift(p.ymax),
    }));

  // A series above the removed panel decreases by one; one ON the removed panel
  // moves to the panel now occupying that slot, or to the new last panel when
  // the removed one was last (spec D4). Every returned series therefore names a
  // panel that exists.
  const moved = series.map((s) => {
    if (s.panel > gone) return { ...s, panel: s.panel - 1 };
    if (s.panel === gone) return { ...s, panel: Math.min(gone, length) };
    return s;
  });

  return { panels: remapped, series: moved };
}

/**
 * Reorder panels: move panel `from` (0-based) to slot `to`, and keep every
 * reference and every series pointing at the panel it named before (spec
 * 2026-09-24, D5). The ORDER defines the displayed numbers, so a reorder
 * renumbers -- it does not re-lay-out: each panel object keeps its own
 * coordinates and only travels to a new position in the array, while the
 * references inside it and the series on it are rewritten through the new
 * numbering. This shares the field coverage removePanel established (C0): the
 * two margin references, the xs/xe date-or-ref, and the ymin/ymax number-or-ref
 * -- a date STRING or a `$group:` name is not a reference and is left as written.
 *
 * A no-op move (same slot) or an out-of-range index returns the very inputs, so
 * a grip dropped on its own row churns nothing.
 */
export function movePanel(
  panels: PanelDef[],
  series: Series[],
  from: number,
  to: number,
): { panels: PanelDef[]; series: Series[] } {
  if (from === to || from < 0 || to < 0 || from >= panels.length || to >= panels.length) {
    return { panels, series };
  }
  // The new array order as a list of OLD indices: splice the moved panel out
  // and back in. Coordinates ride with the panel object, so nothing here reads
  // top/left/width/height.
  const order = panels.map((_p, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  // old 1-based panel number -> new 1-based number (the inverse of `order`).
  const renum = new Map<number, number>();
  order.forEach((oldIndex, newIndex) => { renum.set(oldIndex + 1, newIndex + 1); });
  const map = (n: number): number => renum.get(n) ?? n;

  // The same reference-bearing fields removePanel remaps, through a permutation
  // instead of a delete-and-decrement. A `{ ref }` (ymin/ymax, or a P<n> xs/xe)
  // follows the numbering; a fixed number and a date string pass through.
  const mapRef = (value: number | { ref: number } | undefined): number | { ref: number } | undefined =>
    typeof value === "object" ? { ref: map(value.ref) } : value;
  const mapX = (value: string | { ref: number } | undefined): string | { ref: number } | undefined =>
    typeof value === "object" ? { ref: map(value.ref) } : value;
  // A margin reference is a bare number beside the already-resolved pixels; the
  // pixels stay, only which panel it names moves.
  const mapMargin = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : map(value);

  const remapped: PanelDef[] = order.map((oldIndex) => {
    const p = panels[oldIndex];
    return {
      ...p,
      xmarginRef: mapMargin(p.xmarginRef),
      ymarginRef: mapMargin(p.ymarginRef),
      xs: mapX(p.xs),
      xe: mapX(p.xe),
      ymin: mapRef(p.ymin),
      ymax: mapRef(p.ymax),
    };
  });
  const movedSeries = series.map((s) => ({ ...s, panel: map(s.panel) }));
  return { panels: remapped, series: movedSeries };
}

/** The price drawings, for panelLabel's "Price" reading (spec 2026-09-24, D3). */
const PRICE_DRAWINGS: ReadonlySet<SeriesType> = new Set<SeriesType>(["candlestick", "ohlc", "line", "area"]);

/**
 * A panel's label, derived from what it holds and never stored (spec
 * 2026-09-24, D3): a panel with any price drawing reads "Price", one with the
 * volume reads "Volume", one holding only studies (or a performance line) is
 * named by its first series -- the study's own expression -- and an empty
 * panel falls back to its number. Precedence is price, then volume, then the
 * first series, so the price-plus-studies panel of the default layout reads
 * "Price".
 */
export function panelLabel(series: Series[], panel: number): string {
  const here = series.filter((s) => s.panel === panel);
  if (here.some((s) => PRICE_DRAWINGS.has(s.type))) return "Price";
  if (here.some((s) => s.type === "volume")) return "Volume";
  if (here.length > 0) return seriesLabel(here[0]);
  return `P${panel}`;
}
