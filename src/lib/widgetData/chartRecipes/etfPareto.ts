// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { themedLayout } from '../../chartShapes';
import { color, escape } from '../figureHelpers';
import type { WidgetDataset } from '../types';
import { savedBindingIssue } from './bindings';
import { read, text } from './estimateEvidence';
import { readEtfEvidence } from './etfEvidence';
import { decodeRecipeOptions } from './settings';
import type { RecipeContext, RecipeOptions, RecipeResult } from './types';

type ParetoOptions = Extract<RecipeOptions, { kind: 'etf-pareto' }>;
type Holding = { id: string; weight: number; label: string };
export const PARETO_WEIGHT_TOLERANCE = 1e-6;
const DISPLAY_LIMIT = 50;

const refuse = (message: string) => ({ ok: false, refused: true, message }) as const;
const precisePercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const smallPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 3 });

function weightFormatter(precision: number) {
  const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: precision });
  return (weight: number) => {
    const rounded = percent.format(weight);
    if (weight > 1 || (weight < 1 && rounded === '100%')) return precisePercent.format(weight);
    if (weight > 0 && rounded === '0%') return smallPercent.format(weight);
    return rounded;
  };
}

function compensatedSum() {
  let sum = 0;
  let correction = 0;
  return (weight: number) => {
    const adjusted = weight - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
    return sum;
  };
}

export function buildEtfPareto(dataset: WidgetDataset, options: ParetoOptions, context: RecipeContext): RecipeResult {
  const decoded = decodeRecipeOptions(options, 'etf-pareto');
  if (!decoded.ok) return refuse(decoded.message);
  const acquisition = readEtfEvidence(dataset, 'holdings');
  if (!acquisition.ok) return refuse(acquisition.message);
  const bindingIssue = savedBindingIssue(options, dataset.columns);
  if (bindingIssue) return refuse(bindingIssue);

  const { fields } = options;
  const holdings = new Map<string, Holding>();
  let duplicates = 0;
  for (const row of dataset.rows) {
    const id = read(row, fields.holding);
    if (typeof id !== 'string' || !id.trim()) return refuse('Each delivered holding needs an ID without a cell error.');
    const weight = read(row, fields.weight);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1)
      return refuse('Each delivered holding weight must be a finite fraction in [0, 1] without a cell error.');
    if (fields.label && Object.hasOwn(row.cellErrors ?? {}, fields.label))
      return refuse('The selected holding label has a cell error. Repair the label or remove its binding.');
    const previous = holdings.get(id);
    if (previous) {
      if (previous.weight !== weight) return refuse('A delivered holding ID has conflicting weights.');
      duplicates++;
    } else {
      holdings.set(id, { id, weight, label: text(read(row, fields.label)) ?? id });
    }
  }
  if (!holdings.size) return refuse('At least one delivered holding is needed.');

  const precision = Number.isInteger(context.maxDecimals) && context.maxDecimals >= 0 && context.maxDecimals <= 20
    ? context.maxDecimals : 2;
  const formatWeight = weightFormatter(precision);
  const ranked = [...holdings.values()].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Use the same compensated running sum for the visible prefix and the full delivered total.
  const addWeight = compensatedSum();
  const cumulative: number[] = [];
  let total = 0;
  for (const { weight } of ranked) {
    total = addWeight(weight);
    if (cumulative.length < DISPLAY_LIMIT) cumulative.push(total);
  }
  if (total > 1 + PARETO_WEIGHT_TOLERANCE)
    return refuse(`The delivered weight total of ${formatWeight(total)} exceeds 100% by more than the rounding tolerance of 0.0001 percentage points.`);

  const displayed = ranked.slice(0, DISPLAY_LIMIT);
  const notes = [...acquisition.notes];
  if (duplicates) notes.push(`Collapsed ${duplicates} duplicate holding row${duplicates === 1 ? '' : 's'} with matching IDs and weights.`);
  notes.push(
    `Shown holdings: ${displayed.length} of ${holdings.size} delivered (${formatWeight(cumulative[cumulative.length - 1])} of fund assets).`,
    `Delivered weight: ${formatWeight(total)} of fund assets across ${holdings.size} distinct holdings.`,
  );

  const revision = JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version,
    fields.holding, fields.weight, fields.label ?? null, acquisition.evidence.fund]);
  const categories = displayed.map(({ id }) => `holding:${id}`);
  const labels = displayed.map(({ label }) => escape(label));
  const customdata = displayed.map(({ id, weight }, index) => [
    labels[index], escape(id), formatWeight(weight), formatWeight(cumulative[index]),
  ]);
  const yMaximum = Math.max(1, total);
  const tickvals = [0, .25, .5, .75, yMaximum];
  return {
    ok: true, revision, notes,
    figure: {
      data: [{
        type: 'bar', uid: 'etf-holding-weights', name: 'Reported weight',
        x: categories, y: displayed.map(({ weight }) => weight), yaxis: 'y', customdata,
        marker: { color: color('reported-weight') },
        hovertemplate: '%{customdata[0]} (%{customdata[1]})<br>Reported weight %{customdata[2]}<extra></extra>',
      }, {
        type: 'scatter', uid: 'etf-cumulative-weight', mode: 'lines+markers', name: 'Cumulative weight',
        x: categories, y: cumulative, yaxis: 'y', customdata, cliponaxis: false,
        line: { color: color('cumulative-weight') },
        hovertemplate: '%{customdata[0]} (%{customdata[1]})<br>Cumulative weight %{customdata[3]}<extra></extra>',
      }],
      layout: {
        ...themedLayout(context.theme), uirevision: revision,
        title: { text: `${escape(acquisition.evidence.fund)} holdings concentration` },
        margin: { l: 65, r: 20, t: 48, b: 40 }, showlegend: true,
        legend: { orientation: 'h', y: 1, yanchor: 'bottom' },
        xaxis: {
          type: 'category', categoryorder: 'array', categoryarray: categories,
          tickmode: 'array', tickvals: categories, ticktext: labels, tickangle: -45, automargin: true,
        },
        yaxis: {
          type: 'linear', title: { text: 'Weight of fund assets' }, range: [0, yMaximum], automargin: true,
          tickmode: 'array', tickvals, ticktext: tickvals.map(formatWeight),
        },
      },
    },
  };
}
