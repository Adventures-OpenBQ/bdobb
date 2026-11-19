// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DatasetColumn } from '../types';
import type { RecipeOptions } from './types';

type Role = { key: string; label: string; names: string[]; optional?: boolean; numeric?: boolean; date?: boolean };
export const adjustedPriceRole: Role = { key: 'price', label: 'Adjusted price', names: ['adjusted_close', 'adj_close', 'adjusted_price'], numeric: true };
const dateRole = { key: 'date', label: 'Observation date', names: ['date', 'trading_date', 'observation_date'], date: true };
export function bindingRoles(kind: RecipeOptions['kind'], metric: 'eps' | 'revenue'): Role[] {
  if (kind === 'yield-curve') return [dateRole, { key: 'maturity', label: 'Maturity', names: ['maturity', 'tenor'] },
    { key: 'rate', label: 'Normalized rate', names: ['rate', 'yield'], numeric: true }];
  if (kind === 'estimate-range') return [
    { key: 'periodEnd', label: 'Period end', names: ['period_ending', 'period_end'], date: true },
    { key: 'fiscalPeriod', label: 'Fiscal period', names: ['fiscal_period'], optional: true },
    { key: 'status', label: 'Band status', names: ['band_status'] },
    { key: 'note', label: 'Band note', names: ['band_note'], optional: true },
    { key: 'low', label: 'Low', names: [metric + '_low'], numeric: true },
    { key: 'average', label: 'Average', names: [metric + '_avg', metric + '_average'], numeric: true },
    { key: 'high', label: 'High', names: [metric + '_high'], numeric: true },
  ];
  return [dateRole, adjustedPriceRole,
    { key: 'symbol', label: 'Symbol field', names: ['symbol', 'ticker'], optional: true }];
}
export function acceptsBinding(role: Role, c: DatasetColumn): boolean {
  if (c.analytical || c.measureId || c.aggregation || c.splitPath?.length) return false;
  if (role.date && (c.dtype === 'date' || c.dtype === 'dateString')) return true;
  if (c.dtype && (role.numeric ? c.dtype !== 'number' : !['text', 'date', 'dateString'].includes(c.dtype))) return false;
  if (role.key === 'price') {
    if ([c.id, c.sourceFieldId].some(id => id && /^(?:open|high|low|close|unadjusted_close|volume|rate|yield|(?:eps|revenue)(?:_.*)?)$/i.test(id))) return false;
    if (c.dtype === 'number') return true; // An explicit choice can identify a custom adjusted-price series.
  }
  return role.names.includes((c.sourceFieldId ?? c.id).toLowerCase());
}

export function bindingCandidates(role: Role, columns: DatasetColumn[]): DatasetColumn[] {
  return columns.filter(column => acceptsBinding(role, column));
}

/** Check saved roles against the current presentation before either projection or execution. */
export function savedBindingIssue(options: RecipeOptions, columns: DatasetColumn[]): string | undefined {
  const fields: Record<string, string | undefined> = options.fields;
  for (const role of bindingRoles(options.kind, options.kind === 'estimate-range' ? options.metric : 'eps')) {
    const id = fields[role.key];
    if (id === undefined) continue;
    const column = columns.find(c => c.id === id);
    if (!column) return `Field ${id} is unavailable. Repair chart fields.`;
    if (!acceptsBinding(role, column)) return `Field ${id} cannot supply ${role.label.toLowerCase()}. Repair chart fields.`;
  }
}
