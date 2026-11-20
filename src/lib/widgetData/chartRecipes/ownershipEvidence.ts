// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { asRecord } from '../../isRecord';
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';

const unsafeNames = ['identity_conflict', 'unit_conflict', 'date_conflict', 'partition_conflict'] as const;
export const ownershipBarRoles = ['insiders', 'institutions', 'freeFloat'] as const;
const receiptKeys = ['version', 'kind', 'origin', 'issuer', 'share_class', 'retrieved_at', 'raw_count',
  'normalized_count', 'delivered_count', 'diagnostics', 'unsafe', 'measures', 'field_origins', 'partition'];
const reservedFields = ['symbol', 'share_class', 'as_of', 'denominator', 'constructor', 'prototype'];
const headlineOrigins = { insiders: 'percent_insiders', institutions: 'percent_institutions' } as const;

type OwnershipUnsafe = typeof unsafeNames[number];
export type OwnershipBarRole = typeof ownershipBarRoles[number];
export type OwnershipMeasure = { unit: 'percent-points' | 'fraction'; basis: 'shares-outstanding' | null; as_of: string | null };
type CommonOwnershipSource = ChartSourceReceipt & {
  kind: 'ownership';
  issuer: string;
  diagnostics: OwnershipUnsafe[];
  unsafe: Record<OwnershipUnsafe, boolean>;
};
export type OwnershipBarsSource = CommonOwnershipSource & {
  origin: 'acquired-snapshot' | 'eodhd-share-statistics';
  share_class: string | null;
  measures: Partial<Record<OwnershipBarRole, OwnershipMeasure>>;
  field_origins: Partial<Record<OwnershipBarRole, string>>;
  partition: { status: 'unavailable' };
};
export type OwnershipPartitionSource = CommonOwnershipSource & {
  origin: 'acquired-snapshot';
  share_class: string;
  measures: Record<string, never>;
  field_origins: { bucket: string; share: string };
  partition: {
    status: 'verified';
    as_of: string;
    denominator: 'outstanding-shares';
    exclusive: true;
    exhaustive: true;
    rounding_bound_percent: number;
    reference: string;
  };
  bucket_keys: string[];
};
export type OwnershipSource = OwnershipBarsSource | OwnershipPartitionSource;

function plain(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value);
  return !!record && [Object.prototype, null].includes(Object.getPrototypeOf(record))
    && Reflect.ownKeys(record).every(key => {
      const property = Object.getOwnPropertyDescriptor(record, key);
      return typeof key === 'string' && property?.enumerable && 'value' in property;
    });
}

function exact<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function uniqueList<T>(value: unknown, check: (entry: unknown) => entry is T): value is T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, index);
    if (!field?.enumerable || !('value' in field) || !check(field.value)) return false;
  }
  return new Set(value).size === value.length;
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const diagnostic = (value: unknown): value is OwnershipUnsafe => unsafeNames.some(name => name === value);
const classId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value);
const bucketKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/.test(value);
const origin = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) && !reservedFields.includes(value);
const finiteBetween = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && value >= 0 && value <= maximum;

function ownershipMeasure(value: unknown): value is OwnershipMeasure {
  return exact(value, ['unit', 'basis', 'as_of']) && (value.unit === 'percent-points' || value.unit === 'fraction')
    && (value.basis === null || value.basis === 'shares-outstanding') && (value.as_of === null || isoDate(value.as_of));
}

function verifiedPartition(value: unknown): value is OwnershipPartitionSource['partition'] {
  return exact(value, ['status', 'as_of', 'denominator', 'exclusive', 'exhaustive', 'rounding_bound_percent', 'reference'])
    && value.status === 'verified' && isoDate(value.as_of) && value.denominator === 'outstanding-shares'
    && value.exclusive === true && value.exhaustive === true && finiteBetween(value.rounding_bound_percent, 100)
    && typeof value.reference === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,255}$/.test(value.reference);
}

