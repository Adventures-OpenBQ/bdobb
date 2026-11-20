// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { PlotlyFigure } from '../../chartShapes';
import { readChartSource, readChartSourceProjection } from '../chartRecipes/chartSourceContracts';
import { acquiredColumnOrigin } from '../chartRecipes/financialEvidence';
import {
  metricObservations, metricReferencesComparable, metricSourceAdapter, metricVintageKey, parseMetricSource,
  type MetricObservation, type MetricSource, type MetricUnit,
} from '../chartRecipes/metricEvidence';
import type { RecipeRefusal } from '../chartRecipes/types';
import { escape } from '../figureHelpers';
import type { DatasetColumn, DatasetRow, WidgetDataset } from '../types';
import { decodeLinkedKpiOptions, KPI_METRIC_LABELS } from './settings';
import type { KpiReference, KpiResult, KpiSnapshot, LinkedKpiOptions } from './types';

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const userTarget = 'User target (assumption)';

/** The renderer must give the Plotly drawing surface at least this many CSS pixels. */
export const KPI_GAUGE_MIN_DRAW_WIDTH = 296;
const gaugeMargin = { l: 12, r: 12, t: 8, b: 8, autoexpand: false };
// Gauge-only mode uses the whole x domain. The fixed margins make the band at least 272 px.
const minimumBandWidth = KPI_GAUGE_MIN_DRAW_WIDTH - gaugeMargin.l - gaugeMargin.r;
// Plotly rounds converted indicator coordinates to hundredths of a pixel. A distance beyond
// one rounding step keeps the positions distinct for any greater width and any rounding phase.
const minimumGaugeSeparation = .01 / minimumBandWidth + Number.EPSILON;

const percent = new Intl.NumberFormat('en-US', {
  style: 'percent', useGrouping: false, maximumSignificantDigits: 17,
});
const scientificPercent = new Intl.NumberFormat('en-US', {
  style: 'percent', notation: 'scientific', maximumSignificantDigits: 17,
});

function formatFraction(value: number): string {
  // Intl shifts the original decimal without overflowing a finite fraction.
  const magnitude = Math.abs(value);
  const formatter = magnitude >= 1e19 || (magnitude > 0 && magnitude < 1e-8) ? scientificPercent : percent;
  return formatter.format(value === 0 ? 0 : value);
}

/** Keep the acquired scale and denomination even when a table column has a display formatter. */
export function formatKpiValue(value: number, unit: MetricUnit): string {
  switch (unit.kind) {
    case 'fraction': return formatFraction(value);
    case 'multiple': return `${value}×`;
    case 'money': return `${value} ${unit.currency}`;
    case 'money-per-share': return `${value} ${unit.currency} per share`;
    case 'count': return String(value);
  }
}

function readOriginalValue(row: DatasetRow, field: string, subject: string): { value: number } | RecipeRefusal {
  if (Object.hasOwn(row.cellErrors ?? {}, field)) return refuse(`The ${subject} KPI value has a cell error. Repair the source.`);
  const value = Object.hasOwn(row.values, field) ? row.values[field] : undefined;
  if (value === null || value === undefined) return refuse(`The ${subject} KPI value is missing in the source.`);
  if (typeof value !== 'number' || !Number.isFinite(value))
    return refuse(`The ${subject} KPI value must be a finite original numeric value.`);
  return { value };
}

function agreesWithVisibleFacts(row: DatasetRow, columns: readonly DatasetColumn[], source: MetricSource, observation: MetricObservation) {
  const { unit, origin, ...fields } = observation;
  const local = source.origin === 'acquired-snapshot';
  const facts: Record<string, unknown> = {
    ...fields, issuer: source.issuer, listing: source.listing, share_class: source.share_class, symbol: source.listing,
    metric: origin, unit_kind: unit.kind,
  };
  // Ordinary live table currency and date fields are not source facts about these headlines.
  if (local) facts.currency = 'currency' in unit ? unit.currency : null;
  else Object.assign(facts, { origin, unit });
  return columns.every(column => {
    const field = acquiredColumnOrigin(column);
    if (field === undefined || !Object.hasOwn(facts, field)) return true;
    if (Object.hasOwn(row.cellErrors ?? {}, column.id)) return false;
    if (!Object.hasOwn(row.values, column.id)) return false;
    const value = row.values[column.id];
    // Normalization fills an absent optional key with null when a different row has that key.
    if (local && value === null && (field === 'symbol' || field === 'as_of_unknown')) return true;
    if (field !== 'unit') return value === facts[field];
    return typeof value === 'object' && value !== null && 'kind' in value && value.kind === unit.kind
      && (!('currency' in unit) || ('currency' in value && value.currency === unit.currency));
  });
}

