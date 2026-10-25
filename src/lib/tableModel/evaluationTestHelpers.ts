// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CompiledModel } from './formulaEvaluation';
import { validateFormulaGraph } from './formulaGraph';
import type { FormulaAst, FormulaDef } from './types';
export const ref = (id: string): FormulaAst => ({ kind: 'reference', target: 'field', id });
export const literal = (value: number | boolean | null): FormulaAst => ({ kind: 'literal', value });
export const formula = (id: string, ast: FormulaAst): FormulaDef => ({ id, name: id, scope: 'source', expression: 'stale name', ast });
export function context(formulas: FormulaDef[], categories: CompiledModel['categories'] = []): CompiledModel {
  const columns = ['revenue', 'cost', 'scenario', 'region', 'date'].map(id => ({ id, label: id }));
  const symbols = { fields: columns.map(c => ({ id: c.id, name: c.label })), formulas, measures: [], categories: categories.map(c => ({ ...c, members: [] })) };
  return { columns, symbols, categories, fiscal: {}, graph: validateFormulaGraph(formulas, symbols) };
}
export const profit = formula('profit', { kind: 'binary', operator: '-', left: ref('revenue'), right: ref('cost') });
