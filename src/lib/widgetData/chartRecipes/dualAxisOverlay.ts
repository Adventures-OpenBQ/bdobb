// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { escape } from '../figureHelpers';
import type { DatasetColumn, DatasetRow, WidgetDataset } from '../types';
import { readChartSource, readChartSourceProjection, type ChartBuildResult } from './chartSourceContracts';
import { read } from './estimateEvidence';
import { acquiredColumnOrigin, isoDate } from './financialEvidence';
import {
  isOverlayReference, isSupportedOverlayQuarter, overlayAdapter, overlayBindingOrigins, overlayCoordinateByVintage,
  overlayCoordinateKey, overlayPairIssue, overlayRowFacts, overlaySourceIssue,
  parseOverlaySource, type OverlaySeriesFact, type OverlaySource,
} from './overlayEvidence';
import { overlayAxisTicks, overlayOriginalValue } from './overlayDisplay';
import { decodeDualAxisOverlayOptions } from './settings';
import type { DualAxisOverlayOptions, RecipeContext, RecipeRefusal, RecipeRequestOptions, RecipeResult } from './types';
import {
  axisPixels, drawableValues, dualAxisOverlayMinPlotHeight, dualAxisOverlayMinPlotWidth, extents, valueRange, type Range,
} from './viewport';

type Side = 'left' | 'right';
type SessionTiming = 'before-market' | 'during-market' | 'after-market';
export type OverlayPoint = {
  id: string;
  coordinate: string;
  value: number | null;
  state: 'value' | 'missing' | 'omitted';
  observationDate: string | null;
  availableAt: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  releaseReference: string | null;
  sessionTiming: SessionTiming | null;
};
type OverlaySeries = {
  title: string;
  unitLabel: string;
  fact: OverlaySeriesFact;
  vintage: string;
  inputReference: string;
  points: OverlayPoint[];
};
export type OverlaySeriesPair = {
  recipe: DualAxisOverlayOptions['recipe'];
  identity: OverlaySource['identity'];
  preparationReference: string;
  retrievedAt: string;
  filtered: boolean;
  left: OverlaySeries;
  right: OverlaySeries;
};

const sides = ['left', 'right'] as const;
const hazards = {
  identity_conflict: 'conflicting series or issuer identities',
  unit_conflict: 'conflicting units or currencies',
  coordinate_conflict: 'conflicting series, availability or fiscal coordinates',
  basis_conflict: 'conflicting financial bases',
  untraced_omission: 'unexplained source omissions',
} satisfies Record<keyof OverlaySource['unsafe'], string>;

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const bindingIssue = 'Present each required physical series, date, value and fiscal field once. Repair the overlay bindings.';
const factsIssue = 'The visible rows disagree with the prepared overlay acquisition. Repair the source or field bindings.';

function physicalColumns(columns: readonly DatasetColumn[], rowFacts: ReturnType<typeof overlayRowFacts>): Map<string, string> | undefined {
  const seenIds = new Set<string>();
  const origins = new Map<string, string>();
  const relevant = new Set<string>([...Object.values(overlayBindingOrigins), 'release_ref', 'session_timing', ...Object.keys(rowFacts)]);
  for (const column of columns) {
    if (seenIds.has(column.id)) return;
    seenIds.add(column.id);
    const origin = acquiredColumnOrigin(column);
    if (origin !== undefined && relevant.has(origin)) {
      if (origins.has(origin)) return;
      if (origin === 'value' && column.dtype !== undefined && column.dtype !== 'number') return;
      origins.set(origin, column.id);
    }
  }
  return origins;
}

function isSessionTiming(value: unknown): value is SessionTiming {
  return value === 'before-market' || value === 'during-market' || value === 'after-market';
}

