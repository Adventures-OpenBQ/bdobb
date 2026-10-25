// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { TableModelV1 } from './types';
type ValuesModel = Pick<TableModelV1, 'layout' | 'measures' | 'formulas'>;
/** Display projection only; authored invalid entries remain available to Inspect. */
export function dataIds(model: ValuesModel): string[] {
 const known = new Set([...model.measures.map(m => m.id), ...model.formulas.filter(f => f.scope === 'aggregate').map(f => f.id)]);
 const seen = new Set<string>();
 return [...model.layout.values, ...model.measures.map(m => m.id)].filter(id => known.has(id) && !seen.has(id) && !!seen.add(id));
}
export function moveValue(model: TableModelV1, id: string, toIndex: number): TableModelV1 {
 const known = new Set([...model.measures.map(m => m.id), ...model.formulas.filter(f => f.scope === 'aggregate').map(f => f.id)]);
 if (!known.has(id)) return model;
 const order = dataIds(model).filter(value => value !== id);
 const index = Math.max(0, Math.min(order.length, Number.isFinite(toIndex) ? Math.trunc(toIndex) : order.length));
 const values = model.layout.values.filter(value => value !== id);
 // Missing measures are implicit trailing placements; materialize only those
 // needed to express this explicit move, preserving unrelated authored entries.
 for (const value of order) if (!values.includes(value)) values.push(value);
 const anchor = order[index];
 values.splice(anchor === undefined ? values.length : values.indexOf(anchor), 0, id);
 return { ...model, layout: { ...model.layout, values } };
}
