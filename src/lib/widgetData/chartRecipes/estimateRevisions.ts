// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape, list } from '../figureHelpers';
import type { DatasetColumn, WidgetDataset } from '../types';
import { roundedRatio, scaledInteger } from './binary64';
import { readChartSource, readChartSourceProjection, type ChartBuildResult } from './chartSourceContracts';
import { read } from './estimateEvidence';
import { estimateVintageAdapter, parseEstimateVintageSource, type EstimateVintageSource } from './estimateVintageEvidence';
import { acquiredColumnOrigin } from './financialEvidence';
import { metricVintageKey } from './metricEvidence';
import { linearAxisTicks } from './overlayDisplay';
import { decodeEstimateRevisionsOptions, estimateRevisionFieldOrigins } from './settings';
import type { EstimateRevisionsOptions, EstimateRevisionsSurface, RecipeContext, RecipeRefusal, RecipeRequestOptions, RecipeResult } from './types';
import {
  axisPixels, drawableValues, estimateRevisionMinPlotHeight, estimateRevisionMinPlotWidth,
  maxRecipeViewportDimension, valueRange, type Range,
} from './viewport';

type Issuer = EstimateVintageSource['issuers'][number];
type Vintage = EstimateVintageSource['vintages'][number];
type CompleteUniverse = Extract<EstimateVintageSource['universe'], { status: 'complete' }>;
type Reading =
  | { state: 'value'; value: number }
  | { state: 'missing' | 'omitted' | 'cell-error'; value: null };
type Change = {
  fromVintage: string;
  absolute: number | null;
  percent: number | null;
  absoluteUnavailable?: 'out-of-range';
  percentUnavailable?: 'nonpositive-baseline' | 'out-of-range';
};
type Observation = Reading & { vintage: string; change: Change | null; rank: number | null };
type Series = { issuer: Issuer; unitLabel: string; observations: Observation[] };
type RankColumn =
  | { vintage: string; status: 'available' }
  | { vintage: string; status: 'unavailable'; unavailableMembers: string[] };
export type EstimateRevisionData = {
  metric: EstimateRevisionsOptions['metric'];
  view: EstimateRevisionsOptions['view'];
  target: EstimateRevisionsOptions['target'];
  vintages: Vintage[];
  retrievedAt: string;
  filtered: boolean;
  universe: CompleteUniverse | null;
  series: Series[];
  columns: RankColumn[];
};

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });
const sourceIssue = 'Load a verified local history of independently recorded consensus snapshots. Fiscal target dates and live estimate rows do not establish vintages.';
const bindingIssue = 'Present the six distinct, unambiguous physical estimate fields and repair the chart bindings.';
const factsIssue = 'The visible rows disagree with the acquired estimate history. Repair the source or field bindings.';
const hazards = {
  identity_conflict: 'conflicting issuer identities', vintage_conflict: 'conflicting vintage or batch facts',
  target_conflict: 'conflicting fiscal targets', unit_conflict: 'conflicting denomination or share basis', duplicate_conflict: 'conflicting duplicate observations',
} satisfies Record<keyof EstimateVintageSource['unsafe'], string>;

const companionFields = ['entity_ref', 'currency', 'unit', 'basis', 'basis_ref', 'observed_at', 'batch', 'input_ref', 'source_contract', 'metric'];
const relevantOrigins = new Set([...Object.values(estimateRevisionFieldOrigins), ...companionFields]);

function estimateColumns(columns: readonly DatasetColumn[], fields: EstimateRevisionsOptions['fields']) {
  const origins = new Map<string, string>(), seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.id)) return;
    seen.add(column.id);
    const origin = acquiredColumnOrigin(column);
    if (origin === undefined || !relevantOrigins.has(origin)) continue;
    if (origins.has(origin) || (origin === 'value' && column.dtype !== undefined && column.dtype !== 'number')) return;
    origins.set(origin, column.id);
  }
  if (Object.entries(estimateRevisionFieldOrigins).some(([role, origin]) =>
    origins.get(origin) !== fields[role as keyof typeof fields])) return;
  return origins;
}

