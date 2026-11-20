// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { LinkedFigureResult } from '../chartFigure';
import type { EtfHierarchy } from './etfSunburst';
import type { OverlaySeriesPair } from './dualAxisOverlay';
import type { EstimateRevisionData } from './estimateRevisions';
import type { MarketMapHierarchy } from './marketMap';
import type { NewsCalendarDay } from './newsCalendar';
import type { ReturnSummaryWindow } from './priceSamples';
import type { ReturnSummaryDetails } from './returnSummary';
import type { OwnershipBarRole } from './ownershipEvidence';
import type { OwnershipSnapshotDetails } from './ownershipSnapshot';

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

export type ReturnSummaryOptions = {
  version: 1;
  kind: 'return-summary';
  fields: PriceBindings;
  symbols: string[];
  view: 'box' | 'violin';
  window: ReturnSummaryWindow;
};

export type OwnershipSnapshotOptions = {
  version: 1;
  kind: 'ownership-snapshot';
  issuer: string;
} & (
  | { view: 'bars'; fields: Partial<Record<OwnershipBarRole, string>> }
  | { view: 'waffle'; fields: { bucket: string; share: string } }
);

export type EtfSunburstOptions = {
  version: 1;
  kind: 'etf-sunburst';
  fund: string;
  depth: 1 | 2;
  snapshot: string; // 'latest' or an explicit acquired coordinate
  fields: { holding: string; sector: string; weight: string };
};

export type DualAxisOverlayOptions = {
  version: 1;
  kind: 'dual-axis-overlay';
  recipe: 'price-eps' | 'cpi-ten-year';
  fields: { series: string; date: string; value: string; availableAt?: string; targetStart?: string; targetEnd?: string };
};

export type EstimateRevisionsOptions = {
  version: 1;
  kind: 'estimate-revisions';
  metric: 'eps' | 'revenue';
  view: 'slope' | 'path' | 'bump';
  target: { start: string; end: string; kind: 'FY' | 'FQ' };
  vintages: string[];
  fields: { issuer: string; vintage: string; targetStart: string; targetEnd: string; targetKind: string; value: string };
};

export type MarketMapOptions = {
  version: 1;
  kind: 'market-map';
  mode: 'delivered-cap' | 'index-weight';
  universe: string;
  session: string; // 'latest' or one explicit completed session
  fields: { listing: string; sector: string; area: string; change: string; session: string };
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
  | NewsCalendarOptions
  | ReturnSummaryOptions
  | OwnershipSnapshotOptions
  | EtfSunburstOptions
  | DualAxisOverlayOptions
  | EstimateRevisionsOptions
  | MarketMapOptions;

/** Closed recipe options accepted by the worker boundary. */
export type RecipeRequestOptions = RecipeOptions;

export type RecipeContext = { theme: 'light' | 'dark'; maxDecimals: number; today: string; viewportWidth?: number; viewportHeight?: number };

export type EstimateRevisionsSurface = { width: number; height: number };

/** A successful revision identifies the chart question and stays stable across data refreshes. */
export type RecipeRefusal = Extract<LinkedFigureResult, { ok: false }>;
export type RecipeResult = ((Extract<LinkedFigureResult, { ok: true }> & {
  daySummaries?: NewsCalendarDay[];
  etfHierarchy?: EtfHierarchy;
  marketMap?: MarketMapHierarchy;
  overlay?: OverlaySeriesPair;
  estimateRevisions?: EstimateRevisionData;
  returnSummary?: ReturnSummaryDetails;
  ownershipSnapshot?: OwnershipSnapshotDetails;
}) | RecipeRefusal) & {
  estimateRevisionsSurface?: EstimateRevisionsSurface;
};
