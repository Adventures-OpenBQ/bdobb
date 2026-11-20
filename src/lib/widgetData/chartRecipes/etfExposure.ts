// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import { savedBindingIssue } from './bindings';
import { read } from './estimateEvidence';
import { readEtfEvidence } from './etfEvidence';
import { decodeRecipeOptions } from './settings';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

type ExposureOptions = Extract<RecipeOptions, { kind: 'etf-exposure' }>;

const refuse = (message: string) => ({ ok: false, refused: true, message }) as const;
const reportedPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });

export function buildEtfExposure(dataset: WidgetDataset, options: ExposureOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'etf-exposure');
  if (!decoded.ok) return refuse(decoded.message);
  const acquisition = readEtfEvidence(dataset, options.mode);
  if (!acquisition.ok) return refuse(acquisition.message);
  const bindingIssue = savedBindingIssue(options, dataset.columns);
  if (bindingIssue) return refuse(bindingIssue);

  const { fields } = options;
  const weightsByCategory = new Map<string, number>();
  for (const row of dataset.rows) {
    const category = read(row, fields.category);
    if (typeof category !== 'string' || !category.trim())
      return refuse('Each delivered exposure needs a category label without a cell error.');
    if (weightsByCategory.has(category)) return refuse('The delivered exposure contains a duplicate category label.');
    const weight = read(row, fields.weight);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1)
      return refuse('Each delivered exposure weight must be a finite fraction in [0, 1] without a cell error.');
    weightsByCategory.set(category, weight);
  }
  if (!weightsByCategory.size) return refuse('At least one delivered exposure category is needed.');

  const ranked = [...weightsByCategory].sort(([aLabel, aWeight], [bLabel, bWeight]) =>
    bWeight - aWeight || (aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0));
  const categories = ranked.map(([category]) => category);
  const labels = categories.map(escape);
  const weightColor = color('reported-weight');
  const { fund } = acquisition.evidence;
  const exposure = options.mode === 'sector' ? 'sector' : 'geographic';
  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version,
    options.mode, fields.category, fields.weight, fund]);

  return {
    ok: true, revision, notes: acquisition.notes,
    figure: {
      data: [{
        type: 'scatter', uid: 'etf-exposure-stems', mode: 'lines', hoverinfo: 'skip', connectgaps: false,
        x: ranked.flatMap(([, weight]) => [0, weight, null]),
        y: categories.flatMap(category => [category, category, null]),
        line: { color: weightColor, width: 1 },
      }, {
        type: 'scatter', uid: 'etf-exposure-dots', mode: 'markers', name: 'Reported weight',
        x: ranked.map(([, weight]) => weight), y: categories, cliponaxis: false,
        marker: { color: weightColor, size: 8 },
        customdata: ranked.map(([, weight], index) => [labels[index], reportedPercent.format(weight)]),
        hovertemplate: '%{customdata[0]}<br>Reported weight %{customdata[1]}<br>Weight basis is equity exposure<extra></extra>',
      }],
      layout: {
        ...themedLayout(context.theme), uirevision: revision,
        title: { text: `${escape(fund)} ${exposure} exposure` },
        height: Math.max(280, 36 * ranked.length + 80),
        margin: { l: 65, r: 24, t: 48, b: 44 }, showlegend: false,
        xaxis: {
          type: 'linear', title: { text: 'Reported equity exposure (%)' }, range: [0, 1],
          tickformat: '.0%', fixedrange: true, automargin: true, layer: 'below traces',
        },
        yaxis: {
          type: 'category', categoryorder: 'array', categoryarray: categories, autorange: 'reversed',
          tickmode: 'array', tickvals: categories, ticktext: labels, automargin: true, layer: 'below traces',
        },
      },
    },
  };
}
