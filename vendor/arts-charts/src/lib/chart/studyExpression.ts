// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import type { StudyInstance } from "../types";

/**
 * The `/ta_registry` catalog shape (studies addendum §3). `float` is optional:
 * a JSON `2.0` deserialises to the same JS number as `2`, so whether a default
 * like BBANDS' `k` was written `2` or `2.0` cannot be recovered after the fact
 * -- the registry has to say so explicitly, and an older backend that hasn't
 * caught up yet simply omits the field.
 */
type CatalogParam = {
  name: string; default: number | string | null; text: boolean; float?: boolean;
  /**
   * v12.3.0 (slice 4): whether this param is a WINDOW -- a lookback the `bd`
   * unit may be spelled on. The same fact the entry's `windows` list carries,
   * projected per param by `/ta_registry`; this module reads the list, since
   * the rule below is about the entry as a whole. Optional: an older backend
   * omits it, and absent reads as false.
   */
  window?: boolean;
  /**
   * v12.3.1 (the pack): the registry's own human name for the field
   * (`Length`, `StdDev multiplier`), and the increment a float field steps
   * by. Both optional -- an older backend projects neither, and the picker
   * falls back to the param's wire name and the browser's default step.
   */
  label?: string; step?: number;
};
export type CatalogEntry = {
  name: string; label: string; pane: "price" | "own"; price_basis: string; convention: string;
  /**
   * The names of this entry's window params, in the registry's own words
   * (`macd` -> `["fast", "slow", "signal"]`). Empty for a study with no
   * window at all, and empty from an older backend that does not project
   * it -- which then simply never accepts a `bd` (see unifyWindows).
   */
  windows: readonly string[];
  // `readonly`: the fixtures (here and in useTaRegistry's tests) build a catalog
  // entry with `as const` for its literal `pane`/`render` unions, which makes
  // `params` a readonly tuple -- nothing in this module ever mutates it.
  params: readonly CatalogParam[]; guides: readonly number[]; band: boolean; render: "line" | "dots" | "bar";
  colors: Record<string, string | null>; sessioned: boolean; eodhd: { function: string; note: string } | null;
  /**
   * v12.3.1 (the picker): the registry's own words for how an indicator is
   * presented -- which tab it sits under, its long name, what it measures,
   * and the Wikipedia article behind the `Wikipedia` link. All four are
   * optional because an older backend projects none of them, and nothing
   * client-side stands in for them: the degraded reading is group "Other",
   * the label as the title, and no help text at all (see catalogGroup and
   * catalogTitle below).
   */
  group?: string; title?: string; description?: string; wiki?: string | null;
  /**
   * v12.3.1 (the pack): `full` is the long name the picker's config pane
   * heads with -- the same string B2 still projects as `title` for one
   * release -- and `desc` is the one-line reading under it. Optional for
   * the same reason as the four above.
   */
  full?: string; desc?: string;
  /**
   * Custom studies (docs/custom-studies.md): the registry's per-output pen
   * (lib/chart/pen.ts) and, for a banded study, its fill defaults -- the
   * shade colour, its opacity and the hatch. All optional: an older backend
   * projects none, and the chart then draws solid lines and shades in the
   * series colour at the default opacity, exactly as before.
   */
  pens?: Record<string, string>; widths?: Record<string, number>; shade?: string | null; fill_opacity?: number | null; fill_pattern?: string;
};

/** The picker tab an entry belongs to; "Other" when the registry omits it. */
export const catalogGroup = (entry: CatalogEntry): string => entry.group ?? "Other";

/** An entry's long name: `full`, then B2's transitional `title`, then the label. */
export const catalogTitle = (entry: CatalogEntry): string => entry.full ?? entry.title ?? entry.label;

/**
 * A `wiki` href the picker may actually render (final review, finding 2).
 * The catalog is remote JSON read leniently -- `wiki` is never validated on
 * the way in -- and React does not sanitise an anchor's `href`, so a
 * `javascript:` or `data:` value from a compromised or buggy backend would
 * otherwise become a clickable script URL inside the app's WebView. `https:`
 * only, not merely "not javascript:": an allowlist, not a denylist.
 */
export const safeWiki = (url: string | null | undefined): string | undefined =>
  url !== null && url !== undefined && url.startsWith("https://") ? url : undefined;

