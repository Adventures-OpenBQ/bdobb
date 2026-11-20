// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isChartSourceRecord } from '../chartRecipes/chartSourceShape';
import type { MetricPreset } from '../chartRecipes/metricEvidence';
import type { LinkedKpiOptions } from './types';

export const KPI_METRIC_LABELS = Object.freeze({
  price: 'Last price',
  market_cap: 'Market capitalization',
  dividend_yield: 'Trailing dividend yield',
  pe_ratio: 'Trailing P/E',
  eps_ttm: 'Trailing diluted EPS',
  revenue_ttm: 'Trailing revenue',
} satisfies Record<MetricPreset, string>);

type DecodedOptions = { ok: true; options: LinkedKpiOptions } | { ok: false; message: string };
const invalid = (message: string): DecodedOptions => ({ ok: false, message });
const requiredFields = ['version', 'metric', 'valueField', 'observation', 'view'];
const fields = [...requiredFields, 'range', 'reference'];
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isChartSourceRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const observationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:+-]{0,127}$/.test(value);

function decodeObservation(value: unknown): LinkedKpiOptions['observation'] | undefined {
  if (exact(value, ['mode']) && value.mode === 'latest') return { mode: 'latest' };
  if (exact(value, ['mode', 'id']) && value.mode === 'pinned' && observationId(value.id)) return { mode: 'pinned', id: value.id };
}

function decodeReference(value: unknown): LinkedKpiOptions['reference'] {
  if (exact(value, ['kind', 'id']) && value.kind === 'observation' && observationId(value.id))
    return { kind: 'observation', id: value.id };
  if (exact(value, ['kind', 'value']) && value.kind === 'user-target' && finite(value.value))
    return { kind: 'user-target', value: value.value };
}

function decodeRange(value: unknown): LinkedKpiOptions['range'] {
  if (!exact(value, ['min', 'max', 'label']) || !finite(value.min) || !finite(value.max) || value.min >= value.max
    || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 120 || Array.from(value.label).some(char => char < ' ' || char === '\x7f')) return;
  return { min: value.min, max: value.max, label: value.label.trim() };
}

/** Stored options select source coordinates or user assumptions; they never carry source proof. */
export function decodeLinkedKpiOptions(value: unknown): DecodedOptions {
  if (!isChartSourceRecord(value) || Object.keys(value).some(key => !fields.includes(key))
    || !requiredFields.every(key => Object.hasOwn(value, key)) || value.version !== 1)
    return invalid('Supply version 1 linked KPI options with no unsupported fields.');
  const { metric, valueField, view } = value;
  if (typeof metric !== 'string' || !Object.hasOwn(KPI_METRIC_LABELS, metric) || typeof valueField !== 'string' || !valueField.trim())
    return invalid('Choose an acquired KPI preset and its original numeric field.');
  if (view !== 'card' && view !== 'gauge') return invalid('Choose the KPI card or gauge view.');
  const observation = decodeObservation(value.observation);
  if (!observation) return invalid('Choose the latest acquired KPI observation or pin an acquired observation.');
  const range = decodeRange(value.range);
  if (!range && (view === 'gauge' || Object.hasOwn(value, 'range')))
    return invalid('Supply a labeled user range with finite bounds and a minimum below the maximum.');
  const reference = decodeReference(value.reference);
  if (!reference && Object.hasOwn(value, 'reference'))
    return invalid('Choose an acquired reference observation or enter a finite user target in the acquired units.');
  return { ok: true, options: {
    version: 1, metric: metric as MetricPreset, valueField, observation, view,
    ...(range && { range }), ...(reference && { reference }),
  } };
}