function readObservationRows(dataset: WidgetDataset, source: EstimateVintageSource,
  fields: EstimateRevisionsOptions['fields'], origins: ReadonlyMap<string, string>, omitted: ReadonlySet<string>) {
  const issuers = new Map(source.issuers.map(i => [i.issuer, i]));
  const vintages = new Map(source.vintages.map(v => [v.id, v]));
  const batchInputs = new Map(source.inputs.map(i => [i.batch, i.reference]));
  const coordinates = estimateVintageAdapter.coordinates(source)[0].points;
  const acquired = new Set(coordinates.map(c => c.id));
  const visible = new Map<string, Reading>();
  const visibleIssuers = new Set<string>();
  for (const row of dataset.rows) {
    const id = read(row, fields.issuer), vintage = read(row, fields.vintage);
    const issuer = typeof id === 'string' ? issuers.get(id) : undefined;
    const observed = typeof vintage === 'string' ? vintages.get(vintage) : undefined;
    if (!issuer || !observed || read(row, fields.targetStart) !== source.target.start
      || read(row, fields.targetEnd) !== source.target.end || read(row, fields.targetKind) !== source.target.kind) return refuse(factsIssue);
    const key = coordinateKey(source.target, issuer.issuer, observed.id);
    if (!acquired.delete(key) || omitted.has(key)) return refuse(factsIssue);

    const expectedFacts = {
      entity_ref: issuer.entity_ref, currency: issuer.currency, unit: issuer.unit, basis: issuer.basis, basis_ref: issuer.basis_ref,
      observed_at: observed.observed_at, batch: observed.batch, input_ref: batchInputs.get(observed.batch),
      source_contract: 'independently-recorded-consensus-mean', metric: source.metric,
    };
    for (const [origin, expected] of Object.entries(expectedFacts)) {
      const field = origins.get(origin);
      if (field !== undefined && read(row, field) !== expected) return refuse(factsIssue);
    }

    const value = read(row, fields.value);
    if (typeof value === 'number' && Number.isFinite(value)) visible.set(key, { value, state: 'value' });
    else if (value === null) visible.set(key, { value, state: 'missing' });
    else if (Object.hasOwn(row.cellErrors ?? {}, fields.value)) visible.set(key, { value: null, state: 'cell-error' });
    else return refuse(factsIssue);
    visibleIssuers.add(issuer.issuer);
  }
  for (const key of acquired) {
    if (!omitted.has(key)) return refuse('The estimate history has unexplained missing rows. Reload the source or use a traced table selection.');
    visible.set(key, { value: null, state: 'omitted' });
  }
  return { visible, visibleIssuers };
}

function coordinateKey(target: EstimateRevisionData['target'], issuer: string, vintage: string) {
  return [issuer, target.start, target.end, target.kind, vintage].join('|');
}

function orderedPins(source: EstimateVintageSource, pins: readonly string[]) {
  const selected = new Set(pins);
  return source.vintages.filter(v => selected.has(v.id))
    .map(v => ({ ...v, timeKey: metricVintageKey(v.observed_at) }))
    .sort((a, b) => a.timeKey < b.timeKey ? -1 : a.timeKey > b.timeKey ? 1 : 0)
    .map(({ id, observed_at, batch }) => ({ id, observed_at, batch }));
}

function changeBetween(current: number, earlier: number, fromVintage: string, binary: DataView): Change {
  const difference = current - earlier;
  const change: Change = { fromVintage, absolute: Number.isFinite(difference) ? difference : null, percent: null };
  if (change.absolute === null) change.absoluteUnavailable = 'out-of-range';
  if (earlier <= 0) change.percentUnavailable = 'nonpositive-baseline';
  else {
    const baseline = scaledInteger(earlier, binary);
    const numerator = scaledInteger(current, binary) - baseline;
    const percent = roundedRatio(numerator, baseline);
    if (Number.isFinite(percent) && (percent !== 0 || numerator === 0n)) change.percent = percent;
    else change.percentUnavailable = 'out-of-range';
  }
  return change;
}

