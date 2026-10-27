// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * A card as a `chart/1` document body, and a document body as a card
 * (shared chart documents, step 1b). The body carries the whole card a
 * server needs to reproduce it with no device (S13): symbol, interval,
 * range, `session`, every `series` in strip order with its panel, side,
 * colour and style, anchors, levels, drawings, the `panels` text and the
 * five display flags. Only the `added`/`redo` undo stacks stay the device's.
 *
 * A series is the card's own `Series` (the `{ }` popover's shape) less two
 * fields: `expr`, which is rebuilt here from the rest (S12), and `source`,
 * which nothing reads. An `id` is kept so every device and the server name a
 * series alike; a series written without one (Rita, a hand-made body) gets
 * one minted on read. A body with no `series` at all is the card's default
 * drawing: candlesticks in panel 1, volume in the last panel.
 */
import { studiesFromParam } from "./chart/indicatorsParam";
import { DEFAULT_PANELS_TEXT, parsePanels } from "./chart/panels";
import { isFillPattern, isPen } from "./chart/pen";
import { migrateChart, seriesId, seriesLabel } from "./chart/series";
import { defaultColor, normalizeExpression, type CatalogEntry } from "./chart/studyExpression";
import type { ChartCardState, ChartDrawing, ChartLevel, Series, SeriesType } from "./types";

export type SeriesStyle = NonNullable<Series["style"]>;
/** One series as chart/1 stores it (S13). */
export type ChartSeries = {
  id?: string; type: SeriesType; name?: string; params?: Record<string, number | string>;
  panel: number; side: "left" | "right"; color?: string; style?: SeriesStyle; symbol?: string; anchor?: string;
};
export const FLAGS = ["studyValues", "seriesPills", "snapshotHeader", "adjusted", "railHidden"] as const;
type Flag = (typeof FLAGS)[number];

export type ChartBody = {
  schema: "chart/1";
  symbol: string;
  interval: string;
  provider?: string;
  range?: { from: string; to: string };
  session?: NonNullable<ChartCardState["session"]>;
  series?: ChartSeries[];
  anchors?: string[];
  levels?: ChartLevel[];
  drawings?: ChartDrawing[];
  panels?: string;
} & { [F in Flag]?: boolean };

/** A document as the server returns it (step 1 ruling 10). */
export type ChartDocument = {
  id: string; title: string; revision: number; body: ChartBody;
  updated_by: string; updated_at: string; deleted: boolean;
};

type Lookup = (name: string) => CatalogEntry | undefined;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const text = (v: unknown, limit: number): v is string => typeof v === "string" && v.length > 0 && v.length <= limit;
/** The server's per-key style check (chart_body.STYLE), so a card never sends what it refuses. */
const STYLE_OK: Record<keyof SeriesStyle, (v: unknown) => boolean> = {
  width: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4,
  fill: (v) => typeof v === "boolean",
  fillOpacity: (v) => typeof v === "number" && v >= 0 && v <= 1,
  shade: (v) => typeof v === "string" && COLOR.test(v),
  pen: isPen,
  fillPattern: isFillPattern,
  axisValue: (v) => typeof v === "boolean",
  outputs: (v) => Array.isArray(v) && v.length <= 16 && v.every((o) => text(o, 64)),
};

