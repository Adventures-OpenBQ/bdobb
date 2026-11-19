// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from '../../isRecord';
import type { DatasetProvenance, WidgetDataset } from '../types';
import { read } from './estimateEvidence';
import { calendarDate, observationSymbol } from './priceEvidence';

export type BackendEtfAcquisition = { endpoint: string; parameters: Record<string, string>; retrievedAt: number };
export type EtfEvidence = {
  version: 1; fund: string; kind: 'holdings' | 'sector' | 'region'; basis: 'fund-assets' | 'equity-exposure';
  holdingsCoverage: 'unknown' | 'partial' | 'complete'; asOf?: string; retrievedAt?: number; acquiredAt?: number; issue?: string;
  sourceWidgetId: string; acquiredRowCount: number;
};
type EvidenceResult = { ok: true; evidence: EtfEvidence; notes: string[] } | { ok: false; message: string };
const refuse = (message: string) => ({ ok: false, message }) as const;
const isKind = (value: unknown): value is EtfEvidence['kind'] => value === 'holdings' || value === 'sector' || value === 'region';
const isCoverage = (value: unknown): value is EtfEvidence['holdingsCoverage'] => value === 'unknown' || value === 'partial' || value === 'complete';
const basisFor = (kind: EtfEvidence['kind']) => kind === 'holdings' ? 'fund-assets' : 'equity-exposure';
const fundOf = (value: unknown) => observationSymbol(value)?.toUpperCase();
const validDate = (value: unknown): value is string => typeof value === 'string' && value === calendarDate(value);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && calendarDate(value)
  ? Date.parse(value) : NaN;

function route(acquisition?: BackendEtfAcquisition) {
  if (!acquisition) return;
  const match = /^\/?(?:api\/v1\/)?(eodhd\/)?etf\/(holdings|sectors|countries)\/?$/.exec(acquisition.endpoint);
  if (!match || (!match[1] && acquisition.parameters.provider !== 'eodhd')) return;
  return match[2] === 'holdings' ? 'holdings' : match[2] === 'sectors' ? 'sector' : 'region';
}

const aggregate = (dataset: WidgetDataset) => dataset.provenance.inputMayContainAggregates ||
  dataset.rows.some(row => row.groupPath !== undefined) ||
  dataset.columns.some(c => c.aggregation || c.measureId || c.splitPath?.length || c.analytical?.scope === 'aggregate');

function rowIssue(dataset: WidgetDataset, evidence: EtfEvidence): string | undefined {
  // Holdings identify the constituent in symbol. The exposure routes repeat the queried fund.
  const fundFields = ['fund_symbol', 'fundsymbol', 'etf_symbol', 'etfsymbol', 'fund_ticker', 'etf_ticker', 'fund'];
  if (evidence.kind !== 'holdings') fundFields.push('symbol', 'ticker');
  const checks = [
    { names: fundFields, valid: (v: unknown) => fundOf(v) === evidence.fund, issue: 'The acquired rows contain inconsistent ETF fund identity.' },
    { names: ['weight_basis', 'weightbasis', 'basis'], valid: (v: unknown) => v === evidence.basis, issue: 'The acquired rows contain inconsistent ETF weight basis.' },
    { names: ['etf_kind', 'etfkind', 'exposure_kind'], valid: (v: unknown) => v === evidence.kind, issue: 'The acquired rows contain inconsistent ETF exposure kinds.' },
  ];
  const weights = dataset.columns.filter(c => (c.sourceFieldId ?? c.id).toLowerCase() === 'weight');
  if (!weights.length) return 'The acquired ETF source needs an original fractional weight field.';
  for (const column of dataset.columns) {
    const names = [column.id.toLowerCase(), column.sourceFieldId?.toLowerCase()];
    for (const check of checks) {
      if (check.names.some(name => names.includes(name)) && dataset.rows.some(row => !check.valid(read(row, column.id)))) return check.issue;
      if (weights.includes(column) && Object.entries(column.metadata ?? {}).some(([key, value]) => check.names.includes(key.toLowerCase()) && !check.valid(value))) return check.issue;
    }
  }
  if (weights.some(c => c.analytical || c.measureId || c.aggregation || c.splitPath?.length || (c.dtype && c.dtype !== 'number')
      || dataset.rows.some(row => {
        const weight = read(row, c.id);
        return typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1;
      }))) return 'An acquired ETF weight is missing, has a cell error, or is not an original fraction in [0, 1].';
}

