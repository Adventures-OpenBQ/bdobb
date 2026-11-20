// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from '../../isRecord';
import { INCOME_CHART_PROOF, incomeStatementIds, type IncomeChartProof } from '../../statementModel/incomeChartProof';
import { projectStatementDataset, readStatementPresentation } from '../../statementPresentation';
import type { WidgetDataset } from '../types';
import { isIncomePeriodColumn, savedBindingIssue } from './bindings';
import { incomeEvidenceFields, isoDate, readFinancialEvidence, type IncomeEvidenceField, type IncomeFinancialEvidence } from './financialEvidence';
import { decodeRecipeOptions } from './settings';
import type { RecipeOptions, RecipeRefusal } from './types';

const anchorLabels = {
  revenue: 'Revenue', gross_profit: 'Gross profit', operating_income: 'Operating income',
  income_before_tax: 'Income before tax', net_income: 'Net income',
} as const;
const componentLabels = { cost_of_revenue: 'Cost of revenue', income_tax_expense: 'Income tax expense' } as const;
export type IncomeAnchor = keyof typeof anchorLabels;
export type IncomeComponent = keyof typeof componentLabels;

export type IncomeLineOrigin =
  | { kind: 'reported'; lineId: string; field: IncomeEvidenceField; providerField: string }
  | { kind: 'calculated'; lineId: string; formulaId: string; inputs: readonly ['revenue', 'cost_of_revenue'] };
export type IncomeLineValue = { value: number; origin: IncomeLineOrigin };
export type IncomeSankeyPeriod = { columnId: string; end: string; kind: 'FY' | 'FQ'; fiscalYear: number | null; fiscalPeriod: string | null };
export type IncomeSankeyInput = {
  ok: true;
  issuer: string;
  currency: string;
  scale: Extract<IncomeFinancialEvidence['scale'], { status: 'verified' }>;
  period: IncomeSankeyPeriod;
  anchors: Record<IncomeAnchor, IncomeLineValue>;
  components: Partial<Record<IncomeComponent, IncomeLineValue>>;
  notes: string[];
  evidence: IncomeFinancialEvidence;
  revision: string;
};

const refuse = (message: string): RecipeRefusal => ({ ok: false, refused: true, message });

function readProof(dataset: WidgetDataset, evidence: IncomeFinancialEvidence): IncomeChartProof | undefined {
  const raw = dataset.provenance.metadata?.[INCOME_CHART_PROOF];
  if (!isRecord(raw) || raw.version !== 1 || raw.issuer !== evidence.qualified_symbol || raw.periodKind !== evidence.period_kind
    || typeof raw.calculatedGrossProfit !== 'boolean' || !Array.isArray(raw.reportedFields) || !Array.isArray(raw.periods)
    || !raw.reportedFields.every(field => incomeEvidenceFields.some(canonical => canonical === field))
    || !raw.periods.every(period => isRecord(period) && typeof period.columnId === 'string' && isoDate(period.periodEnd))) return undefined;
  const periods = raw.periods as IncomeChartProof['periods'];
  if (new Set(periods.map(period => period.columnId)).size !== periods.length
    || new Set(periods.map(period => period.periodEnd)).size !== periods.length) return undefined;
  return raw as IncomeChartProof;
}

function periodChoices(dataset: WidgetDataset, evidence: IncomeFinancialEvidence, proof: IncomeChartProof): IncomeSankeyPeriod[] {
  const acquired = new Map(evidence.periods.map(period => [period.period_end, period]));
  const periods = new Map(proof.periods.map(period => [period.columnId, period.periodEnd]));
  return dataset.columns.flatMap(column => {
    const period = acquired.get(periods.get(column.id) ?? '');
    if (!period || !isIncomePeriodColumn(column) || column.splitPath?.[0].transform !== evidence.period_kind) return [];
    return [{ columnId: column.id, end: period.period_end, kind: period.period_kind, fiscalYear: period.fiscal_year, fiscalPeriod: period.fiscal_period }];
  }).sort((left, right) => right.end.localeCompare(left.end));
}

/** Newest first, ordered by acquired report dates rather than the display's fiscal labels. */
export function incomeSankeyPeriodChoices(dataset: WidgetDataset): IncomeSankeyPeriod[] {
  const evidence = readFinancialEvidence(dataset.provenance);
  if (evidence?.kind !== 'income') return [];
  const proof = readProof(dataset, evidence);
  return proof ? periodChoices(dataset, evidence, proof) : [];
}

