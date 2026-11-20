// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { escape } from '../figureHelpers';
import type { DatasetColumn, WidgetDataset } from '../types';
import { acceptsBinding, ownershipBarLabels, ownershipBindingRoles } from './bindings';
import { readChartSource, readChartSourceProjection, type ChartBuildResult } from './chartSourceContracts';
import { read } from './estimateEvidence';
import { acquiredColumnOrigin } from './financialEvidence';
import {
  ownershipBarRoles, ownershipSourceAdapter, parseOwnershipSource,
  type OwnershipBarRole, type OwnershipBarsSource, type OwnershipMeasure, type OwnershipPartitionSource, type OwnershipSource,
} from './ownershipEvidence';
import { decodeRecipeOptions } from './settings';
import type { OwnershipSnapshotOptions, RecipeContext, RecipeOptions, RecipeRefusal, RecipeResult } from './types';

export type OwnershipBucket = { id: string; percent: number };
type OwnershipBar = {
  id: OwnershipBarRole;
  label: string;
  status: 'observed' | 'unavailable' | 'unbound';
  /** Original source value and unit, and the canonical fraction used by Plotly. */
  reported: number | null;
  fraction: number | null;
  unit: OwnershipMeasure['unit'] | null;
  basis: OwnershipMeasure['basis'];
  asOf: OwnershipMeasure['as_of'];
};
type OwnershipBars = { view: 'bars'; measures: OwnershipBar[] };
type OwnershipWaffle = {
  view: 'waffle';
  asOf: string;
  denominator: OwnershipPartitionSource['partition']['denominator'];
  reference: string;
  roundingBoundPercent: number;
  totalDiscrepancyPercent: number;
  buckets: (OwnershipBucket & { cells: number })[];
};
type SnapshotIdentity = { issuer: string; shareClass: string | null; retrievedAt: string };
export type OwnershipSnapshotDetails = (OwnershipBars | OwnershipWaffle) & SnapshotIdentity;

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const geometryIssue = 'The ownership values cannot preserve distinct geometry at this chart size. Widen or enlarge the chart.';
const coordinateIssue = 'The presentation disagrees with the acquired ownership coordinates. Repair the raw source fields.';
const unsafeIssues = {
  identity_conflict: 'issuer or share class conflict',
  unit_conflict: 'unit conflict',
  date_conflict: 'measurement date conflict',
  partition_conflict: 'partition conflict',
} satisfies Record<keyof OwnershipSource['unsafe'], string>;

const cellCount = 100;
const gridSide = 10;
const compareKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// The smallest positive Number serializes to 5e-324. Working in these decimal
// units preserves all reported digits and keeps the cap and remainder ties exact.
const decimalPlaces = 324;
const unitsPerPercent = 10n ** BigInt(decimalPlaces);

function decimalParts(value: number) {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = (whole + fraction).replace(/^0+(?=\d)/, '');
  return { digits, power: Number(exponent) - fraction.length };
}

function percentUnits(percent: number): bigint {
  const { digits, power } = decimalParts(percent);
  return BigInt(digits) * 10n ** BigInt(decimalPlaces + power);
}

function decimalBuckets(buckets: readonly OwnershipBucket[]) {
  return buckets.map(({ id, percent }) => ({ id, units: percentUnits(percent) }));
}

function apportion(buckets: readonly { id: string; units: bigint }[]): Record<string, number> {
  const ranked = buckets.map(({ id, units }) => ({
    id, cells: Number(units / unitsPerPercent), remainder: units % unitsPerPercent,
  })).sort((a, b) => a.remainder === b.remainder ? compareKeys(a.id, b.id) : a.remainder > b.remainder ? -1 : 1);
  const remaining = cellCount - ranked.reduce((sum, bucket) => sum + bucket.cells, 0);
  return Object.fromEntries(ranked.map(({ id, cells }, index) => [id, cells + Number(index < remaining)]));
}

/** Apportion an admitted partition's percentages to the fixed visual grid. */
export function allocateWaffle(buckets: readonly OwnershipBucket[]): Record<string, number> {
  return apportion(decimalBuckets(buckets));
}

export function inspectOwnershipSource(dataset: WidgetDataset) {
  const source = readChartSource(dataset.provenance, 'ownership', parseOwnershipSource);
  const projection = readChartSourceProjection(dataset.provenance, 'ownership');
  if (!source || !projection) return refuse('Acquire an ownership snapshot with verified field and issuer evidence.');
  const hazards = Object.entries(unsafeIssues).flatMap(([fact, message]) => source.unsafe[fact] ? [message] : []);
  if (hazards.length) return refuse(`The ownership acquisition reports ${hazards.join(', ')}. Repair the source.`);
  return { ok: true, value: { source, projection } } as const;
}

