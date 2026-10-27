// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { StudyInstance } from "../types";
import { isExpression } from "../dateExpressions";
import { defaultColor, isBusinessDays, normalizeExpression, type CatalogEntry, type ParseOptions } from "./studyExpression";

/**
 * v12.3.0 (slice 4): resolves an anchor expression -- `T@14:00`, `FQ0@open`,
 * `T-1bd@close` -- to the absolute instant the wire carries, or null when it
 * cannot (no exchange, no calendar). The renderer supplies it from the
 * symbol's exchange calendar; every caller that has none gets slice 3's
 * behaviour by passing nothing.
 */
export type AnchorResolver = (text: string) => string | null;

/**
 * One param value as the WIRE carries it. An anchor holding a v5 expression
 * is resolved to an absolute instant, because live-grid wants an instant and
 * fails the WHOLE socket on a raw `T@14:00` (observed in slice 3's live
 * check). A literal instant (`2026-09-17T13:30:00Z`), a `bd` window and
 * every number pass through untouched -- none of them parses as a v5
 * expression. Null means the resolver could not answer; the caller then
 * leaves the study off the wire entirely rather than sending the raw text.
 *
 * The catalog is deliberately NOT consulted for which param is anchor-typed
 * (`text: true`): a text param's value is a string, a numeric param's is a
 * number, and no numeric spelling -- `50bd` included -- parses as a v5
 * expression, so the value itself says which it is. That keeps a catalog
 * argument out of both functions below, and out of all four call sites.
 *
 * ponytail: resolution happens when the string is DERIVED (the studies or
 * the exchange change), not on a timer -- a chart left open across midnight
 * keeps the prior day's `T` anchor until something changes. Upgrade path: a
 * midnight tick in the renderer that bumps the resolver's identity.
 */
function wireValue(value: number | string, resolveAnchor: AnchorResolver | undefined): number | string | null {
  if (resolveAnchor === undefined || typeof value !== "string" || !isExpression("datetime", value)) return value;
  return resolveAnchor(value);
}

/**
 * The socket's `indicators` grammar, derived from the card's studies
 * (studies addendum §4): `name:key=value:...` per study, comma-joined, with
 * `source=` ALWAYS explicit and ALWAYS the CHART's source (v12.3.1 ruling:
 * one source of truth per chart -- `options.source`, REQUIRED, since the
 * caller is the one place that knows the card's own parameter and its
 * local default -- never this function's to assume). A `source` left on an
 * instance by a card or preset saved before the ruling is ignored. Saying
 * it per study is still worth the few characters: the server's default for
 * an absent `source` is the card's parameter as read off the connect URL,
 * and an explicit value cannot be read two ways.
 * Params render in the instance's own key order (the
 * catalog's declared param order, since that is how instanceFromParse and
 * studiesFromParam build `params`), values via plain `String()` -- a `bd`
 * window keeps its unit, a number needs no more than that, and an anchor
 * goes through `resolveAnchor` first (wireValue above). A study whose anchor
 * does not resolve is left OUT of the string: the raw expression would fail
 * the socket, taking every other study down with it.
 *
 * The order on the wire is CANONICAL (by `expr`), not the strip's: the
 * string is part of the socket URL, so deriving it from the strip's order
 * would make a chip drag -- a purely client-side reorder -- reconnect
 * /ta_series_ws and blank every study until the next frame. Pane order
 * still follows the strip, through paneLayout's `order` argument.
 *
 * `allowBusinessDays: false` (the final review's I2) leaves a `bd`-windowed
 * study OFF the wire, the same way an unresolvable anchor is: `bd` is
 * refused at every ENTRY for a symbol with no exchange, but the studies
 * survive a symbol switch (spec § "Symbol switch"), so an AAPL card carrying
 * `SMA(50bd)` switched to BTC-USD would otherwise send a window the card
 * could not have been given. The instance stays on the card -- switch back
 * and it is on the wire again.
 */
export function indicatorsParam(
  studies: StudyInstance[], resolveAnchor: AnchorResolver | undefined,
  options: ParseOptions & { source: "local" | "eodhd" },
): string {
  return [...studies]
    .sort((a, b) => a.expr.localeCompare(b.expr))
    .map((study) => {
      const parts = [study.name];
      for (const [key, value] of Object.entries(study.params)) {
        // A bd window with no exchange to count sessions on: drop the study.
        if (options.allowBusinessDays === false && typeof value === "string" && isBusinessDays(value)) return null;
        const wire = wireValue(value, resolveAnchor);
        if (wire === null) return null;                      // an anchor that does not resolve drops its study
        parts.push(`${key}=${String(wire)}`);
      }
      parts.push(`source=${options.source}`);
      return parts.join(":");
    })
    .filter((segment): segment is string => segment !== null)
    .join(",");
}