export function resolveIncomeSankeyInput(
  dataset: WidgetDataset,
  options: Extract<RecipeOptions, { kind: 'income-sankey' }>,
): IncomeSankeyInput | RecipeRefusal {
  const decoded = decodeRecipeOptions(options, 'income-sankey');
  if (!decoded.ok) return refuse(decoded.message);
  const issue = savedBindingIssue(options, dataset.columns);
  if (issue) return refuse(issue);
  const evidence = readFinancialEvidence(dataset.provenance);
  if (evidence?.kind !== 'income') return refuse('Acquire the income statement with verified source evidence.');
  if (evidence.unsafe.invalid_period_identity) return refuse('The income acquisition contains invalid period identities.');
  if (evidence.scale.status !== 'verified' || evidence.unsafe.scale_conflict) return refuse('Verify one monetary scale for the acquired income statement.');
  if (!evidence.reporting_currency) return refuse('Verify the income statement reporting currency.');

  const proof = readProof(dataset, evidence);
  if (!proof) return refuse('Use a compiler-validated income statement with canonical source fields.');
  const period = periodChoices(dataset, evidence, proof).find(choice => choice.columnId === options.periodColumn);
  if (!period) return refuse('Select a fiscal period column backed by one actual acquired report date.');
  const acquired = evidence.periods.find(report => report.period_end === period.end)!;
  if (acquired.record_coverage !== 'full-record') return refuse('Acquire a complete income statement record for the selected period.');
  if (acquired.currency_conflict || acquired.scale_conflict || acquired.identity_conflict || acquired.field_origin_conflict)
    return refuse('The selected income statement period has conflicting currency, scale, identity or field origins.');

  const { item, period: periodId, value, line, formula } = incomeStatementIds;
  let presented;
  try {
    const descriptor = readStatementPresentation(dataset.provenance.metadata?.statementPresentation);
    if (descriptor.itemCategoryId !== item || descriptor.periodCategoryId !== periodId || descriptor.valueMeasureId !== value)
      return refuse('Use a compiler-validated income statement presentation.');
    presented = projectStatementDataset({ ...dataset, columns: dataset.columns.filter(column => column.id === options.periodColumn) }, descriptor);
  } catch {
    return refuse('Reload the income statement to restore valid presented line origins.');
  }

  const lines = new Map(presented.sections.flatMap(section => section.items.map(item => [item.field, item] as const)));
  const fields = new Set(acquired.present_fields);
  const supported = new Set(proof.reportedFields);
  const presentedValue = (id: string) => {
    const entry = lines.get(id);
    const value = entry?.values[0];
    return !entry?.errors?.[0] && typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  const reported = (field: IncomeEvidenceField): IncomeLineValue | undefined => {
    const lineId = line(field);
    const value = presentedValue(lineId);
    return supported.has(field) && fields.has(field) && value !== undefined
      ? { value, origin: { kind: 'reported', lineId, field, providerField: evidence.field_origins[field] } }
      : undefined;
  };

  const revenue = reported('revenue');
  const operating_income = reported('operating_income');
  const income_before_tax = reported('income_before_tax');
  const net_income = reported('net_income');
  const cost_of_revenue = reported('cost_of_revenue');
  const income_tax_expense = reported('income_tax_expense');
  let gross_profit = reported('gross_profit');

  if (!fields.has('gross_profit') && proof.calculatedGrossProfit && revenue && cost_of_revenue) {
    const lineId = line('calculated_gross_profit');
    const value = presentedValue(lineId);
    if (value !== undefined && value === revenue.value - cost_of_revenue.value) gross_profit = {
      value, origin: { kind: 'calculated', lineId, formulaId: formula('calculated_gross_profit'), inputs: ['revenue', 'cost_of_revenue'] },
    };
  }

  const anchors = { revenue, gross_profit, operating_income, income_before_tax, net_income };
  for (const [field, anchor] of Object.entries(anchors)) {
    const label = anchorLabels[field as IncomeAnchor];
    if (!anchor) return refuse(`Present a finite, source-verified ${label} anchor for the selected period.`);
    if (field === 'revenue' ? anchor.value <= 0 : anchor.value < 0)
      return refuse(`Income Sankey requires positive revenue and nonnegative profits. The selected period has unsupported ${label}.`);
  }

  const components = { ...(cost_of_revenue ? { cost_of_revenue } : {}), ...(income_tax_expense ? { income_tax_expense } : {}) };
  const notes = (Object.keys(componentLabels) as IncomeComponent[]).flatMap(field => components[field]
    ? [] : [`${componentLabels[field]} is unavailable in the presented period. Reconciliation includes lines not shown.`]);
  const issuer = evidence.qualified_symbol, currency = evidence.reporting_currency, scale = evidence.scale;
  return { ok: true, issuer, currency, scale, period, anchors: anchors as IncomeSankeyInput['anchors'], components, notes, evidence,
    revision: JSON.stringify([dataset.provenance.sourceWidgetId, options.kind, options.version, options.periodColumn,
      issuer, period.kind, period.end, currency, scale.multiplier]) };
}
