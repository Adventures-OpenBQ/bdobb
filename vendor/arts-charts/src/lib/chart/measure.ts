// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import type { ChartPoint } from "../types";
import { formatPrice } from "./formats";

/** `7m`, `1h 30m`, `2d 1h`, `30s`: a span of seconds for the measure label. */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

/**
 * The measure tool's label (spec §7.2): Δprice (Δ%) · N bars · duration,
 * from the press to the release in either direction. The sign is the
 * price's direction of travel, press to release; the minus is U+2212 like
 * the legend's delta chip.
 */
export function measureBetween(
  a: ChartPoint, b: ChartPoint, intervalSeconds: number, decimals: number,
): { text: string; bars: number; change: number; percent: number } {
  const change = b.value - a.value;
  const percent = a.value === 0 ? 0 : (change / a.value) * 100;
  const span = Math.abs(b.time - a.time);
  const bars = Math.round(span / intervalSeconds);
  const sign = change < 0 ? "−" : "+";
  // No sign on the PERCENT (user, 2026-09-26), matching formatDelta: it repeats
  // the sign on the change immediately before it. This readout has no glyph, so
  // the change's own sign carries direction and must stay.
  const text = `Δ ${sign}${formatPrice(Math.abs(change), decimals)} (${formatPrice(Math.abs(percent), 2)}%) · ${bars} bars · ${duration(span)}`;
  return { text, bars, change, percent };
}
