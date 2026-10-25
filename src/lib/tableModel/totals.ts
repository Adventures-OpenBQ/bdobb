// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { EligiblePool } from './facets';
import { evaluateAggregateFormulas, type CompiledModel, type FormulaValues } from './formulaEvaluation';
import { collectFiscalEvidence, type CalculationScope } from './scopes';
export type CalculatedTotals = {
    empty: boolean;
    scope: CalculationScope;
    formulas: FormulaValues;
    measures: {
        cells: FormulaValues['cells'];
        metadata: FormulaValues['metadata'];
    };
};
/** Only explicit definition bindings establish chronology. Ambiguous bindings never pick a first field. */
export function temporalContext(model: CompiledModel): CalculationScope['temporalContext'] {
    const dates = new Set(model.categories.filter(c => c.transform !== 'native' || c.legacyBucket).map(c => c.sourceFieldId));
    const companies = new Set(model.categories.flatMap(c => c.fiscalBinding ? [c.fiscalBinding.companyFieldId] : []));
    return { ...(dates.size === 1 ? { dateFieldId: [...dates][0] } : {}), ...(companies.size === 1 ? { companyFieldId: [...companies][0] } : {}) };
}
/** Capture authoritative request evidence before any line-member replacement. */
export function requestedFiscalScope(ids: ReadonlySet<string>, pool: EligiblePool, model: CompiledModel): CalculationScope['requestedFiscalScope'] {
    const policy = model.execution?.policy;
    if (!policy) return undefined;
    const category = model.categories.find(category => category.transform === policy.periodKind);
    return {
        categoryId: category?.id ?? '',
        dependentCategoryIds: policy.dependentCategoryIds,
        ...collectFiscalEvidence(pool, ids, category?.id ?? ''),
    };
}
/** Re-evaluate operations over source identities; displayed subtotals never enter the inputs. */
export function calculateTotals(ids: ReadonlySet<string>, pool: EligiblePool, model: CompiledModel, context: Partial<Omit<CalculationScope, 'sourceRecordIds'>> = {}): CalculatedTotals {
    const policy = model.execution?.policy;
    const fields = policy ? [policy.companyFieldId, policy.currencyFieldId, policy.unitFieldId].filter((field): field is string => !!field) : [];
    const records = fields.length ? pool.rows.filter(row => ids.has(row.id)) : [];
    const fieldConstraints = fields.length ? new Map(fields.map(field => [field, new Set(records.map(row => row.values[field]))])) : undefined;
    const scope: CalculationScope = { fieldConstraints, sourceRecordIds: ids, categoryConstraints: new Map(), temporalContext: temporalContext(model), requestedFiscalScope: requestedFiscalScope(ids, pool, model), ...context };
    const formulas = evaluateAggregateFormulas(scope, pool, model);
    return { empty: formulas.empty, scope, formulas, measures: { cells: formulas.measureCells, metadata: formulas.measureMetadata } };
}