function boundColumn(columns: readonly DatasetColumn[], id: string | undefined): DatasetColumn | undefined {
  const matches = columns.filter(column => column.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

/** null means an absent coordinate, while undefined means that its presented field is ambiguous. */
function coordinateField(columns: readonly DatasetColumn[], origin: string): string | null | undefined {
  const matches = columns.filter(column => acquiredColumnOrigin(column) === origin);
  if (!matches.length) return null;
  return matches.length === 1 && boundColumn(columns, matches[0].id) ? matches[0].id : undefined;
}

function readBars(
  dataset: WidgetDataset, fields: Extract<OwnershipSnapshotOptions, { view: 'bars' }>['fields'], source: OwnershipBarsSource,
): ChartBuildResult<OwnershipBars> {
  const { rows: [row], columns } = dataset;
  const symbolField = coordinateField(columns, 'symbol');
  const classField = coordinateField(columns, 'share_class');
  if (read(row, symbolField ?? undefined) !== source.issuer || classField === undefined
    || ((source.share_class !== null || classField !== null) && read(row, classField ?? undefined) !== source.share_class)) {
    return refuse(coordinateIssue);
  }

  const roles = ownershipBindingRoles(source);
  const measures: OwnershipBar[] = [];
  for (const id of ownershipBarRoles) {
    const label = ownershipBarLabels[id];
    const measure = source.measures[id];
    const field = fields[id];
    const metadata = { id, label, unit: measure?.unit ?? null, basis: measure?.basis ?? null, asOf: measure?.as_of ?? null };
    if (field === undefined) {
      measures.push({ ...metadata, status: measure ? 'unbound' : 'unavailable', fraction: null, reported: null });
      continue;
    }
    if (!measure) return refuse(`${label} has no acquired measure evidence. Repair the selected ownership fields.`);
    const role = roles.find(role => role.key === id);
    const column = boundColumn(columns, field);
    if (!role || !column || !acceptsBinding(role, column))
      return refuse(`Present the raw acquired field for ${label.toLowerCase()}. Repair the chart binding.`);
    const reported = read(row, field);
    const maximum = measure.unit === 'fraction' ? 1 : 100;
    if (reported !== null && !(typeof reported === 'number' && reported >= 0 && reported <= maximum))
      return refuse(`${label} has an invalid presented percentage for its acquired unit. Repair the source.`);
    let fraction = reported;
    if (reported !== null && measure.unit === 'percent-points') {
      const { digits, power } = decimalParts(reported);
      fraction = Number(`${digits}e${power - 2}`);
    }
    measures.push({ ...metadata, status: reported === null ? 'unavailable' : 'observed', reported, fraction });
  }
  return { ok: true, value: { view: 'bars', measures }, notes: [] };
}

function readWaffle(
  dataset: WidgetDataset, fields: Extract<OwnershipSnapshotOptions, { view: 'waffle' }>['fields'],
  source: OwnershipPartitionSource,
): ChartBuildResult<OwnershipWaffle> {
  const { columns } = dataset;
  const { partition, field_origins: origins } = source;
  for (const role of ownershipBindingRoles(source)) {
    const column = boundColumn(columns, fields[role.key as keyof typeof fields]);
    if (!column || !acceptsBinding(role, column)) return refuse('Present the raw acquired bucket and share fields. Repair the chart bindings.');
  }
  const coordinates = ['symbol', 'share_class', 'as_of', 'denominator'].map(origin => [origin, coordinateField(columns, origin)] as const);
  const canonicalRows = dataset.rows.map(row => Object.fromEntries([
    ...coordinates.map(([origin, field]) => [origin, read(row, field ?? undefined)]),
    [origins.bucket, read(row, fields.bucket)], [origins.share, read(row, fields.share)],
  ]));
  if (!ownershipSourceAdapter.rowsAgree(source, canonicalRows, dataset.completeness.kind)) return refuse(coordinateIssue);
  const reported = canonicalRows.map(row => ({ id: row[origins.bucket] as string, percent: row[origins.share] as number }))
    .sort((a, b) => compareKeys(a.id, b.id));

  const decimals = decimalBuckets(reported);
  const total = decimals.reduce((sum, { units }) => sum + units, 0n);
  const difference = total - BigInt(cellCount) * unitsPerPercent;
  const bound = partition.rounding_bound_percent || 1e-10;
  const permitted = percentUnits(Math.min(.01, bound));
  if (difference < -permitted || difference > permitted)
    return refuse('The ownership partition total discrepancy exceeds the acquired rounding tolerance. Repair the source partition.');

  const counts = apportion(decimals);
  return { ok: true, value: {
    view: 'waffle', asOf: partition.as_of, denominator: partition.denominator, reference: partition.reference,
    roundingBoundPercent: partition.rounding_bound_percent, totalDiscrepancyPercent: Number(`${difference}e-${decimalPlaces}`),
    buckets: reported.map(bucket => ({ ...bucket, cells: counts[bucket.id] })),
  }, notes: [] };
}

function readMeasures(
  dataset: WidgetDataset, options: OwnershipSnapshotOptions, source: OwnershipSource,
): ChartBuildResult<OwnershipBars | OwnershipWaffle> {
  if ('bucket_keys' in source) return options.view === 'waffle' ? readWaffle(dataset, options.fields, source)
    : refuse('Acquire independent ownership measures for bars or choose the certified waffle.');
  return options.view === 'bars' ? readBars(dataset, options.fields, source)
    : refuse('Independent measures can overlap. Acquire a certified partition with exclusive, exhaustive buckets for waffle.');
}

const barMargin = { l: 124, r: 18, t: 40, b: 35, autoexpand: false };
const waffleMargin = { l: 14, r: 14, t: 40, b: 14, autoexpand: false };
const hovertemplate = '%{text}<extra></extra>';
function fractionPercent(fraction: number): string {
  if (fraction === 0) return '0%';
  const { digits, power } = decimalParts(fraction);
  const point = digits.length + power + 2;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}%`;
  if (point >= digits.length) return `${digits.padEnd(point, '0')}%`;
  return `${digits.slice(0, point)}.${digits.slice(point)}%`;
}

function measureText(measure: OwnershipBar) {
  const { label, status, reported, unit, asOf, basis } = measure;
  const value = reported === null ? status === 'unbound' ? 'Binding unselected' : 'Unavailable'
    : (unit === 'percent-points' ? `${reported}%` : fractionPercent(reported)) + ` (reported ${reported} ${unit})`;
  return [label, value, `As of ${asOf ?? 'unknown'}`, basis ? 'Shares outstanding basis' : 'Basis unknown'];
}

function drawBars(snapshot: OwnershipBars & SnapshotIdentity, context: RecipeContext) {
  const { measures, retrievedAt } = snapshot;
  const width = (context.viewportWidth ?? 360) - barMargin.l - barMargin.r;
  const height = (context.viewportHeight ?? 280) - barMargin.t - barMargin.b;
  // Reserve one CSS pixel after the possible loss from rounding the plot width.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 120 || height < 120
    || measures.some(({ fraction, reported }) => (reported ?? 0) > 0 && (fraction ?? 0) * (width - 1) < 1)) return;
  const positive = measures.filter(measure => measure.fraction !== null && measure.fraction > 0);
  const states = measures.filter(measure => measure.fraction === null || measure.fraction === 0);
  const text = (items: OwnershipBar[]) => items.map(measure =>
    [...measureText(measure), `Retrieved ${retrievedAt}`].map(escape).join('<br>'));
  const position = (items: OwnershipBar[]) => items.map(measure => measures.indexOf(measure));
  const dark = context.theme === 'dark';
  const data: unknown[] = [];
  if (positive.length) data.push({
    type: 'bar', orientation: 'h', x: positive.map(measure => measure.fraction), y: position(positive),
    // Explicit gap and alpha keep Plotly from expanding a thin bar to whole pixels.
    width: .55, marker: { color: dark ? 'rgba(108,176,255,0.99)' : 'rgba(31,105,190,0.99)' },
    textposition: 'none', text: text(positive), hovertemplate,
  });
  if (states.length) data.push({
    type: 'scatter', mode: 'markers', x: states.map(() => 0), y: position(states), cliponaxis: false,
    marker: { size: 10, color: dark ? '#dfe4ec' : '#2b3546',
      symbol: states.map(measure => measure.fraction === 0 ? 'circle-open' : 'x') },
    text: text(states), hovertemplate,
  });
  return { data, layout: {
    margin: barMargin, barmode: 'group', bargap: .35,
    xaxis: { type: 'linear', range: [0, 1], fixedrange: true, tickformat: '.0%', tickvals: [0, .25, .5, .75, 1], layer: 'below traces' },
    yaxis: {
      type: 'linear', range: [2.5, -.5], fixedrange: true, tickvals: [0, 1, 2], showgrid: false, zeroline: false,
      ticktext: measures.map(measure => [measure.label, ...(measure.fraction === 0 ? ['0%']
        : measure.fraction === null ? [measure.status === 'unbound' ? 'Unselected' : 'Unavailable'] : [])].map(escape).join('<br>')),
    },
  } };
}

const bucketColors = ['#3b85cc', '#ec9b32', '#2f9d83', '#bd709e', '#a99c29', '#796cc1'];
function drawWaffle(snapshot: OwnershipWaffle & SnapshotIdentity, context: RecipeContext) {
  const width = (context.viewportWidth ?? 360) - waffleMargin.l - waffleMargin.r;
  const height = (context.viewportHeight ?? 280) - waffleMargin.t - waffleMargin.b;
  const step = Math.min(width, height) / gridSide;
  if (!Number.isFinite(width) || !Number.isFinite(height) || step < 12) return;
  const x: number[] = [], y: number[] = [], colors: string[] = [], text: string[] = [];
  let colorIndex = 0;
  for (const { id, percent, cells } of snapshot.buckets) {
    if (!cells) continue;
    // Spread later categories around the color wheel without reusing a color.
    const color = bucketColors[colorIndex] ?? `hsl(${colorIndex * 137 % 360}, 48%, 50%)`;
    colorIndex++;
    const hover = [id, `${percent}% reported`, `${cells} of ${cellCount} cells (1% each)`,
      `As of ${snapshot.asOf}`, `Retrieved ${snapshot.retrievedAt}`].map(escape).join('<br>');
    for (let i = 0; i < cells; i++) {
      y.push(Math.floor(x.length / gridSide));
      x.push(x.length % gridSide);
      colors.push(color);
      text.push(hover);
    }
  }
  if (x.length !== cellCount) return;
  const axis = { type: 'linear', constrain: 'domain', visible: false, fixedrange: true };
  return {
    data: [{ type: 'scatter', mode: 'markers', x, y, text, hovertemplate,
      marker: { symbol: 'square', size: Math.floor(step * .8), color: colors } }],
    layout: {
      margin: waffleMargin,
      xaxis: { ...axis, range: [-.5, 9.5] },
      yaxis: { ...axis, range: [9.5, -.5], scaleanchor: 'x', scaleratio: 1 },
    },
  };
}

export function buildOwnershipSnapshot(dataset: WidgetDataset, options: RecipeOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'ownership-snapshot');
  if (!decoded.ok || options.kind !== 'ownership-snapshot')
    return refuse(decoded.ok ? 'Choose the ownership snapshot recipe.' : decoded.message);
  const acquired = inspectOwnershipSource(dataset);
  if (!acquired.ok) return acquired;
  const { source, projection } = acquired.value;
  if (options.issuer !== source.issuer) return refuse(`Choose the acquired issuer ${source.issuer} or reload the intended source.`);
  if (dataset.provenance.inputMayContainAggregates || dataset.rows.some(row => row.groupPath !== undefined))
    return refuse('Present raw ownership rows before grouping, pivoting or aggregation.');
  const { kind, acquiredRowCount } = dataset.completeness;
  if (kind !== 'complete' && kind !== 'unknown')
    return refuse(`Ownership requires its full acquired snapshot. The current acquisition is ${kind}. Repair the source.`);
  if (projection.omitted.length || dataset.rows.length !== source.delivered_count
    || (acquiredRowCount !== undefined && acquiredRowCount !== source.delivered_count)) {
    return refuse(options.view === 'waffle'
      ? 'The presentation omits or changes acquired ownership buckets. Repair the source or restore the full partition.'
      : 'The presentation omits or changes the acquired issuer row. Repair the source or restore the issuer.');
  }

  const input = readMeasures(dataset, options, source);
  if (!input.ok) return input;
  const snapshot: OwnershipSnapshotDetails = {
    ...input.value, issuer: source.issuer, shareClass: source.share_class, retrievedAt: source.retrieved_at,
  };
  const plot = snapshot.view === 'bars' ? drawBars(snapshot, context) : drawWaffle(snapshot, context);
  if (!plot) return refuse(geometryIssue);

  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version, options.issuer,
    options.view, ...(options.view === 'waffle' ? [options.fields.bucket, options.fields.share]
      : ownershipBarRoles.map(role => options.fields[role] ?? null))]);
  const classText = source.share_class === null ? 'Share class unknown' : `Share class ${source.share_class}`;
  const heading = snapshot.view === 'bars' ? 'Independent ownership measures' : 'Certified ownership partition';
  const notes = [`${heading} · ${source.issuer} · ${classText} · Retrieved ${source.retrieved_at}.`];
  if (projection.filtered) notes.push('The presented source has active filters or selection and retains the acquired rows.');
  if (snapshot.view === 'bars') {
    notes.push(...snapshot.measures.map(measure => measureText(measure).join(' · ') + '.'));
  } else {
    notes.push(`As of ${snapshot.asOf} · Shares outstanding basis · Acquired partition reference ${snapshot.reference}.`);
    notes.push(`100 cells at 1% visual granularity. Reported shares retain their original values. Total discrepancy ${snapshot.totalDiscrepancyPercent} percentage points.`);
  }
  return { ok: true, ownershipSnapshot: snapshot, revision, notes, figure: { data: plot.data, layout: {
    ...themedLayout(context.theme), ...plot.layout, title: { text: heading, font: { size: 15 } },
    uirevision: revision, showlegend: false, hovermode: 'closest',
  } } };
}
