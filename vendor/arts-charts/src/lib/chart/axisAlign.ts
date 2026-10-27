// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { PanelDef } from "./panels";

export type AxisSide = "left" | "right";
export type AxisSides = { left: boolean; right: boolean };
/** One panel's price axis on one side: whether it is drawn, and how wide at least. */
export type AxisPlan = { visible: boolean; minimumWidth: number };

/**
 * The owner's requirement (2026-09-21): "two chart panels using the same x axis are
 * required to have their tick marks line up", and their design for it: a margin is
 * obeyed EXACTLY -- the labels are fitted to the pixels given (fitLevel, below) -- and a
 * panel that must match another says so, `P1` in its margin (panels.ts), rather than the
 * renderer guessing from geometry. So a panel's axis is its OWN resolved `ymargin`.
 *
 * What is still decided for the STACK (same `left`, same `width`: panels over one span of
 * the one synced time scale) is WHICH sides exist: if any panel in it draws on a side,
 * every panel in it shows that side -- an empty gutter where it plots nothing -- or the
 * plots would start at different x and no margin could line them up.
 *
 * `measured` is the last resort. The library has no maximum width: when even the
 * coarsest labels cannot fit a margin, that axis is wider than asked, and the rest of
 * its stack is widened to match so the ticks still line up. The caller passes a
 * measurement ONLY for a panel whose labels can be fitted no further (0 otherwise).
 *
 * A panel whose `ymargin` is 0 has hidden its price axis (the owner's earlier ruling):
 * it shows no gutter and does not count as drawing a side. Panels that must line up
 * with it inherit the 0 -- `P<n>` -- and are hidden with it.
 */
export function axisPlans(
  panels: readonly PanelDef[], sides: readonly AxisSides[],
  measured: readonly Record<AxisSide, number>[] = [],
): Record<AxisSide, AxisPlan>[] {
  const stackOf = (p: PanelDef): string => `${p.left}:${p.width}`;
  const out = panels.map(() => ({
    left: { visible: false, minimumWidth: 0 }, right: { visible: false, minimumWidth: 0 },
  }));
  for (const side of ["left", "right"] as const) {
    const stacks = new Map<string, number[]>();
    panels.forEach((p, i) => { if (p.ymargin > 0) stacks.set(stackOf(p), [...(stacks.get(stackOf(p)) ?? []), i]); });
    for (const members of stacks.values()) {
      if (!members.some((i) => sides[i]?.[side])) continue;
      const overflow = Math.max(0, ...members.map((i) => measured[i]?.[side] ?? 0));
      for (const i of members) out[i][side] = { visible: true, minimumWidth: Math.max(panels[i].ymargin, overflow) };
    }
  }
  return out;
}

/**
 * How price labels are coarsened to fit a margin, finest first. Level 0 is the library's
 * own formatting (the series' precision; a volume series is already compact). The
 * header and the legend always show the exact figure -- this is the AXIS only.
 *
 * The last level is compact (104.2K) and keeps as many significant digits as it takes to
 * tell neighbouring ticks apart over the range on screen: seen in Chromium 2026-09-21, a
 * fixed two digits labelled a 100K-110K axis "110K, 110K, 110K, 100K, 100K" -- an axis
 * that fits and says nothing. A label that cannot distinguish ticks is never offered.
 */
export const LABEL_LEVELS = 4;
export function labelFormatter(level: number, range: { from: number; to: number } | null): ((price: number) => string) | undefined {
  if (level <= 0) return undefined;
  if (level === 1) return (price) => price.toFixed(1);
  if (level === 2) return (price) => String(Math.round(price));
  const top = range === null ? 1 : Math.max(Math.abs(range.from), Math.abs(range.to), 1e-9);
  const step = range === null ? top : Math.max(Math.abs(range.to - range.from) / 8, 1e-12);
  // Digits needed for one tick step to show: 104,250 over a 10,000 range is 3-4 digits.
  const digits = Math.min(8, Math.max(2, Math.ceil(Math.log10(top / step)) + 1));
  const format = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: digits });
  return (price) => format.format(price);
}

/**
 * The search for a panel's label level, one measured step at a time (a level is applied,
 * painted, and the library's reported axis width read back two frames later).
 *
 * Finest first: the FIRST level whose axis is within the margin wins. If none is -- the
 * library has a floor of its own, about 58px here, that no label can get under (measured:
 * forcing every label to "8M" still gave 58) -- the winner is the finest level that
 * reached the smallest width, so precision is never given up for nothing. `overflow` is
 * then what the axis takes despite the margin, and the rest of its stack is widened to
 * it (axisPlans) so the ticks still line up.
 */
export type LabelSearch = { level: number; widths: number[]; settled: boolean };
export const newLabelSearch = (): LabelSearch => ({ level: 0, widths: [], settled: false });

/**
 * Whether a level's labels still tell neighbouring ticks apart over `range`.
 *
 * The compact level has always asked itself this (it picks its own digit count
 * from the step); levels 1 and 2 did not, and on a symbol quoted near 1 --
 * EURUSD at 1.1432, user 2026-09-26 -- `toFixed(1)` and `Math.round` collapse
 * every tick to "1.1" and "1". Since those strings are also the NARROWEST, the
 * search below preferred them, and the axis read "1, 1, 1, 1, 1".
 *
 * The step is the range over eight, the same estimate `labelFormatter` uses for
 * its compact digits: the library's real tick positions are not ours to read,
 * and a tick count in that neighbourhood is what it draws. Sampled away from
 * the ends, where a range that happens to start on a round number would make
 * any level look like it distinguishes.
 */
export function levelDistinguishes(level: number, range: { from: number; to: number } | null): boolean {
  const format = labelFormatter(level, range);
  if (format === undefined || range === null) return true;
  const step = Math.abs(range.to - range.from) / 8;
  if (!(step > 0)) return true;
  const at = Math.min(range.from, range.to) + step * 3;
  return format(at) !== format(at + step);
}

/** The next level at or after `from` worth trying, or null when none is left. */
function nextUsable(from: number, range: { from: number; to: number } | null): number | null {
  for (let level = from; level < LABEL_LEVELS; level += 1) if (levelDistinguishes(level, range)) return level;
  return null;
}

/**
 * How much narrower a coarser level has to be before it is worth its decimals.
 * At the library's floor every level measures the same to within a pixel of
 * rounding, so without this the tiebreak below hands the axis to the coarsest
 * label for no pixels at all.
 */
const WORTH_A_LEVEL = 2;

export function stepLabelSearch(
  search: LabelSearch, width: number, margin: number,
  range: { from: number; to: number } | null = null,
): LabelSearch & { overflow: number } {
  if (search.settled) return { ...search, overflow: width > margin ? width : 0 };
  const widths = [...search.widths];
  widths[search.level] = width;
  if (width <= margin) return { level: search.level, widths, settled: true, overflow: 0 };
  // Levels whose labels would say the same thing at every tick are not offered,
  // however narrow they are -- so a chart can run out of levels while still on
  // the exact ones, and settle there rather than round its prices away.
  const next = nextUsable(search.level + 1, range);
  if (next !== null) return { level: next, widths, settled: false, overflow: 0 };
  // Nothing fitted. The finest level that came within a pixel or two of the
  // narrowest axis anyone managed: precision is given up only where it buys width.
  const tried = widths.flatMap((w, level) => (w === undefined ? [] : [{ w, level }]));
  const least = Math.min(...tried.map((t) => t.w));
  const winner = tried.find((t) => t.w <= least + WORTH_A_LEVEL) ?? { level: search.level, w: width };
  return { level: winner.level, widths, settled: true, overflow: winner.w };
}
