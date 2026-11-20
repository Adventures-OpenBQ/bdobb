// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import type snapshotShape from './estimateVintageSnapshot.json';
import type { EstimateRevisionsOptions } from '../../lib/widgetData/chartRecipes/types';

const snapshot = JSON.parse(readFileSync('src/test/fixtures/estimateVintageSnapshot.json', 'utf8')) as typeof snapshotShape;
const receipt = snapshot.chart_sources.receipts[0];
export const revisionSlope: EstimateRevisionsOptions = {
  version: 1, kind: 'estimate-revisions', metric: 'eps', view: 'slope',
  target: { start: '2027-01-01', end: '2027-03-31', kind: 'FQ' }, vintages: ['snap-a', 'snap-c'],
  fields: { issuer: 'issuer', vintage: 'vintage', targetStart: 'target_start', targetEnd: 'target_end', targetKind: 'target_kind', value: 'value' },
};
export const revisionPath: EstimateRevisionsOptions = { ...revisionSlope, view: 'path', vintages: ['snap-a', 'snap-b', 'snap-c'] };
export const revisionBump: EstimateRevisionsOptions = { ...revisionPath, view: 'bump' };

export function revisionHistory(values: (number | null)[][], { unknown = false, missing = '' } = {}) {
  const issuers = values.map((_, index) => {
    const issuer = values.length <= 2 ? receipt.issuers[index].issuer : `RANK00${index}.US`;
    return { ...receipt.issuers[index % 2], issuer, entity_ref: 'example/entity/' + issuer,
      basis_ref: 'example/shares/' + issuer };
  });
  const members = issuers.map(issuer => issuer.issuer);
  const vintages = receipt.vintages.filter(vintage => vintage.id !== missing);
  const inputs = receipt.inputs.filter(input => vintages.some(vintage => vintage.batch === input.batch))
    .map(input => ({ ...input, universe_id: unknown ? null : input.universe_id, members: unknown ? null : members }));
  const rows = snapshot.rows.filter(row => row.issuer === receipt.issuers[0].issuer).flatMap((row, index) =>
    row.vintage === missing ? [] : issuers.map((issuer, issuerIndex) => ({ ...row, ...issuer, value: values[issuerIndex][index] })));
  return { ...snapshot, rows, chart_sources: { version: 1, receipts: [{
    ...receipt, issuers, vintages, inputs, raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length,
    universe: unknown ? { status: 'unknown' } : { ...receipt.universe, members, current_batch: vintages.at(-1)!.batch },
    coordinates: rows.map(({ vintage, issuer }) => ({ vintage, issuer })),
  }] } };
}

export const revisionDenseValues = [1e200, 1.0000000002e200, 1.0000000005e200];
export const revisionTieValues = Array.from({ length: 6 }, (_, i) => [10 + i, 3 * (10 + i), 2 * (10 + i)]);
