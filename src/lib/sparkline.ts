// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";

/**
 * Sparkline geometry, kept pure so the component (SparklineCell) stays a thin
 * renderer and the maths is unit-tested on its own. The reference backend puts
 * a `sparkline` object on a columnsDef; the cell for that column is a number[],
 * or a list of points read through options.yKey (see sparklineValues).
 */

export type PoiStyle = { fill?: string; stroke?: string; strokeWidth?: number; size?: number };

export type SparklineConfig = {
  type: "line" | "bar" | "area";
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  markers?: { enabled: boolean; size?: number; fill?: string };
  poi?: { maximum?: PoiStyle; minimum?: PoiStyle };
  padding?: { top: number; right: number; bottom: number; left: number };
  /** options.tooltip.enabled, default true. */
  tooltip: boolean;
  /** options.yKey: the key a point object's value is read from, default "y". */
  yKey?: string;
};

const TYPES = new Set(["line", "bar", "area"]);

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
const rec = (v: unknown) => (isRecord(v) ? v : undefined);

function poiStyle(v: unknown): PoiStyle | undefined {
  const o = rec(v);
  if (!o) return undefined;
  const s: PoiStyle = {};
  const fill = str(o.fill);
  if (fill) s.fill = fill;
  const stroke = str(o.stroke);
  if (stroke) s.stroke = stroke;
  const sw = num(o.strokeWidth);
  if (sw !== undefined) s.strokeWidth = sw;
  const sz = num(o.size);
  if (sz !== undefined) s.size = sz;
  return s;
}

/**
 * Normalise the opaque columnsDef.sparkline object. Everything but `type` is
 * nested under `options` on the wire; we flatten it so the renderer never has
 * to know that. An absent type defaults to line; a present-but-unknown type
 * means the manifest asked for something we do not draw, so we bail to
 * undefined and the column renders as plain text.
 */
export function parseSparkline(raw: unknown): SparklineConfig | undefined {
  const r = rec(raw);
  if (!r) return undefined;

  let type: SparklineConfig["type"];
  if (r.type === undefined) type = "line";
  else if (typeof r.type === "string" && TYPES.has(r.type)) type = r.type as SparklineConfig["type"];
  else return undefined;

  const opts = rec(r.options) ?? {};
  const config: SparklineConfig = { type, tooltip: true };
  const yKey = str(opts.yKey);
  if (yKey) config.yKey = yKey;

  const stroke = str(opts.stroke);
  if (stroke) config.stroke = stroke;
  const fill = str(opts.fill);
  if (fill) config.fill = fill;
  const sw = num(opts.strokeWidth);
  if (sw !== undefined) config.strokeWidth = sw;

  const m = rec(opts.markers);
  if (m) {
    config.markers = { enabled: m.enabled === true };
    const ms = num(m.size);
    if (ms !== undefined) config.markers.size = ms;
    const mf = str(m.fill);
    if (mf) config.markers.fill = mf;
  }

  const poi = rec(opts.pointsOfInterest);
  if (poi) {
    const max = poiStyle(poi.maximum);
    const min = poiStyle(poi.minimum);
    if (max || min) config.poi = { ...(max ? { maximum: max } : {}), ...(min ? { minimum: min } : {}) };
  }

  const pad = rec(opts.padding);
  if (pad) {
    const t = num(pad.top);
    const rt = num(pad.right);
    const b = num(pad.bottom);
    const l = num(pad.left);
    if (t !== undefined && rt !== undefined && b !== undefined && l !== undefined) {
      config.padding = { top: t, right: rt, bottom: b, left: l };
    }
  }

  const tt = rec(opts.tooltip);
  if (tt && tt.enabled === false) config.tooltip = false;

  return config;
}

/**
 * The numbers a sparkline cell draws. A cell is either a number[] or a list
 * of point objects (the reference backend's bar sparklines send {x, y} and
 * name the keys with options.xKey/yKey); a point's value is read from
 * config.yKey. Anything that is not a finite number is skipped, so a cell with
 * nothing usable comes back empty and the caller renders it as text.
 * Object.hasOwn: the points came from JSON.parse.
 */