function rankColumns(series: Series[], vintages: Vintage[], binary: DataView): ChartBuildResult<RankColumn[]> {
  const baseline = series.map(s => s.observations[0].value);
  if (!baseline.every((value): value is number => value !== null && value > 0))
    return refuse('Bump ranks require a strictly positive acquired baseline for every universe member. Repair the source or choose a slope or path.');
  const exactBaseline = baseline.map(value => scaledInteger(value, binary));

  const columns = vintages.map<RankColumn>(({ id: vintage }, position) => {
    const ranked = series.flatMap((s, index) => {
      const observation = s.observations[position];
      return observation.value === null ? [] : [{ index, observation, current: scaledInteger(observation.value, binary) }];
    });
    if (ranked.length !== series.length) return { vintage, status: 'unavailable',
      unavailableMembers: series.filter(s => s.observations[position].value === null).map(s => s.issuer.issuer) };

    // current / baseline and (current - baseline) / baseline have the same ordering.
    // Cross multiplication of the acquired binary64 integers has no overflow, underflow or rounded ties.
    const compare = (a: typeof ranked[number], b: typeof ranked[number]) => {
      const left = a.current * exactBaseline[b.index], right = b.current * exactBaseline[a.index];
      return left > right ? -1 : left < right ? 1 : 0;
    };
    ranked.sort(compare);
    let rank = 1;
    ranked.forEach((entry, index) => {
      if (index > 0 && compare(ranked[index - 1], entry) !== 0) rank = index + 1;
      entry.observation.rank = rank;
    });
    return { vintage, status: 'available' };
  });
  return { ok: true, value: columns, notes: [] };
}

function estimateNotes(data: EstimateRevisionData, source: EstimateVintageSource) {
  const { metric, target, vintages, series, columns, universe, filtered } = data;
  const observations = series.flatMap(s => s.observations);
  const valueCount = observations.filter(o => o.state === 'value').length;
  const notes = [
    `Consensus ${metric === 'eps' ? 'EPS' : 'revenue'} for ${target.kind} ${target.start} through ${target.end} (inclusive).`,
    `Acquired history retrieved ${source.retrieved_at}; ${source.delivered_count} delivered coordinates. ${valueCount} of ${observations.length} selected issuer–vintage observations have numeric consensus.`,
    'The equally spaced positions show acquired vintages in UTC observation order, independent of the elapsed time between them.',
  ];
  if (universe) {
    notes.push(`Ranks compare percentage revision from baseline batch ${universe.baseline_batch} to each selected batch within ${universe.id}. All ${series.length} members tie at rank 1 on the baseline.`);
    const unavailable = columns.filter(c => c.status === 'unavailable');
    if (unavailable.length) notes.push(`Whole rank columns unavailable at ${list(unavailable.map(c => c.vintage))} because at least one member lacks an eligible observation.`);
  } else {
    notes.push(`${series[0].issuer.issuer} uses acquired ${series[0].unitLabel}. Changes compare consecutive selected vintages when both values are available.`);
  }
  if (valueCount < observations.length) notes.push('Missing values, presentation omissions and cell errors leave gaps.');
  if (filtered) notes.push('The source presentation is filtered.');
  if (source.exact_repeats) notes.push(`The source collapsed ${source.exact_repeats} exact repeat observations.`);
  if (observations.some(o => o.change?.percentUnavailable === 'nonpositive-baseline'))
    notes.push('Percentage change is unavailable from a zero or negative earlier estimate.');
  if (observations.some(o => o.change?.absoluteUnavailable || o.change?.percentUnavailable === 'out-of-range'))
    notes.push('Some changes exceed the supported numeric display range. The original values and exact eligible ranks remain available.');
  notes.push(`Selected observations from ${vintages[0].observed_at} through ${vintages[vintages.length - 1].observed_at}.`);
  return notes;
}

