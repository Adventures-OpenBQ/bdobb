// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readChartSource, readChartSourceProjection } from '../chartRecipes/chartSourceContracts';
import { acquiredColumnOrigin } from '../chartRecipes/financialEvidence';
import { metricObservations, parseMetricSource, type MetricPreset, type MetricUnit } from '../chartRecipes/metricEvidence';
import type { DatasetColumn, WidgetDataset } from '../types';

const factOrigins = new Set([
  'issuer', 'listing', 'share_class', 'symbol', 'metric', 'observation_id', 'vintage', 'metric_vintage',
  'as_of', 'as_of_unknown', 'period_start', 'period_end', 'period_kind', 'unit_kind', 'currency',
  'adjustment_basis', 'reporting_basis', 'basis_reference', 'origin', 'unit',
]);

/** Project all visible declared facts, plus only the requested original numeric field. */
export function kpiInputFields(columns: readonly DatasetColumn[], valueField?: string) {
  return columns.filter(column => column.id === valueField || factOrigins.has(acquiredColumnOrigin(column) ?? '')).map(column => column.id);
}

export function kpiSourceChoices(input: WidgetDataset) {
  const source = readChartSource(input.provenance, 'metric', parseMetricSource);
  const projection = readChartSourceProjection(input.provenance, 'metric');
  if (!source || !projection || Object.values(source.unsafe).some(Boolean) || input.provenance.inputMayContainAggregates) return;
  return { source, omitted: new Set(projection.omitted) };
}

export function kpiFields(columns: readonly DatasetColumn[], metric: MetricPreset | '') {
  return columns.filter(column => acquiredColumnOrigin(column) === metric && (!column.dtype || column.dtype === 'number'));
}

export function kpiObservationChoices(choices: ReturnType<typeof kpiSourceChoices>, metric: MetricPreset | '') {
  return choices && metric ? metricObservations(choices.source, metric) : [];
}

export function kpiUnitLabel(unit: MetricUnit) {
  switch (unit.kind) {
    case 'fraction': return 'fraction (0.01 = 1%)';
    case 'multiple': return 'multiple (×)';
    case 'money': return unit.currency;
    case 'money-per-share': return unit.currency + ' per share';
    case 'count': return 'count';
  }
}
