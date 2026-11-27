// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { identityWitness } from './identityWitness';
import { input } from './fixtures';

it.each([{ sourceBindingId: '' }, { sourceFieldId: '' }])('does not certify absence through an empty raw-field binding %j', binding => {
  const root = { table: {}, search: '' };
  const target = { table: { pivot: { enabled: true, grouping: ['region'], split: [] } }, search: '' };
  const columns = input.columns.map(column => column.id === 'region' ? { ...column, ...binding } : column);
  expect(identityWitness(input, [root, target], ['missing-group'], root, columns))
    .toEqual([{ id: 'missing-group', state: 'unknown' }]);
});