/** Compare explicitly pinned acquired observations of one exact fiscal target. */
export function compareEstimateVintages(dataset: WidgetDataset, options: EstimateRevisionsOptions): ChartBuildResult<EstimateRevisionData> {
  const decoded = decodeEstimateRevisionsOptions(options);
  if (!decoded.ok) return refuse(decoded.message);
  const { fields, metric, target, view } = decoded.options;
  const { provenance, columns, rows } = dataset;
  const source = readChartSource(provenance, 'estimate-vintages', parseEstimateVintageSource);
  const projection = readChartSourceProjection(provenance, 'estimate-vintages');
  if (!source || !projection || (provenance.receipt !== undefined && !estimateVintageAdapter.legacyReceiptAgrees?.(source, provenance.receipt)))
    return refuse(sourceIssue);
  const unsafe = Object.entries(hazards).filter(([flag]) => source.unsafe[flag]).map(([, text]) => text);
  if (unsafe.length) return refuse(`The estimate acquisition reports ${unsafe.join(', ')}. Repair the source.`);
  if (source.metric !== metric || source.target.start !== target.start || source.target.end !== target.end || source.target.kind !== target.kind)
    return refuse('The pinned target or metric is unavailable in this acquisition. Select the exact acquired fiscal dates, period kind and metric.');
  const vintages = orderedPins(source, decoded.options.vintages);
  if (vintages.length !== decoded.options.vintages.length)
    return refuse('A pinned acquired vintage is unavailable. Select available recorded vintages to repair the comparison.');
  if (provenance.inputMayContainAggregates || rows.some(r => r.groupPath !== undefined)
    || columns.some(c => c.aggregation || c.measureId || c.splitPath?.length || c.analytical?.scope === 'aggregate'))
    return refuse('Present raw acquired estimate observations before grouping, pivoting or aggregation.');
  const origins = estimateColumns(columns, fields);
  if (!origins) return refuse(bindingIssue);

  const universe = view === 'bump' && source.universe.status === 'complete' ? source.universe : null;
  if (view === 'bump' && (!universe || dataset.completeness.kind !== 'complete'))
    return refuse('Bump ranks require a complete, independently declared universe and a complete acquisition.');
  if (universe && (vintages[0].batch !== universe.baseline_batch || vintages[vintages.length - 1].batch !== universe.current_batch))
    return refuse('Pin the exact declared baseline and current batches as the first and last bump vintages.');
  const readRows = readObservationRows(dataset, source, fields, origins, new Set(projection.omitted));
  if ('ok' in readRows) return readRows;
  const { visible, visibleIssuers } = readRows;
  if (!universe && visibleIssuers.size !== 1) return refuse('Filter or select the source to present exactly one acquired issuer for a slope or path.');

  const members = source.issuers.filter(issuer => universe || visibleIssuers.has(issuer.issuer))
    .sort((a, b) => a.issuer < b.issuer ? -1 : a.issuer > b.issuer ? 1 : 0);
  const binary = new DataView(new ArrayBuffer(8));
  const series = members.map<Series>(issuer => {
    const readings = vintages.map<Reading>(v => visible.get(coordinateKey(target, issuer.issuer, v.id)) ?? { state: 'missing', value: null });
    const observations = vintages.map<Observation>((vintage, index) => {
      const reading = readings[index];
      const earlierIndex = universe ? 0 : index - 1;
      const earlier = readings[earlierIndex]?.value;
      return { ...reading, vintage: vintage.id, rank: null,
        change: reading.value !== null && earlier !== undefined && earlier !== null
          ? changeBetween(reading.value, earlier, vintages[earlierIndex].id, binary) : null };
    });
    return { issuer, observations, unitLabel: issuer.currency + (issuer.unit === 'money-per-share' ? '/share' : '') };
  });
  if (!universe && !series[0].observations.some(o => o.state === 'value'))
    return refuse('No numeric acquired consensus is visible for the pinned vintages. Repair the source, fields or selection.');
  const ranked = universe && rankColumns(series, vintages, binary);
  if (ranked && !ranked.ok) return ranked;

  const value: EstimateRevisionData = { metric, view, target, vintages, universe, series,
    columns: ranked ? ranked.value : [], retrievedAt: source.retrieved_at, filtered: projection.filtered };
  return { ok: true, value, notes: estimateNotes(value, source) };
}

const ordinaryPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 15, signDisplay: 'exceptZero', useGrouping: false });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 15, signDisplay: 'exceptZero' });

function changeText(change: Change, unit: string) {
  const absolute = change.absolute;
  const signedAbsolute = absolute === null ? 'unavailable (outside numeric range)' : `${absolute > 0 ? '+' : ''}${absolute} ${unit}`;
  const percent = change.percent;
  const signedPercent = percent === null
    ? change.percentUnavailable === 'nonpositive-baseline' ? 'unavailable (earlier estimate is zero or negative)' : 'unavailable (outside numeric range)'
    : `${(Math.abs(percent) >= 1000 ? scientificPercent : ordinaryPercent).format(percent)} (fraction ${percent})`;
  return { signedAbsolute, signedPercent };
}

