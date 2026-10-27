// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import type { Candle } from "../../hooks/useTickCache";

const DAY = 86400;

/**
 * The header's last-price delta (spec §4.5): against the previous close on
 * the 1D chip, against the first visible bar otherwise. `basis` is the
 * tooltip's text, which is how the reading says which it is. "Previous
 * close" is the last bar of the previous UTC day among the loaded bars --
 * the tick plane's days are UTC days until slice 4 knows the exchange.
 */
export function heroDelta(
  candles: Candle[], visibleFrom: number | null, preset: "1D" | "5D" | "1M" | "Custom" | null,
): { change: number; percent: number; basis: string } | null {
  const last = candles.at(-1);
  if (last === undefined) return null;
  const against = (reference: number, basis: string) =>
    reference === 0 ? null : { change: last.close - reference, percent: ((last.close - reference) / reference) * 100, basis };
  if (preset === "1D") {
    const today = Math.floor(last.time / DAY);
    // Walk back from the newest bar rather than copying and reversing the
    // whole array: the previous day's last bar is usually a few bars back.
    for (let i = candles.length - 1; i >= 0; i -= 1) {
      const candle = candles[i]!;
      if (Math.floor(candle.time / DAY) < today) return against(candle.close, "vs previous close");
    }
    return null;
  }
  const first = candles.find((c) => visibleFrom === null || c.time >= visibleFrom) ?? candles[0];
  if (first === last && candles.length < 2) return null;
  return against(first.open, "vs first visible bar");
}
