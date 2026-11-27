// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../isRecord';
import type { EligiblePool } from '../tableModel/facets';
import {
  acquiredColumnOrigin, incomeEvidenceFields, isoDate, readFinancialEvidence, type IncomeEvidenceField,
} from '../widgetData/chartRecipes/financialEvidence';
import { read } from '../widgetData/chartRecipes/estimateEvidence';
import type { DatasetColumn, DatasetProvenance, WidgetDataset } from '../widgetData/types';
import { statementTemplate } from './catalog';
import { statementOwnedIds, type StatementIntent } from './types';

export const INCOME_CHART_PROOF = 'incomeChartProof';
const template = { id: 'income', version: '1.0.0' } as const;
export const incomeStatementIds = statementOwnedIds(template);

type IncomeBindingsProof = { reportedFields: IncomeEvidenceField[]; calculatedGrossProfit: boolean };
/** A table that computes new values must establish its own statement proof. */
export function withoutIncomeChartProof(provenance: DatasetProvenance): DatasetProvenance {
  if (!provenance.metadata || !Object.hasOwn(provenance.metadata, INCOME_CHART_PROOF)) return provenance;
  const { [INCOME_CHART_PROOF]: _proof, ...metadata } = provenance.metadata;
  return { ...provenance, metadata };
}

export type IncomeChartProof = IncomeBindingsProof & {
  version: 1;
  issuer: string;
  periodKind: 'FY' | 'FQ';
  periods: { columnId: string; periodEnd: string }[];
};

function canonicalFormula(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => isRecord(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

/** Attest line bindings after validation. Labels and section placement do not participate. */
export function proveIncomeBindings(intent: StatementIntent, columns: readonly DatasetColumn[]): IncomeBindingsProof | undefined {
  const { bindings } = intent;
  const origin = (id: string | undefined) => acquiredColumnOrigin(columns.find(column => column.id === id));
  if (intent.template.id !== template.id || intent.template.version !== template.version || bindings.shape !== 'wide'
    || origin(bindings.fiscal.dateFieldId) !== 'period_ending' || !origin(bindings.companyFieldId)
    || bindings.companyFieldId !== bindings.fiscal.companyFieldId) return undefined;

  const { line, formula } = incomeStatementIds;
  const reportedFields = incomeEvidenceFields.filter(field => {
    const slot = intent.template.lines.find(item => item.id === line(field));
    const mapping = bindings.mappings.find(item => item.lineId === line(field));
    return slot?.policy === 'flow' && slot.unit === 'currency' && !slot.formula && origin(mapping?.sourceFieldId) === field;
  });
  const calculated = intent.template.lines.find(item => item.id === line('calculated_gross_profit'));
  const installed = statementTemplate(template.id, template.version)?.lines.find(item => item.id === calculated?.id)?.formula;
  const override = intent.overrides.formulas.find(item => item.id === formula('calculated_gross_profit'));
  const calculatedGrossProfit = !!installed && calculated?.policy === 'formula' && calculated.unit === 'currency'
    && canonicalFormula(calculated.formula) === canonicalFormula(installed)
    && (!override || canonicalFormula(override) === canonicalFormula(installed));
  return { reportedFields, calculatedGrossProfit };
}

/** Associate compiled members with actual source report dates before result projection. */
export function incomeChartProof(
  input: WidgetDataset, intent: StatementIntent, bindings: IncomeBindingsProof, pool: EligiblePool, columns: DatasetColumn[],
): IncomeChartProof | undefined {
  const evidence = readFinancialEvidence(input.provenance);
  if (evidence?.kind !== 'income' || evidence.period_kind !== intent.periodKind || input.provenance.inputMayContainAggregates) return undefined;
  const knownDates = new Set(evidence.periods.map(period => period.period_end));
  const dates = new Set<string>();
  const { dateFieldId } = intent.bindings.fiscal;
  for (const row of input.rows) {
    const date = read(row, dateFieldId);
    if (read(row, intent.bindings.companyFieldId) !== evidence.qualified_symbol
      || read(row, intent.bindings.periodKindFieldId) !== evidence.period_kind
      || !isoDate(date) || !knownDates.has(date) || dates.has(date)) return undefined;
    dates.add(date);
  }

  const { period, value } = incomeStatementIds;
  const actualEnds = new Map<string, string | null>();
  for (const row of pool.universe.rows) {
    const member = pool.universe.members.get(row.id)?.get(period);
    const date = read(row, dateFieldId);
    if (!member?.ok || !isoDate(date)) continue;
    const old = actualEnds.get(member.value.key);
    actualEnds.set(member.value.key, old === undefined || old === date ? date : null);
  }
  const periods = columns.flatMap(column => {
    const member = column.splitPath?.[0];
    if (column.measureId !== value || column.splitPath?.length !== 1 || member?.categoryId !== period || !member.memberKey) return [];
    const periodEnd = actualEnds.get(member.memberKey);
    return periodEnd ? [{ columnId: column.id, periodEnd }] : [];
  });
  return { version: 1, issuer: evidence.qualified_symbol, periodKind: evidence.period_kind, ...bindings, periods };
}
