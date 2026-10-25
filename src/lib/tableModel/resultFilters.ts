// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CellResult, ModelError, ResultFilter } from './types';
export type CalculatedGroup = {
    categoryId: string;
    sourceRecordIds: ReadonlySet<string>;
    cells: Map<string, CellResult>;
    measureCells?: Map<string, CellResult>;
};
export type Qualification = {
    recordIds: Set<string>;
    complete: boolean;
    errors: ModelError[];
};
/** One pass over original results. Each filter contributes a union, then unions intersect. */
export function qualifyGroups(groups: CalculatedGroup[], filters: ResultFilter[]): Qualification {
    let recordIds = new Set(groups.flatMap(group => [...group.sourceRecordIds]));
    const errors: ModelError[] = [];
    for (const filter of filters) {
        const candidates = groups.filter(group => group.categoryId === filter.categoryId);
        const qualified = new Set<string>();
        if (!candidates.length)
            errors.push({ code: 'missing-reference', message: `Result filter category ${filter.categoryId} is unavailable.`, definitionId: filter.id });
        for (const group of candidates) {
            const cell = (filter.target.kind === 'measure' ? group.measureCells ?? group.cells : group.cells).get(filter.target.id);
            if (!cell || !cell.ok) {
                errors.push(cell && !cell.ok ? { ...cell.error, definitionId: filter.id } : { code: 'missing-reference', message: 'Result filter input is unavailable.', definitionId: filter.id });
                continue;
            }
            const a = cell.value, b = filter.value;
            const scalar = (v: unknown) => v === null || ['number', 'string', 'boolean'].includes(typeof v);
            if (!scalar(a) || !scalar(b) || (typeof a === 'number' && !Number.isFinite(a)) || (!['eq', 'ne'].includes(filter.predicate) && (typeof a !== typeof b || !['number', 'string'].includes(typeof a)))) {
                errors.push({ code: 'invalid-type', message: 'Result predicate requires compatible scalar values.', definitionId: filter.id, recordIds: [...group.sourceRecordIds] });
                continue;
            }
            const passes = filter.predicate === 'eq' ? a === b : filter.predicate === 'ne' ? a !== b : filter.predicate === 'gt' ? (a as number) > (b as number) : filter.predicate === 'gte' ? (a as number) >= (b as number) : filter.predicate === 'lt' ? (a as number) < (b as number) : (a as number) <= (b as number);
            if (passes)
                group.sourceRecordIds.forEach(id => qualified.add(id));
        }
        recordIds = new Set([...recordIds].filter(id => qualified.has(id)));
    }
    return { recordIds, complete: errors.length === 0, errors };
}
