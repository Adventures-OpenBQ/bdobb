// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout, type PlotlyFigure } from "./chartShapes";
import { asRecord, isRecord, str } from "./isRecord";

/**
 * Translates the common Vega-Lite shapes the reference backend serves -- bar,
 * line/area, and point/scatter, with inline `data.values` -- into a Plotly
 * figure, so ChartRenderer draws them like any other chart and v3 needs no
 * Vega dependency. This is NOT a general Vega-Lite engine: a spec it cannot
 * map (facets, layers, transforms, an unknown mark) returns null, and the
 * caller falls back to the raw view.
 */
const MARK: Record<string, { type: string; mode?: string; fill?: string }> = {
  bar: { type: "bar" },
  line: { type: "scatter", mode: "lines" },
  area: { type: "scatter", mode: "lines", fill: "tozeroy" },
  point: { type: "scatter", mode: "markers" },
  circle: { type: "scatter", mode: "markers" },
  square: { type: "scatter", mode: "markers" },
  tick: { type: "scatter", mode: "markers" },
};

type Row = Record<string, unknown>;

function markType(mark: unknown): string | null {
  return str(mark) ?? str(asRecord(mark)?.type) ?? null;
}

/** A row's own field: data.values came from JSON.parse, so never its prototype. */
function own(row: Row, field: string): unknown {
  return Object.hasOwn(row, field) ? row[field] : undefined;
}

/** An encoding channel's field name and optional axis title. */
function channel(encoding: unknown, name: string): { field: string; title?: string } | null {
  const c = asRecord(asRecord(encoding)?.[name]);
  if (!c || typeof c.field !== "string") return null;
  return { field: c.field, title: str(c.title) };
}

/** Vega title is a string or an object carrying `text`. */
function titleText(title: unknown): string | undefined {
  return str(title) ?? str(asRecord(title)?.text);
}

export function vegaLiteToPlotly(spec: unknown, theme: "dark" | "light" = "dark"): PlotlyFigure | null {
  const s = asRecord(spec);
  if (!s) return null;

  // Only the object entries: a null or number in data.values would otherwise
  // throw below and take the card to its error boundary, not the raw view.
  const raw = asRecord(s.data)?.values;
  const values = Array.isArray(raw) ? raw.filter(isRecord) : null;
  if (values === null || values.length === 0) return null;

  const type = markType(s.mark);
  const mark = type ? MARK[type] : undefined;
  if (!mark) return null;

  const x = channel(s.encoding, "x");
  const y = channel(s.encoding, "y");
  if (!x || !y) return null;

  const color = channel(s.encoding, "color");
  const markColor = str(asRecord(s.mark)?.color);

  const trace = (rows: Row[], name?: string): Row => ({
    ...mark,
    x: rows.map((r) => own(r, x.field)),
    y: rows.map((r) => own(r, y.field)),
    ...(name !== undefined ? { name } : {}),
    // A per-mark colour is honoured only for a single series; a colour
    // encoding assigns its own per-group colours instead.
    ...(markColor && !color ? { marker: { color: markColor } } : {}),
  });

  let data: Row[];
  if (color) {
    const byGroup = new Map<string, Row[]>();
    for (const row of values) {
      const key = String(own(row, color.field));
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(row);
    }
    data = [...byGroup].map(([key, rows]) => trace(rows, key));
  } else {
    data = [trace(values)];
  }

  const title = titleText(s.title);
  const layout: Record<string, unknown> = {
    margin: { l: 52, r: 12, t: title ? 32 : 12, b: 40 },
    xaxis: { title: x.title ?? x.field },
    yaxis: { title: y.title ?? y.field },
    showlegend: Boolean(color),
    ...themedLayout(theme),
  };
  if (title) layout.title = { text: title };

  return { data, layout };
}
