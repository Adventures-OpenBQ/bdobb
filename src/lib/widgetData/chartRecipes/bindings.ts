// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { statementOwnedIds } from '../../statementModel/types';
import { read } from './estimateEvidence';
import { acquiredColumnOrigin, isoDate } from './financialEvidence';
import { adjustedPriceOrigins, priceDateOrigins } from './priceEvidence';
import type { DatasetColumn, DatasetRow, WidgetDataset } from '../types';
import type { RecipeOptions } from './types';

type Role = { key: string; label: string; names: string[]; optional?: boolean; numeric?: boolean; date?: boolean; strictOrigin?: true };
export const adjustedPriceRole: Role = { key: 'price', label: 'Adjusted price', names: adjustedPriceOrigins, numeric: true };
const dateRole = { key: 'date', label: 'Observation date', names: priceDateOrigins, date: true };
const weightRole: Role = { key: 'weight', label: 'Reported weight', names: ['weight'], numeric: true };
const incomeIds = statementOwnedIds({ id: 'income', version: '1.0.0' });

/** Identifies the compiler's FY/FQ money-column shape. The actual period still needs acquired proof. */
export function isIncomePeriodColumn(column: DatasetColumn): boolean {
  const member = column.splitPath?.[0];
  return column.measureId === incomeIds.value && column.splitPath?.length === 1 && member?.categoryId === incomeIds.period
    && (member.transform === 'FY' || member.transform === 'FQ') && column.aggregation === 'sum'
    && column.dtype === 'number' && !column.analytical;
}

export function bubblePriceDates(dataset: WidgetDataset, dateField: string): string[] {
  return [...new Set(dataset.rows.map(row => read(row, dateField)).filter(isoDate))].sort().reverse();
}

const acquiredRole = (key: string, label: string, field: string, variant?: 'numeric' | 'date' | 'optional'): Role =>
  ({ key, label, names: [field], strictOrigin: true, ...(variant ? { [variant]: true } : {}) });

