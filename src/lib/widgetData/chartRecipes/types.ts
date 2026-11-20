// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkedFigureResult } from '../chartFigure';
import type { NewsCalendarDay } from './newsCalendar';

export type PriceBindings = { date: string; price: string; symbol?: string };

export type BubbleBindings = {
  symbol: string; date: string; dividendYield: string; priceChange: string; marketCap: string;
  exchange: string; currency: string; name?: string; sector?: string;
};
export type DividendBindings = { date: string; amount: string; currency: string; frequency?: string };

export type NewsCalendarOptions = {
  version: 1;
  kind: 'news-sentiment-calendar';
  fields: { timestamp: string; articleId: string; instrument: string; polarity: string };
  instrument: string;
  window: { mode: 'latest-12-months' } | { mode: 'pinned'; start: string; end: string };
};

export type RecipeOptions =
  | { version: 1; kind: 'drawdown'; fields: PriceBindings; symbols: string[] }
  | { version: 1; kind: 'yield-curve'; fields: { date: string; maturity: string; rate: string } }
  | { version: 1; kind: 'estimate-range'; fields: { periodEnd: string; fiscalPeriod?: string; status: string; note?: string; low: string; average: string; high: string }; metric: 'eps' | 'revenue' }
  | { version: 1; kind: 'monthly-returns'; fields: PriceBindings; symbol: string }
  | { version: 1; kind: 'correlation'; fields: PriceBindings; symbols: string[]; lookback: number; minOverlap: number }
  | { version: 1; kind: 'return-distribution'; fields: PriceBindings; symbol: string; bins: number }
  | { version: 1; kind: 'small-multiples'; fields: PriceBindings; symbols: string[] }
  | { version: 1; kind: 'etf-pareto'; fields: { holding: string; label?: string; weight: string } }
  | { version: 1; kind: 'etf-exposure'; fields: { category: string; weight: string }; mode: 'sector' | 'region' }
  | { version: 1; kind: 'bubble-regression'; fields: BubbleBindings; priceDate: string; regression: boolean }
  | { version: 1; kind: 'dividend-steps'; fields: DividendBindings; instrument: string }
  | { version: 1; kind: 'income-sankey'; periodColumn: string }
  | NewsCalendarOptions;

export type RecipeContext = { theme: 'light' | 'dark'; maxDecimals: number; today: string; viewportWidth?: number };

/** A successful revision identifies the chart question and stays stable across data refreshes. */
export type RecipeRefusal = Extract<LinkedFigureResult, { ok: false }>;
export type RecipeResult = (Extract<LinkedFigureResult, { ok: true }> & { daySummaries?: NewsCalendarDay[] }) | RecipeRefusal;
