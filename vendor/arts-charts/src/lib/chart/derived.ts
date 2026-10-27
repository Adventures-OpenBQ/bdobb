// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import type { Candle } from "../../hooks/useTickCache";

/**
 * Series data derived client-side from the loaded bars (spec: panels and
 * series) -- volume, close line/area, OHLC bars and performance are not
 * their own studies; they read straight off `Candle[]`. Colours come in
 * from the theme adapter (no chart file names a colour: createChartTheme.
 * test.ts greps for exactly that).
 */

export function volumeData(bars: Candle[], up: string, down: string): { time: number; value: number; color: string }[] {
  return bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? up : down }));
}

export function closeData(bars: Candle[]): { time: number; value: number }[] {
  return bars.map((b) => ({ time: b.time, value: b.close }));
}

export function ohlcData(bars: Candle[]): { time: number; open: number; high: number; low: number; close: number }[] {
  return bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
}

/**
 * Percent change of the close, rebased at the first bar whose time is at or
 * after `anchorTime`. Bars before the anchor are omitted, not drawn against
 * it. A null anchor, an anchor past the last bar, or a zero rebase close
 * all yield `[]` -- the last so this never divides by zero.
 */
export function performanceData(bars: Candle[], anchorTime: number | null): { time: number; value: number }[] {
  if (anchorTime === null) return [];
  const startIndex = bars.findIndex((b) => b.time >= anchorTime);
  if (startIndex === -1) return [];
  const base = bars[startIndex]!.close;
  if (base === 0) return [];
  return bars.slice(startIndex).map((b) => ({ time: b.time, value: (b.close / base - 1) * 100 }));
}