/** One `name:key=value:...` segment split into a name and its given params. */
function splitSegment(segment: string): { name: string; given: Record<string, string> } {
  const [name, ...rest] = segment.split(":").map((s) => s.trim());
  const given: Record<string, string> = {};
  for (const kv of rest) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    given[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
  }
  return { name, given };
}

/**
 * The pre-12.3.0 card's `indicators` string read back as studies, for the
 * chip strip of a card that has never touched it: an unknown name (the
 * registry no longer serves it, or never did) is skipped rather than
 * failing the whole card, and an omitted param takes the catalog's default
 * -- the same "positional/omitted -> default" rule the expression grammar
 * uses, just keyed by name instead of position since that is this
 * grammar's own shape. Colours come from the registry (defaultColor),
 * never from the string, which predates per-study colour entirely.
 *
 * v12.3.0 (slice 4): a `bd` window on a numeric param is kept as its own
 * string, as parseStudyExpression keeps it -- `Number("50bd")` is NaN and
 * printed `SMA(NaN)` before this. With `allowBusinessDays: false` (a card
 * whose symbol has no exchange) the study is skipped like an unknown name,
 * since the server could not compute it on any session either.
 */
export function studiesFromParam(
  indicators: string,
  lookup: (name: string) => CatalogEntry | undefined,
  fallbackColor: string,
  options: ParseOptions = {},
): StudyInstance[] {
  const out: StudyInstance[] = [];
  for (const raw of indicators.split(",")) {
    const segment = raw.trim();
    if (!segment) continue;
    const { name, given } = splitSegment(segment);
    const entry = lookup(name);
    if (!entry) continue;                                    // the registry no longer knows it
    const params: Record<string, number | string> = {};
    let refused = false;
    for (const p of entry.params) {
      const value = given[p.name];
      if (value === undefined) {
        if (p.default === null) continue;                    // no default and none given
        params[p.name] = p.default;
      } else if (p.text || isBusinessDays(value)) {
        if (!p.text && options.allowBusinessDays === false) { refused = true; break; }
        params[p.name] = value;
      } else {
        params[p.name] = Number(value);
      }
    }
    if (refused) continue;                                   // a bd window with no exchange to count on
    const color = defaultColor(entry, fallbackColor);
    out.push({
      expr: normalizeExpression(entry.name, params, entry, color),
      name: entry.name,
      params,
      color,
    });
  }
  return out;
}

/**
 * Deep-equal on the keys both sides actually carry -- order does not matter.
 * The instance's side goes through wireValue first: `b` is what the SERIES
 * echoed, which is what the wire carried, so an anchored instance can only
 * be compared as the instant it was sent as.
 */
function paramsEqual(
  a: Record<string, number | string>, b: Record<string, unknown>, resolveAnchor: AnchorResolver | undefined,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => wireValue(a[key], resolveAnchor) === b[key]);
}

/**
 * The instance a series' `req` came from (see the openbb-docker v12.3.0
 * studies work: every series carries the request it answered). Matched by
 * name, by params deep-equal on the catalog's own keys, and by the CHART's
 * source (v12.3.1: there is only one) -- a `req.source` of null means the
 * backend served it from the card's own `source` parameter, which is that
 * same chart source, so a null-sourced series matches like an explicit one.
 * A series answering some OTHER source is not this chart's and matches
 * nothing; that can only happen while a source switch is in flight, with
 * the old socket's last frames still arriving. Note this is the REQUESTED
 * source, not the served one: an EODHD study the backend had to compute
 * locally still echoes `req.source: "eodhd"` (and `render.source: "local"`,
 * which is what the strip's parity mark reads).
 * Never matched by the wire's column name: an
 * explicit source changes it (`sma|period=50,source=eodhd`), so the column
 * cannot be the identity here.
 *
 * v12.3.0: `resolveAnchor` is the SAME resolver indicatorsParam was given --
 * an anchored instance holds `T@14:00` while its series echoes the instant
 * that went out, and only the resolver bridges the two. Passing the resolver
 * (rather than precomputing a wire-params map per instance) is the smaller
 * change: the renderer already memoises one resolver for the socket URL, and
 * a map would have to be built and threaded through all three call sites.
 * ponytail: it re-resolves at match time, so a resolver whose answer moves
 * between deriving the string and matching the frame -- midnight, an
 * exchange change that has not yet reconnected -- leaves the series
 * unmatched for a frame. Upgrade path: resolve once alongside the string and
 * carry the resolved params on the instance.
 */
export function matchSeries(
  series: { req?: { name: string; params: Record<string, unknown>; source: string | null } },
  studies: StudyInstance[],
  source: "local" | "eodhd",
  resolveAnchor?: AnchorResolver,
): StudyInstance | undefined {
  const req = series.req;
  if (!req) return undefined;
  if ((req.source ?? source) !== source) return undefined;
  return studies.find(
    (study) => study.name === req.name && paramsEqual(study.params, req.params, resolveAnchor),
  );
}
