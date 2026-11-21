// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { asRecord } from '../../isRecord';
import type { DatasetColumn, DatasetProvenance, DatasetRow, WidgetDataset } from '../types';
import { acquiredColumnOrigin, utcTimestamp, type BackendAcquisition } from './financialEvidence';
import { isChartSourceArray as dense, isChartSourceRecord as plain } from './chartSourceShape';
import { chartSourceRegistry } from './chartSourceRegistry';
import type { RecipeRefusal } from './types';

export type ChartSourceReceipt = {
  version: 1;
  kind: 'news' | 'ownership' | 'overlay' | 'estimate-vintages' | 'market-map' | 'etf-hierarchy' | 'metric' | 'daily-price';
  retrieved_at: string;
  raw_count: number;
  normalized_count: number;
  delivered_count: number;
  diagnostics: string[];
  unsafe: Record<string, boolean>;
};
type Kind = ChartSourceReceipt['kind'];
export type ChartSourceMap = Partial<Record<Kind, ChartSourceReceipt>>;
export type ChartBuildResult<T> = { ok: true; value: T; notes: string[] } | RecipeRefusal;

/** Each point names a coordinate in the receipt and the exact acquired string fields identifying it. */
export type ChartCoordinateGroup = { fields: string[]; points: { id: string; values: string[] }[] };
export type ChartSourceAdapter<T extends ChartSourceReceipt = ChartSourceReceipt> = {
  kind: T['kind'];
  decode(value: unknown): T | undefined;
  /** Some families reserve specific receipt origins for a completed backend request. */
  allowsLocal?(receipt: T): boolean;
  /** Check declarations outside the selected row array on a backend response. */
  responseAgrees?(receipt: T, response: unknown): boolean;
  rowsAgree(receipt: T, rows: readonly Record<string, unknown>[], scope: unknown): boolean;
  /** Check relevant declarations on a sibling legacy table receipt, when present. */
  legacyReceiptAgrees?(receipt: T, legacy: unknown): boolean;
  routes: readonly {
    endpoint: string;
    selector: string;
    parameters: readonly string[];
    matches(receipt: T, parameters: Readonly<Record<string, string>>): boolean;
  }[];
  coordinates(receipt: T, provenance: DatasetProvenance): ChartCoordinateGroup[] | undefined;
  /** Recheck the incoming rows and their acquired field origins before a table can filter or project them. */
  acquiredInputAgrees?(receipt: T, input: Pick<WidgetDataset, 'columns' | 'rows'>,
    provenance: DatasetProvenance, omitted: readonly string[]): boolean;
};
export type ChartSourceRegistry = Readonly<Partial<Record<Kind, ChartSourceAdapter>>>;

function strings(value: unknown): value is string[] {
  return dense(value) && value.every(s => typeof s === 'string') && new Set(value).size === value.length;
}
function decode(receipt: unknown, registry: ChartSourceRegistry) {
  if (!plain(receipt) || typeof receipt.kind !== 'string' || !Object.hasOwn(registry, receipt.kind)) return;
  const adapter = registry[receipt.kind as Kind];
  if (!adapter || receipt.kind !== adapter.kind || receipt.version !== 1 || !utcTimestamp(receipt.retrieved_at)
    || !strings(receipt.diagnostics) || !plain(receipt.unsafe) || !Object.values(receipt.unsafe).every(v => typeof v === 'boolean')) return;
  const { raw_count, normalized_count, delivered_count } = receipt;
  if (typeof raw_count !== 'number' || typeof normalized_count !== 'number' || typeof delivered_count !== 'number'
    || ![raw_count, normalized_count, delivered_count].every(Number.isSafeInteger)
    || delivered_count < 0 || normalized_count < delivered_count || raw_count < normalized_count) return;
  const decoded = adapter.decode(receipt);
  return decoded?.kind === adapter.kind ? { receipt: decoded, adapter } : undefined;
}
function envelope(value: unknown, registry: ChartSourceRegistry) {
  if (!plain(value) || Object.keys(value).length !== 2 || value.version !== 1 || !dense(value.receipts)
    || !value.receipts.length || value.receipts.length > 7) return;
  const result = [];
  const seen = new Set<Kind>();
  for (const wire of value.receipts) {
    const entry = decode(wire, registry);
    if (!entry || seen.has(entry.receipt.kind)) return;
    seen.add(entry.receipt.kind);
    result.push(entry);
  }
  return result;
}
function pathValue(root: unknown, selector: string): unknown {
  let v = root;
  for (const key of selector.split('.')) {
    if (!plain(v) || !Object.hasOwn(v, key)) return;
    v = v[key];
  }
  return v;
}

