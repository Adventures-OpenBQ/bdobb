// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { isRecord } from "../isRecord";
import type { ChartCardState, ChartDrawing, Series, SeriesType } from "../types";
import { encodePanels, parsePanels } from "./panels";
import { seriesId, symbolAllowed } from "./series";

/**
 * The declarative chart spec (spec §9): the card's whole state as one JSON
 * document, the canonical save/share format. Built from card state, shown
 * in the `{ }` popover, and read back on Apply. Symbol and timeframe come
 * from the card's parameters and saved interval; the rest is ChartCardState.
 *
 * Validation here is SHAPE only. Each study is checked by the caller's
 * `validateStudy` (the renderer builds one on the registry catalog, which
 * this module does not know); without one a legacy `studies` list is
 * carried through as-is.
 */
type ChartSpec = {
  symbol: string;
  timeframe: string;
  range: { from: string; to: string } | null;
  session: "extended" | "regular" | "24hr";
  /** v12.4.0: the card's `panels` PARAMETER text, not card state -- the caller passes it in. */
  panels: string;
  series: Series[];
  drawings: ChartDrawing[];
};

/**
 * The document no longer carries `studies` or `panes` (the branch-end
 * round, finding 7): the card's series ARE its studies since T6, and the
 * renderer strips both before it reads a document back -- so emitting them
 * only invited an unchanged Apply to write dead data into card state.
 * `parseChartSpec` still ACCEPTS them, because a spec saved or shared
 * before this release carries them.
 */
export function buildChartSpec(
  symbol: string, interval: string, state: ChartCardState, panels: string,
): ChartSpec {
  return {
    symbol,
    timeframe: interval,
    range: state.range ?? null,
    session: (state as { session?: "extended" | "regular" | "24hr" }).session ?? "extended",
    panels,
    series: state.series ?? [],
    drawings: state.drawings ?? [],
  };
}

/**
 * v12.4.12: `panels` prints as the dict it is, one panel per line, rather than as a
 * string of escaped JSON. The card's text IS valid JSON (encodePanels), so it is
 * spliced in where a placeholder was printed and the document stays JSON. A text
 * that will not parse as panels is left as the string it is, for the user to fix.
 */
export function specJson(spec: ChartSpec): string {
  const { panels, problems } = parsePanels(spec.panels);
  if (problems.length > 0 || panels.length === 0) return JSON.stringify(spec, null, 2);
  const slot = "\u0000panels\u0000";
  return JSON.stringify({ ...spec, panels: slot }, null, 2)
    .replace(JSON.stringify(slot), () => encodePanels(panels).replace(/\n/g, "\n  "));
}

const KEYS = new Set(["symbol", "timeframe", "range", "session", "panels", "series", "studies", "drawings", "panes"]);

const SERIES_TYPES: readonly SeriesType[] = ["candlestick", "ohlc", "line", "area", "volume", "performance", "study"];

/**
 * One series checked against the panels it claims a place in (spec §9):
 * shape, a known type, an id (when given) that is a non-empty string, a
 * panel that is a real number AND exists in this document's `panels` text,
 * and a side. A performance series must carry its anchor (v12.4.0 fix
 * round: the notation has no anchorless form worth emitting, so the model
 * does not carry one either) and a study series must carry a name, whether
 * or not the caller supplied a `validateStudy` -- an id-less name would
 * reach `indicatorsFromSeries` with nothing to ask the server for. A study
 * is then handed to the caller's `validateStudy` -- the same registry
 * check a v12.3.x `studies` entry gets, since a study series carries the
 * same `name`/`params`/`expr`/`color` fields it reads.
 */