function resolveCurrent(observations: MetricObservation[], selection: LinkedKpiOptions['observation']): MetricObservation | RecipeRefusal {
  if (selection.mode === 'pinned')
    return observations.find(obs => obs.observation_id === selection.id) ??
      refuse('The pinned KPI observation is unavailable. Reacquire it or choose an available observation.');
  let latest: MetricObservation | undefined;
  let latestKey = '';
  let tied = false;
  for (const observation of observations) {
    const key = metricVintageKey(observation.vintage);
    if (key > latestKey) {
      latest = observation;
      latestKey = key;
      tied = false;
    } else if (key === latestKey) tied = true;
  }
  if (tied) return refuse('The latest acquired KPI vintage is ambiguous. Pin one available observation.');
  return latest ?? refuse('No acquired observation matches this KPI preset. Acquire a compatible source.');
}

function positionInRange(value: number, min: number, max: number): number | undefined {
  if (value === min) return 0;
  if (value === max) return 1;
  const span = max - min;
  const position = Number.isFinite(span) ? (value - min) / span
    : (value / 2 - min / 2) / (max / 2 - min / 2);
  if (position > minimumGaugeSeparation && 1 - position > minimumGaugeSeparation) return position;
}

function gaugeFigure(snapshot: KpiSnapshot, revision: string, notes: string[]): PlotlyFigure | RecipeRefusal {
  const { range, unit, value, reference, referenceLabel } = snapshot;
  if (!range) return refuse('Supply an explicit user range before drawing the KPI gauge.');
  const { min, max, label } = range;
  const position = positionInRange(value, min, max);
  let threshold: number | undefined;
  const geometryRefusal = refuse('The KPI gauge geometry cannot distinguish the original values. Narrow the user range, choose an appropriate reference, or use a card.');
  if (position === undefined) return geometryRefusal;
  if (reference) {
    if (reference.value < min || reference.value > max) {
      notes.push('The reference is outside the user range.');
    } else {
      threshold = positionInRange(reference.value, min, max);
      if (threshold === undefined
        || (reference.value !== value && Math.abs(position - threshold) <= minimumGaugeSeparation))
        return geometryRefusal;
    }
  }
  const valueText = formatKpiValue(value, unit);
  const minText = formatKpiValue(min, unit);
  const maxText = formatKpiValue(max, unit);
  // Plotly can hide long bullet-axis tick labels. Anchor bounds inside the plot and
  // use separate lines when the full values and unit would crowd the same line.
  const boundsOnSeparateLines = minText.length + maxText.length > 40;
  const annotation = { xref: 'paper', yref: 'paper', showarrow: false };
  const hover = [
    snapshot.label, `Original value: ${valueText}${unit.kind === 'fraction' ? ` (${value} fraction)` : ''}`,
    `As of ${snapshot.asOf ?? 'unknown'}`, `Vintage ${snapshot.observation.vintage}`, `Retrieved ${snapshot.retrievedAt}`,
    label, ...(boundsOnSeparateLines ? [`Minimum ${minText}`, `Maximum ${maxText}`] : [`${minText} to ${maxText}`]),
    ...(reference ? [`${referenceLabel}: ${formatKpiValue(reference.value, unit)}`] : []),
    ...(reference?.kind === 'observation' ? [
      `Reference as of ${reference.observation.as_of ?? 'unknown'}`, `Reference vintage ${reference.observation.vintage}`,
    ] : []),
  ].map(escape).join('<br>');
  return {
    data: [{
      type: 'indicator', mode: 'gauge', uid: 'linked-kpi-gauge', value: position,
      domain: { x: [0, 1], y: [.36, .56] },
      gauge: {
        shape: 'bullet',
        axis: { range: [0, 1], tickmode: 'array', tickvals: [0, 1], showticklabels: false },
        bgcolor: 'rgba(113,130,154,0.18)', bordercolor: '#71829a', borderwidth: 1,
        bar: { color: '#527db6', thickness: .55 },
        ...(threshold === undefined ? {} : { threshold: { value: threshold, thickness: .85, line: { color: '#71829a', width: 2 } } }),
      },
    }],
    layout: {
      uirevision: revision, margin: { ...gaugeMargin }, font: { color: '#71829a', size: 11 },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      annotations: [
        { ...annotation, x: .5, y: .76, text: escape(valueText), font: { size: 15 }, hovertext: hover },
        { ...annotation, x: 0, y: .23, xanchor: 'left', text: escape(minText) },
        { ...annotation, x: 1, y: boundsOnSeparateLines ? .1 : .23, xanchor: 'right', text: escape(maxText) },
      ],
    },
  };
}

