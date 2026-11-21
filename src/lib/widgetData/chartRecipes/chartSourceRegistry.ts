// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceRegistry } from './chartSourceContracts';
import { dailyPriceSourceAdapter } from './dailyPriceEvidence';
import { estimateVintageAdapter } from './estimateVintageEvidence';
import { etfHierarchyAdapter } from './etfHierarchyEvidence';
import { marketMapAdapter } from './marketMapEvidence';
import { metricSourceAdapter } from './metricEvidence';
import { newsSourceAdapter } from './newsEvidence';
import { overlayAdapter } from './overlayEvidence';
import { ownershipSourceAdapter } from './ownershipEvidence';

/** Only reviewed, source-specific adapters belong here. Local-only adapters have no routes. */
export const chartSourceRegistry: ChartSourceRegistry = Object.freeze({
  'etf-hierarchy': etfHierarchyAdapter, news: newsSourceAdapter, ownership: ownershipSourceAdapter, metric: metricSourceAdapter,
  'estimate-vintages': estimateVintageAdapter, 'market-map': marketMapAdapter, overlay: overlayAdapter,
  'daily-price': dailyPriceSourceAdapter,
});