function seriesProblem(
  s: unknown, panelCount: number, validateStudy?: (study: unknown) => string | null,
): string | null {
  if (!isRecord(s)) return ": a series must be an object";
  if (typeof s.type !== "string" || !SERIES_TYPES.includes(s.type as SeriesType)) {
    return `.type: not one of ${SERIES_TYPES.join(", ")}`;
  }
  if (s.id !== undefined && (typeof s.id !== "string" || s.id === "")) return ".id: needs a non-empty string";
  // The `{ }` popover is a paste surface: a non-string symbol reached
  // `named.startsWith(GROUP_PREFIX)` on the render path and threw
  // (the branch-end round, finding 4).
  if (s.symbol !== undefined && (typeof s.symbol !== "string" || s.symbol === "")) {
    return ".symbol: needs a non-empty string";
  }
  // What the server refuses on save is refused here; a study's symbol is dropped on save instead.
  if (typeof s.symbol === "string" && s.type !== "study" && !symbolAllowed(s.type as SeriesType, s.symbol)) {
    return ".symbol: must be a ticker, $ymbol, $group:<Name> or list:<n>";
  }
  if (typeof s.panel !== "number" || !Number.isFinite(s.panel) || !Number.isInteger(s.panel) || s.panel < 1) {
    return ".panel: expected a panel number";
  }
  if (s.panel > panelCount) return `.panel: no panel ${s.panel} (the spec has ${panelCount})`;
  if (s.side !== "left" && s.side !== "right") return '.side: must be "left" or "right"';
  if (typeof s.expr !== "string" || typeof s.color !== "string") return ": needs expr and color";
  if (!isRecord(s.params)) return ": needs params";
  if (s.type === "performance" && (typeof s.anchor !== "string" || s.anchor === "")) {
    return ".anchor: a performance series needs an anchor";
  }
  if (s.type === "study" && (typeof s.name !== "string" || s.name === "")) return ".name: a study needs a name";
  if (s.type === "study" && validateStudy !== undefined) {
    const reason = validateStudy(s);
    if (reason !== null) return `: ${reason}`;
  }
  return null;
}

const isPoint = (p: unknown): p is { time: number; value: number } =>
  isRecord(p) && typeof p.time === "number" && typeof p.value === "number";

function isDrawing(d: unknown): d is ChartDrawing {
  if (!isRecord(d)) return false;
  switch (d.kind) {
    case "segment": case "fib": return isPoint(d.a) && isPoint(d.b);
    case "ray": return isPoint(d.a) && typeof d.slope === "number";
    case "gann": return isPoint(d.a) && Array.isArray(d.slopes) && d.slopes.length === 3 && d.slopes.every((s) => typeof s === "number");
    default: return false;
  }
}

/**
 * The spec text as a card patch, or the first thing wrong with it.
 * `validateStudy` answers null for a well-formed study and the reason
 * otherwise; the first bad one is reported as `studies[i]: <reason>`.
 */