export function chartResponseRows(response: unknown, selector: string | undefined): readonly unknown[] | undefined {
  const rows = selector && pathValue(response, selector);
  return Array.isArray(rows) ? rows : undefined;
}

// An opted-in daily-price response cannot supply legacy price history when live capture fails.
// Recognize the attempted route or declaration even if the selector, redirect or parameters invalidate it.
export function requestsDailyPriceSource(url: URL, response: unknown): boolean {
  if (!url.searchParams.getAll('chart_source').some(value => /^(true|1)$/i.test(value))) return false;
  const receipts = pathValue(response, 'extra.results_metadata.chart_sources.receipts');
  return chartSourceRegistry['daily-price']?.routes.some(route => route.endpoint === url.pathname)
    || (Array.isArray(receipts) && receipts.some(receipt => plain(receipt) && receipt.kind === 'daily-price'));
}

/** Construct a transient view of the actual URL, excluding credentials and ambiguous or unknown parameters. */
export function chartRequestContext(url: URL, selector: string | undefined, retrievedAt: number, credentialKey?: string): BackendAcquisition | undefined {
  if (!selector || !/^(true|1)$/i.test(url.searchParams.get('chart_source') ?? '')) return;
  const routes = Object.values(chartSourceRegistry).flatMap(adapter => adapter.routes)
    .filter(route => route.endpoint === url.pathname && route.selector === selector);
  if (!routes.length) return;
  const names = new Set(['chart_source', ...routes.flatMap(route => route.parameters)]);
  if (credentialKey && [...names].some(name => name.toLowerCase() === credentialKey.toLowerCase())) return;
  const entries: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (url.searchParams.getAll(key).length !== 1) return;
    if (key === credentialKey) continue;
    if (!names.has(key)) return;
    entries.push([key, value]);
  }
  return { endpoint: url.pathname, selector, parameters: Object.fromEntries(entries), retrievedAt };
}

function requestMatches(context: BackendAcquisition, receipt: ChartSourceReceipt, adapter: ChartSourceAdapter) {
  const { endpoint, selector, parameters } = context;
  if (!/^(true|1)$/i.test(parameters.chart_source ?? '')) return false;
  return adapter.routes.some(route => route.endpoint === endpoint && route.selector === selector
    && Object.keys(parameters).every(key => key === 'chart_source' || route.parameters.includes(key))
    && route.matches(receipt, parameters));
}

/** Pure request/response cross-check. A fixture registry can exercise this without enabling a real route. */
export function captureMatchedChartSources(context: BackendAcquisition, response: unknown, selectedRows: readonly unknown[], registry: ChartSourceRegistry): ChartSourceMap | undefined {
  const { selector } = context;
  if (!selector || !dense(selectedRows) || !selectedRows.every(plain)) return;
  const entries = envelope(pathValue(response, 'extra.results_metadata.chart_sources'), registry);
  if (!entries || pathValue(response, selector) !== selectedRows) return;
  const parent = selector.includes('.') ? pathValue(response, selector.slice(0, selector.lastIndexOf('.'))) : response;
  const result: ChartSourceMap = {};
  for (const { receipt, adapter } of entries) {
    if (!requestMatches(context, receipt, adapter) || receipt.delivered_count !== selectedRows.length) continue;
    if (adapter.responseAgrees?.(receipt, response) === false) continue;
    const scopes = new Set([asRecord(parent)?.completeness, asRecord(response)?.completeness]);
    const legacyReceipts = new Set([asRecord(parent)?.receipt, asRecord(response)?.receipt]);
    if ([...legacyReceipts].some(legacy => legacy !== undefined && adapter.legacyReceiptAgrees?.(receipt, legacy) === false)) continue;
    const declared = [...scopes].filter(scope => scope !== undefined);
    if ((declared.length ? declared : [undefined]).every(scope => adapter.rowsAgree(receipt, selectedRows, scope)))
      result[receipt.kind] = receipt;
  }
  return Object.keys(result).length ? result : undefined;
}
export function captureChartSources(context: BackendAcquisition, response: unknown, selectedRows: readonly unknown[]): ChartSourceMap | undefined {
  return captureMatchedChartSources(context, response, selectedRows, chartSourceRegistry);
}

