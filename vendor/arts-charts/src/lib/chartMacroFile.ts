// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { isFillPattern, isPen } from "./chart/pen";
import { parsePanels, scaleOrder, type PanelDef } from "./chart/panels";
import { seriesId, seriesLabel, symbolAllowed } from "./chart/series";
import { normalizeExpression, type CatalogEntry } from "./chart/studyExpression";
import type { ChartLayout } from "./chartLayoutsFile";
import { importRefusal } from "./importLimits";
import type { Series, SeriesType } from "./types";

/**
 * The layout interchange file (spec 2026-09-25, E1). The handoff package's
 * envelope, used for export as well as import (user ruling): one format, so the
 * acceptance fixtures import unchanged and nothing needs an adapter. The wire
 * keyword stays `macros` (E3) for that compatibility. The user-visible wording is
 * MIXED, deliberately: the interchange dialogs say "macros" so the control matches
 * the format it writes (J closeout item 5 renamed them, a Label-in-Name fix), while
 * the chart row's Layout caption and its Layout control still say "layout" because
 * that is the concept a reader is picking from. This comment used to claim "every
 * LABEL the user sees says layout", which J made false.
 *
 * Pure -- no React, no filesystem -- and shaped like planBackendsImport: the
 * byte ceiling is checked before the parse, and a bad file returns a single
 * refusal line rather than throwing. It diverges in two deliberate ways: the ok
 * arm carries the validated INCOMING layouts (the editor decides the per-name
 * Replace/Keep-both merge, E5), and it takes a study catalog `lookup` in place
 * of the existing list, because a series' expression is REGENERATED here (E11),
 * never trusted from the file.
 */
export const MACRO_FORMAT = "arts-charts-macros";
export const MACRO_VERSION = 1;

const HEX6 = /^#[0-9a-f]{6}$/i;
const RESERVED = ["__proto__", "constructor", "prototype"];
const BUILT_IN: SeriesType[] = ["candlestick", "ohlc", "line", "area", "volume"];

export type LayoutImportPlan =
  | { ok: true; layouts: ChartLayout[] }
  | { ok: false; refusal: string };

// A throw carrying the human line; caught once at the top so any single bad
// field refuses the WHOLE file (E6), never a partial import.
class Refused extends Error {}
const refuse = (message: string): never => {
  throw new Refused(message);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A wire margin value (number or "P<n>") to the compact field parsePanels reads. */
function marginField(value: unknown, name: string, key: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^P\d+$/.test(value)) return value;
  return refuse(`${name}: ${key} must be a number or P<n>.`);
}

/** A wire extra (xs/xe/ymin/ymax) to a compact `key=value`, or "" to omit it. */
function extraField(value: unknown, name: string, key: string): string {
  if (value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return `${key}=${value}`;
  if (typeof value === "string") return `${key}=${value}`; // a "P<n>" or a date expression; parsePanels tells them apart
  return refuse(`${name}: ${key} is not a number, P<n> or a date expression.`);
}

/**
 * One macro's panels, rebuilt through the native codec (E9). Each wire panel
 * becomes the compact row parsePanels reads, so "P1" becomes xmarginRef/{ ref }
 * and the codec's own reference pass reports a missing target (P99). A cycle
 * among ymin/ymax is caught by scaleOrder. Any problem refuses the file.
 */
function panelsOf(raw: unknown, name: string): PanelDef[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    return refuse(`${name}: include 1-100 panels.`);
  }
  const rows = raw.map((p) => {
    if (!isRecord(p)) return refuse(`${name}: a panel is not an object.`);
    for (const k of ["top", "left", "width", "height"]) {
      if (typeof p[k] !== "number" || !Number.isFinite(p[k] as number)) return refuse(`${name}: panel ${k} must be a finite number.`);
    }
    const head = [p.top, p.left, p.width, p.height,
      marginField(p.xmargin, name, "xmargin"), marginField(p.ymargin, name, "ymargin")];
    const extras = ["xs", "xe", "ymin", "ymax"].map((k) => extraField(p[k], name, k)).filter((s) => s !== "");
    return [...head, ...extras].join(",");
  });
  const { panels, problems } = parsePanels(rows.join(";"));
  if (problems.length > 0 || panels.length !== raw.length) return refuse(`${name}: ${problems[0] ?? "invalid panels."}`);
  if (scaleOrder(panels).cycles.length > 0) return refuse(`${name}: panel scale links are circular.`);
  return panels;
}

