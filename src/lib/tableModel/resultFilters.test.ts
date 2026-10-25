// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { qualifyGroups, type CalculatedGroup } from './resultFilters';
import type { ResultFilter } from './types';
const group = (categoryId: string, ids: string[], value: number): CalculatedGroup => ({ categoryId, sourceRecordIds: new Set(ids), cells: new Map([['revenue', { ok: true, value }]]) });
const filter = (categoryId: string, value: number): ResultFilter => ({ id: categoryId, categoryId, target: { kind: 'measure', id: 'revenue' }, predicate: 'gt', value });
it('intersects annual and quarterly qualification and deduplicates overlapping records', () => {
    const groups = [group('year', ['a', 'b'], 100), group('year', ['c'], 20), group('quarter', ['a'], 80), group('quarter', ['b'], 20), group('quarter', ['c'], 20)];
    expect([...qualifyGroups(groups, [filter('year', 50)]).recordIds]).toEqual(['a', 'b']);
    expect([...qualifyGroups(groups, [filter('year', 50), filter('quarter', 50)]).recordIds]).toEqual(['a']);
});
it('reports unavailable levels and errored predicates as incomplete', () => {
    const broken = group('year', ['a'], 0);
    broken.cells.set('revenue', { ok: false, error: { code: 'division-by-zero', message: 'zero' } });
    expect(qualifyGroups([broken], [filter('year', 1)])).toMatchObject({ complete: false, recordIds: new Set(), errors: [expect.objectContaining({ code: 'division-by-zero' })] });
    expect(qualifyGroups([broken], [filter('missing', 1)])).toMatchObject({ complete: false, errors: [expect.objectContaining({ code: 'missing-reference' })] });
});