function entryOf(s: Series): ChartSeries {
  const style = Object.fromEntries(
    Object.entries(s.style ?? {}).filter(([k, v]) => k in STYLE_OK && STYLE_OK[k as keyof SeriesStyle](v)),
  ) as SeriesStyle;
  return {
    ...(text(s.id, 64) ? { id: s.id } : {}),
    type: s.type,
    ...(s.type === "study" ? { name: s.name as string, params: s.params } : {}),
    panel: s.panel,
    side: s.side,
    ...(COLOR.test(s.color) ? { color: s.color } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
    ...(s.type === "performance" && text(s.symbol, 64) ? { symbol: s.symbol } : {}),
    ...(s.type === "performance" && s.anchor !== undefined ? { anchor: s.anchor } : {}),
  };
}

function seriesOf(e: ChartSeries, lookup: Lookup, panels: number): Series {
  const params = e.params ?? {};
  const entry = e.type === "study" && e.name !== undefined ? lookup(e.name) : undefined;
  // A study with no colour of its own takes the registry's first, as a typed study does
  // (instanceFromParse); "" otherwise, which the renderer draws in the theme's colour.
  const color = e.color ?? (entry ? defaultColor(entry, "") : "");
  const s: Series = {
    id: e.id ?? seriesId(), type: e.type, params, panel: Math.min(e.panel, panels), side: e.side, color,
    ...(e.name !== undefined ? { name: e.name } : {}),
    ...(e.symbol !== undefined ? { symbol: e.symbol } : {}),
    ...(e.anchor !== undefined ? { anchor: e.anchor } : {}),
    ...(e.style !== undefined ? { style: e.style } : {}),
    expr: "",
  };
  if (e.type !== "study") return { ...s, expr: seriesLabel(s) };
  const name = e.name as string;
  return {
    ...s,
    expr: entry
      ? normalizeExpression(name, params, entry, color)
      : `${name.toUpperCase()}(${Object.values(params).join(", ")})${color ? ` ${color.toLowerCase()}` : ""}`,
  };
}

/** The card's series and panels text, migrated off `studies`/`indicators` exactly as the renderer reads them. */
export function cardSeries(params: Record<string, string>, state: ChartCardState, lookup: Lookup): { series: Series[]; panelsText: string } {
  const studies = state.studies ?? studiesFromParam(params.indicators ?? "", lookup, "", { allowBusinessDays: true });
  return migrateChart({ series: state.series, studies }, params.panels, lookup);
}

/** The card as a chart/1 body. Empty facets are left out, so equal cards give equal bodies. */
export function bodyFromCard(params: Record<string, string>, state: ChartCardState, lookup: Lookup): ChartBody {
  const { series, panelsText } = cardSeries(params, state, lookup);
  const body: ChartBody = {
    schema: "chart/1",
    symbol: (params.symbol ?? "").trim().toUpperCase(),
    interval: state.interval ?? params.interval ?? "1m",
  };
  if (params.provider) body.provider = params.provider;
  if (state.range) body.range = { from: state.range.from, to: state.range.to };
  if (state.session) body.session = state.session;
  body.series = series.map(entryOf);
  if (state.anchors?.length) body.anchors = state.anchors;
  if (state.levels?.length) body.levels = state.levels;
  if (state.drawings?.length) body.drawings = state.drawings;
  body.panels = panelsText;
  for (const flag of FLAGS) if (typeof state[flag] === "boolean") body[flag] = state[flag];
  return body;
}

/**
 * A body as a card patch and a params patch. Total over every body the
 * server accepts: an unknown study lands where it was placed, a series past
 * the last panel is clamped to it, and an unreadable `panels` text is the
 * renderer's to report (it draws its default two panels) -- never a throw.
 */
export function cardFromBody(body: ChartBody, lookup: Lookup): { state: Partial<ChartCardState>; params: Record<string, string> } {
  const panelsText = body.panels ?? DEFAULT_PANELS_TEXT;
  const parsed = parsePanels(panelsText).panels.length;
  const panels = parsed > 0 ? parsed : parsePanels(DEFAULT_PANELS_TEXT).panels.length;
  const series = body.series === undefined
    ? migrateChart({ studies: [] }, panelsText, lookup).series
    : body.series.map((e) => seriesOf(e, lookup, panels));
  const patch: Partial<ChartCardState> = {
    interval: body.interval,
    range: body.range,
    session: body.session,
    anchors: body.anchors ?? [],
    levels: body.levels ?? [],
    drawings: body.drawings ?? [],
    series,
    // The deprecated inputs the series were migrated from: dead once `series` is written.
    studies: undefined,
    panes: undefined,
  };
  for (const flag of FLAGS) patch[flag] = body[flag];
  return { state: patch, params: { symbol: body.symbol, panels: panelsText, ...(body.provider ? { provider: body.provider } : {}) } };
}
