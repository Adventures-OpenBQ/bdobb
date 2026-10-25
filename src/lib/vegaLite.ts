// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout, type PlotlyFigure } from "./chartShapes";
import { isRecord } from "./isRecord";

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
  if (typeof mark === "string") return mark;
  if (typeof mark === "object" && mark !== null && typeof (mark as Row).type === "string") {
    return (mark as { type: string }).type;
  }
  return null;
}

/** A row's own field: data.values came from JSON.parse, so never its prototype. */
function own(row: Row, field: string): unknown {
  return Object.hasOwn(row, field) ? row[field] : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** An encoding channel's field name and optional axis title. */
function channel(encoding: unknown, name: string): { field: string; title?: string } | null {
  if (typeof encoding !== "object" || encoding === null) return null;
  const c = (encoding as Row)[name];
  if (typeof c !== "object" || c === null) return null;
  const field = (c as Row).field;
  if (typeof field !== "string") return null;
  return { field, title: str((c as Row).title) };
}

/** Vega title is a string or an object carrying `text`. */
function titleText(title: unknown): string | undefined {
  return str(title) ?? (typeof title === "object" && title !== null ? str((title as Row).text) : undefined);
}

export function vegaLiteToPlotly(spec: unknown, theme: "dark" | "light" = "dark"): PlotlyFigure | null {
  if (typeof spec !== "object" || spec === null) return null;
  const s = spec as Row;

  const container = s.data;
  // Only the object entries: a null or number in data.values would otherwise
  // throw below and take the card to its error boundary, not the raw view.
  const values =
    typeof container === "object" && container !== null && Array.isArray((container as Row).values)
      ? ((container as Row).values as unknown[]).filter(isRecord)
      : null;
  if (values === null || values.length === 0) return null;

  const type = markType(s.mark);
  const mark = type ? MARK[type] : undefined;
  if (!mark) return null;

  const x = channel(s.encoding, "x");
  const y = channel(s.encoding, "y");
  if (!x || !y) return null;

  const color = channel(s.encoding, "color");
  const markColor =
    typeof s.mark === "object" && s.mark !== null ? str((s.mark as Row).color) : undefined;

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