/**
 * What to CALL a study's reference link, read from the link itself.
 *
 * The href is the registry's, not ours (`CatalogEntry.wiki`), and the picker
 * used to label it "Wikipedia" in both places it renders -- so the moment the
 * backend pointed a study somewhere better the app would have said Wikipedia
 * and linked elsewhere. The owner is moving studies to Investopedia, whose
 * indicator pages are editorially reviewed and dated where a Wikipedia
 * indicator article is often neither, and which covers studies Wikipedia
 * barely does (Supertrend). This lets that happen one study at a time.
 *
 * The two known hosts are named so they read properly; anything else falls
 * back to its bare hostname, which is honest without needing a table of every
 * site a registry might ever cite. `www.` is dropped, and a host we cannot
 * parse reads "Reference" rather than throwing inside a render.
 */
export function referenceLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Reference";
  }
  if (host.endsWith("wikipedia.org")) return "Wikipedia";
  if (host.endsWith("investopedia.com")) return "Investopedia";
  return host;
}

/**
 * The study expression grammar (studies addendum §2): a DESCRIPTION language,
 * not a formula language -- no arithmetic, no nesting, no eval. Anything the
 * allowlist charset does not admit fails the parse outright; anything else
 * that fails does so silently, which is why every failure is `null`.
 */
