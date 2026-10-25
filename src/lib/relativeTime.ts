// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/**
 * "Last refresh 5 minutes ago", the way the Workspace's timer tooltip says
 * it. Coarse on purpose: the tooltip is re-rendered once a minute, so
 * seconds would only ever be wrong. A stamp in the future (a clock that
 * moved back) reads as just now rather than as a negative age.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const ago = Math.max(0, now - ms);
  if (ago < 45_000) return "just now";
  // Rounded, so 59.5 minutes and up is 60 -- which reads as an hour.
  const minutes = Math.max(1, Math.round(ago / MINUTE));
  if (minutes < 60) return format.format(-minutes, "minute");
  if (ago < DAY) return format.format(-Math.max(1, Math.floor(ago / HOUR)), "hour");
  if (ago <= 7 * DAY) return format.format(-Math.floor(ago / DAY), "day");
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
