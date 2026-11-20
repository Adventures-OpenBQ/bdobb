// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import { doubleUnitExponent, roundedRatio, scaledInteger } from './binary64';
import { admitReturnSummary } from './priceSamples';
import { returnPercent, type ReturnAxisScaling } from './returnSummaryDisplay';
import { decodeRecipeOptions } from './settings';
import type { RecipeContext, RecipeResult, ReturnSummaryOptions } from './types';

export type ReturnBoxSummary = {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  lowerWhisker: number;
  upperWhisker: number;
  outliers: number[];
};

export type DensityResult =
  | { ok: true; bandwidth: number; points: { value: number; density: number }[] }
  | { ok: false; reason: 'sample-size' | 'bandwidth' | 'geometry' };

type Admitted = Extract<ReturnType<typeof admitReturnSummary>, { ok: true }>['value'];
type ReturnSeries = Admitted['series'][number] & {
  summary: ReturnBoxSummary;
  outlierObservations: Admitted['series'][number]['samples'];
};
export type ReturnSummaryDetails = Omit<Admitted, 'series'> & {
  view: ReturnSummaryOptions['view'];
  series: ReturnSeries[];
  scaledAxis?: ReturnAxisScaling;
};

const densityMinimum = 20;
const evaluationCount = 128;
const maximumHalfWidth = .34;
const plotMargins = { l: 70, r: 12, t: 44, b: 72 };
const pathPixelStep = .01; // Plotly Cartesian c2p rounds SVG coordinates to two decimal places.
const minimumAxisPixels = 2; // Plotly's smallest supported inner axis dimension.

function interpolate(low: bigint, high: bigint, step: number, divisions: number): bigint {
  return low * BigInt(divisions - step) + high * BigInt(step);
}

function observedGrid(min: number, max: number, count: number): number[] {
  const view = new DataView(new ArrayBuffer(8));
  const low = scaledInteger(min, view), high = scaledInteger(max, view);
  const divisions = count - 1;
  return Array.from({ length: count }, (_, i) => roundedRatio(interpolate(low, high, i, divisions), BigInt(divisions), doubleUnitExponent));
}

