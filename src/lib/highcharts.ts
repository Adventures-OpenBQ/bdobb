// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout, type PlotlyFigure } from "./chartShapes";

/**
 * Translates the Highcharts shapes the reference backend serves -- column/bar,
 * line/spline, area and scatter, one or more series over an optional category
 * axis -- into a Plotly figure, so ChartRenderer draws them and v3 needs no
 * Highcharts dependency. NOT a general Highcharts engine: an unmappable chart
 * (pie, gauge, a renderer-specific type) returns null and the caller falls
 * back to the raw view. The payload may be a bare options object or wrapped in
 * `userOptions`, which is how this backend sends it.
 */
const CHART: Record<string, { type: string; mode?: string; fill?: string; orientation?: string }> = {
  column: { type: "bar" },
  bar: { type: "bar", orientation: "h" },
  line: { type: "scatter", mode: "lines" },
  spline: { type: "scatter", mode: "lines" },
  area: { type: "scatter", mode: "lines", fill: "tozeroy" },
  areaspline: { type: "scatter", mode: "lines", fill: "tozeroy" },
  scatter: { type: "scatter", mode: "markers" },
};

type Row = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function obj(value: unknown): Row | undefined {
  return typeof value === "object" && value !== null ? (value as Row) : undefined;
}

/** A Highcharts title/axis-title is `{ text }`; tolerate a bare string too. */
function textOf(value: unknown): string | undefined {
  return str(value) ?? str(obj(value)?.text);
}

/** A point is a number, an `[x, y]` pair, or an object carrying `y`. */
function yOf(point: unknown): unknown {
  if (typeof point === "number") return point;
  if (Array.isArray(point)) return point[1];
  return obj(point)?.y ?? null;
}

/** Its label: the category at that index if there is one, else its own x/name/index. */
function xOf(point: unknown, index: number, categories: unknown[] | undefined): unknown {
  if (categories && index < categories.length) return categories[index];
  if (Array.isArray(point)) return point[0];
  const o = obj(point);
  if (o?.x !== undefined) return o.x;
  if (typeof o?.name === "string") return o.name;
  return index;
}

export function highchartsToPlotly(payload: unknown, theme: "dark" | "light" = "dark"): PlotlyFigure | null {
  const root = obj(payload);
  if (!root) return null;
  const opts = obj(root.userOptions) ?? root;

  const seriesList = Array.isArray(opts.series) ? (opts.series as unknown[]) : null;
  if (seriesList === null || seriesList.length === 0) return null;

  const chartType = str(obj(opts.chart)?.type);
  const categories = Array.isArray(obj(opts.xAxis)?.categories)
    ? (obj(opts.xAxis)!.categories as unknown[])
    : undefined;

  const data: Row[] = [];
  for (const raw of seriesList) {
    const series = obj(raw);
    if (!series) continue;
    const base = CHART[str(series.type) ?? chartType ?? ""];
    if (!base) continue; // a type neither this series nor the chart maps -- skip it
    const points = Array.isArray(series.data) ? (series.data as unknown[]) : [];
    const labels = points.map((p, i) => xOf(p, i, categories));
    const nums = points.map(yOf);
    const name = str(series.name);
    // A Highcharts `bar` is horizontal: the category axis is y, values on x.
    const swap = base.orientation === "h";
    data.push({
      ...base,
      ...(swap ? { x: nums, y: labels } : { x: labels, y: nums }),
      ...(name !== undefined ? { name } : {}),
    });
  }
  if (data.length === 0) return null;

  const title = textOf(opts.title);
  const layout: Record<string, unknown> = {
    margin: { l: 52, r: 12, t: title ? 32 : 12, b: 40 },
    xaxis: { title: textOf(obj(opts.xAxis)?.title) },
    yaxis: { title: textOf(obj(opts.yAxis)?.title) },
    showlegend: data.length > 1,
    ...themedLayout(theme),
  };
  if (title) layout.title = { text: title };

  return { data, layout };
}
