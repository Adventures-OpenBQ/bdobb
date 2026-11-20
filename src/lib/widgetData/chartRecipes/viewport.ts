// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { PlotlyFigure } from '../../chartShapes';
import type { RecipeOptions } from './types';

export function smallMultiplesGrid(width: number, count: number): { columns: number; rows: number; height: number } {
  const columns = Math.min(count, width < 640 ? 1 : width < 960 ? 2 : 3);
  const rows = columns === 0 ? 0 : Math.ceil(count / columns);
  return { columns, rows, height: rows * 220 + 60 };
}

export function nextMultiplesWidth(current: number, measured: number, panels: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return current;
  const width = Math.min(measured, 10_000);
  return smallMultiplesGrid(width, panels).columns === smallMultiplesGrid(current, panels).columns ? current : width;
}

export const maxRecipeViewportDimension = 10_000;
export const estimateRevisionMinPlotHeight = 230;

/** Baseline drawing width before accounting for precise ticks and consolidated hover. */
export function estimateRevisionMinPlotWidth(vintages: number): number {
  return Math.max(320, 130 + 60 * vintages);
}

// Browser-verified drawing surface for both unit-bearing overlay axis titles.
export const dualAxisOverlayMinPlotWidth = 320;
export const dualAxisOverlayMinPlotHeight = 210;

export type Range = [number, number];
// Plotly 3.7 cartesian cleanRange clamps linear coordinates to constants/numerical.js FP_SAFE.
const plotlySafeMagnitude = Number.MAX_VALUE * 1e-4;

export function extents(values: readonly number[]): Range {
  let min = Infinity, max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  return [min, max];
}

export function valueRange(values: readonly number[], zeroScale: number): Range | undefined {
  const [min, max] = extents(values);
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (!Number.isFinite(scale) || scale >= plotlySafeMagnitude) return;
  const span = max - min;
  const padding = span === 0 ? (scale || zeroScale) * 0.1 : span * 0.08;
  const lo = Math.max(min - padding, -plotlySafeMagnitude), hi = Math.min(max + padding, plotlySafeMagnitude);
  if (lo < min && max < hi) return [lo, hi];
}

// Plotly's cartesian c2p uses this arithmetic and rounds the SVG coordinate to hundredths of a pixel.
export function axisPixels([lo, hi]: Range, length: number, vertical: boolean) {
  const slope = length / (vertical ? lo - hi : hi - lo);
  const offset = -slope * (vertical ? hi : lo);
  return (value: number) => Math.round((offset + slope * value) * 100) / 100;
}

export function drawableValues(values: readonly number[], range: Range, height: number) {
  const pixel = axisPixels(range, height, true);
  const [low, high] = extents(values);
  if (low !== high && !(pixel(low) > pixel(high))) return false;
  return values.every(value => {
    const position = pixel(value);
    const stablePosition = ((range[1] - value) / (range[1] - range[0])) * height;
    // A loss greater than one SVG quantization step indicates cancellation in the renderer.
    return position > 0 && position < height && Math.abs(position - stablePosition) <= .01;
  });
}

export const newsCalendarPlotHeight = 260;
export const returnSummaryPlotHeight = 280;
export const ownershipPlotHeight = 240;
export function ownershipPlotWidth(view: 'bars' | 'waffle'): number {
  return view === 'bars' ? 270 : 310;
}

/** Leave room for each listing's date pair at the normal Plotly text size. */
export function returnSummaryPlotWidth(listings: number): number {
  return 90 + 178 * listings;
}

/** These recipe builders supply a plot height for the card’s scroll viewport. */
export function recipePlotHeight(kind: RecipeOptions['kind'], figure: PlotlyFigure): number | undefined {
  if (kind !== 'small-multiples' && kind !== 'etf-exposure' && kind !== 'income-sankey') return;
  const height = figure.layout.height;
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : undefined;
}
