// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DatasetColumn } from '../widgetData/types';
import type { FormulaAst, MemberSelector, ModelDiagnostic, TableModelV1 } from '../tableModel/types';
import { compileAnalyticalModel } from '../tableModel/calculate';
import { pivotValueKey } from '../pivotKeys';
import { validateStatementIntent } from './validation';
import { statementOwnedIds, type EffectiveStatement, type StatementIntent } from './types';
import type { AnalyticalExecutionDescriptor } from '../tableModel/executionDescriptor';
export class StatementCompilationError extends Error {
    constructor(public readonly diagnostics: ModelDiagnostic[]) { super(diagnostics.map(d => d.message).join(' ')); this.name = 'StatementCompilationError'; }
}
export function compileStatement(raw: StatementIntent, columns: readonly DatasetColumn[]): EffectiveStatement {
    const validated = validateStatementIntent(raw);
    if (!validated.value)
        throw new StatementCompilationError(validated.diagnostics);
    const intent = validated.value, b = intent.bindings, ids = statementOwnedIds(intent.template);
    const problem = (message: string, path = 'bindings'): never => { throw new StatementCompilationError([{ code: 'missing-reference', severity: 'error', path, message }]); };
    const carry = [...new Set([b.companyFieldId, b.periodKindFieldId, b.currencyFieldId, b.unitFieldId, ...Object.entries(b.fiscal).filter(([key]) => key.endsWith('FieldId')).map(([, value]) => value)].filter((v): v is string => !!v))];
    const required = [...carry, ...(b.shape === 'wide' ? b.mappings.map(m => m.sourceFieldId) : [b.longFields!.itemFieldId, b.longFields!.valueFieldId])];
    for (const field of required)
        if (!columns.some(c => c.id === field))
            problem(`Presented source field ${field} is unavailable; restore or rebind it.`);
    if (!b.fiscal.dateFieldId)
        problem('Bind a report date to execute the selected fiscal period.');
    if ([b.fiscal.periodKind, b.fiscal.fiscalYearFieldId, b.fiscal.fiscalQuarterFieldId, b.fiscal.periodStartFieldId, b.fiscal.periodEndFieldId].some(v => v !== undefined) && (!b.fiscal.fiscalYearFieldId || !b.fiscal.periodStartFieldId || !b.fiscal.periodEndFieldId || (intent.periodKind === 'FQ' && !b.fiscal.fiscalQuarterFieldId)))
        problem('Explicit fiscal bindings require year, start/end bounds and a quarter for FQ.');
    const sectionId = ids.prefix + 'category/section', sectionField = ids.prefix + 'field/section';
    const itemField = b.shape === 'long' ? b.longFields!.itemFieldId : ids.prefix + 'field/item';
    const valueField = b.shape === 'long' ? b.longFields!.valueFieldId : ids.prefix + 'field/value';
    const sectionByLine = new Map(intent.template.sections.flatMap(s => s.lineIds.map(id => [id, s.id] as const)));
    const lineById = new Map(intent.template.lines.map(line => [line.id, line]));
    const selectorsForLine = (lineId: string): MemberSelector[] => [
        { categoryId: sectionId, memberKey: pivotValueKey(sectionByLine.get(lineId)) },
        { categoryId: ids.item, memberKey: pivotValueKey(lineId) },
    ];
    // The active line belongs to the lexical member subtree. A nested selector
    // replaces it only for that subtree; every nested Value reference exposes
    // its actual formula dependency to the graph before execution is allowed.
    const mapAst = (ast: FormulaAst, selectedLineId?: string): FormulaAst => {
        if (ast.kind === 'reference' && ast.target === 'measure') {
            if (!selectedLineId)
                problem('Bind Value to an explicit line member in aggregate formulas.', 'formulas');
            const formula = lineById.get(selectedLineId!)?.formula;
            return formula ? { kind: 'reference', target: 'formula', id: formula.id } : ast;
        }
        if (ast.kind === 'member') {
            const selected = ast.selectors.find(selector => selector.categoryId === ids.item);
            const activeLineId = selected?.memberKey ?? selectedLineId;
            return {
                ...ast,
                value: mapAst(ast.value, activeLineId),
                selectors: ast.selectors.flatMap(selector => selector.categoryId === ids.item
                    ? selectorsForLine(selector.memberKey)
                    : [selector]),
            };
        }
        if (ast.kind === 'binary')
            return { ...ast, left: mapAst(ast.left, selectedLineId), right: mapAst(ast.right, selectedLineId) };
        if (ast.kind === 'unary')
            return { ...ast, operand: mapAst(ast.operand, selectedLineId) };
        if (ast.kind === 'call')
            return { ...ast, args: ast.args.map(arg => mapAst(arg, selectedLineId)) };
        return ast;
    };
    const pinned = intent.template.lines.flatMap(l => l.formula ? [l.formula] : []);
    const formulas = [...new Map([...pinned, ...intent.overrides.formulas].map(f => [f.id, f])).values()].map(f => ({ ...f, ast: mapAst(f.ast) }));
    const sectionOrder = intent.overrides.sectionOrder ?? intent.template.sections.map(s => s.id);
    const orderedSections = [...sectionOrder, ...intent.template.sections.map(s => s.id).filter(id => !sectionOrder.includes(id))];
    const lines = orderedSections.flatMap(id => { const section = intent.template.sections.find(s => s.id === id)!; const order = intent.overrides.lineOrder[id] ?? section.lineIds; return [...order, ...section.lineIds.filter(l => !order.includes(l))]; });
    const memberOrders = { [sectionId]: orderedSections.map(pivotValueKey), [ids.item]: lines.map(pivotValueKey) };
    const linePolicies = Object.fromEntries(intent.template.lines.map(l => [pivotValueKey(l.id), l.policy]));
    const model: TableModelV1 = {
        schemaVersion: 1,
        enabled: true,
        params: { promotePage: false, filters: [] },
        categories: [
            { id: sectionId, name: 'Section', sourceFieldId: sectionField, transform: 'native' },
            { id: ids.item, name: 'Line item', sourceFieldId: itemField, transform: 'native' },
            { id: ids.company, name: 'Company', sourceFieldId: b.companyFieldId, transform: 'native' },
            { id: ids.period, name: intent.periodKind, sourceFieldId: b.fiscal.dateFieldId!, transform: intent.periodKind, fiscalBinding: b.fiscal },
        ],
        measures: [{ id: ids.value, sourceFieldId: valueField, aggregation: 'sum', customLabel: 'Value' }],
        formulas,
        layout: {
            rows: [sectionId, ids.item], columns: [ids.period], values: [ids.value],
            ...(intent.page ? { page: intent.page } : {}),
        },
        checklists: intent.checklists.map(selection => ({ ...selection, memberKeys: selection.categoryId === ids.item ? selection.memberKeys.map(pivotValueKey) : [...selection.memberKeys] })),
        resultFilters: intent.resultFilters,
        subtotals: { groups: false, grandTotal: false },
    };
    const scopeMembers = intent.template.lines.flatMap(line => line.formula
        ? [{ formulaId: line.formula.id, selectors: selectorsForLine(line.id) }]
        : []);
    const mappedIds = new Set(b.mappings.map(mapping => mapping.lineId));
    const hiddenIds = new Set(intent.overrides.hiddenIds);
    const outputMembers = lines.flatMap(id => {
        const line = lineById.get(id)!;
        const available = b.shape === 'long' || mappedIds.has(id) || line.required || line.formula;
        if (!available || intent.checklists.some(selection => selection.categoryId === ids.item && !selection.memberKeys.includes(id)) || hiddenIds.has(id) || hiddenIds.has(sectionByLine.get(id)!)) return [];
        const authoredFormat = (line.formula ? formulas.find(f => f.id === line.formula!.id)?.format : undefined) ?? line.format;
        // Statement formula/template percent denotes a ratio. Source formats retain
        // their existing backend/XLS semantics without global formatter changes.
        const formatterFn = authoredFormat === 'percent' ? 'normalizedPercent' : authoredFormat === 'integer' ? 'int' : ['decimal', 'number'].includes(authoredFormat ?? '') ? 'none' : authoredFormat;
        const format: DatasetColumn['format'] = formatterFn && ['int', 'none', 'normalized', 'normalizedPercent', 'dateToYear'].includes(formatterFn)
            ? { formatterFn: formatterFn as NonNullable<DatasetColumn['format']>['formatterFn'] } : undefined;
        return [{
            ...(format ? { format } : {}),
            requireObserved: b.shape === 'long' && !line.required && !line.formula,
            selectors: selectorsForLine(id),
            ...(line.formula ? { formulaId: line.formula.id } : {}),
        }];
    });
    const policy: AnalyticalExecutionDescriptor['policy'] = {
        categoryId: ids.item,
        dependentCategoryIds: [sectionId, ids.item],
        measureId: ids.value,
        valueFieldId: valueField,
        members: linePolicies,
        required: Object.fromEntries(intent.template.lines.map(l => [pivotValueKey(l.id), l.required])),
        formulas: Object.fromEntries(scopeMembers.map(member => [
            member.selectors.find(selector => selector.categoryId === ids.item)!.memberKey,
            member.formulaId,
        ])),
        periodKind: intent.periodKind,
        companyFieldId: b.companyFieldId,
        currencyFieldId: b.currencyFieldId,
        unitFieldId: b.unitFieldId,
        fiscal: b.fiscal,
    };
    const memberLabels = {
        [sectionId]: Object.fromEntries(intent.template.sections.map(section => [
            pivotValueKey(section.id), intent.overrides.labels[section.id] ?? section.label,
        ])),
        [ids.item]: Object.fromEntries(intent.template.lines.map(line => [
            pivotValueKey(line.id), intent.overrides.labels[line.id] ?? line.label,
        ])),
    };
    const execution: AnalyticalExecutionDescriptor = {
        scopeMembers, memberOrders, memberLabels, outputMembers, policy,
    };
    const unpivot = b.shape === 'wide' ? { id: ids.prefix + 'unpivot', carryFieldIds: carry, mappings: b.mappings, itemFieldId: itemField, valueFieldId: valueField } : undefined;
    const effectiveColumns = unpivot ? [...columns.filter(c => carry.includes(c.id)), { id: itemField, label: 'Line item' }, { id: valueField, label: 'Value' }] : [...columns];
    effectiveColumns.push({ id: sectionField, label: 'Section' });
    const checked = compileAnalyticalModel(model, { columns: effectiveColumns });
    if (checked.validation.diagnostics.some(d => d.severity === 'error'))
        throw new StatementCompilationError(checked.validation.diagnostics);
    if (checked.graph.diagnostics.length)
        problem(checked.graph.diagnostics.map(d => d.message).join(' '), 'formulas');
    return { model, unpivot, memberOrders, linePolicies, templateIdentity: { id: intent.template.id, version: intent.template.version }, execution, sectionField, sectionByLine: Object.fromEntries(sectionByLine) };
}
