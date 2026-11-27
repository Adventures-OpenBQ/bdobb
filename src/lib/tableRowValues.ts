// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { WidgetDataset } from './widgetData/types';
import type { TableSpec } from './types';
import { isRecord } from './isRecord';
import { localChartSources, type ChartSourceMap } from './widgetData/chartRecipes/chartSourceContracts';
import { financialRowsAgree, financialScopeAgrees, parseFinancialEvidence, type FinancialEvidence } from './widgetData/chartRecipes/financialEvidence';
/** One record of a table payload. */
export type Row = Record<string, unknown>;
/** Shared acquisition shape check, independent of renderer and Pivot calculation imports. */
export function tableRows(data: unknown, spec?: TableSpec): Row[] | null {
  if (Array.isArray(data)) return data.every(isRecord) ? data : null;
  // Some model endpoints (ECB reference rates) return one record. Only a
  // declared schema can establish that an object is a row, not an envelope
  // or error. Preserve exact wire keys and leave the source object untouched.
  if (isRecord(data) && spec?.columns.length) {
    const keys = Object.keys(data);
    const declared = new Set(spec.columns.map(c => c.field));
    if (keys.length > 0 && keys.every(key => declared.has(key))) return [data];
  }
  return null;
}

/** Identify an explicit acquisition envelope before a widget selects or transforms its rows. */
export function isTableSnapshotEnvelope(data: unknown): data is Record<string, unknown> {
  return isRecord(data) && ['rows', 'completeness'].every(key => Object.hasOwn(data, key));
}

export type Snapshot = {
  receipt?: Record<string, string>;
  chartSources?: ChartSourceMap;
  financialEvidence?: FinancialEvidence;
  completeness: WidgetDataset['completeness']['kind'];
};

/** Only the local file boundary can recognize financial evidence inside a snapshot. */
export function parseTableSnapshot(data: unknown, source: 'backend' | 'local-file' = 'backend'): { data: unknown; snapshot?: Snapshot } {
  if (!isRecord(data)) return { data };
  const legacy = Object.hasOwn(data, 'receipt');
  const financial = source === 'local-file' && Object.hasOwn(data, 'chart_evidence');
  const chart = source === 'local-file' && Object.hasOwn(data, 'chart_sources');
  if (!legacy && !financial && !chart && !isTableSnapshotEnvelope(data)) return { data };
  const { rows, receipt, completeness } = data;
  const kinds = ['complete', 'bounded', 'paged', 'partial', 'sample', 'unknown'] as const;
  const kind = kinds.find(k => k === completeness);
  const keys = ['interval', 'start_date', 'end_date', 'symbol', 'currency', 'unit', 'date',
    'fund_symbol', 'etf_kind', 'weight_basis', 'holdings_coverage', 'as_of', 'retrieved_at'];
  const records = tableRows(rows);
  if (!legacy && !financial && !chart && records) {
    // An explicit negative scope is meaningful on its own. An affirmative one needs its receipt.
    const scope = kind && kind !== 'complete' && kind !== 'bounded' ? kind : 'unknown';
    return { data: rows, snapshot: { completeness: scope } };
  }
  if (!kind || !records || Object.keys(data).some(k => !['rows', 'receipt', 'completeness', 'chart_evidence', ...(chart ? ['chart_sources'] : [])].includes(k))
    || (legacy && (!isRecord(receipt) || !Object.entries(receipt).every(([k, v]) => keys.includes(k) && typeof v === 'string' && v.trim() && v.length <= 4096))))
    throw new Error('Invalid table snapshot');
  const financialEvidence = financial ? parseFinancialEvidence(data.chart_evidence) : undefined;
  if (financial && (!financialEvidence || !financialScopeAgrees(financialEvidence, kind) || !financialRowsAgree(financialEvidence, records)))
    throw new Error('Invalid table snapshot');
  const chartSources = chart ? localChartSources(data.chart_sources, records, kind, receipt) : undefined;
  if (chart && !chartSources) throw new Error('Invalid table snapshot');
  return { data: rows, snapshot: { ...(chartSources ? { chartSources } : {}), ...(legacy ? { receipt: receipt as Record<string, string> } : {}), completeness: kind,
    ...(financialEvidence ? { financialEvidence } : {}) } };
}
