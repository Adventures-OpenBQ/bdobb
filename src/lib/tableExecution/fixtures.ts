// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDataset } from '../widgetData/types';
import type { Revision, TableDefinition } from './types';
export const input: WidgetDataset = { rows: [10, 20, 90].map((revenue, i) => ({ id: `r${i}`, values: { revenue, region: i < 2 ? 'A' : 'B', team: String(i), date: `2026-01-0${i + 1}` } })), columns: [{ id: 'revenue', label: 'Revenue', dtype: 'number' }, { id: 'region', label: 'Region', dtype: 'text' }, { id: 'team', label: 'Team', dtype: 'text' }, { id: 'date', label: 'Date', dtype: 'date' }], resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 'source' }, completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false } };
export const definition: TableDefinition = { search: '', table: { pivot: { enabled: true, grouping: ['region', 'team'], split: [], aggregationFns: { revenue: 'mean', date: 'last' } } } };
export const revision: Revision = { widgetId: 'source', input: 1, model: 1, output: 1 };
