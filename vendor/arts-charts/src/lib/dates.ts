// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * Date expressions come from the host (spec 2026-11-04 §1, S4): every grammar
 * call is `getHost().dates`, made at the call site. Only the wire formatting of an instant,
 * which is `@internationalized/date` and not grammar, lives in this file.
 */
import { getLocalTimeZone, parseAbsolute, type ZonedDateTime } from "@internationalized/date";

/**
 * `2026-09-14T09:30:15-04:00`: local time to the second with the UTC offset
 * and WITHOUT the `[America/New_York]` suffix ZonedDateTime.toString() adds.
 * The millisecond is zeroed first — toString() prints a fraction only when it
 * is non-zero — so a non-zero millisecond can never leak a fractional second
 * onto the wire. Zeroing goes through `subtract`, not `set({ millisecond: 0 })`:
 * `set` re-resolves the wall-clock time with 'compatible' disambiguation, which
 * during the DST fall-back repeated hour silently picks the earlier offset —
 * `subtract` keeps the offset the instant already had.
 */
export const wireDatetime = (at: ZonedDateTime): string =>
  at.subtract({ milliseconds: at.millisecond }).toString().replace(/\[.*\]$/, "");

const orNull = <T>(parse: () => T): T | null => {
  try {
    return parse();
  } catch {
    return null;
  }
};

/** A stored literal, or null when it is not one (an expression, junk, ""). */
export const parseWireDatetime = (value: string, zone: string = getLocalTimeZone()): ZonedDateTime | null =>
  orNull(() => parseAbsolute(value, zone));