function observationLines(data: EstimateRevisionData, series: Series, observation: Observation, vintage: Vintage) {
  const metric = data.metric === 'eps' ? 'EPS' : 'revenue';
  const { value, rank, change } = observation;
  const original = value === null ? 'Consensus unavailable' : `Consensus ${value} ${series.unitLabel}`;
  const lines = [
    `${series.issuer.issuer} · consensus ${metric}`,
    `Observed ${vintage.observed_at}`,
    `Vintage ${vintage.id} · batch ${vintage.batch}`,
    `${data.target.kind} ${data.target.start} through ${data.target.end}`,
    original,
  ];
  if (change) {
    const { signedAbsolute, signedPercent } = changeText(change, series.unitLabel);
    if (rank !== null) {
      // One compact row group per issuer lets Plotly keep coincident ranks inspectable together.
      return [`${series.issuer.issuer} · rank ${rank} of ${data.series.length}`, original, `${signedAbsolute} · ${signedPercent}`];
    }
    lines.push(`Change from ${change.fromVintage}  ${signedAbsolute}`, `Percentage  ${signedPercent}`);
  }
  return lines;
}

const hoverFontSize = 11;
const bumpHoverFont = { family: 'monospace', size: hoverFontSize };

function minimumDrawingSurface(data: EstimateRevisionData, margin: { l: number; r: number },
  hover: readonly string[][][]): EstimateRevisionsSurface {
  // The full UTC labels are horizontal, on equally spaced positions. Reserve an
  // extra gap beside each 60 px label plus room for the axis title at two pins.
  const width = Math.max(estimateRevisionMinPlotWidth(data.vintages.length),
    margin.l + margin.r + Math.max(150, 68 * data.vintages.length));
  if (!data.universe) return { width, height: estimateRevisionMinPlotHeight };

  let longestLine = 27; // UTC instant in the unified hover title.
  for (const series of hover) for (const observation of series) for (const line of observation)
    longestLine = Math.max(longestLine, line.length);

  // Plotly's unified hover uses a legend with a marker gutter and three text
  // rows per issuer. Reserve space for all entries, including coincident ranks.
  const hoverWidth = 44 + Math.ceil(longestLine * 7.2);
  const hoverHeight = 28 + data.series.length * 54;
  return { width: Math.max(width, hoverWidth), height: Math.max(estimateRevisionMinPlotHeight, hoverHeight) };
}

function questionRevision(dataset: WidgetDataset, options: EstimateRevisionsOptions, data: EstimateRevisionData) {
  const { start, end, kind } = data.target;
  return JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, data.metric, data.view, [start, end, kind],
    Object.keys(estimateRevisionFieldOrigins).map(role => options.fields[role as keyof typeof options.fields]),
    data.vintages.map(v => [v.id, v.batch, metricVintageKey(v.observed_at)]),
    data.universe?.id ?? null,
    data.series.map(({ issuer }) => [issuer.issuer, issuer.entity_ref, issuer.currency, issuer.basis, issuer.basis_ref]),
  ]);
}