function pointFromRow(row: DatasetRow, source: OverlaySource, side: Side,
  fields: DualAxisOverlayOptions['fields'], origins: ReadonlyMap<string, string>, expectedFacts: readonly [string, unknown][]): OverlayPoint | undefined {
  for (const [origin, expected] of expectedFacts) {
    const field = origins.get(origin);
    if (field !== undefined && read(row, field) !== expected) return;
  }

  const fact = source.series[side], vintage = source.vintages[side], eps = fact.id === 'reported_diluted_eps';
  const date = read(row, fields.date), value = read(row, fields.value);
  if (!overlayCoordinateByVintage(date, vintage, false)
    || (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) return;

  const at = fields.availableAt === undefined ? null : read(row, fields.availableAt);
  if (at !== null && (!overlayCoordinateByVintage(at, vintage, true) || at.slice(0, 10) < date)) return;
  const releaseField = origins.get('release_ref');
  const reference = releaseField === undefined ? null : read(row, releaseField);
  if (reference !== null && !isOverlayReference(reference)) return;
  if (fields.availableAt !== undefined && releaseField !== undefined && (at === null) !== (reference === null)) return;

  const start = fields.targetStart === undefined ? null : read(row, fields.targetStart);
  const end = fields.targetEnd === undefined ? null : read(row, fields.targetEnd);
  const timingField = origins.get('session_timing');
  const timing = timingField === undefined ? null : read(row, timingField);
  let coordinate = date, targetStart: string | null = null, targetEnd: string | null = null, sessionTiming: SessionTiming | null = null;
  if (eps) {
    if (at === null || !isoDate(start) || end !== date || !isSupportedOverlayQuarter(start, end)
      || (timing !== null && !isSessionTiming(timing))) return;
    coordinate = at;
    targetStart = start;
    targetEnd = end;
    sessionTiming = timing;
  } else if (start !== null || end !== null || timing !== null) return;

  if (fact.id === 'CUSR0000SA0') {
    const month = date.slice(0, 7);
    if (!date.endsWith('-01') || (value !== null && (value <= 0 || vintage.slice(0, 7) <= month))
      || (at !== null && at.slice(0, 7) <= month)) return;
  }
  if (fact.id === 'adjusted_close' && value !== null && value <= 0) return;

  return { id: fact.id + '|' + coordinate, coordinate, value, state: value === null ? 'missing' : 'value',
    observationDate: date, availableAt: at, targetStart, targetEnd, sessionTiming, releaseReference: reference };
}

function orderedPoints(source: OverlaySource, side: Side, visible: ReadonlyMap<string, OverlayPoint>, omitted: ReadonlySet<string>) {
  const fact = source.series[side];
  const points: OverlayPoint[] = [];
  for (const coordinate of source.coordinates[side]) {
    const id = fact.id + '|' + coordinate;
    const point = visible.get(coordinate);
    if (point) points.push(point);
    else if (omitted.has(id)) points.push({ id, coordinate, value: null, state: 'omitted',
      observationDate: fact.coordinate === 'observation-date' ? coordinate : null, availableAt: null,
      targetStart: null, targetEnd: null, sessionTiming: null, releaseReference: null });
    else return;
  }
  return points.sort((a, b) => {
    const key = overlayCoordinateKey(a.coordinate), other = overlayCoordinateKey(b.coordinate);
    return key < other ? -1 : key > other ? 1 : 0;
  });
}

function seriesDetails(source: OverlaySource, side: Side, points: OverlayPoint[]): OverlaySeries {
  const fact = source.series[side];
  const labels = {
    adjusted_close: ['Adjusted close', fact.currency + '/share'],
    reported_diluted_eps: ['Diluted FQ EPS', fact.currency + '/share'],
    CUSR0000SA0: ['US CPI-U', '1982–84 = 100'],
    DGS10: ['10-year yield', '%'],
  };
  const [title, unitLabel] = labels[fact.id];
  return { title, unitLabel, fact, vintage: source.vintages[side], inputReference: source.preparation.input_refs[side === 'left' ? 0 : 1], points };
}

function describeSide(series: OverlaySeries) {
  let values = 0, missing = 0, omitted = 0, missingRelease = 0;
  for (const point of series.points) {
    if (point.state === 'omitted') omitted++;
    else if (point.state === 'missing') missing++;
    else {
      values++;
      if (point.availableAt === null) missingRelease++;
    }
  }
  const first = series.points[0].coordinate, last = series.points[series.points.length - 1].coordinate;
  const range = first === last ? first : first + ' to ' + last;
  const coverage = `${series.title} (${series.fact.id}), acquired ${series.vintage}: ${values} shown, ${missing} explicit missing, ${omitted} omitted. Acquired coordinates: ${range}.`;
  const release = missingRelease ? ` Release date/time unavailable for ${missingRelease} shown ${missingRelease === 1 ? 'observation' : 'observations'}.` : '';
  return coverage + release;
}

/** Prepare one acquired pair using only the selected physical fields and visible companion facts. */
export function prepareOverlaySeries(dataset: WidgetDataset, options: DualAxisOverlayOptions): ChartBuildResult<OverlaySeriesPair> {
  const decoded = decodeDualAxisOverlayOptions(options);
  if (!decoded.ok) return refuse(decoded.message);
  const { fields, recipe } = decoded.options;
  const { provenance, columns, rows } = dataset;
  const source = readChartSource(provenance, 'overlay', parseOverlaySource);
  const projection = readChartSourceProjection(provenance, 'overlay');
  if (!source || !projection || (provenance.receipt !== undefined && !overlayAdapter.legacyReceiptAgrees?.(source, provenance.receipt)))
    return refuse(overlaySourceIssue);
  const unsafe = Object.entries(hazards).filter(([flag]) => source.unsafe[flag]).map(([, label]) => label);
  if (unsafe.length) return refuse(`The overlay acquisition reports ${unsafe.join(', ')}. Repair the source.`);
  if (source.recipe !== recipe) return refuse(overlayPairIssue);
  if (provenance.inputMayContainAggregates || rows.some(row => row.groupPath !== undefined)
    || columns.some(column => column.aggregation || column.measureId || column.splitPath?.length || column.analytical?.scope === 'aggregate'))
    return refuse('Present raw acquired overlay rows before grouping, pivoting or aggregation.');

  const leftFacts = overlayRowFacts(source, 'left');
  const expectedFacts = { left: Object.entries(leftFacts), right: Object.entries(overlayRowFacts(source, 'right')) };
  const origins = physicalColumns(columns, leftFacts);
  if (!origins || (Object.keys(overlayBindingOrigins) as (keyof typeof overlayBindingOrigins)[]).some(role =>
    fields[role] !== undefined && origins.get(overlayBindingOrigins[role]) !== fields[role])) return refuse(bindingIssue);

  const omitted = new Set(projection.omitted);
  const acquired = { left: new Set(source.coordinates.left), right: new Set(source.coordinates.right) };
  const visible = { left: new Map<string, OverlayPoint>(), right: new Map<string, OverlayPoint>() };
  const fiscalEnds = new Set<string>();
  for (const row of rows) {
    const id = read(row, fields.series);
    const side = id === source.series.left.id ? 'left' : id === source.series.right.id ? 'right' : undefined;
    const point = side && pointFromRow(row, source, side, fields, origins, expectedFacts[side]);
    if (!side || !point || !acquired[side].has(point.coordinate) || visible[side].has(point.coordinate)
      || omitted.has(point.id)) return refuse(factsIssue);
    if (point.targetEnd !== null) {
      if (fiscalEnds.has(point.targetEnd)) return refuse(factsIssue);
      fiscalEnds.add(point.targetEnd);
    }
    visible[side].set(point.coordinate, point);
  }
  const leftPoints = orderedPoints(source, 'left', visible.left, omitted);
  const rightPoints = orderedPoints(source, 'right', visible.right, omitted);
  if (!leftPoints || !rightPoints)
    return refuse('The prepared overlay has unexplained missing coordinates. Reload the source or use a traced presentation.');
  const left = seriesDetails(source, 'left', leftPoints), right = seriesDetails(source, 'right', rightPoints);
  if (![left, right].every(series => series.points.some(point => point.state === 'value')))
    return refuse('Present at least one acquired numeric observation on each axis. Repair the source or table filter.');

  const notes = [
    'The two series use independent linear axes. Apparent movement together depends on the scales.',
    `Prepared snapshot ${source.preparation.reference}, acquired ${source.retrieved_at}. ${source.delivered_count} acquired coordinates.`,
    describeSide(left), describeSide(right),
  ];
  if (projection.filtered) notes.push('The presented source is filtered. Traced excluded coordinates remain gaps.');
  if (source.identity) {
    notes.unshift(source.series.right.restated
      ? 'Diluted EPS is currently restated; not historical as-known.'
      : 'Diluted EPS reflects the current acquisition; not historical as-known.');
    notes.push(`${source.identity.listing} uses split- and dividend-adjusted closing prices and fiscal-quarter diluted EPS on the same current split-share basis.`);
    notes.push('Adjusted close uses the exchange session date. Same-day release ordering needs session timing evidence.');
    if (right.points.some(point => point.availableAt && isoDate(point.availableAt)))
      notes.push('Date-only EPS availability establishes no ordering against the same day’s close.');
  } else {
    notes.push('US CPI-U is the monthly seasonally adjusted all-items US city average index. Its x coordinate encodes the measurement month. DGS10 is the daily nominal US ten-year constant-maturity Treasury yield.');
    if (left.points.some(point => point.state === 'value' && point.availableAt === null))
      notes.unshift('CPI publication timing is unknown where release dates are unavailable.');
  }

  return { ok: true, notes, value: { recipe, identity: source.identity, preparationReference: source.preparation.reference,
    retrievedAt: source.retrieved_at, filtered: projection.filtered, left, right } };
}

const day = 86_400_000;

// Plotly parses the fractional seconds into a binary64 millisecond coordinate after constructing the UTC minute.
function plotlyDateCoordinate(value: string): number {
  if (value.length === 10) return Date.parse(value);
  const seconds = Number(value.slice(17).replace(/(?:Z|\+00:00)$/, ''));
  return Date.parse(value.slice(0, 16) + ':00Z') + seconds * 1000;
}

function seriesText(series: OverlaySeries, point: OverlayPoint): string {
  const value = point.value === null ? 'Missing observation'
    : overlayOriginalValue(point.value, series.fact.unit, series.unitLabel);
  const lines = [series.title, value];
  if (point.targetStart && point.targetEnd) {
    lines.push(`Fiscal quarter: ${point.targetStart} to ${point.targetEnd}`);
  } else if (point.observationDate) {
    const date = point.observationDate;
    lines.push(series.fact.id === 'CUSR0000SA0' ? `Measurement month: ${date.slice(0, 7)}`
      : series.fact.id === 'adjusted_close' ? `Session date: ${date} (date only)` : `Observation date: ${date}`);
  }
  if (point.availableAt) {
    lines.push(`Available: ${point.availableAt}${isoDate(point.availableAt) ? ' (date only)' : ''}`);
  } else if (series.fact.id === 'CUSR0000SA0' || series.fact.id === 'DGS10') {
    lines.push('Release date/time unavailable');
  }
  if (point.sessionTiming) lines.push(`Reported session timing: ${point.sessionTiming}`);
  if (point.releaseReference) lines.push(`Release reference: ${point.releaseReference}`);
  if (series.fact.id === 'reported_diluted_eps') lines.push(series.fact.restated
    ? 'Currently restated; not historical as-known' : 'Current acquisition; not historical as-known');
  lines.push(`Input acquired: ${series.vintage}`);
  return lines.map(escape).join('<br>');
}

function trace(series: OverlaySeries, side: Side, color: string) {
  const markers = series.fact.id === 'reported_diluted_eps' || series.fact.id === 'CUSR0000SA0';
  return { type: 'scatter', mode: markers ? 'markers' : 'lines+markers', uid: series.fact.id, name: escape(series.title),
    x: series.points.map(point => point.coordinate), y: series.points.map(point => point.value), yaxis: side === 'left' ? 'y' : 'y2',
    ids: series.points.map(point => point.id), text: series.points.map(point => seriesText(series, point)),
    // The open ring and smaller diamond stay visible and independently hoverable at a shared screen position.
    marker: side === 'left' ? { color, symbol: 'circle-open', size: 12, line: { width: 2 } }
      : { color, symbol: 'diamond', size: markers ? 7 : 5 },
    line: { color, dash: side === 'left' ? 'solid' : 'dash', simplify: false }, connectgaps: false,
    hovertemplate: '%{text}<extra></extra>',
  };
}

export function buildDualAxisOverlay(dataset: WidgetDataset, options: RecipeRequestOptions, context: RecipeContext): RecipeResult {
  if (options.kind !== 'dual-axis-overlay') return refuse('Choose a dual-axis overlay recipe.');
  const prepared = prepareOverlaySeries(dataset, options);
  if (!prepared.ok) return prepared;
  const { viewportWidth = 640, viewportHeight = 360 } = context;
  if (viewportWidth < dualAxisOverlayMinPlotWidth || viewportHeight < dualAxisOverlayMinPlotHeight)
    return refuse(`Increase the drawing area to at least ${dualAxisOverlayMinPlotWidth} × ${dualAxisOverlayMinPlotHeight} pixels so both axes and their units are visible.`);

  const { notes, value: pair } = prepared;
  const { left, right } = pair;
  const leftValues = left.points.flatMap(point => point.value === null ? [] : [point.value]);
  const rightValues = right.points.flatMap(point => point.value === null ? [] : [point.value]);
  const leftRange = valueRange(leftValues, 1), rightRange = valueRange(rightValues, right.fact.unit === 'yield-fraction' ? .01 : 1);
  const linearIssue = 'Plotly’s linear scale cannot place the acquired values faithfully. Choose a smaller supported range or repair the source.';

  if (!leftRange || !rightRange) return refuse(linearIssue);
  const leftTicks = overlayAxisTicks(leftRange, left.fact.unit), rightTicks = overlayAxisTicks(rightRange, right.fact.unit);
  const margin = { l: leftTicks.margin, r: rightTicks.margin, t: 20, b: 54, pad: 0, autoexpand: false };
  const width = viewportWidth - margin.l - margin.r;
  const height = viewportHeight - margin.t - margin.b;
  if (!(width > 0 && height > 0)) return refuse('Increase the drawing area so both axes and their units are visible.');
  if (!drawableValues(leftValues, leftRange, height) || !drawableValues(rightValues, rightRange, height)) return refuse(linearIssue);

  const datePositions = {
    left: left.points.map(point => plotlyDateCoordinate(point.coordinate)),
    right: right.points.map(point => plotlyDateCoordinate(point.coordinate)),
  };
  const [leftStart, leftEnd] = extents(datePositions.left), [rightStart, rightEnd] = extents(datePositions.right);
  const min = Math.min(leftStart, rightStart), max = Math.max(leftEnd, rightEnd);
  const datePad = Math.ceil(Math.max(max - min, day) * .08);
  const dateRange: Range = [Math.max(Date.parse('0001-01-01'), Math.floor(min) - datePad),
    Math.min(Date.parse('9999-12-31T23:59:59.999Z'), Math.ceil(max) + datePad)];
  const xPixel = axisPixels(dateRange, width, false);
  for (const side of sides) {
    const rendered = new Set<number>();
    const points = pair[side].points;
    for (let i = 0; i < points.length; i++) {
      if (points[i].state !== 'value') continue;
      const position = xPixel(datePositions[side][i]);
      if (!(position >= 0 && position <= width) || rendered.has(position)) {
        const coordinate = pair[side].fact.coordinate === 'availability-date' ? 'availability' : 'observation';
        return refuse(`Plotly cannot draw distinct ${pair[side].title} ${coordinate} coordinates at this scale. Use a wider drawing area or a narrower acquired period.`);
      }
      rendered.add(position);
    }
  }

  const { series, date, value, availableAt, targetStart, targetEnd } = options.fields;
  const { identity } = pair;
  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version, pair.recipe,
    [series, date, value, availableAt, targetStart, targetEnd],
    identity && [identity.issuer, identity.listing, identity.share_basis_ref],
    left.fact.currency, left.fact.id, right.fact.id, right.fact.period_kind]);
  const leftColor = context.theme === 'dark' ? '#68acff' : '#195dac';
  const rightColor = context.theme === 'dark' ? '#ffa779' : '#9f3e16';
  const axis = (series: OverlaySeries, range: Range, ticks: ReturnType<typeof overlayAxisTicks>, color: string, side: Side) => ({
    type: 'linear', side, range, tickmode: 'array', tickvals: ticks.tickvals, ticktext: ticks.ticktext,
    automargin: false, zeroline: false, tickfont: { family: 'monospace', size: 11, color },
    title: { text: escape(series.title + ' (' + series.unitLabel + ')'), font: { size: 12, color }, standoff: 6 },
  });
  return {
    ok: true, overlay: pair, revision, notes,
    figure: { data: [trace(left, 'left', leftColor), trace(right, 'right', rightColor)],
      layout: { ...themedLayout(context.theme), uirevision: revision, showlegend: false, margin, hovermode: 'closest',
        hoverlabel: { font: { size: 11 }, align: 'left' },
        xaxis: { type: 'date', range: dateRange.map(ms => new Date(ms).toISOString()), automargin: false,
          nticks: Math.max(2, Math.floor(width / 110)), tickfont: { size: 11 },
          title: { text: 'Source dates (UTC)', font: { size: 12 }, standoff: 5 } },
        yaxis: axis(left, leftRange, leftTicks, leftColor, 'left'),
        yaxis2: { ...axis(right, rightRange, rightTicks, rightColor, 'right'), overlaying: 'y', showgrid: false },
      },
    },
  };
}