/** Certify the delivered raw acquisition once. A downstream table cannot establish omitted facts. */
export function etfAcquisitionProvenance(dataset: WidgetDataset, acquisition?: BackendEtfAcquisition): DatasetProvenance {
  const { provenance, completeness, rows } = dataset;
  if (provenance.metadata?.etfEvidence !== undefined || provenance.presentation || provenance.lineage?.length ||
      ('kind' in dataset && dataset.kind === 'chartData')) return provenance;
  const { receipt } = provenance;
  const kindFromRoute = route(acquisition);
  const hasReceipt = receipt && ['fund_symbol', 'etf_kind', 'weight_basis', 'holdings_coverage', 'as_of', 'retrieved_at'].some(key => Object.hasOwn(receipt, key));
  if (!kindFromRoute && !hasReceipt) return provenance;
  const withEvidence = (evidence: EtfEvidence | { version: 1; issue: string }) =>
    ({ ...provenance, metadata: { ...provenance.metadata, etfEvidence: evidence } });
  const invalid = (issue: string) => withEvidence({ version: 1, issue });
  const kind = kindFromRoute ?? receipt?.etf_kind;
  const requestFund = fundOf(acquisition?.parameters.symbol);
  const receiptFund = fundOf(receipt?.fund_symbol);
  const fund = kindFromRoute ? requestFund : receiptFund;
  if (!isKind(kind) || !fund || (acquisition?.parameters.symbol !== undefined && requestFund !== fund) ||
      (kindFromRoute && acquisition?.parameters.provider !== undefined && acquisition.parameters.provider !== 'eodhd'))
    return invalid('Choose an ETF source acquired for one fund and a compatible exposure kind.');
  const basis = basisFor(kind);
  if (receipt && (receiptFund !== fund || receipt.etf_kind !== kind || receipt.weight_basis !== basis))
    return invalid('The ETF receipt must establish the same fund, exposure kind and weight basis as the acquisition.');
  const coverage = receipt?.holdings_coverage ?? 'unknown';
  const asOf = receipt?.as_of;
  const receiptTime = receipt?.retrieved_at === undefined ? undefined : timestamp(receipt.retrieved_at);
  if (!isCoverage(coverage) || (asOf !== undefined && !validDate(asOf)) ||
      (receiptTime !== undefined && !validTime(receiptTime)) || (acquisition && !validTime(acquisition.retrievedAt)))
    return invalid('The ETF receipt needs valid coverage, snapshot date and retrieval time.');
  if (!provenance.sourceWidgetId.trim() || completeness.acquiredRowCount !== rows.length || aggregate(dataset))
    return invalid('Use raw ETF observations with their original acquisition scope and lineage.');
  const retrievedAt = receiptTime ?? acquisition?.retrievedAt;
  const evidence: EtfEvidence = { version: 1, kind, fund, basis, holdingsCoverage: coverage,
    sourceWidgetId: provenance.sourceWidgetId, acquiredRowCount: rows.length,
    ...(receiptTime !== undefined && acquisition && receiptTime !== acquisition.retrievedAt ? { acquiredAt: acquisition.retrievedAt } : {}),
    ...(asOf !== undefined ? { asOf } : {}), ...(retrievedAt !== undefined ? { retrievedAt } : {}) };
  const issue = rowIssue(dataset, evidence);
  return withEvidence(issue ? { ...evidence, issue } : evidence);
}

function validEvidence(value: unknown): value is EtfEvidence {
  return isRecord(value) && value.version === 1 && typeof value.fund === 'string' && fundOf(value.fund) === value.fund
    && isKind(value.kind) && value.basis === basisFor(value.kind) && isCoverage(value.holdingsCoverage)
    && typeof value.sourceWidgetId === 'string' && !!value.sourceWidgetId.trim()
    && typeof value.acquiredRowCount === 'number' && Number.isSafeInteger(value.acquiredRowCount) && value.acquiredRowCount >= 0
    && (value.asOf === undefined || validDate(value.asOf)) && (value.retrievedAt === undefined || validTime(value.retrievedAt))
    && (value.acquiredAt === undefined || validTime(value.acquiredAt)) && value.issue === undefined;
}

export function readEtfEvidence(dataset: WidgetDataset, expected: EtfEvidence['kind']): EvidenceResult {
  const { provenance, completeness, rows } = dataset;
  const evidence = provenance.metadata?.etfEvidence;
  if (aggregate(dataset)) return refuse('Choose raw ETF observations before grouping, pivoting or aggregation.');
  if (isRecord(evidence) && typeof evidence.issue === 'string') return refuse(evidence.issue);
  if (!validEvidence(evidence)) return refuse('Use an acquired ETF route or a snapshot receipt with the fund, exposure kind and original weight basis.');
  if (evidence.kind !== expected) return refuse('Choose an ETF source with the requested exposure kind.');
  const { lineage, presentation } = provenance;
  const producer = lineage?.at(-1);
  if (presentation && (!producer || producer.widgetId !== presentation.revision.widgetId
      || producer.resultRevision !== presentation.revision.model || producer.outputRevision !== presentation.revision.output
      || rows.length > presentation.rowCount || presentation.rowCount > evidence.acquiredRowCount))
    return refuse('The linked ETF source has lost its presented table revision or row scope.');
  if (evidence.sourceWidgetId !== provenance.sourceWidgetId || (lineage?.length && lineage[0].widgetId !== evidence.sourceWidgetId)
      || completeness.acquiredRowCount !== evidence.acquiredRowCount || rows.length > evidence.acquiredRowCount)
    return refuse('The ETF source lineage or acquired row count is unavailable.');
  const notes = [`Transport coverage is ${completeness.kind}. Provider holdings coverage is ${evidence.holdingsCoverage}.`];
  if (rows.length < evidence.acquiredRowCount) notes.push(`Filtered source delivered ${rows.length} of ${evidence.acquiredRowCount} acquired rows.`);
  else notes.push(`${rows.length} acquired row${rows.length === 1 ? '' : 's'} delivered.`);
  notes.push(evidence.asOf ? `Snapshot as of ${evidence.asOf}.` : expected === 'holdings' ? 'Holdings as-of date not supplied.' : 'Snapshot as-of date not supplied.');
  if (evidence.retrievedAt !== undefined) notes.push(`Snapshot retrieved ${new Date(evidence.retrievedAt).toISOString()}.`);
  if (evidence.acquiredAt !== undefined) notes.push(`Request completed ${new Date(evidence.acquiredAt).toISOString()}.`);
  return { ok: true, evidence, notes };
}
