// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { AggName, PivotMeasure } from '../types';

export function duplicateMeasure(measures: PivotMeasure[], id: string, newId: string): PivotMeasure[] {
  const index = measures.findIndex(measure => measure.id === id);
  if (index < 0) throw new Error('Unknown measure ID');
  if (!newId || measures.some(measure => measure.id === newId)) throw new Error('Measure ID must be unique and nonempty');
  return [...measures.slice(0, index + 1), { ...measures[index], id: newId }, ...measures.slice(index + 1)];
}

export function updateMeasureAggregation(measures: PivotMeasure[], id: string, aggregation: AggName | undefined): PivotMeasure[] {
  if (!measures.some(measure => measure.id === id)) throw new Error('Unknown measure ID');
  return measures.map(measure => {
    if (measure.id !== id) return measure;
    const next = { ...measure };
    if (aggregation === undefined) delete next.aggregation;
    else next.aggregation = aggregation;
    return next;
  });
}

const LABELS: Record<AggName, string> = {
  sum: 'Total', mean: 'Average', median: 'Median', min: 'Min', max: 'Max',
  first: 'First', last: 'Last', count: 'Count', uniqueCount: 'Unique Count',
};

export function measureLabel(measure: PivotMeasure, sourceLabel: string, siblings: PivotMeasure[]): string {
  if (measure.customLabel !== undefined) return measure.customLabel;
  const label = measure.aggregation === undefined ? sourceLabel : `${sourceLabel} — ${LABELS[measure.aggregation]}`;
  const matching = siblings.filter(sibling => sibling.customLabel === undefined && sibling.sourceFieldId === measure.sourceFieldId && sibling.aggregation === measure.aggregation);
  const index = matching.findIndex(sibling => sibling.id === measure.id);
  return index > 0 ? `${label} (${index + 1})` : label;
}
