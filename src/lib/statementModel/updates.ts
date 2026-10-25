// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { statementOwnedIds, type StatementIntent, type StatementTemplate } from './types';
import { statementSnapshot, validateStatementTemplate } from './persistence';
import type { FormulaAst } from '../tableModel/types';
export type StatementUpdateChange = Readonly<{ id: string; label: string; field: string; before: unknown; after: unknown }>;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
export type StatementUpdateConflict = {id:string;reason:string};
/** Explicit preview only. Removed references remain visible and strict admission refuses the candidate. */
export function previewStatementUpdate(intent: StatementIntent, next: StatementTemplate): {next:StatementIntent;conflicts:StatementUpdateConflict[];changes:readonly StatementUpdateChange[]} {
  const candidate = statementSnapshot(intent);
  const snapshot = validateStatementTemplate(next);
  if (snapshot.id !== candidate.template.id) throw new Error('A Statement update must retain template identity.');
  const oldIds = statementOwnedIds(candidate.template), newIds = statementOwnedIds(snapshot);
  const targets = new Set([newIds.item,newIds.company,newIds.period,newIds.value,...snapshot.lines.map(l=>l.id),...snapshot.sections.map(s=>s.id),...snapshot.lines.flatMap(l=>l.formula?[l.formula.id]:[])]);
  const conflicts:StatementUpdateConflict[] = [];
  const conflict = (id:string,reason:string) => { if (!conflicts.some(c=>c.id===id&&c.reason===reason)) conflicts.push({id,reason}); };
  function map(id:string):string {
    if (!id.startsWith(oldIds.prefix)) return id;
    const replacement = newIds.prefix + id.slice(oldIds.prefix.length);
    if (targets.has(replacement)) return replacement;
    conflict(id,'Referenced semantic ID was removed from the proposed snapshot.');
    return id;
  }
  function ast(value:FormulaAst):FormulaAst {
    switch(value.kind) {
      case 'reference': return {...value,id:map(value.id)};
      case 'unary': return {...value,operand:ast(value.operand)};
      case 'binary': return {...value,left:ast(value.left),right:ast(value.right)};
      case 'call': return {...value,args:value.args.map(ast)};
      case 'member': return {...value,value:ast(value.value),selectors:value.selectors.map(s=>({...s,categoryId:map(s.categoryId),memberKey:s.categoryId===oldIds.item?map(s.memberKey):s.memberKey}))};
      default: return structuredClone(value);
    }
  }
  candidate.bindings.mappings = candidate.bindings.mappings.map(m=>({...m,lineId:map(m.lineId)}));
  const overrides = candidate.overrides;
  overrides.labels = Object.fromEntries(Object.entries(overrides.labels).map(([id,label])=>[map(id),label]));
  overrides.hiddenIds = overrides.hiddenIds.map(map);
  overrides.sectionOrder = overrides.sectionOrder?.map(map);
  overrides.lineOrder = Object.fromEntries(Object.entries(overrides.lineOrder).map(([id,order])=>[map(id),order.map(map)]));
  overrides.formulas = overrides.formulas.map(f=>({...f,id:map(f.id),ast:ast(f.ast)}));
  const selection = (s:NonNullable<StatementIntent['page']>) => ({categoryId:map(s.categoryId),memberKeys:s.categoryId===oldIds.item?s.memberKeys.map(map):[...s.memberKeys]});
  if (candidate.page) candidate.page = selection(candidate.page);
  candidate.checklists = candidate.checklists.map(selection);
  candidate.resultFilters = candidate.resultFilters.map(f=>({...f,categoryId:map(f.categoryId),target:{...f.target,id:map(f.target.id)}}));
  candidate.template = snapshot;
  // Order overrides also conflict when section membership changed; never silently drop user's order.
  for (const [section,order] of Object.entries(overrides.lineOrder)) {
    const current = snapshot.sections.find(s=>s.id===section);
    if (!current || current.lineIds.length !== order.length || current.lineIds.some(id=>!order.includes(id))) conflict(section,'Section membership changed; resolve the local line order.');
  }
  if (overrides.sectionOrder && (overrides.sectionOrder.length!==snapshot.sections.length || snapshot.sections.some(s=>!overrides.sectionOrder!.includes(s.id)))) conflict('overrides.sectionOrder','Section membership changed; resolve the local section order.');
  // A preview marker prevents even structurally valid unresolved order/default conflicts being adopted.
  if (conflicts.length) Object.assign(candidate,{updateConflicts:structuredClone(conflicts)});
  else statementSnapshot(candidate);
  const changes: StatementUpdateChange[] = [];
  const add = (id: string, label: string, field: string, before: unknown, after: unknown, semantic = true) => {
    const comparable = (value: unknown, prefix: string) => JSON.stringify(value)?.replaceAll(prefix, 'template/');
    if (semantic ? comparable(before, oldIds.prefix) === comparable(after, newIds.prefix) : JSON.stringify(before) === JSON.stringify(after)) return;
    changes.push(immutable({ id, label, field, before: structuredClone(before), after: structuredClone(after) }));
  };
  const compareEntries = (before: StatementTemplate['lines'] | StatementTemplate['sections'], after: StatementTemplate['lines'] | StatementTemplate['sections']) => {
    const oldById = new Map(before.map(entry => [entry.id.slice(oldIds.prefix.length), entry]));
    const newById = new Map(after.map(entry => [entry.id.slice(newIds.prefix.length), entry]));
    for (const id of new Set([...oldById.keys(), ...newById.keys()])) {
      const old = oldById.get(id), next = newById.get(id);
      if (!old || !next) { add(id, (old ?? next)!.label, old ? 'removed' : 'added', old, next); continue; }
      const fields = new Set([...Object.keys(old), ...Object.keys(next)]);
      for (const field of fields) if (field !== 'id') add(id, old.label, field, Reflect.get(old, field), Reflect.get(next, field));
    }
  };
  compareEntries(intent.template.lines, snapshot.lines);
  compareEntries(intent.template.sections, snapshot.sections);
  add('sections', 'Template sections', 'sectionOrder', intent.template.sections.map(s => s.id), snapshot.sections.map(s => s.id));
  add('bindings', 'Source bindings', 'mappings', intent.bindings.mappings, candidate.bindings.mappings, false);
  return {next:candidate,conflicts,changes:Object.freeze(changes)};
}