export function bindingRoles(kind: RecipeOptions['kind'], metric: 'eps' | 'revenue', mode: 'sector' | 'region' = 'sector'): Role[] {
  if (kind === 'bubble-regression') return [
    acquiredRole('symbol', 'Qualified listing', 'symbol'),
    acquiredRole('date', 'Price-data date', 'last_day_data_date', 'date'),
    acquiredRole('dividendYield', 'Fractional dividend yield', 'dividend_yield', 'numeric'),
    acquiredRole('priceChange', 'Fractional five-day price change', 'price_change_5d', 'numeric'),
    acquiredRole('marketCap', 'Listing-currency market cap', 'market_cap', 'numeric'),
    acquiredRole('exchange', 'Listing exchange', 'exchange'),
    acquiredRole('currency', 'Listing denomination', 'currency_symbol'),
    acquiredRole('name', 'Company name', 'name', 'optional'),
    acquiredRole('sector', 'Sector', 'sector', 'optional'),
  ];
  if (kind === 'dividend-steps') return [
    acquiredRole('date', 'Ex-dividend date', 'ex_dividend_date', 'date'),
    acquiredRole('amount', 'Split-adjusted amount', 'amount', 'numeric'),
    acquiredRole('currency', 'Payment currency', 'currency'),
    acquiredRole('frequency', 'Distribution type', 'frequency', 'optional'),
  ];
  if (kind === 'news-sentiment-calendar') return [
    acquiredRole('timestamp', 'Article timestamp', 'date', 'date'),
    acquiredRole('articleId', 'Stable article URL', 'url'),
    acquiredRole('instrument', 'Qualified article listings', 'symbols'),
    acquiredRole('polarity', 'Article polarity', 'polarity', 'numeric'),
  ];
  if (kind === 'income-sankey') return [];
  if (kind === 'yield-curve') return [dateRole, { key: 'maturity', label: 'Maturity', names: ['maturity', 'tenor'] },
    { key: 'rate', label: 'Normalized rate', names: ['rate', 'yield'], numeric: true }];
  if (kind === 'estimate-range') return [
    { key: 'periodEnd', label: 'Period end', names: ['period_ending', 'period_end'] },
    { key: 'fiscalPeriod', label: 'Fiscal period', names: ['fiscal_period'], optional: true },
    { key: 'status', label: 'Band status', names: ['band_status'] },
    { key: 'note', label: 'Band note', names: ['band_note'], optional: true },
    { key: 'low', label: 'Low', names: [metric + '_low'], numeric: true },
    { key: 'average', label: 'Average', names: [metric + '_avg', metric + '_average'], numeric: true },
    { key: 'high', label: 'High', names: [metric + '_high'], numeric: true },
  ];
  if (kind === 'etf-pareto') return [
    { key: 'holding', label: 'Holding', names: ['symbol', 'ticker', 'holding_id'] },
    { key: 'label', label: 'Holding label', names: ['name', 'label', 'holding_name'], optional: true },
    weightRole,
  ];
  if (kind === 'etf-exposure') return [
    { key: 'category', label: 'Exposure category', names: mode === 'sector' ? ['sector'] : ['country', 'region'] },
    weightRole,
  ];
  return [dateRole, adjustedPriceRole,
    { key: 'symbol', label: 'Symbol field', names: ['symbol', 'ticker'], optional: true }];
}
export function acceptsBinding(role: Role, c: DatasetColumn, rows?: DatasetRow[]): boolean {
  const origin = acquiredColumnOrigin(c);
  if (origin === undefined || (role.strictOrigin && !role.names.includes(origin))) return false;
  if (role.date && (c.dtype === 'date' || c.dtype === 'dateString')) return true;
  if (c.dtype && (role.numeric ? c.dtype !== 'number' : !['text', 'date', 'dateString'].includes(c.dtype))) return false;
  if (role.key === 'price') {
    if ([c.id, c.sourceFieldId].some(id => id && /^(?:open|high|low|close|unadjusted_close|volume|rate|yield|(?:eps|revenue)(?:_.*)?)$/i.test(id))) return false;
    if (c.dtype === 'number') return true; // An explicit choice can identify a custom adjusted-price series.
    // Raw snapshots reach pure builders before the table executor infers column types.
    // Use delivered values for an explicit custom binding only when the column is numeric.
    if (!c.dtype && rows && !role.names.includes(origin.toLowerCase())) {
      let observed = false;
      for (const row of rows) {
        const value = row.values[c.id];
        if (value == null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        observed = true;
      }
      return observed;
    }
  }
  return role.names.includes(origin.toLowerCase());
}

export function bindingCandidates(role: Role, columns: DatasetColumn[]): DatasetColumn[] {
  return columns.filter(column => acceptsBinding(role, column));
}

/** Check saved roles against the current presentation before either projection or execution. */
export function savedBindingIssue(options: RecipeOptions, columns: DatasetColumn[], rows?: DatasetRow[]): string | undefined {
  if (options.kind === 'income-sankey') {
    const column = columns.find(c => c.id === options.periodColumn);
    if (!column) return `Field ${options.periodColumn} is unavailable. Repair the selected income statement period.`;
    if (!isIncomePeriodColumn(column)) return `Field ${options.periodColumn} cannot supply a fiscal period. Repair the selected income statement period.`;
    return;
  }
  const fields: Record<string, string | undefined> = options.fields;
  for (const role of bindingRoles(options.kind, options.kind === 'estimate-range' ? options.metric : 'eps', options.kind === 'etf-exposure' ? options.mode : undefined)) {
    const id = fields[role.key];
    if (id === undefined) continue;
    const column = columns.find(c => c.id === id);
    if (!column) return `Field ${id} is unavailable. Repair chart fields.`;
    if (!acceptsBinding(role, column, rows)) return `Field ${id} cannot supply ${role.label.toLowerCase()}. Repair chart fields.`;
  }
}
