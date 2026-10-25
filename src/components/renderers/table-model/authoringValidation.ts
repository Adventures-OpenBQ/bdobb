// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { compileAnalyticalModel } from '../../../lib/tableModel/calculate';
import type { DatasetColumn } from '../../../lib/widgetData/types';
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
