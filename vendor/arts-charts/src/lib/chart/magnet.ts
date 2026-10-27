// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import type { Candle } from "../../hooks/useTickCache";
import type { ChartPoint } from "../types";

/**
 * Magnet mode (spec §7.2): a drawing endpoint snaps to the nearest of its
 * bar's open, high, low or close. A tie goes to the extreme -- the high
 * above, the low below -- because the extreme is the price a trader means
 * when they aim between a close and a wick.
 */
export function snapToBar(candles: Candle[], point: ChartPoint, intervalSeconds: number): ChartPoint {
  const bucket = Math.floor(point.time / intervalSeconds) * intervalSeconds;
  const bar = candles.find((c) => c.time === bucket);
  if (bar === undefined) return point;
  // Extremes first, so a tie keeps the extreme (strict < below).
  const prices = [bar.high, bar.low, bar.open, bar.close];
  let best = prices[0];
  for (const price of prices) if (Math.abs(price - point.value) < Math.abs(best - point.value)) best = price;
  return { time: bar.time, value: best };
}