export function localChartSources(value: unknown, rows: readonly Record<string, unknown>[], scope: unknown, legacy?: unknown): ChartSourceMap | undefined {
  const entries = envelope(value, chartSourceRegistry);
  if (!entries || !entries.every(({ receipt, adapter }) => adapter.allowsLocal?.(receipt) !== false
    && (legacy === undefined || adapter.legacyReceiptAgrees?.(receipt, legacy) !== false)
    && receipt.delivered_count === rows.length && adapter.rowsAgree(receipt, rows, scope))) return;
  return Object.fromEntries(entries.map(({ receipt }) => [receipt.kind, receipt]));
}

/** Some table cards relabel fiscal rows before handover. Recheck the actual input and the bound request. */
export function acquiredChartSources(sources: ChartSourceMap | undefined, rows: readonly Record<string, unknown>[], scope: unknown, request?: BackendAcquisition, legacy?: unknown): ChartSourceMap | undefined {
  if (!plain(sources)) return;
  const result: ChartSourceMap = {};
  for (const [kind, wire] of Object.entries(sources)) {
    const entry = decode(wire, chartSourceRegistry);
    if (!entry || entry.receipt.kind !== kind) return;
    const { receipt, adapter } = entry;
    const originMatches = request ? requestMatches(request, receipt, adapter) : adapter.allowsLocal?.(receipt) !== false;
    if (originMatches && (legacy === undefined || adapter.legacyReceiptAgrees?.(receipt, legacy) !== false)
      && receipt.delivered_count === rows.length && adapter.rowsAgree(receipt, rows, scope))
      result[receipt.kind] = receipt;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Runtime data is revalidated after every structured-clone or linked-input boundary. */
function sourceState(provenance: DatasetProvenance, input?: Pick<WidgetDataset, 'columns' | 'rows'>) {
  const metadata = provenance.metadata;
  if (!plain(metadata)) return;
  const sources = metadata.chartSources;
  if (!plain(sources) || !Object.keys(sources).length || (metadata?.chartSourceFiltered !== undefined && metadata.chartSourceFiltered !== true)) return;
  const omissions = metadata?.chartSourceOmissions;
  if (omissions !== undefined && (!plain(omissions) || Object.keys(omissions).some(kind => !Object.hasOwn(sources, kind)))) return;
  const entries = [];
  for (const [kind, value] of Object.entries(sources)) {
    const entry = decode(value, chartSourceRegistry);
    if (!entry || kind !== entry.receipt.kind) return;
    const coordinates = entry.adapter.coordinates(entry.receipt, provenance);
    if (!coordinates) return;
    const omitted = asRecord(omissions)?.[kind];
    if (omitted !== undefined) {
      const ids = new Set(coordinates.flatMap(group => group.points.map(point => point.id)));
      if (!strings(omitted) || omitted.some(id => !ids.has(id))) return;
    }
    if (input && entry.adapter.acquiredInputAgrees?.(entry.receipt, input, provenance, omitted ?? []) === false) return;
    entries.push({ ...entry, coordinates, omitted: omitted ?? [] });
  }
  return entries;
}
export function readChartSource<T extends ChartSourceReceipt>(provenance: DatasetProvenance, kind: T['kind'], decodeFamily: (value: unknown) => T | undefined): T | undefined {
  const entry = sourceState(provenance)?.find(({ receipt }) => receipt.kind === kind);
  if (!entry) return;
  const result = decodeFamily(entry.receipt);
  return result?.kind === kind ? result : undefined;
}

export function readChartSourceProjection(provenance: DatasetProvenance, kind: Kind): { filtered: boolean; omitted: string[] } | undefined {
  const entry = sourceState(provenance)?.find(({ receipt }) => receipt.kind === kind);
  return entry && { filtered: provenance.metadata?.chartSourceFiltered === true, omitted: [...entry.omitted] };
}

export function hasDailyPriceDeclaration(metadata: DatasetProvenance['metadata']): boolean {
  const sources: unknown = metadata && Object.getOwnPropertyDescriptor(metadata, 'chartSources')?.value;
  return typeof sources === 'object' && sources !== null && Object.hasOwn(sources, 'daily-price');
}

/** Recalculation accepts acquired facts and additive restrictions only. Presentation proof belongs to its producing view. */
export function validatedChartProvenance(provenance: DatasetProvenance, input?: Pick<WidgetDataset, 'columns' | 'rows'>): DatasetProvenance {
  const metadata = provenance.metadata;
  if (!metadata) return provenance;
  const evidenceKeys = ['chartSources', 'chartSourceFiltered', 'chartSourceOmissions', 'dailyPriceCoordinates'];
  const presentationKeys = ['chartSourcePresentationProof', 'chartSourceCoordinatePlan'];
  const keys = [...evidenceKeys, ...presentationKeys];
  if (!keys.some(key => Object.hasOwn(metadata, key))) return provenance;
  const valid = sourceState(provenance, input);
  const removed = valid ? [...presentationKeys,
    ...(valid.some(({ receipt }) => receipt.kind === 'daily-price') ? [] : ['dailyPriceCoordinates'])] : keys;
  const retained = Object.fromEntries(Object.keys(metadata).flatMap(key => {
    const field = Object.getOwnPropertyDescriptor(metadata, key);
    return !removed.includes(key) && field && 'value' in field ? [[key, field.value]] : [];
  }));
  if (!valid && hasDailyPriceDeclaration(metadata))
    retained.dailyPriceRejected = true;
  return { ...provenance, metadata: retained };
}

/** The native table sees the same coordinate declarations as the TypeScript calculator. */
export function chartCoordinatePlan(provenance: DatasetProvenance) {
  const entries = sourceState(provenance);
  return entries && Object.fromEntries(entries.map(({ receipt, coordinates }) => [receipt.kind, coordinates]));
}
export function chartPresentationProvenance(provenance: DatasetProvenance, filtered: boolean): DatasetProvenance {
  return filtered && provenance.metadata?.chartSources
    ? { ...provenance, metadata: { ...provenance.metadata, chartSourceFiltered: true } } : provenance;
}
export function projectChartSources(provenance: DatasetProvenance, columns: readonly DatasetColumn[], rows: readonly DatasetRow[]): DatasetProvenance {
  const entries = sourceState(provenance);
  if (!entries) return validatedChartProvenance(provenance);
  const omissions: Partial<Record<Kind, string[]>> = {};
  for (const { receipt, coordinates, omitted } of entries) {
    const removed = new Set(omitted);
    for (const group of coordinates) {
      const bindings = group.fields.map(field => {
        const matches = columns.filter(c => acquiredColumnOrigin(c) === field);
        return matches.length === 1 ? matches[0].id : undefined;
      });
      const visible = new Set<string>();
      if (!provenance.inputMayContainAggregates && bindings.every((f): f is string => f !== undefined)) {
        for (const row of rows) {
          const tuple = bindings.map(f => !row.cellErrors?.[f] ? row.values[f] : undefined);
          if (tuple.every(v => typeof v === 'string')) visible.add(JSON.stringify(tuple));
        }
      }
      for (const point of group.points) if (!visible.has(JSON.stringify(point.values))) removed.add(point.id);
    }
    if (removed.size) omissions[receipt.kind] = coordinates.flatMap(g => g.points.map(p => p.id)).filter(id => removed.has(id));
  }
  return Object.keys(omissions).length ? { ...provenance, metadata: { ...provenance.metadata, chartSourceOmissions: omissions } } : provenance;
}
