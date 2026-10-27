// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import {
  isExpression, parseExpression, parseWireDatetime, previewExpression,
  type Preview, type Unit,
} from "../dateExpressions";

/**
 * The six named anchors live-grid resolves itself, and the six offset units
 * it parses on one -- `live-grid/app/anchors.py`'s own grammar, which is
 * narrower than the client's (final whole-branch review, B1). The client
 * additionally has `S`/`E`, the period anchors (`W0 M0 Q0 Y0 FQ0 FY0`), and
 * the wider unit set (`w m q y fq fy`); none of those parse on the server,
 * so an expression using them must be resolved here, not echoed raw.
 *
 * `AnchorName` (dateExpressions' own six-plus-`S`/`E` union) isn't exported,
 * so this set is typed as a plain string set rather than imported -- its
 * six literals are still exactly that union minus `S`/`E`.
 */
const LIVE_GRID_NAMED_ANCHORS: ReadonlySet<string> = new Set([
  "T", "now", "trade_date", "prev_trade_date", "session_open", "session_close",
]);
const LIVE_GRID_OFFSET_UNITS: ReadonlySet<Unit> = new Set(["s", "min", "h", "d", "bd"] satisfies Unit[]);

/**
 * Whether `wireResolver` may hand `text` to the server exactly as typed,
 * rather than resolving it to an instant first. Two cases:
 *
 * - An `OBS-n` anchor, on EITHER plane: it names a fact about the trade
 *   data (the n-th most recent trade) that only the server can answer, so
 *   it always rides raw -- kdb-ws counts its own trades on the tick plane,
 *   live-grid counts EODHD's on the EODHD one.
 * - Any other expression, but only on the EODHD plane, and only when it
 *   stays inside live-grid's narrower grammar: a bare named anchor from the
 *   six-name set above, with every offset's unit in the six-unit set above.
 *   `S`/`E`, a period anchor, or a wider unit falls through to `false` and
 *   is resolved to an instant by the caller instead.
 *
 * A malformed expression (`parseExpression` returns null) is never sent
 * raw -- there is nothing here for the server to parse either.
 */
export function sendRaw(text: string, eodhd: boolean): boolean {
  const expr = parseExpression(text);
  if (expr === null) return false;
  if (expr.start.anchor.kind === "obs") return true;
  if (!eodhd) return false;
  const { anchor, offsets } = expr.start;
  if (anchor.kind !== "named") return false;
  if (!LIVE_GRID_NAMED_ANCHORS.has(anchor.name)) return false;
  return offsets.every((o) => LIVE_GRID_OFFSET_UNITS.has(o.unit));
}

/**
 * Whether an anchor field's text is something the chart can actually use
 * (owner, 2026-09-27: "make the anchor time support the v5 date entry paradigm
 * including OBS-100, etc").
 *
 * The field was a plain text param, judged only on being non-empty, so a typo
 * rode all the way to the socket -- which answers a bad anchor by closing, and
 * every study on the card goes with it. Two things are legal:
 *
 * - a v5 DATETIME expression, which is the whole grammar the range fields
 *   already take: `T@14:00`, `T-1bd@close`, `session_open`, `now-30min`, and
 *   `OBS-n`, the trade count only the server can answer;
 * - a literal instant, which is what the wire actually stores (an anchor is
 *   absolute UTC on the wire) and what a saved card round-trips. It is NOT an
 *   expression -- `isExpression` says so -- so it needs its own arm here, or
 *   every anchor the app itself wrote would read as invalid.
 */
export function anchorValid(text: string): boolean {
  const raw = text.trim();
  if (raw === "") return false;
  return isExpression("datetime", raw) || parseWireDatetime(raw) !== null;
}

/**
 * What to show under the anchor field: the expression resolved right now, the
 * same reading the Custom range gives its own expressions.
 *
 * `OBS-n` resolves to no time at all and `previewExpression` returns null for
 * it -- correctly, because which trade was the n-th most recent is a fact
 * about the server's data, not a calculation. Saying so beats a blank line
 * that reads as "this did not parse".
 *
 * A literal echoes itself, and anything invalid is null -- the field's own
 * red border is what says so.
 */
export function anchorPreview(text: string, ctx: Parameters<typeof previewExpression>[2] = {}): Preview | null {
  const raw = text.trim();
  if (raw === "") return null;
  const expr = parseExpression(raw);
  if (expr !== null && expr.start.anchor.kind === "obs") {
    return { text: `the last ${expr.start.anchor.n.toLocaleString()} trades, counted by the server`, fallback: false };
  }
  const preview = previewExpression("datetime", raw, ctx);
  if (preview !== null) return preview;
  return parseWireDatetime(raw) === null ? null : { text: raw, fallback: false };
}