/** One wire series to a Series, with a fresh id and a regenerated expr (E11). */
function seriesOf(raw: unknown, name: string, panelIds: string[], lookup: (name: string) => CatalogEntry | undefined): Series {
  if (!isRecord(raw)) return refuse(`${name}: a series is not an object.`);
  const type = raw.type as SeriesType;
  if (type !== "study" && type !== "performance" && !BUILT_IN.includes(type)) return refuse(`${name}: unsupported series type.`);
  const panel = panelIds.indexOf(String(raw.panel)) + 1;
  if (panel === 0) return refuse(`${name}: a series names a panel that is not in this layout.`);
  if (raw.side !== "left" && raw.side !== "right") return refuse(`${name}: a series side must be left or right.`);
  const color = raw.color === undefined || raw.color === "" ? "" : (typeof raw.color === "string" && HEX6.test(raw.color) ? raw.color : refuse(`${name}: use six-digit hex colours.`));
  const params = isRecord(raw.params) ? (raw.params as Record<string, number | string>) : {};

  // Build the placed series, then regenerate its expr from the type (E11):
  // NEVER the file's own expr, which studyExpression's own comment shows can
  // reorder the chart's indicators if its colour suffix is wrong or missing.
  const out: Series = { id: seriesId(), type, params, panel, side: raw.side, color, expr: "" };

  // A bar series or a performance line may name a ticker or a position in the card's list
  // (spec 2026-11-13 §3): never the list itself, which stays the widget's setting.
  if (type !== "study" && raw.symbol !== undefined) {
    if (typeof raw.symbol !== "string" || !symbolAllowed(type, raw.symbol)) {
      return refuse(`${name}: symbol must be a ticker, $ymbol, $group:<Name> or list:<n>.`);
    }
    out.symbol = raw.symbol;
  }

  let entry: CatalogEntry | undefined;
  if (type === "study") {
    const studyName = typeof raw.name === "string" ? raw.name : refuse(`${name}: a study needs a name.`);
    entry = lookup(studyName);
    if (entry === undefined) return refuse(`${name}: ${studyName} is not an available study.`);
    for (const p of entry.params) {
      const v = params[p.name];
      if (v === undefined && p.default === null) return refuse(`${name}: ${studyName} needs ${p.name}.`);
    }
    out.name = studyName;
    out.expr = normalizeExpression(studyName, params, entry, color || undefined);
  } else if (type === "performance") {
    if (out.symbol === undefined) return refuse(`${name}: a performance series needs a symbol.`);
    const anchor = typeof raw.anchor === "string" && raw.anchor.trim() !== "" ? raw.anchor : refuse(`${name}: a performance series needs an anchor.`);
    out.anchor = anchor;
    out.expr = seriesLabel(out);
  } else {
    out.expr = seriesLabel(out);
  }

  // The appearance whitelist (E2). Unknown keys, out-of-range values, or a
  // banded-only key on a non-banded series each refuse the file.
  if (raw.style !== undefined) {
    if (!isRecord(raw.style)) return refuse(`${name}: series style must be an object.`);
    const style: NonNullable<Series["style"]> = {};
    const banded = entry?.band === true;
    for (const [k, v] of Object.entries(raw.style)) {
      if (k === "width" && [1, 2, 3, 4].includes(v as number)) style.width = v as number;
      else if (k === "pen" && isPen(v)) style.pen = v;
      else if (k === "fill" && typeof v === "boolean") style.fill = v;
      else if (k === "fillOpacity" && typeof v === "number" && v >= 0 && v <= 1) style.fillOpacity = v;
      else if (k === "shade" && banded && typeof v === "string" && HEX6.test(v)) style.shade = v;
      else if (k === "fillPattern" && banded && isFillPattern(v)) style.fillPattern = v;
      else return refuse(`${name}: unsupported appearance field ${k}.`);
    }
    if (Object.keys(style).length > 0) out.style = style;
  }
  // `source` is deliberately never read (E2): types.ts says it is ignored
  // everywhere and survives only for preset comparison, so it is dropped.
  return out;
}