export function parseOwnershipSource(value: unknown): OwnershipSource | undefined {
  if (!plain(value) || !plain(value.partition)) return;
  const partition = value.partition;
  const keys = partition.status === 'verified' ? [...receiptKeys, 'bucket_keys'] : receiptKeys;
  if (!exact(value, keys) || value.version !== 1 || value.kind !== 'ownership'
    || (value.origin !== 'acquired-snapshot' && value.origin !== 'eodhd-share-statistics')
    || !qualifiedSymbol(value.issuer) || !utcTimestamp(value.retrieved_at)
    || !count(value.raw_count) || !count(value.normalized_count) || !count(value.delivered_count)
    || value.raw_count < value.normalized_count || value.normalized_count !== value.delivered_count || !value.delivered_count
    || !uniqueList(value.diagnostics, diagnostic) || !exact(value.unsafe, unsafeNames)
    || !plain(value.measures) || !plain(value.field_origins)) return;
  const { diagnostics, unsafe, measures, field_origins: origins } = value;
  if (unsafeNames.some(name => unsafe[name] !== diagnostics.includes(name))
    || (value.raw_count > value.normalized_count && !diagnostics.length)) return;

  if (verifiedPartition(partition)) {
    if (value.origin !== 'acquired-snapshot' || !classId(value.share_class) || !exact(measures, [])
      || !exact(origins, ['bucket', 'share']) || !origin(origins.bucket) || !origin(origins.share) || origins.bucket === origins.share
      || !uniqueList(value.bucket_keys, bucketKey) || value.bucket_keys.length !== value.delivered_count) return;
    return value as OwnershipPartitionSource;
  }

  const measureNames = Object.keys(measures);
  if (!exact(partition, ['status']) || partition.status !== 'unavailable' || value.delivered_count !== 1
    || (value.share_class !== null && !classId(value.share_class)) || !measureNames.length || !exact(origins, measureNames)
    || measureNames.some(name => !ownershipBarRoles.some(role => role === name) || !ownershipMeasure(measures[name]) || !origin(origins[name]))
    || new Set(Object.values(origins)).size !== measureNames.length) return;

  if (value.origin === 'eodhd-share-statistics' && (
    value.share_class !== null || !value.issuer.endsWith('.US') || value.raw_count !== 1
    || diagnostics.some(d => d !== 'unit_conflict') || !exact(origins, ['insiders', 'institutions'])
    || origins.insiders !== headlineOrigins.insiders || origins.institutions !== headlineOrigins.institutions
    || Object.values(measures).some(measure =>
      !ownershipMeasure(measure) || measure.unit !== 'percent-points' || measure.basis !== null || measure.as_of !== null)
  )) return;

  return value as OwnershipBarsSource;
}

function rowsAgree(source: OwnershipSource, rows: readonly Record<string, unknown>[], scope: unknown): boolean {
  if ((scope !== undefined && scope !== 'unknown' && scope !== 'complete') || rows.length !== source.delivered_count)
    return false;
  if ('bucket_keys' in source) {
    const { partition } = source;
    const expected = new Set(source.bucket_keys);
    const { bucket, share } = source.field_origins;
    return rows.every(row => row.symbol === source.issuer && row.share_class === source.share_class
      && row.as_of === partition.as_of && row.denominator === partition.denominator
      && typeof row[bucket] === 'string' && expected.delete(row[bucket]) && finiteBetween(row[share], 100));
  }

  const [row] = rows;
  const classMatches = source.origin === 'eodhd-share-statistics'
    ? row.share_class === undefined || row.share_class === null : row.share_class === source.share_class;
  return row.symbol === source.issuer && classMatches && ownershipBarRoles.every(role => {
    const measure = source.measures[role];
    const field = source.field_origins[role];
    if (!measure || !field) return true;
    const value = row[field];
    return value === null || finiteBetween(value, measure.unit === 'fraction' ? 1 : 100);
  });
}

function matchesRequest(source: OwnershipSource, params: Readonly<Record<string, string>>, defaultProvider?: 'eodhd'): boolean {
  if (source.origin !== 'eodhd-share-statistics' || (params.provider ?? defaultProvider) !== 'eodhd'
    || (params.exchange ?? 'US').toUpperCase() !== 'US') return false;
  const symbol = params.symbol?.trim().toUpperCase();
  return !!symbol && (symbol.includes('.') ? symbol : symbol + '.US') === source.issuer;
}

const parameters = ['provider', 'symbol', 'exchange'] as const;
export const ownershipSourceAdapter: ChartSourceAdapter<OwnershipSource> = {
  kind: 'ownership',
  decode: parseOwnershipSource,
  allowsLocal: source => source.origin === 'acquired-snapshot',
  rowsAgree,
  routes: [
    { endpoint: '/api/v1/equity/ownership/share_statistics', selector: 'results', parameters,
      matches: (source, params) => matchesRequest(source, params) },
    { endpoint: '/api/v1/eodhd/equity/ownership/share_statistics', selector: 'results', parameters,
      matches: (source, params) => matchesRequest(source, params, 'eodhd') },
  ],
  coordinates: source => {
    if ('bucket_keys' in source) return [{
      fields: ['symbol', 'share_class', source.field_origins.bucket, 'as_of', 'denominator'],
      points: source.bucket_keys.map(key => ({
        id: key, values: [source.issuer, source.share_class, key, source.partition.as_of, source.partition.denominator],
      })),
    }];
    const fields = source.share_class === null ? ['symbol'] : ['symbol', 'share_class'];
    const values = source.share_class === null ? [source.issuer] : [source.issuer, source.share_class];
    return [{ fields, points: [{ id: source.issuer, values }] }];
  },
};