export function buildEstimateRevisions(dataset: WidgetDataset, options: RecipeRequestOptions, context: RecipeContext): RecipeResult {
  if (options.kind !== 'estimate-revisions') return refuse('Choose an estimate-revisions recipe.');
  const result = compareEstimateVintages(dataset, options);
  if (!result.ok) return result;
  const { value: data, notes } = result;
  const { vintages } = data;
  const isBump = data.universe !== null;
  const valueObservations = data.series[0].observations;
  const values = valueObservations.flatMap(o => o.value === null ? [] : [o.value]);
  const range: Range | undefined = isBump ? [data.series.length + .55, .45] : valueRange(values, 1);
  const linearIssue = 'Plotly’s linear scale cannot place the acquired values faithfully. Choose a narrower supported range of vintages.';
  if (!range) return refuse(linearIssue);
  const ticks = isBump ? undefined : linearAxisTicks(range);
  const margin = { l: ticks?.margin ?? 60, r: 26, t: isBump ? 94 : 37, b: 75, pad: 0, autoexpand: false };
  const hover = data.series.map(series => series.observations.map((observation, index) =>
    (isBump ? observation.rank : observation.value) === null ? [] : observationLines(data, series, observation, vintages[index])));
  const estimateRevisionsSurface = minimumDrawingSurface(data, margin, hover);
  const { width, height: minHeight } = estimateRevisionsSurface;
  if (width > maxRecipeViewportDimension || minHeight > maxRecipeViewportDimension)
    return refuse('This comparison exceeds the 10,000 px drawing limit. Select fewer acquired vintages or a smaller, independently verified universe.');
  const { viewportWidth = Math.max(640, width), viewportHeight = Math.max(360, minHeight) } = context;
  if (viewportWidth < width || viewportHeight < minHeight)
    return { ...refuse(`Increase the drawing area to at least ${width} × ${minHeight} pixels to make the vintage labels and observations readable.`),
      estimateRevisionsSurface };
  if (!isBump) {
    const height = viewportHeight - margin.t - margin.b;
    const pixel = axisPixels(range, height, true);
    if (!drawableValues(values, range, height) || valueObservations.some((point, index) => {
      const prior = valueObservations[index - 1]?.value;
      return point.value !== null && prior !== undefined && prior !== null && point.value !== prior && pixel(point.value) === pixel(prior);
    })) return refuse(linearIssue);
  }
  const revision = questionRevision(dataset, options, data);
  const metric = data.metric === 'eps' ? 'EPS' : 'revenue';
  const issuerLabel = data.series[0].issuer.issuer;
  const titleIssuer = issuerLabel.length > 20 ? issuerLabel.slice(0, 19) + '…' : issuerLabel;
  const summary = `${isBump ? 'Consensus ' + metric : escape(titleIssuer) + ' · consensus ' + metric}<br>${data.target.kind} ${data.target.start} to ${data.target.end}`;
  const x = vintages.map(v => metricVintageKey(v.observed_at) + 'Z');
  const vintageLabels = x.map(stamp => [stamp.slice(0, 10), stamp.slice(11, 19), stamp.slice(19)].map(escape).join('<br>'));
  const rankLineStyles = ['solid', 'dash', 'dot', 'dashdot'] as const;
  const traces = data.series.map((series, index) => {
    const label = series.issuer.issuer, shade = color(label);
    return { type: 'scatter', mode: 'lines+markers', name: escape(label), uid: label, x,
      y: series.observations.map(o => isBump ? o.rank : o.value), connectgaps: false,
      marker: { color: shade, size: 8 }, line: { color: shade, width: 2, simplify: false, dash: rankLineStyles[index % rankLineStyles.length] },
      ids: vintages.map(v => v.id), text: hover[index].map(lines => lines.map(escape).join('<br>')),
      hovertemplate: '%{text}<extra></extra>',
    };
  });
  return {
    ok: true, estimateRevisions: data, estimateRevisionsSurface, notes, revision,
    figure: { data: traces, layout: {
      ...themedLayout(context.theme), uirevision: revision, margin, hovermode: isBump ? 'x unified' : 'closest',
      hoverlabel: { align: 'left', font: isBump ? bumpHoverFont : { size: hoverFontSize } },
      showlegend: isBump, legend: { orientation: 'h', x: .5, xref: 'container', xanchor: 'center', y: 1 - 42 / viewportHeight,
        yref: 'container', yanchor: 'top', maxheight: 48,
        font: { size: 10 }, itemclick: false, itemdoubleclick: false },
      title: { text: summary, x: .5, xanchor: 'center', y: 1 - 18 / viewportHeight, yref: 'container', yanchor: 'top', font: { size: 12 } },
      xaxis: { type: 'category', range: [-.5, vintages.length - .5], categoryorder: 'array', categoryarray: x,
        tickmode: 'array', tickvals: x, ticktext: vintageLabels, tickangle: 0, unifiedhovertitle: { text: '%{x}' },
        automargin: false, zeroline: false, tickfont: { size: 10 },
        title: { text: 'Recorded vintages (equally spaced)', font: { size: 11 }, standoff: 8 } },
      yaxis: { type: 'linear', range, automargin: false, zeroline: false, tickfont: { family: 'monospace', size: 11 },
        ...(ticks ? { tickmode: 'array', tickvals: ticks.tickvals, ticktext: ticks.ticktext }
          : { tickmode: 'linear', tick0: 1, dtick: Math.ceil(data.series.length / 6) }),
        title: { text: isBump ? 'Percentage revision rank' : escape(`Consensus ${metric} (${data.series[0].unitLabel})`),
          font: { size: 11 }, standoff: 6 } },
    } },
  };
}