const CHARSET = /^[0-9A-Za-z.,:@\s()#-]*$/;                // the addendum's set, plus the parens the grammar needs and the one #RRGGBB it allows
const SHAPE = /^\s*([A-Za-z]+)\s*\(\s*([^()]*?)\s*\)\s*(?:(#[0-9A-Fa-f]{3,8}))?\s*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const ANCHOR = /^[0-9A-Za-z:@.-]+$/;                       // T@14:00, FQ0@open, T-1bd@close, an ISO date
/**
 * v12.3.0 (slice 4): a window in BUSINESS days on an otherwise numeric param
 * -- `SMA(50bd)` is the 49 prior session closes plus today's running bar. No
 * sign, no fraction, lower case only: the wire's spelling is the only one,
 * so `50BD` and `-50bd` are rejected rather than silently normalised.
 */
const BUSINESS_DAYS = /^\d+bd$/;

/** Whether a numeric param's value is a `bd` window in the wire's own spelling. */
export const isBusinessDays = (value: string): boolean => BUSINESS_DAYS.test(value);

export type ParseOptions = {
  /**
   * `bd` needs an exchange calendar to mean anything, so the renderer passes
   * `false` for the asset classes that have none (crypto, forex) and the arg
   * is rejected there like any other non-number. Absent means allowed: slice
   * 3's callers pass no options at all.
   */
  allowBusinessDays?: boolean;
};

/**
 * `#abc` -> six digits by doubling each nibble (`abc` becomes `aabbcc`);
 * `#aabbccdd` -> its first six digits, dropping the alpha byte; six digits
 * as-is; null for anything else. Spelled out rather than shown as a literal
 * `#`+six-hex example: that shape is exactly what createChartTheme.test.ts'
 * colour-grep guard scans every chart file for, and a doc comment is not
 * exempt from it.
 */
function sixDigit(color: string): string | null {
  const hex = color.slice(1).toLowerCase();
  if (hex.length === 6) return `#${hex}`;
  if (hex.length === 8) return `#${hex.slice(0, 6)}`;
  if (hex.length === 3 || hex.length === 4) return `#${hex.slice(0, 3).split("").map((c) => c + c).join("")}`;
  return null;
}

/**
 * ONE UNIT PER STUDY (v12.3.0, slice 4). A `bd` on any window of an entry
 * pulls every OTHER window of that entry to `bd` as well -- an explicit bare
 * number and a filled-in default alike -- so `MACD(12bd)` and
 * `MACD(12bd, 26, 9)` both mean `MACD(12bd, 26bd, 9bd)`. The addendum's
 * grammar says nothing about mixing units; the ledger's ruling is that a
 * study has one, and the backend agrees: live-grid rejects a request whose
 * window params disagree (`macd:fast=12bd:slow=26:signal=9` is a bad
 * request), so a mixed study built here could only ever be refused. Only the
 * names in `entry.windows` are touched -- `bbands:k=2bd` is not a window and
 * is refused outright by the parser below.
 *
 * Returns `params` itself when there is nothing to unify, so a caller that
 * re-renders on identity (the editor's preview) is not handed a new object
 * every keystroke.
 */
export function unifyWindows(
  params: Record<string, number | string>, entry: CatalogEntry,
): Record<string, number | string> {
  const carries = entry.windows.some((name) => {
    const value = params[name];
    return typeof value === "string" && BUSINESS_DAYS.test(value);
  });
  if (!carries) return params;
  const out = { ...params };
  for (const name of entry.windows) {
    const value = out[name];
    if (typeof value === "number") out[name] = `${value}bd`;
  }
  return out;
}

export function parseStudyExpression(
  text: string, lookup: (name: string) => CatalogEntry | undefined, options: ParseOptions = {},
): { name: string; params: Record<string, number | string>; color: string | null } | null {
  if (!CHARSET.test(text)) return null;
  const match = SHAPE.exec(text);
  if (match === null) return null;
  const [, rawName, rawArgs, rawColor] = match;
  const entry = lookup(rawName.toLowerCase());
  if (entry === undefined) return null;
  const args = rawArgs.trim() === "" ? [] : rawArgs.split(",").map((a) => a.trim());
  if (args.length > entry.params.length) return null;
  const params: Record<string, number | string> = {};
  for (const [i, param] of entry.params.entries()) {
    const arg = args[i];
    if (arg === undefined || arg === "") {
      if (param.default === null) return null;                // an anchor has no default
      params[param.name] = param.default;
      continue;
    }
    if (param.text) {
      if (!ANCHOR.test(arg)) return null;
      params[param.name] = arg;
    } else if (BUSINESS_DAYS.test(arg)) {
      // A bd window stays a STRING here, in `params` and on the wire: the
      // unit is the server's to read, and Number("50bd") is NaN -- there is
      // no numeric form of it to keep. normalizeExpression prints a string
      // param as-is, so the identity string is `SMA(50bd)`.
      if (options.allowBusinessDays === false) return null;
      // A window unit belongs on a window: the registry names them, and the
      // backend refuses a `bd` anywhere else (`bbands:k=2bd`).
      if (!entry.windows.includes(param.name)) return null;
      params[param.name] = arg;
    } else {
      if (!NUMBER.test(arg)) return null;
      params[param.name] = Number(arg);
    }
  }
  const color = rawColor === undefined ? null : sixDigit(rawColor);
  if (rawColor !== undefined && color === null) return null;
  return { name: entry.name, params: unifyWindows(params, entry), color };
}

/** A param's text in the normalised form: a float-typed param keeps `.0`. */
export function argText(param: CatalogParam, value: number | string): string {
  if (typeof value === "string") return value;
  return param.float === true && Number.isInteger(value) ? `${value}.0` : String(value);
}

/** The identity string (addendum §2.4): name, args, and a trailing colour. */
export function normalizeExpression(
  name: string, params: Record<string, number | string>, entry: CatalogEntry, color?: string | null,
): string {
  const args = entry.params.map((p) => argText(p, params[p.name] ?? p.default ?? "")).join(", ");
  const head = `${name.toUpperCase()}(${args})`;
  return color ? `${head} ${color.toLowerCase()}` : head;
}

/** The chip's text: the expression without its colour. */
export function expressionLabel(instance: StudyInstance): string {
  return instance.expr.replace(/\s#[0-9a-f]{6}$/i, "");
}

/** The registry's first colour for this study, else the fallback (a token value). */
export function defaultColor(entry: CatalogEntry, fallback: string): string {
  return Object.values(entry.colors).find((c): c is string => typeof c === "string") ?? fallback;
}

export function instanceFromParse(
  parsed: { name: string; params: Record<string, number | string>; color: string | null },
  entry: CatalogEntry, fallbackColor: string,
): StudyInstance {
  const color = parsed.color ?? defaultColor(entry, fallbackColor);
  // No `source`: the chart's own `source` parameter is the one source of
  // truth (v12.3.1 ruling), so an instance never carries one of its own.
  return { expr: normalizeExpression(parsed.name, parsed.params, entry, color), name: parsed.name, params: parsed.params, color };
}