function macroOf(raw: unknown, lookup: (name: string) => CatalogEntry | undefined): ChartLayout {
  if (!isRecord(raw)) return refuse("A layout is not an object.");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name === "" || name.length > 80) return refuse("Each layout needs a name of 1-80 characters.");
  if (RESERVED.includes(name)) return refuse(`${name} is a reserved name.`);
  const note = raw.note ?? "";
  if (typeof note !== "string" || note.length > 2000) return refuse(`${name}: a note must be text up to 2,000 characters.`);
  const panels = panelsOf(raw.panels, name);
  if (!Array.isArray(raw.series) || raw.series.length > 500) return refuse(`${name}: include no more than 500 series.`);
  const panelIds = (raw.panels as Record<string, unknown>[]).map((p) => String(p.id));
  const series = raw.series.map((s) => seriesOf(s, name, panelIds, lookup));
  return { name, note, panels, series };
}

export function planLayoutImport(
  text: string, bytes: number, lookup: (name: string) => CatalogEntry | undefined,
): LayoutImportPlan {
  const oversize = importRefusal(bytes);
  if (oversize !== null) return { ok: false, refusal: oversize };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, refusal: "That file is not JSON." };
  }
  if (!isRecord(parsed) || parsed.format !== MACRO_FORMAT) {
    return { ok: false, refusal: "That file is not an Art's Charts layout file." };
  }
  if (parsed.version !== MACRO_VERSION) {
    const named = typeof parsed.version === "number" ? `version ${parsed.version}` : "an unknown version";
    return { ok: false, refusal: `That layout file is ${named}; this app understands version ${MACRO_VERSION}.` };
  }
  if (!Array.isArray(parsed.macros) || parsed.macros.length < 1 || parsed.macros.length > 100) {
    return { ok: false, refusal: "That file must hold 1-100 layouts." };
  }
  try {
    const layouts = parsed.macros.map((m) => macroOf(m, lookup));
    const names = new Set<string>();
    for (const l of layouts) {
      if (names.has(l.name)) return { ok: false, refusal: `That file names ${l.name} twice.` };
      names.add(l.name);
    }
    return { ok: true, layouts };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, refusal: err.message };
    throw err;
  }
}

/** A wire margin from a resolved pixel value and its optional reference. */
function marginWire(px: number, ref: number | undefined): number | string {
  return ref === undefined ? px : `P${ref}`;
}

/** A wire extra from a { ref } / number / string, or "" when unset. */
function extraWire(value: number | string | { ref: number } | undefined): number | string {
  if (value === undefined) return "";
  return typeof value === "object" ? `P${value.ref}` : value;
}

/**
 * The layouts as an interchange file (E1/E8). Panels map back to the wire
 * shape -- xmarginRef/{ ref } become "P<n>" again (E9) -- and each series' wire
 * `expr` is the DISPLAY label (seriesLabel, colour stripped), matching the
 * package fixtures; the internal colour-bearing expr is the importer's to
 * regenerate (E11). Pretty-printed with a trailing newline, as every export in
 * the app writes.
 */
export function layoutsToMacroFile(layouts: ChartLayout[]): string {
  const macros = layouts.map((l) => ({
    name: l.name,
    note: l.note,
    panels: l.panels.map((p, i) => ({
      id: `p${i + 1}`, name: `P${i + 1}`,
      top: p.top, left: p.left, width: p.width, height: p.height,
      xmargin: marginWire(p.xmargin, p.xmarginRef), ymargin: marginWire(p.ymargin, p.ymarginRef),
      xs: extraWire(p.xs), xe: extraWire(p.xe), ymin: extraWire(p.ymin), ymax: extraWire(p.ymax),
    })),
    series: l.series.map((s, i) => ({
      id: `s${i + 1}`, type: s.type, panel: `p${s.panel}`, side: s.side, params: s.params, color: s.color,
      ...(s.name !== undefined ? { name: s.name } : {}),
      ...(s.symbol !== undefined ? { symbol: s.symbol } : {}),
      ...(s.anchor !== undefined ? { anchor: s.anchor } : {}),
      ...(s.style !== undefined ? { style: s.style } : {}),
      expr: seriesLabel(s),
    })),
  }));
  return `${JSON.stringify({ format: MACRO_FORMAT, version: MACRO_VERSION, macros }, null, 2)}\n`;
}