export function sparklineValues(cell: unknown[], config: SparklineConfig): number[] {
  const out: number[] = [];
  const key = config.yKey ?? "y";
  for (const item of cell) {
    const point = rec(item);
    const v = num(point ? (Object.hasOwn(point, key) ? point[key] : undefined) : item);
    if (v !== undefined) out.push(v);
  }
  return out;
}

export type SparklinePoint = { x: number; y: number; v: number; i: number };
export type SparklineGeometry = {
  points: SparklinePoint[];
  linePath: string;
  areaPath: string;
  bars: { x: number; y: number; w: number; h: number }[];
  minIdx: number;
  maxIdx: number;
};

const DEFAULT_PAD = 2;

/**
 * Map values into a width x height box. SVG y grows downward, so a HIGHER value
 * gets a SMALLER y. A single value or an all-equal series has no range to scale
 * against and is drawn flat at the vertical centre (never a divide-by-zero).
 * min/max are the FIRST occurrence on ties.
 * A bar measures from zero, not from the series minimum, so for type "bar" the
 * domain is widened to include 0 and each bar runs from yAt(0) to its value:
 * the smallest bar keeps its height and a negative bar hangs below the zero
 * line (the reference backend's monthly returns are mixed-sign).
 */
export function sparklineGeometry(
  values: number[],
  config: SparklineConfig,
  width: number,
  height: number,
): SparklineGeometry {
  if (values.length === 0) {
    return { points: [], linePath: "", areaPath: "", bars: [], minIdx: -1, maxIdx: -1 };
  }

  const pad = config.padding ?? { top: DEFAULT_PAD, right: DEFAULT_PAD, bottom: DEFAULT_PAD, left: DEFAULT_PAD };
  const left = pad.left;
  const right = width - pad.right;
  const top = pad.top;
  const bottom = height - pad.bottom;
  const innerW = Math.max(0, right - left);
  const innerH = Math.max(0, bottom - top);
  const n = values.length;

  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 1; i < n; i++) {
    if (values[i] < values[minIdx]) minIdx = i;
    if (values[i] > values[maxIdx]) maxIdx = i;
  }
  const isBar = config.type === "bar";
  const lo = isBar ? Math.min(values[minIdx], 0) : values[minIdx];
  const span = (isBar ? Math.max(values[maxIdx], 0) : values[maxIdx]) - lo;

  const xAt = (i: number) => (n === 1 ? left + innerW / 2 : left + (innerW * i) / (n - 1));
  const yAt = (v: number) => (span === 0 ? top + innerH / 2 : bottom - (innerH * (v - lo)) / span);

  const points: SparklinePoint[] = values.map((v, i) => ({ x: xAt(i), y: yAt(v), v, i }));

  const d = (i: number) => `${i === 0 ? "M" : "L"}${points[i].x.toFixed(2)},${points[i].y.toFixed(2)}`;
  // A single value has no segment to draw, so a bare point-path would leave a
  // blank cell; the spec asks for a flat line, so we span the full inner width
  // at that point's y. n >= 2 draws the point-to-point path as usual.
  let linePath: string;
  let areaPath: string;
  if (n === 1) {
    const y = points[0].y.toFixed(2);
    linePath = `M${left.toFixed(2)},${y}L${right.toFixed(2)},${y}`;
    areaPath = `${linePath}L${right.toFixed(2)},${bottom.toFixed(2)}L${left.toFixed(2)},${bottom.toFixed(2)}Z`;
  } else {
    linePath = points.map((_, i) => d(i)).join("");
    areaPath = `${linePath}L${points[n - 1].x.toFixed(2)},${bottom.toFixed(2)}L${points[0].x.toFixed(2)},${bottom.toFixed(2)}Z`;
  }

  const barW = (innerW / n) * 0.8;
  const base = yAt(0);
  const bars = points.map((p) => ({ x: p.x - barW / 2, y: Math.min(p.y, base), w: barW, h: Math.abs(base - p.y) }));

  return { points, linePath, areaPath, bars, minIdx, maxIdx };
}
