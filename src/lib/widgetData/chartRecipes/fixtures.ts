// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { datasetFromRows } from '../../localTableData';
import type { Row } from '../../tableColumns';
import type { RecipeOptions } from './types';

export const priceFields = { date: 'date', price: 'adjusted_close', symbol: 'symbol' };
export const drawdownOptions = { version: 1, kind: 'drawdown', fields: priceFields, symbols: ['A'] } satisfies RecipeOptions;

export function priceDataset(rows: Row[], start = '2026-01-01', end = '2026-01-31') {
  const dataset = datasetFromRows(structuredClone(rows), 'source', 1, 'localFile');
  dataset.provenance.receipt = { interval: '1d', start_date: start, end_date: end };
  return dataset;
}
