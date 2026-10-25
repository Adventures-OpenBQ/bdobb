// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { PivotMeasure } from '../types';
import type { FormulaAst, FormulaDef, CategoryDef } from './types';
import { validateSyntaxAst, type SyntaxAst, type FormulaDiagnostic } from './formulaSyntax';
import { tokenFor } from './formulaTokens';
export type FormulaScope = FormulaDef['scope'];
export type ModelSymbols = {
  fields: { id: string; name: string }[];
  formulas: Pick<FormulaDef, 'id' | 'name' | 'scope'>[];
  measures: (PivotMeasure & { name: string; aliases?: string[] })[];
  categories: (Pick<CategoryDef, 'id' | 'name' | 'sourceFieldId'> & Partial<Pick<CategoryDef, 'transform'>> & { members: { key: string; value: number | string | boolean | null }[] })[];
};
export type FormulaDependency = { kind: 'field' | 'formula' | 'measure' | 'category' | 'member'; id: string; categoryId?: string };
export type BindResult = { ast?: FormulaAst; diagnostics: FormulaDiagnostic[]; dependencies: FormulaDependency[] };
/** Symbols are validated model/schema metadata; the AST itself remains untrusted. */
export function bindFormula(ast: SyntaxAst | FormulaAst, symbols: ModelSymbols, scope: FormulaScope, options: { boundMembers?: 'structural' } = {}): BindResult {
  const checked = validateSyntaxAst(ast);
  const diagnostics = [...checked.diagnostics];
  const dependencies: FormulaDependency[] = [];
  const add = (kind: FormulaDependency['kind'], id: string, categoryId?: string) => {
    if (!dependencies.some(d => d.kind === kind && d.id === id && d.categoryId === categoryId)) dependencies.push({ kind, id, ...(categoryId ? { categoryId } : {}) });
  };
  const issue = (code: FormulaDiagnostic['code'], message: string, dependencyIds?: string[], candidateIds?: string[]) => {
    diagnostics.push({ code, message, ...(dependencyIds ? { dependencyIds } : {}), ...(candidateIds ? { candidateIds } : {}) });
  };
  const unique = <T extends { id: string }>(matches: T[], label: string): T | undefined => {
    if (matches.length === 1) return matches[0];
    if (!matches.length) issue('missing-reference', `Missing reference: ${label}.`, [label]);
    else issue('ambiguous-reference', `Ambiguous reference: ${label}. Choose a stable definition.`, undefined, matches.map(m => m.id));
  };
  const inputDependency = (id: string) => {
    const fields = symbols.fields.filter(f => f.id === id);
    const formulas = symbols.formulas.filter(f => f.id === id);
    const match = unique([...fields, ...formulas], id);
    if (!match) return;
    if (formulas.length) {
      add('formula', id);
      if (formulas[0].scope !== 'source') issue('scope', 'Category and measure inputs must be source fields or source formulas.', [id]);
    } else add('field', id);
  };
  type Ref = Extract<FormulaAst, { kind: 'reference' }>;
  const resolveName = (name: string, context: FormulaScope): Ref | undefined => {
    const fields = symbols.fields.filter(f => f.name === name).map(f => ({ ...f, target: 'field' as const }));
    const formulas = symbols.formulas.filter(f => f.name === name).map(f => ({ ...f, target: 'formula' as const }));
    const measures = symbols.measures.filter(m => m.name === name || m.aliases?.includes(name)).map(m => ({ ...m, target: 'measure' as const }));
    const aggregate = [...measures, ...formulas.filter(f => f.scope === 'aggregate')];
    const candidates: { id: string; target: Ref['target'] }[] = context === 'source' ? [...fields, ...formulas] : aggregate.length ? aggregate : [...fields, ...formulas];
    if (context === 'aggregate' && candidates.length > 1 && candidates.every(candidate => candidate.target === 'measure') && new Set(measures.map(measure => measure.sourceFieldId)).size === 1) {
      // Unrepresentable imported names retain their diagnostic instead of throwing during binding.
      const operand = name.includes(']') ? (name.includes(' ') ? `[${name}]` : name) : tokenFor({ id: '', name }, symbols);
      issue('ambiguous-reference', `${name} has more than one measure; use an explicit function such as SUM(${operand})`, undefined, candidates.map(candidate => candidate.id));
      return;
    }
    const match = unique(candidates, name);
    return match ? { kind: 'reference', target: match.target, id: match.id } : undefined;
  };
  const reference = (ref: Ref, context: FormulaScope): Ref => {
    add(ref.target, ref.id);
    if (ref.target === 'field') {
      const field = unique(symbols.fields.filter(f => f.id === ref.id), ref.id);
      if (field && context === 'aggregate') issue('missing-aggregation', `Choose an aggregation for ${field.name}.`, [field.id]);
    } else if (ref.target === 'formula') {
      const formula = unique(symbols.formulas.filter(f => f.id === ref.id), ref.id);
      if (formula?.scope === 'aggregate' && context === 'source') issue('scope', 'Source expressions cannot depend on aggregate formulas.', [ref.id]);
      if (formula?.scope === 'source' && context === 'aggregate') issue('missing-aggregation', `Choose an aggregation for ${formula.name}.`, [ref.id]);
    } else {
      const measure = unique(symbols.measures.filter(m => m.id === ref.id), ref.id);
      if (context === 'source') issue('scope', 'Source expressions cannot depend on aggregate measure instances.', [ref.id]);
      if (measure) {
        if (!measure.aggregation) issue('missing-aggregation', `Choose an aggregation for ${measure.name}.`, [ref.id]);
        inputDependency(measure.sourceFieldId);
      }
    }
    return ref;
  };
  const visit = (node: SyntaxAst, context: FormulaScope): FormulaAst | undefined => {
    switch (node.kind) {
      case 'literal': return node;
      case 'name': { const ref = resolveName(node.name, context); return ref && reference(ref, context); }
      case 'reference': return reference(node, context);
      case 'unary': { const operand = visit(node.operand, context); return operand && { ...node, operand }; }
      case 'binary': {
        const left = visit(node.left, context); const right = visit(node.right, context);
        return left && right ? { ...node, left, right } : undefined;
      }
      case 'call': {
        const aggregate = node.function !== 'IF';
        if (aggregate && context === 'source') issue('scope', 'Aggregate calls are allowed only at aggregate scope.');
        const args = node.args.map(arg => visit(arg, aggregate ? 'source' : context));
        return args.every((arg): arg is FormulaAst => arg !== undefined) ? { ...node, args } : undefined;
      }
      case 'member': {
        if (context === 'source') issue('scope', 'Category member comparisons require aggregate scope.');
        const value = visit(node.value, context);
        const selectors: { categoryId: string; memberKey: string }[] = [];
        const seen = new Set<string>();
        for (const selector of node.selectors) {
          const bound = 'categoryId' in selector;
          const category = unique(symbols.categories.filter(c => bound ? c.id === selector.categoryId : c.name === selector.categoryName), bound ? selector.categoryId : selector.categoryName);
          if (!category) { if (bound) add('category', selector.categoryId); continue; }
          add('category', category.id); inputDependency(category.sourceFieldId);
          if (seen.has(category.id)) issue('invalid-ast', 'Member selectors must name each category at most once.', [category.id]);
          seen.add(category.id);
          if (bound && options.boundMembers === 'structural') { add('member', selector.memberKey, category.id); selectors.push({ categoryId: category.id, memberKey: selector.memberKey }); continue; }
          let members = category.members.filter(m => bound ? m.key === selector.memberKey : m.value === selector.value);
          // A bucketed (Y/Q/M…) member is a string: an unquoted Year=2024 means "2024".
          if (!bound && !members.length && typeof selector.value === 'number' && category.transform && category.transform !== 'native') members = category.members.filter(m => m.value === String(selector.value));
          // A fiscal quarter is shown as FY2025-Q1 but stored as FY2025 Q1: either spelling binds.
          const shown = !bound && !members.length && category.transform === 'FQ' && typeof selector.value === 'string' ? /^FY(\d{4})-Q([1-4])$/.exec(selector.value) : null;
          if (shown) members = category.members.filter(m => m.value === `FY${shown[1]} Q${shown[2]}`);
          if (!members.length) issue('missing-member', `Missing member in ${category.name}.`, [category.id, bound ? selector.memberKey : String(selector.value)]);
          else if (members.length > 1) issue('ambiguous-reference', `Ambiguous member in ${category.name}.`, [category.id], members.map(m => m.key));
          else { add('member', members[0].key, category.id); selectors.push({ categoryId: category.id, memberKey: members[0].key }); }
        }
        return value ? { kind: 'member', value, selectors } : undefined;
      }
    }
  };
  const bound = checked.ast && visit(checked.ast, scope);
  return { ...(bound && !diagnostics.length ? { ast: bound } : {}), diagnostics, dependencies };
}
