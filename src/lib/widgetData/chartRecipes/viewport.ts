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

// Browser-verified drawing surface for both unit-bearing overlay axis titles.
export const dualAxisOverlayMinPlotWidth = 320;
export const dualAxisOverlayMinPlotHeight = 210;

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