export function parseChartSpec(
  text: string, current: { symbol: string; panels: string }, validateStudy?: (study: unknown) => string | null,
): { patch: Partial<ChartCardState> & { interval?: string; panels?: string }; error: null }
  | { patch: null; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (err) { return { patch: null, error: `not JSON: ${err instanceof Error ? err.message : String(err)}` }; }
  if (!isRecord(raw)) return { patch: null, error: "the spec must be a JSON object" };
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) return { patch: null, error: `unknown key "${key}"` };
  if (raw.symbol !== undefined && raw.symbol !== current.symbol) {
    return { patch: null, error: "the symbol is set on the card, not in the spec" };
  }
  if (raw.timeframe !== undefined && typeof raw.timeframe !== "string") return { patch: null, error: "timeframe must be a string" };
  if (raw.range !== undefined && raw.range !== null
    && !(isRecord(raw.range) && typeof raw.range.from === "string" && typeof raw.range.to === "string")) {
    return { patch: null, error: "range must be { from, to } or null" };
  }
  if (raw.session !== undefined && raw.session !== "extended" && raw.session !== "regular" && raw.session !== "24hr") {
    return { patch: null, error: 'session must be "extended", "regular" or "24hr"' };
  }
  // A dict (what the document prints since v12.4.12) or either text form (a spec
  // saved or shared before then). All three become the one text the card stores.
  if (isRecord(raw.panels)) raw.panels = JSON.stringify(raw.panels);
  if (raw.panels !== undefined && typeof raw.panels !== "string") return { patch: null, error: "panels must be a dict of panels" };
  // The panels the SERIES are numbered against: this document's own text
  // when it carries one, else the card's (the caller's `panels` parameter).
  // Either way it is validated -- a malformed fallback must not silently
  // hand every series a wrong panel count -- but the message says which of
  // the two is at fault, since a document-less fallback error points at
  // text the user pasting a spec is not looking at.
  const panelsText = (raw.panels as string | undefined) ?? current.panels;
  {
    const { problems } = parsePanels(panelsText);
    if (problems.length > 0) {
      return {
        patch: null,
        error: raw.panels !== undefined
          ? `panels: ${problems[0]}`
          : `the card's panels parameter: ${problems[0]}`,
      };
    }
  }
  if (raw.series !== undefined) {
    if (!Array.isArray(raw.series)) return { patch: null, error: "series must be an array" };
    const panelCount = parsePanels(panelsText).panels.length;
    const seenIds = new Set<string>();
    for (const [i, s] of raw.series.entries()) {
      const reason = seriesProblem(s, panelCount, validateStudy);
      if (reason !== null) return { patch: null, error: `series[${i}]${reason}` };
      const id = (s as { id?: unknown }).id;
      if (typeof id === "string") {
        if (seenIds.has(id)) return { patch: null, error: `series[${i}].id: duplicate id "${id}"` };
        seenIds.add(id);
      }
    }
  }
  if (raw.studies !== undefined && !Array.isArray(raw.studies)) return { patch: null, error: "studies must be an array" };
  if (Array.isArray(raw.studies) && validateStudy !== undefined) {
    for (const [i, study] of raw.studies.entries()) {
      const reason = validateStudy(study);
      if (reason !== null) return { patch: null, error: `studies[${i}]: ${reason}` };
    }
  }
  if (raw.drawings !== undefined) {
    if (!Array.isArray(raw.drawings)) return { patch: null, error: "drawings must be an array" };
    const bad = raw.drawings.findIndex((d) => !isDrawing(d));
    if (bad !== -1) return { patch: null, error: `drawings[${bad}] is not a segment, ray, fib or gann` };
  }
  if (raw.panes !== undefined && !(isRecord(raw.panes) && Object.values(raw.panes).every((v) => typeof v === "number" && v > 0))) {
    return { patch: null, error: "panes must map pane ids to positive numbers" };
  }
  const patch: Partial<ChartCardState> & { interval?: string; panels?: string } = {};
  if (typeof raw.timeframe === "string") patch.interval = raw.timeframe;
  // `panels` is a widget PARAMETER, not card state: it rides back on the
  // patch like `interval` and the caller routes it through onParam.
  if (typeof raw.panels === "string") patch.panels = encodePanels(parsePanels(raw.panels).panels);
  // A missing id is filled in here, on apply -- seriesProblem above only
  // refuses one that is present and malformed, so a hand-written spec need
  // not invent ids for series it added.
  if (raw.series !== undefined) {
    patch.series = (raw.series as Array<Record<string, unknown>>).map((s) => (
      typeof s.id === "string" && s.id !== "" ? (s as unknown as Series) : ({ ...s, id: seriesId() } as unknown as Series)
    ));
  }
  if (raw.range !== undefined) patch.range = (raw.range as ChartSpec["range"]) ?? undefined;
  if (raw.session !== undefined) (patch as { session?: string }).session = raw.session as string;
  if (raw.studies !== undefined) (patch as { studies?: unknown[] }).studies = raw.studies as unknown[];
  if (raw.drawings !== undefined) patch.drawings = raw.drawings as ChartDrawing[];
  if (raw.panes !== undefined) patch.panes = raw.panes as Record<string, number>;
  return { patch, error: null };
}
