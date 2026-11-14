// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { getHost } from "../../host";
import type { HostDates, Preview } from "../../host/dates";
import { parseWireDatetime } from "../dates";

/**
 * Whether `wireResolver` may hand `text` to the server exactly as typed,
 * rather than resolving it to an instant first. Only `OBS-n`, on either
 * plane (spec 2026-11-04 §2): it names a fact about the trade data (the n-th
 * most recent trade) that only the server can answer -- kdb-ws counts its own
 * trades on the tick plane, live-grid counts EODHD's on the EODHD one. Every
 * other expression is resolved to an instant by the host's grammar first.
 *
 * A malformed expression (`parseExpression` returns null) is never sent
 * raw -- there is nothing here for the server to parse either.
 */
export function sendRaw(text: string, _eodhd: boolean): boolean {
  const expr = getHost().dates.parseExpression(text);
  if (expr === null) return false;
  return expr.start.anchor.kind === "obs";
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
  return getHost().dates.isExpression("datetime", raw) || parseWireDatetime(raw) !== null;
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
export function anchorPreview(text: string, ctx: Parameters<HostDates["previewExpression"]>[2] = {}): Preview | null {
  const raw = text.trim();
  if (raw === "") return null;
  const expr = getHost().dates.parseExpression(raw);
  if (expr !== null && expr.start.anchor.kind === "obs") {
    return { text: `the last ${expr.start.anchor.n.toLocaleString()} trades, counted by the server`, fallback: false };
  }
  const preview = getHost().dates.previewExpression("datetime", raw, ctx);
  if (preview !== null) return preview;
  return parseWireDatetime(raw) === null ? null : { text: raw, fallback: false };
}