export function buildKpiSnapshot(dataset: WidgetDataset, options: LinkedKpiOptions): KpiResult {
  const decoded = decodeLinkedKpiOptions(options);
  if (!decoded.ok) return refuse(decoded.message);
  const { metric, valueField, observation, view, range, reference } = decoded.options;
  const { provenance, columns, rows } = dataset;
  const source = readChartSource(provenance, 'metric', parseMetricSource);
  const projection = readChartSourceProjection(provenance, 'metric');
  if (!source || !projection) return refuse('Acquire a source with verified KPI observation evidence.');
  if (Object.values(source.unsafe).some(Boolean)) return refuse('The acquisition contains unsafe KPI identity, unit, period, basis or duplicate facts.');
  if (provenance.inputMayContainAggregates) return refuse('Choose original KPI observations from a source without aggregated values.');
  const observations = metricObservations(source, metric);
  if (!observations.length) return refuse('The selected KPI preset is unavailable from this acquisition.');
  const valueColumns = columns.filter(column => column.id === valueField);
  const [valueColumn] = valueColumns;
  if (valueColumns.length !== 1 || acquiredColumnOrigin(valueColumn) !== metric || (valueColumn.dtype && valueColumn.dtype !== 'number'))
    return refuse('Bind the selected KPI preset to its original numeric source field.');

  const current = resolveCurrent(observations, observation);
  if ('ok' in current) return current;
  const [coordinates] = metricSourceAdapter.coordinates(source);
  const coordinateFields = coordinates.fields.map(field => {
    const matches = columns.filter(c => acquiredColumnOrigin(c) === field);
    return matches.length === 1 ? matches[0].id : undefined;
  });
  const omitted = new Set(projection.omitted);
  const readVisible = (selected: MetricObservation, subject: string) => {
    const point = coordinates.points.find(item => item.id === selected.observation_id);
    const unavailable = refuse(`The ${subject} KPI observation is unavailable in the source presentation. Restore it or repair the selection.`);
    if (!point || omitted.has(point.id) || coordinateFields.some(id => id === undefined)) return unavailable;
    const matching = rows.filter(row => coordinateFields.every((field, index) => field !== undefined
      && Object.hasOwn(row.values, field) && !Object.hasOwn(row.cellErrors ?? {}, field) && row.values[field] === point.values[index]));
    if (matching.length > 1) return refuse(`The ${subject} KPI observation is ambiguous in the source presentation.`);
    if (!matching.length) return unavailable;
    const [row] = matching;
    if (!agreesWithVisibleFacts(row, columns, source, selected))
      return refuse(`The ${subject} KPI observation contradicts the original source facts. Reacquire the source.`);
    return readOriginalValue(row, valueField, subject);
  };
  const original = readVisible(current, observation.mode);
  if ('ok' in original) return original;
  const { value } = original;
  let comparison: KpiReference | undefined;
  if (reference?.kind === 'observation') {
    const acquired = observations.find(obs => obs.observation_id === reference.id);
    if (source.origin !== 'acquired-snapshot' || !acquired || !metricReferencesComparable(source, metric, current.observation_id, reference.id))
      return refuse('The acquired reference observation is unavailable or does not have comparable metric, class, unit, period and basis evidence.');
    const prior = readVisible(acquired, 'reference');
    if ('ok' in prior) return prior;
    comparison = { kind: 'observation', value: prior.value, observation: acquired };
  } else if (reference) {
    comparison = reference;
  }

  const snapshot: KpiSnapshot = {
    value, label: KPI_METRIC_LABELS[metric], unit: current.unit, issuer: source.issuer, listing: source.listing,
    shareClass: source.share_class, observation: current, asOf: current.as_of, retrievedAt: source.retrieved_at,
    scope: { acquiredRowCount: source.delivered_count, presentedRowCount: rows.length,
      filtered: projection.filtered, omittedObservationCount: omitted.size },
    ...(range && { range: { ...range, label: `User range (assumption) · ${range.label}` } }),
    outOfRange: !!range && (value < range.min || value > range.max),
  };
  if (comparison) {
    const delta = value - comparison.value;
    if (!Number.isFinite(delta)) return refuse('The absolute KPI delta exceeds finite numeric limits.');
    snapshot.deltaAbsolute = delta;
    if (comparison.value > 0) {
      const ratio = delta / comparison.value;
      const change = Math.abs(ratio) < 2 ** -1022 ? (delta * 100) / comparison.value : ratio * 100;
      if (!Number.isFinite(change) || (delta !== 0 && change === 0))
        return refuse('The percentage KPI delta exceeds finite numeric limits.');
      snapshot.deltaPercent = change;
    }
    snapshot.reference = comparison;
    snapshot.referenceLabel = comparison.kind === 'user-target' ? userTarget : 'Acquired reference observation';
  }

  const notes: string[] = [];
  if (snapshot.outOfRange) notes.push('The original KPI value is outside the user range.');
  if (projection.filtered || omitted.size) notes.push('The source presentation filters or omits acquired observations.');
  const observationKey = (obs: MetricObservation) => [
    obs.observation_id, metricVintageKey(obs.vintage), obs.unit.kind, 'currency' in obs.unit ? obs.unit.currency : null,
    obs.as_of, obs.period_start, obs.period_end, obs.period_kind, obs.adjustment_basis, obs.reporting_basis, obs.basis_reference,
  ];
  const revision = JSON.stringify([
    provenance.sourceWidgetId, source.origin, source.issuer, source.listing, source.share_class, decoded.options,
    observationKey(current), comparison?.kind === 'observation' ? observationKey(comparison.observation) : null,
  ]);
  if (view !== 'gauge' || snapshot.outOfRange) return { ok: true, snapshot, revision, notes };
  const gauge = gaugeFigure(snapshot, revision, notes);
  if ('ok' in gauge) return gauge;
  return { ok: true, snapshot, gauge, revision, notes };
}