/** R7 quantiles and Tukey fences use exact binary64 input values before rounding for presentation. */
export function summarizeReturns(values: readonly number[]): ReturnBoxSummary {
  if (!values.length || values.some(value => !Number.isFinite(value))) {
    throw new RangeError('A box summary needs finite return observations.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const view = new DataView(new ArrayBuffer(8));
  function quarterUnits(numerator: number) {
    const quarters = (sorted.length - 1) * numerator;
    const index = Math.floor(quarters / 4);
    return interpolate(scaledInteger(sorted[index], view), scaledInteger(sorted[Math.min(index + 1, sorted.length - 1)], view),
      quarters % 4, 4);
  }

  const q1Units = quarterUnits(1), medianUnits = quarterUnits(2), q3Units = quarterUnits(3);
  const iqrUnits = q3Units - q1Units;
  const iqr = roundedRatio(iqrUnits, 4n, doubleUnitExponent);
  if (!Number.isFinite(iqr)) throw new RangeError('The interquartile range exceeds finite return precision.');
  const lowFence = 2n * q1Units - 3n * iqrUnits;
  const highFence = 2n * q3Units + 3n * iqrUnits;
  const outliers: number[] = [];
  let lowerWhisker: number | undefined, upperWhisker: number | undefined;
  for (const value of sorted) {
    const units = 8n * scaledInteger(value, view);
    if (units < lowFence || units > highFence) outliers.push(value);
    else {
      lowerWhisker ??= value;
      upperWhisker = value;
    }
  }
  if (lowerWhisker === undefined || upperWhisker === undefined) {
    throw new RangeError('No observed return lies within the Tukey fences.');
  }
  return {
    q1: roundedRatio(q1Units, 4n, doubleUnitExponent),
    median: roundedRatio(medianUnits, 4n, doubleUnitExponent),
    q3: roundedRatio(q3Units, 4n, doubleUnitExponent),
    iqr, lowerWhisker, upperWhisker, outliers,
  };
}

/** Gaussian KDE at equally spaced values from the observed minimum through the observed maximum. */
export function estimateReturnDensity(values: readonly number[]): DensityResult {
  if (values.length < densityMinimum) return { ok: false, reason: 'sample-size' };
  if (values.some(value => !Number.isFinite(value))) return { ok: false, reason: 'geometry' };
  let summary: ReturnBoxSummary;
  try {
    summary = summarizeReturns(values);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { ok: false, reason: 'bandwidth' };
  }
  return densityForSummary(values, summary.iqr);
}

function densityForSummary(values: readonly number[], iqr: number): DensityResult {
  if (values.length < densityMinimum) return { ok: false, reason: 'sample-size' };
  let min = Infinity, max = -Infinity;
  for (const value of values) {
    min = Math.min(value, min);
    max = Math.max(value, max);
  }
  const range = max - min;
  if (!Number.isFinite(range) || iqr === 0) return { ok: false, reason: 'bandwidth' };

  // Center and scale before squaring so the sample standard deviation is stable
  // even when squared differences would overflow or underflow in original units.
  const offsets = values.map(value => (value - min) / range);
  const mean = offsets.reduce((sum, value) => sum + value, 0) / values.length;
  const squared = offsets.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const sampleSD = Math.sqrt(squared / (values.length - 1)) * range;
  const bandwidth = (.9 * values.length ** (-1 / 5)) * Math.min(sampleSD, iqr / 1.34);
  if (!Number.isFinite(bandwidth) || bandwidth <= 0) return { ok: false, reason: 'bandwidth' };

  const grid = observedGrid(min, max, evaluationCount);
  if (grid.some((value, i) => i > 0 && value <= grid[i - 1])) return { ok: false, reason: 'geometry' };
  const gaussian = Math.sqrt(2 * Math.PI);
  const points = grid.map(value => {
    let weight = 0;
    for (const observation of values) {
      const z = (value - observation) / bandwidth;
      weight += Math.exp(-.5 * z * z);
    }
    return { value, density: (weight / values.length / gaussian) / bandwidth };
  });
  if (points.some(point => !Number.isFinite(point.density))) return { ok: false, reason: 'geometry' };
  return { ok: true, bandwidth, points };
}

function extrema(sequences: readonly (readonly number[])[]) {
  let min = Infinity, max = -Infinity;
  for (const values of sequences) for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function reducedAxisMinimum(canvasPixels: number | undefined, baseMargins: number): number {
  // Let labels use half of the area left by the base margins. With no measured
  // dimension, only Plotly's absolute minimum is guaranteed.
  return canvasPixels === undefined ? minimumAxisPixels
    : Math.max(minimumAxisPixels, Math.floor((canvasPixels - baseMargins) / 2));
}

function hasDrawableSpan(coordinates: readonly number[], range: readonly [number, number], reducedAxisPixels: number): boolean {
  const { min, max } = extrema([coordinates]);
  // The two auto margins round separately. Use a one-pixel lower allowance.
  // A full coordinate step survives SVG rounding at every subpixel position.
  const pixels = ((max - min) / (range[1] - range[0])) * (reducedAxisPixels - 1);
  return Number.isFinite(pixels) && pixels > pathPixelStep;
}

function returnAxis(
  observations: readonly (readonly number[])[],
  summaryCoordinates: readonly (readonly number[])[],
  densityGrids: readonly (readonly number[])[],
  context: RecipeContext,
  revision: string,
) {
  const { min, max } = extrema(observations);
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const span = max - min;
  const centered = span > 0 && span < magnitude * 1e-8;
  const origin = centered ? min : 0;
  const exceptional = centered || magnitude >= 1e100 || (magnitude > 0 && magnitude < 1e-6);
  const scale = exceptional ? 2 ** Math.min(1023, Math.floor(Math.log2(centered ? span : magnitude))) : 1;
  const coordinate = (value: number) => (value - origin) / scale;
  const first = coordinate(min), last = coordinate(max);
  const padding = min === max ? Math.max(Math.abs(first) * .05, exceptional ? .05 : .0001) : (last - first) * .06;
  const range = [first - padding, last + padding] as const;
  if (!range.every(Number.isFinite) || range[0] >= range[1]) return undefined;

  // The coordinate transform must preserve the original admitted values. Plotly's
  // vertical axis subtracts from the upper endpoint, so also check for cancellation
  // of ordered summary bounds and density vertices on that axis.
  const distinct = (values: readonly number[], transform: (value: number) => number) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    return sorted.every((value, i) => Number.isFinite(transform(value))
      && (i === 0 || transform(value) > transform(sorted[i - 1])));
  };
  // A power-of-two scale keeps the geometry affine. Reject an exceptional range
  // that would map an original observation to a different binary64 value.
  if (exceptional && observations.some(values => values.some(value => coordinate(value) * scale + origin !== value))) return undefined;
  const position = (value: number) => coordinate(value) - range[1];
  if ([...summaryCoordinates, ...densityGrids].some(values => !distinct(values, position))) return undefined;

  const manualTicks = exceptional ? [...new Set(observedGrid(min, max, 5))] : undefined;
  const tickStep = (range[1] - range[0]) / 5;
  const decimals = Math.max(context.maxDecimals, Math.min(20, -Math.floor(Math.log10(100 * tickStep))));
  return {
    coordinate,
    scaling: exceptional ? { origin, scale } : undefined,
    layout: {
      type: 'linear', title: { text: 'Daily return' }, range, autorange: false, automargin: true,
      uirevision: JSON.stringify([revision, origin, scale]),
      ...(manualTicks ? { tickmode: 'array', tickvals: manualTicks.map(coordinate), ticktext: manualTicks.map(returnPercent) }
        : { tickformat: `.${decimals}%` }),
    },
  };
}

function returnLabel(value: number): string {
  return escape(`${returnPercent(value)} (${value})`);
}

function summaryHover(series: ReturnSeries): string {
  const { summary } = series;
  return [
    `<b>${escape(series.symbol)}</b>`,
    `N = ${series.samples.length} · ${escape(series.start)} to ${escape(series.end)}`,
    `Q1: ${returnLabel(summary.q1)}`,
    `Median: ${returnLabel(summary.median)}`,
    `Q3: ${returnLabel(summary.q3)}`,
    `Observed whiskers: ${returnLabel(summary.lowerWhisker)} to ${returnLabel(summary.upperWhisker)}`,
    `IQR: ${returnLabel(summary.iqr)} · Outliers: ${summary.outliers.length}`,
    `Excluded return opportunities: ${series.excludedOpportunities}`,
  ].join('<br>');
}

function boxTraces(summary: ReturnBoxSummary, index: number, symbol: string, coordinate: (value: number) => number): unknown[] {
  const { q1, median, q3, lowerWhisker, upperWhisker } = summary;
  const inside = lowerWhisker > q1 || upperWhisker < q3;
  const line = { color: color(symbol), width: 2 };
  const traces: unknown[] = [{
    type: 'box', uid: `return-box-${index}`, name: escape(symbol), orientation: 'v', x: [index], width: .52,
    q1: [coordinate(q1)], median: [coordinate(median)], q3: [coordinate(q3)],
    lowerfence: [coordinate(lowerWhisker)], upperfence: [coordinate(upperWhisker)],
    boxpoints: false, hoverinfo: 'skip', showwhiskers: !inside, line,
  }];
  if (inside) {
    // Plotly substitutes a fence when it falls inside the box. Such a whisker
    // can legitimately result from R7 interpolation and must use the observed value.
    traces.push({
      type: 'scatter', uid: `return-whiskers-${index}`, mode: 'lines', hoverinfo: 'skip', line,
      x: [index, index, null, index, index, null, index - .13, index + .13, null, index - .13, index + .13],
      y: [q1, lowerWhisker, null, q3, upperWhisker, null, lowerWhisker, lowerWhisker, null, upperWhisker, upperWhisker]
        .map(value => value === null ? null : coordinate(value)),
    });
  }
  return traces;
}

function violinTrace(
  estimate: Extract<DensityResult, { ok: true }>, maxDensity: number,
  index: number, symbol: string, coordinate: (value: number) => number,
) {
  const right = estimate.points.map(point => index + maximumHalfWidth * (point.density / maxDensity));
  const left = estimate.points.map(point => index - maximumHalfWidth * (point.density / maxDensity)).reverse();
  const points = [...estimate.points, ...[...estimate.points].reverse()];
  return {
    type: 'scatter', uid: `return-violin-${index}`, name: escape(symbol), mode: 'lines', fill: 'toself',
    line: { color: color(symbol), simplify: false }, hoveron: 'points',
    x: [...right, ...left], y: points.map(point => coordinate(point.value)),
    text: points.map(point => [
      `<b>${escape(symbol)}</b>`, `Daily return: ${returnLabel(point.value)}`,
      `Smoothed density: ${escape(point.density)}`, `Gaussian bandwidth: ${returnLabel(estimate.bandwidth)}`,
    ].join('<br>')),
    hovertemplate: '%{text}<extra></extra>',
  };
}

const refusal = (message: string) => ({ ok: false, refused: true, message }) as const;

export function buildReturnSummary(dataset: WidgetDataset, options: ReturnSummaryOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'return-summary');
  if (!decoded.ok) return refusal(decoded.message);
  const { fields, symbols, window } = options;
  const admitted = admitReturnSummary(dataset, fields, symbols, window);
  if (!admitted.ok) return admitted;
  const observations = admitted.value.series.map(series => series.samples.map(sample => sample.value));
  const notes = [...admitted.notes];
  const series: ReturnSeries[] = [];
  for (const [index, source] of admitted.value.series.entries()) {
    let summary: ReturnBoxSummary;
    try {
      summary = summarizeReturns(observations[index]);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return refusal(`The return box geometry for ${source.symbol} exceeds finite precision. Choose a different window or listing.`);
    }
    if (summary.iqr > 0 && summary.q1 === summary.q3) {
      return refusal(`The return box geometry for ${source.symbol} cannot preserve its distinct quartiles. Choose a different window or listing.`);
    }
    const outlierObservations = source.samples.filter(sample => sample.value < summary.lowerWhisker || sample.value > summary.upperWhisker);
    series.push({ ...source, summary, outlierObservations });
    notes.push(`${source.symbol} · N = ${source.samples.length} daily returns · ${source.start} to ${source.end} · ${source.excludedOpportunities} excluded opportunities (${source.gapCount} known price gaps, ${source.excludedNonfinite} nonfinite returns).`);
    if (summary.iqr === 0) notes.push(`${source.symbol} has zero IQR.`);
  }

  const estimates: Extract<DensityResult, { ok: true }>[] = [];
  let view = options.view;
  if (view === 'violin') {
    let geometryIssue: string | undefined;
    for (const [index, item] of series.entries()) {
      const estimate = densityForSummary(observations[index], item.summary.iqr);
      if (estimate.ok) estimates.push(estimate);
      else if (estimate.reason === 'geometry') geometryIssue ??= item.symbol;
      else {
        view = 'box';
        const reason = estimate.reason === 'sample-size'
          ? `needs at least ${densityMinimum} returns and has ${item.samples.length}`
          : 'has zero or nonfinite Gaussian bandwidth';
        notes.push(`Box view shown because KDE for ${item.symbol} ${reason}.`);
      }
    }
    if (view === 'violin' && geometryIssue) {
      return refusal(`The KDE geometry for ${geometryIssue} cannot preserve a finite observed-range grid. Choose a different window or listing.`);
    }
  }
  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, fields.date, fields.price, fields.symbol ?? null,
    symbols, options.view, window.mode === 'common' ? ['common', window.start, window.end] : ['own'],
  ]);
  const activeEstimates = view === 'violin' ? estimates : [];
  const bounds = series.map(({ summary }) => {
    const { q1, median, q3, lowerWhisker, upperWhisker, outliers } = summary;
    return [
      Math.min(outliers[0] ?? lowerWhisker, lowerWhisker),
      lowerWhisker, q1, median, q3, upperWhisker,
      Math.max(outliers.at(-1) ?? upperWhisker, upperWhisker),
    ];
  });
  const yaxis = returnAxis(observations, bounds,
    activeEstimates.map(estimate => estimate.points.map(point => point.value)), context, revision);
  if (!yaxis) return refusal('The selected return range cannot preserve finite, distinct figure geometry. Plot listings separately or choose a different window.');

  const maxDensity = extrema(activeEstimates.map(estimate => estimate.points.map(point => point.density))).max;
  const { coordinate } = yaxis;
  const xRange = [-.5, series.length - .5] as const;
  const minreducedwidth = reducedAxisMinimum(context.viewportWidth, plotMargins.l + plotMargins.r);
  const minreducedheight = reducedAxisMinimum(context.viewportHeight, plotMargins.t + plotMargins.b);
  const data: unknown[] = [];
  for (const [index, item] of series.entries()) {
    const { summary, symbol } = item;
    if (view === 'box') data.push(...boxTraces(summary, index, symbol, coordinate));
    else {
      const trace = violinTrace(activeEstimates[index], maxDensity, index, symbol, coordinate);
      if (!hasDrawableSpan(trace.x, xRange, minreducedwidth) || !hasDrawableSpan(trace.y, yaxis.layout.range, minreducedheight)) {
        return refusal(`The shared density scale cannot preserve violin geometry for ${symbol} at this plot size. Enlarge the plot or plot listings separately.`);
      }
      data.push(trace);
    }
    const hover = { mode: 'markers', type: 'scatter', name: escape(symbol), hovertemplate: '%{text}<extra></extra>' };
    data.push({
      ...hover, uid: `return-summary-${index}`, x: [index], y: [coordinate(summary.median)], text: [summaryHover(item)],
      marker: { size: 8, color: color(symbol), line: { color: context.theme === 'dark' ? '#111827' : '#ffffff', width: 1 } },
    });
    const outliers = item.outlierObservations;
    if (outliers.length) data.push({
      ...hover, uid: `return-outliers-${index}`, x: outliers.map(() => index), y: outliers.map(sample => coordinate(sample.value)),
      text: outliers.map(sample => `<b>${escape(symbol)}</b><br>Outlier · ${escape(sample.date)}<br>Daily return: ${returnLabel(sample.value)}`),
      marker: { size: 8, symbol: 'circle-open', color: color(symbol) },
    });
  }
  notes.push(`Adjusted-price daily returns · Acquired ${admitted.value.scope.start} to ${admitted.value.scope.end}.`);
  if (window.mode === 'common') notes.push(`Common inclusive bounds ${window.start} to ${window.end}. Each listing uses its own observed sessions.`);
  if (view === 'violin') notes.push('Gaussian KDE is density smoothing within observed endpoints. Width uses one density scale across listings.');
  return {
    ok: true, notes, revision, returnSummary: { ...admitted.value, view, series, ...(yaxis.scaling && { scaledAxis: yaxis.scaling }) },
    figure: {
      data,
      layout: {
        ...themedLayout(context.theme), uirevision: revision, hovermode: 'closest', showlegend: false,
        hoverlabel: { bgcolor: context.theme === 'dark' ? '#202937' : '#ffffff',
          font: { color: context.theme === 'dark' ? '#f1f5f9' : '#152034' } },
        title: { text: view === 'box' ? 'Daily return boxes' : 'Daily return density' },
        margin: { ...plotMargins },
        ...(view === 'violin' ? { minreducedwidth, minreducedheight } : {}),
        xaxis: {
          type: 'linear', range: xRange, autorange: false, automargin: true, tickmode: 'array',
          tickvals: series.map((_, index) => index),
          ticktext: series.map(item => `${escape(item.symbol)}<br>N = ${item.samples.length}<br>${escape(item.start)} to ${escape(item.end)}`),
        },
        yaxis: yaxis.layout,
      },
    },
  };
}
