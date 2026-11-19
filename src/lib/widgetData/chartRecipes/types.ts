// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkedFigureResult } from '../chartFigure';

export type PriceBindings = { date: string; price: string; symbol?: string };

export type RecipeOptions =
  | { version: 1; kind: 'drawdown'; fields: PriceBindings; symbols: string[] }
  | { version: 1; kind: 'yield-curve'; fields: { date: string; maturity: string; rate: string } }
  | { version: 1; kind: 'estimate-range'; fields: { periodEnd: string; fiscalPeriod?: string; status: string; note?: string; low: string; average: string; high: string }; metric: 'eps' | 'revenue' }
  | { version: 1; kind: 'monthly-returns'; fields: PriceBindings; symbol: string }
  | { version: 1; kind: 'correlation'; fields: PriceBindings; symbols: string[]; lookback: number; minOverlap: number };

export type RecipeContext = { theme: 'light' | 'dark'; maxDecimals: number; today: string };

/** A successful revision identifies the chart question and stays stable across data refreshes. */
export type RecipeResult = LinkedFigureResult;
