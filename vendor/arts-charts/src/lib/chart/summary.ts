// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { shownAs } from "./rangeExpr";

/**
 * The collapsed status row's centred summary (spec 2026-09-24, D7): one line
 * describing what the chart is ACTUALLY showing -- the interval, the resolved
 * range, and the session (with the exchange when the regular session is in
 * force). Pure by design: no React and no chart, so StatusBar renders it and
 * summary.test.ts pins it without a DOM (spec, Testing).
 *
 * The layout name joins this line only once sub-project D gives layouts names
 * (spec, What the user sees); it is deliberately absent here, which is why the
 * mockup's trailing "· Default" segment is not produced yet.
 *
 * Truncation is the CSS's job (`.chart-status-summary` ellipsises), so this
 * never shortens its own text: the full string is what the tooltip and the
 * accessible name carry.
 */
export function chartSummary({
  interval,
  range,
  session,
  exchange,
  timeZone,
}: {
  interval: string;
  /**
   * The range as resolved instants (from `resolveRange`), or null when the
   * card carries no range at all -- the fitted view, which has no dates to
   * name. Null omits the segment rather than printing an invalid date.
   */
  range: { from: number; to: number } | null;
  session: "extended" | "regular" | "24hr";
  exchange: string | null;
  /**
   * The zone the dates read in -- the exchange's when it has one, the viewer's
   * otherwise, and UTC when none is given so the output is deterministic under
   * test. Only the date's calendar day depends on it.
   */
  timeZone?: string;
}): string {
  const parts: string[] = [shownAs(interval)];
  if (range !== null) parts.push(`${isoDate(range.from, timeZone)} to ${isoDate(range.to, timeZone)}`);
  // Regular names the exchange as its own segment, mirroring the toolbar's
  // "Regular · XNYS" pill (spec 2026-09-24, D3). Extended and 24hr stand
  // alone. A card with no exchange is never in the regular session (the
  // toggle is not even shown), so it falls through to Extended/24hr and adds
  // no dangling separator.
  if (session === "regular" && exchange !== null) {
    parts.push("Regular", exchange);
  } else if (session === "24hr") {
    parts.push("24hr");
  } else {
    parts.push("Extended");
  }
  return parts.join(" · ");
}

/**
 * A resolved instant (epoch SECONDS) as `YYYY-MM-DD` in the given zone (UTC
 * when none). en-CA renders the ISO field order the mockup's summary uses.
 */
function isoDate(epochSeconds: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timeZone ?? "UTC",
  }).format(new Date(epochSeconds * 1000));
}
