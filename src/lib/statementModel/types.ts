// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChecklistConstraint, FiscalBinding, FormulaDef, ModelDiagnostic, PageSelection, ResultFilter, TableModelV1 } from '../tableModel/types';
export type UnpivotSpec = { id: string; carryFieldIds: string[]; mappings: { sourceFieldId: string; lineId: string }[]; itemFieldId: string; valueFieldId: string };
export type LinePolicy = 'single' | 'flow' | 'stock' | 'formula';
/**
 * A statement has three dimensions -- line item, period, company. A layout puts
 * two on the grid; the third is what `page` selects, one member at a time.
 * 'lines-by-period' is the statement as printed and the only one the Statement
 * view draws; 'lines-by-company' is read in the Table view's pivot grid.
 *
 * Line items stay on rows in both: the flow, stock and formula rules evaluate a
 * line across its row, and a layout with lines across calculates nothing. The
 * card's plain Table view of wide rows is already periods down, lines across.
 */
export const STATEMENT_LAYOUTS = ['lines-by-period', 'lines-by-company'] as const;
export type StatementLayout = (typeof STATEMENT_LAYOUTS)[number];
export type StatementTemplate = { schemaVersion: 1; id: string; version: string; sections: { id: string; label: string; lineIds: string[] }[]; lines: { id: string; label: string; required: boolean; policy: LinePolicy; formula?: FormulaDef; format?: string; unit?: string; /** Not on a 1.0.0 snapshot. */ emphasis?: 'subtotal' | 'total' }[] };
export type StatementBindings = { shape: 'wide' | 'long'; companyFieldId: string; periodKindFieldId: string; currencyFieldId?: string; unitFieldId?: string; fiscal: FiscalBinding; mappings: { sourceFieldId: string; lineId: string }[]; longFields?: { itemFieldId: string; valueFieldId: string } };
export type StatementOverrides = { labels: Record<string,string>; sectionOrder?: string[]; lineOrder: Record<string,string[]>; lineSection?: Record<string,string>; hiddenIds: string[]; formulas: FormulaDef[] };
export type StatementIntent = { schemaVersion: 2; kind: 'statement'; template: StatementTemplate; bindings: StatementBindings; overrides: StatementOverrides; periodKind: 'FY' | 'FQ'; page?: PageSelection; /** Absent is 'lines-by-period'. */ layout?: StatementLayout; checklists: ChecklistConstraint[]; resultFilters: ResultFilter[] };
export type EffectiveStatement = { execution: import('../tableModel/executionDescriptor').AnalyticalExecutionDescriptor; sectionField: string; sectionByLine: Record<string,string>; model: TableModelV1; unpivot?: UnpivotSpec; memberOrders: Record<string,string[]>; linePolicies: Record<string,LinePolicy>; templateIdentity: { id:string; version:string }; incomeBindings?: ReturnType<typeof import('./incomeChartProof').proveIncomeBindings> };
export type StatementValidation = { value?: StatementIntent; diagnostics: ModelDiagnostic[] };
/** Reserved semantic slots; compilation remaps these to widget-owned IDs. */
export const statementOwnedIds = (template: Pick<StatementTemplate, 'id' | 'version'>) => {
  const prefix = `statement/${template.id}/${template.version}/`;
  return { prefix, line: (name: string) => `${prefix}line/${name}`, section: (name: string) => `${prefix}section/${name}`, formula: (name: string) => `${prefix}formula/${name}`, item: `${prefix}category/item`, company: `${prefix}category/company`, period: `${prefix}category/period`, value: `${prefix}measure/value` };
};
