// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import { dailyReturnSamples, prepareSelectedPrices } from './priceSamples';
import { decodeRecipeOptions } from './settings';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

type Bin = { left: number; right: number; count: number };
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17, notation: 'scientific' });

function formatBoundary(value: number) {
  const magnitude = Math.abs(value);
  return (magnitude >= 1e4 || (magnitude > 0 && magnitude < 1e-6) ? scientificPercent : percent).format(value);
}

function histogram(samples: { value: number }[], count: number): Bin[] | string {
  let min = Infinity;
  let max = -Infinity;
  for (const { value } of samples) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (min === max) {
    const halfWidth = Math.max(Math.abs(min) * 0.01, 1e-6);
    const left = min - halfWidth, right = min + halfWidth;
    if (!Number.isFinite(left) || left >= min || !Number.isFinite(right) || right <= min)
      return 'The constant return is too large to draw a finite centered bin.';
    return [{ left, right, count: samples.length }];
  }

  const width = (max - min) / count;
  const edges = Array.from({ length: count + 1 }, (_, i) => i === count ? max : min + width * i);
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    left: edges[i], right: edges[i + 1], count: 0,
  }));
  if (bins.some(({ left, right }) => left >= right))
    return 'The return range is too narrow for distinct bin boundaries at this precision. Choose fewer bins or a wider source return range.';

  for (const { value } of samples) {
    if (value === min) bins[0].count++;
    else if (value === max) bins[count - 1].count++;
    else {
      let index = Math.min(count - 1, Math.floor((value - min) / width));
      // Floating-point division may land on the wrong side of a displayed edge.
      while (index < count - 1 && value >= edges[index + 1]) index++;
      while (index > 0 && value < edges[index]) index--;
      bins[index].count++;
    }
  }
  return bins;
}

export function buildReturnDistribution(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'return-distribution' }>,
  context: RecipeContext,
): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'return-distribution');
  if (!decoded.ok) return { ok: false, refused: true, message: decoded.message };
  const { fields, symbol, bins } = options;
  const prepared = prepareSelectedPrices(dataset, fields, [symbol], options.kind);
  if (!prepared.ok) return prepared;

  const { samples, excludedNonfinite, gapCount } = dailyReturnSamples(prepared.series[0]);
  const { scope, sourceMode } = prepared;
  const observed = sourceMode === 'live';
  const returnKind = observed ? 'observed quote-to-quote' : 'daily';
  const notes = [...prepared.notes, `${gapCount} known price gap(s) for ${symbol} break adjacent returns.`];
  if (observed) notes.unshift('Observed quote-to-quote returns; exchange-session completeness unknown.');
  if (excludedNonfinite) notes.push(`Excluded ${excludedNonfinite} nonfinite ${returnKind} return(s).`);
  const acquiredRows = dataset.completeness.acquiredRowCount;
  if (acquiredRows !== undefined && acquiredRows > dataset.rows.length)
    notes.push(`Filtered source delivered ${dataset.rows.length} of ${acquiredRows} acquired rows.`);
  if (samples.length < 2) return { ok: false, refused: true, message: [
    `At least 2 finite ${returnKind} returns are required for ${symbol}. Found ${samples.length}.`, ...notes,
  ].join(' ') };

  const distribution = histogram(samples, bins);
  if (typeof distribution === 'string') return { ok: false, refused: true, message: [distribution, ...notes].join(' ') };

  notes.unshift(`N = ${samples.length} ${returnKind} returns for ${symbol} from ${samples[0].date} to ${samples[samples.length - 1].date}.`);
  notes.push(`Acquisition window ${scope.start} to ${scope.end}.`);
  if (!observed) notes.push('Unreported provider gaps cannot always be distinguished from market holidays.');
  if (distribution.length === 1) notes.push(`Constant ${returnKind} return of ${formatBoundary(samples[0].value)}.`);

  const revision = JSON.stringify([
    dataset.provenance.sourceWidgetId, options.kind, options.version, fields.date, fields.price,
    fields.symbol ?? null, symbol, bins, scope.start, scope.end,
  ]);
  const first = distribution[0].left;
  const last = distribution[distribution.length - 1].right;
  // Plotly drops extrema at FP_SAFE (Number.MAX_VALUE * 1e-4). Leave room for
  // axis padding and use exact binary scaling for exceptional magnitudes.
  const scale = Math.max(Math.abs(first), Math.abs(last)) >= 1e300 ? 2 ** 512 : 1;
  const axis = {
    type: 'linear', title: { text: observed ? 'Observed quote-to-quote return' : 'Daily return' }, automargin: true,
    uirevision: JSON.stringify([revision, scale]), tickformat: `.${context.maxDecimals}%`,
  };
  let xaxis: Record<string, unknown> = axis;
  if (scale !== 1) {
    const stride = Math.ceil(distribution.length / 3);
    const tickEdges = [first, ...distribution.filter((_, i) => (i + 1) % stride === 0 || i === distribution.length - 1)
      .map(bin => bin.right)];
    xaxis = { ...axis, tickmode: 'array', tickvals: tickEdges.map(edge => edge / scale), ticktext: tickEdges.map(formatBoundary) };
  }
  return {
    ok: true, revision, notes,
    figure: {
      data: [{
        type: 'bar', uid: 'return-distribution', name: escape(symbol), marker: { color: color(symbol) },
        // Plot from the same edges used for counting. An interval can have two
        // distinct edges even when its midpoint rounds to one of them.
        x: distribution.map(bin => bin.left / scale), y: distribution.map(bin => bin.count),
        offset: 0, width: distribution.map(bin => (bin.right - bin.left) / scale),
        customdata: distribution.map((bin, index) => [
          formatBoundary(bin.left), formatBoundary(bin.right), index === distribution.length - 1 ? ']' : ')',
          bin.count / samples.length,
        ]),
        hovertemplate: `[%{customdata[0]}, %{customdata[1]}%{customdata[2]}<br>Count %{y} (%{customdata[3]:.${context.maxDecimals}%})<extra>%{fullData.name}</extra>`,
      }],
      layout: {
        ...themedLayout(context.theme), uirevision: revision, bargap: 0, showlegend: false,
        title: { text: observed ? 'Observed return distribution' : 'Daily return distribution' },
        margin: { l: 60, r: 12, t: 44, b: 48 },
        xaxis,
        yaxis: { type: 'linear', title: { text: 'Observation count' }, rangemode: 'tozero', automargin: true },
      },
    },
  };
}
