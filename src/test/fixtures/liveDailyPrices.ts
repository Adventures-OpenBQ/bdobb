// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { datasetFromRows } from '../../lib/localTableData';
import type { Row } from '../../lib/tableColumns';
import { captureChartSources, chartRequestContext } from '../../lib/widgetData/chartRecipes/chartSourceContracts';
import type { DailyPriceReceipt } from '../../lib/widgetData/chartRecipes/dailyPriceEvidence';
import type { PriceCoordinate } from '../../lib/widgetData/chartRecipes/priceEvidence';
import { dailyPriceParameters, dailyPricePaths, dailyPriceReceipt, dailyPriceResponse } from './chartSources';

export function liveDailyPriceDataset(input: Row[], symbols: string[], {
  omissions = [], unsafe = {}, bounds = { start_date: '2026-01-01', end_date: '2026-01-31' },
}: {
  omissions?: PriceCoordinate[];
  unsafe?: Partial<DailyPriceReceipt['unsafe']>;
  bounds?: { start_date: string; end_date: string };
} = {}) {
  const rows = structuredClone(input);
  const multiple = symbols.length > 1;
  const listings = symbols.map(symbol => {
    const delivered = multiple ? rows.filter(row => row.symbol === symbol).length : rows.length;
    const missing = omissions.filter(([listing]) => listing === symbol);
    return { symbol, raw_count: delivered + missing.length, normalized_count: delivered, delivered_count: delivered,
      duplicate_count: 0, omissions: missing };
  });
  const receipt = {
    ...dailyPriceReceipt, ...bounds, symbols, symbol_field: multiple ? 'symbol' : null, listings,
    raw_count: rows.length + omissions.length, normalized_count: rows.length, delivered_count: rows.length,
    unsafe: { ...dailyPriceReceipt.unsafe, ...unsafe }, diagnostics: Object.keys(unsafe).sort(),
  };
  const parameters = { ...dailyPriceParameters, ...bounds, symbol: symbols.join(',') };
  const url = new URL(`https://example.com${dailyPricePaths[0]}?${new URLSearchParams(parameters)}`);
  const request = chartRequestContext(url, 'results', 1);
  if (!request) throw new Error('Invalid daily-price fixture request');
  const response = dailyPriceResponse(receipt, rows);
  const chartSources = captureChartSources(request, response, response.results);
  return datasetFromRows(rows, 'root', 1, 'backend', undefined, [], undefined, { ...request, chartSources });
}
