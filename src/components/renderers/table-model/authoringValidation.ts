// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { compileAnalyticalModel } from '../../../lib/tableModel/calculate';
import { bindFormula } from '../../../lib/tableModel/formulaBinding';
import { parseFormula, type SyntaxAst, type FormulaDiagnostic } from '../../../lib/tableModel/formulaSyntax';
import type { FormulaDef, MemberSelector, TableModelV1 } from '../../../lib/tableModel/types';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import {rememberMembers,applyBindings,chronological,type DraftBindings} from '../../../lib/tableModel/formulaProvenance';
export {rememberFormulaBindings} from '../../../lib/tableModel/formulaProvenance';
export type {Reference,DraftBindings} from '../../../lib/tableModel/formulaProvenance';
export type DraftMemberProof = MemberSelector & { token: string; categoryName: string; value: number | string | boolean | null };
/** Keep only inserted selectors still present in this bounded draft, never a facet cache. */
export function retainDraftMembers(expression: string, proofs: readonly DraftMemberProof[]): DraftMemberProof[] {
    if (new TextEncoder().encode(expression).length > 16384) return [];
    const parsed = parseFormula(expression).ast;
    const selectors = new Set<string>();
    const visit = (ast: SyntaxAst): void => {
        if (ast.kind === 'member') {
            ast.selectors.forEach(selector => { if ('categoryName' in selector) selectors.add(JSON.stringify([selector.categoryName, selector.value])); });
            visit(ast.value);
        } else if (ast.kind === 'binary') { visit(ast.left); visit(ast.right); }
        else if (ast.kind === 'unary') visit(ast.operand);
        else if (ast.kind === 'call') ast.args.forEach(visit);
    };
    if (parsed) visit(parsed);
    return proofs.filter(proof => parsed ? selectors.has(JSON.stringify([proof.categoryName, proof.value])) : expression.includes(proof.token)).slice(0, 1024);
}
/** Static validation only. It never invokes the calculation pipeline. */
export function checkAuthoringModel(raw: unknown, columns: readonly DatasetColumn[]) {
    const compiled = compileAnalyticalModel(raw, { columns });
    const errors = [...compiled.validation.diagnostics.filter(d => d.severity === 'error').map(d => d.message), ...compiled.graph.diagnostics.map(d => d.message)];
    const sourceIds = [...columns.map(c => c.id), ...compiled.symbols.formulas.filter(f => f.scope === 'source').map(f => f.id)];
    const requireSource = (id: string, name: string) => { const matches = sourceIds.filter(source => source === id); if (matches.length !== 1)
        errors.push(`${name}: ${matches.length ? 'Ambiguous' : 'Missing'} source binding ${id}.`); };
    for (const definition of [...compiled.model.categories, ...compiled.model.measures])
        requireSource(definition.sourceFieldId, 'name' in definition ? definition.name : definition.customLabel ?? definition.id);
    for (const category of compiled.model.categories)
        if (category.fiscalBinding) {
            const binding = category.fiscalBinding;
            for (const key of ['companyFieldId', 'dateFieldId', 'periodStartFieldId', 'periodEndFieldId', 'fiscalYearFieldId', 'fiscalQuarterFieldId'] as const) {
                if (binding[key])
                    requireSource(binding[key], category.name);
            }
            if (binding.dateFieldId && binding.dateFieldId !== category.sourceFieldId)
                errors.push(`${category.name}: fiscal period date must match the category source binding.`);
        }
    return { model: errors.length ? undefined : compiled.validation.model, errors, diagnostics: compiled.graph.diagnostics, compiled };
}
export function bindFormulaDraft(model: TableModelV1, columns: readonly DatasetColumn[], draft: Omit<FormulaDef, 'ast'>, original: FormulaDef | undefined, bindings: DraftBindings, members?: {
    categoryId: string;
    members?: {
        key: string;
        value: unknown;
    }[];
}, draftMembers: readonly DraftMemberProof[] = []): { model?: TableModelV1; errors: string[]; diagnostics?: FormulaDiagnostic[] } {
    const context = compileAnalyticalModel(model, { columns });
    const symbols = { ...context.symbols, formulas: [...model.formulas.filter(f => f.id !== draft.id), draft], categories: context.symbols.categories.map(c => ({ ...c, members: members?.categoryId === c.id ? members.members?.flatMap(m => m.value === null || ['number', 'boolean', 'string'].includes(typeof m.value) ? [{ key: m.key, value: m.value as number | string | boolean | null }] : []) ?? [] : [] })) };
    if (original && draft.expression === original.expression) {
        const next = { ...model, formulas: [...model.formulas.filter(f => f.id !== draft.id), { ...draft, ast: original.ast }] };
        const checked = checkAuthoringModel(next, columns);
        return { model: checked.model, errors: checked.errors, diagnostics: checked.diagnostics };
    }
    const parsed = parseFormula(draft.expression);
    if (!parsed.ast)
        return { errors: parsed.diagnostics.map(d => d.message), diagnostics: parsed.diagnostics };
    const retained = rememberMembers(original);
    for (const proof of retainDraftMembers(draft.expression, draftMembers)) {
        const key = JSON.stringify([proof.categoryName, proof.value]);
        const previous = retained.get(key);
        if (previous && (previous.categoryId !== proof.categoryId || previous.memberKey !== proof.memberKey))
            return { errors: ['Ambiguous member selector. Choose an unambiguous category and member.'] };
        retained.set(key, { categoryId: proof.categoryId, memberKey: proof.memberKey });
    }
    const bound = bindFormula(applyBindings(parsed.ast, bindings, retained, draft.scope), symbols, draft.scope, { boundMembers: 'structural' });
    if (!bound.ast)
        return { errors: bound.diagnostics.map(d => d.message), diagnostics: bound.diagnostics };
    const dates = new Set(model.categories.filter(c => c.transform !== 'native' || c.legacyBucket).map(c => c.sourceFieldId));
    const companies = new Set(model.categories.flatMap(c => c.fiscalBinding ? [c.fiscalBinding.companyFieldId] : []));
    if (chronological(bound.ast) && (dates.size !== 1 || companies.size > 1))
        return { errors: ['First and Last require one declared temporal category and an unambiguous company mapping.'] };
    const next = { ...model, formulas: [...model.formulas.filter(f => f.id !== draft.id), { ...draft, ast: bound.ast }] };
    const checked = checkAuthoringModel(next, columns);
    return { model: checked.model, errors: checked.errors, diagnostics: checked.diagnostics };
}
