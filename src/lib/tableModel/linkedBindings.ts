// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { TableDefinition } from '../tableExecution/types';
import type { DatasetColumn } from '../widgetData/types';
import type { FormulaAst, FormulaDef } from './types';
import { validateTableModel } from './validation';
import { validateFormulaGraph } from './formulaGraph';
import { astChildren } from './formulaSyntax';
import { ExecutionProtocolError } from '../tableExecution/validation';

/** Schema-only linked contract. Synthetic symbols prove requirements, never authorize execution. */
export function validateLinkedBindings(definition: TableDefinition, columns: readonly DatasetColumn[]): void {
  if (definition.analytical === undefined) return;
  const validated = validateTableModel(definition.analytical);
  const categories = validated.categories.flatMap(e => e.value ? [e.value] : []);
  const measures = validated.measures.flatMap(e => e.value ? [e.value] : []);
  const formulas = validated.formulas.flatMap(e => e.value ? [e.value] : []);
  const incoming = new Set(columns.map(c => c.id));
  // Declaration ownership survives an invalid AST. Match the compiler's safe raw
  // headers without admitting malformed definitions to the validation graph below.
  const localSources = new Set(validated.formulas.flatMap(entry => {
    const header = entry.raw as Partial<FormulaDef> | null;
    return header && typeof header.id === 'string' && typeof header.name === 'string' && header.scope === 'source' ? [header.id] : [];
  }));
  const fields = (ast: FormulaAst): string[] =>
    ast.kind === 'reference' ? (ast.target === 'field' ? [ast.id] : []) : astChildren(ast).flatMap(fields);
  const declared = [...categories.map(c => c.sourceFieldId), ...measures.map(m => m.sourceFieldId), ...formulas.flatMap(f => fields(f.ast))];
  const candidates = new Set([...incoming, ...declared.filter(id => !localSources.has(id))]);
  const graph = validateFormulaGraph(formulas, {
    fields: [...candidates].map(id => ({ id, name: id })), formulas,
    categories: categories.map(c => ({ ...c, members: [] })),
    measures: measures.map(m => ({ ...m, name: m.customLabel ?? m.id })),
  }, { boundMembers: 'structural' });
  const valid = new Set(graph.order);
  const required = new Set<string>();
  const source = (id: string) => {
    if (localSources.has(id)) {
      if (incoming.has(id)) throw new ExecutionProtocolError('INVALID_REQUEST', `Ambiguous local formula and incoming field: ${id}`);
      return;
    }
    required.add(id);
  };
  for (const c of categories) {
    source(c.sourceFieldId);
    if (c.fiscalBinding) for (const [key, value] of Object.entries(c.fiscalBinding))
      if (key.endsWith('FieldId') && value) source(value);
  }
  for (const m of measures) source(m.sourceFieldId);
  for (const f of formulas) if (valid.has(f.id)) for (const id of fields(f.ast)) required.add(id);
  for (const filter of definition.table.columnFilters ?? []) {
    if (filter.value === '' || filter.value == null || Array.isArray(filter.value) && filter.value.length === 0) continue;
    if (!categories.some(c => c.id === filter.id) && !localSources.has(filter.id)) required.add(filter.id);
  }
  const missing = [...required].filter(id => !incoming.has(id));
  if (missing.length) throw new ExecutionProtocolError('MISSING_FIELD', `Missing linked source field: ${missing.join(', ')}; restore field or edit definition`);
}
