// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { StatementIntent } from './statementModel/types';
import type { WidgetDataset } from './widgetData/types';
import { uniqueHeaders } from './transpose';
import { SECTION_COLUMN, ITEM_COLUMN, exportRows, statementRows, type StatementRows, type StatementItem } from './statementRows';
import { isRecord } from './isRecord';
import type { TableSpec } from './types';

/** Presentation evidence only: no formulas, source facts or independently calculated values. */
export type StatementPresentation = {
  schemaVersion: 1;
  sectionCategoryId: string;
  itemCategoryId: string;
  periodCategoryId: string;
  valueMeasureId: string;
  sections: { id: string; label: string; lines: { id: string; label: string }[] }[];
};
const MAX_BYTES = 1024 * 1024;
const text = (raw: unknown): raw is string => typeof raw === 'string' && raw.length > 0 && raw.length <= 4096;
const keys = (raw: Record<string, unknown>, allowed: string[]) => Object.keys(raw).every(key => allowed.includes(key));

export function readStatementPresentation(raw: unknown): StatementPresentation {
  const invalid = () => { throw new Error('Invalid or unsupported Statement presentation metadata'); };
  if (!isRecord(raw) || !keys(raw, ['schemaVersion', 'sectionCategoryId', 'itemCategoryId', 'periodCategoryId', 'valueMeasureId', 'sections'])
      || raw.schemaVersion !== 1 || !text(raw.sectionCategoryId) || !text(raw.itemCategoryId) || !text(raw.periodCategoryId)
      || !text(raw.valueMeasureId) || !Array.isArray(raw.sections) || raw.sections.length > 256) return invalid();
  const ids = new Set<string>(); let count = 0;
  for (const section of raw.sections) {
    if (!isRecord(section) || !keys(section, ['id', 'label', 'lines']) || !text(section.id) || !text(section.label)
        || ids.has(section.id) || !Array.isArray(section.lines)) return invalid();
    ids.add(section.id);
    for (const line of section.lines) {
      if (++count > 4096 || !isRecord(line) || !keys(line, ['id', 'label']) || !text(line.id) || !text(line.label) || ids.has(line.id)) return invalid();
      ids.add(line.id);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(raw)).length > MAX_BYTES) return invalid();
  return raw as StatementPresentation;
}

/** Called only after the producing worker has validated and compiled this intent. */
export function statementPresentation(intent: StatementIntent, layout: { rows: string[]; columns: string[]; values: string[] }): StatementPresentation {
  const sectionOrder = intent.overrides.sectionOrder ?? intent.template.sections.map(section => section.id);
  const sections = [...sectionOrder, ...intent.template.sections.map(section => section.id).filter(id => !sectionOrder.includes(id))].map(id => {
    const section = intent.template.sections.find(section => section.id === id)!;
    const order = intent.overrides.lineOrder[id] ?? section.lineIds;
    return { id, label: intent.overrides.labels[id] ?? section.label, lines: [...order, ...section.lineIds.filter(id => !order.includes(id))].map(id => {
      const line = intent.template.lines.find(line => line.id === id)!;
      return { id, label: intent.overrides.labels[id] ?? line.label };
    }) };
  });
  return readStatementPresentation({ schemaVersion: 1, sectionCategoryId: layout.rows[0], itemCategoryId: layout.rows[1], periodCategoryId: layout.columns[0], valueMeasureId: layout.values[0], sections });
}

/** Project only delivered leaf rows and their authoritative cells; never fill absent template members. */
export function projectStatementDataset(data: WidgetDataset, descriptor: StatementPresentation): StatementRows {
  const columns = data.columns.filter(column => column.measureId === descriptor.valueMeasureId && column.splitPath?.length === 1
    && column.splitPath[0].categoryId === descriptor.periodCategoryId);
  if (!columns.length && data.rows.length) throw new Error('Statement period columns are unavailable in this presentation');
  const headers = uniqueHeaders(columns.map(column => String(column.splitPath![0].value ?? '—')), [SECTION_COLUMN, ITEM_COLUMN]);
  const members = new Map<string, Map<string, StatementItem>>();
  for (const row of data.rows) {
    const path = row.groupPath;
    // Section headings are structural parents, not invented subtotal cells.
    if (path?.length === 1 && path[0].categoryId === descriptor.sectionCategoryId) continue;
    if (!path || path.length !== 2 || path[0].categoryId !== descriptor.sectionCategoryId || path[1].categoryId !== descriptor.itemCategoryId)
      throw new Error('Statement row structure is incompatible with its presentation metadata');
    const section = descriptor.sections.find(section => section.id === path[0].value);
    const line = section?.lines.find(line => line.id === path[1].value);
    if (!section || !line) throw new Error('Statement row is not declared by its presentation metadata');
    const items = members.get(section.id) ?? new Map<string, StatementItem>();
    if (items.has(line.id)) throw new Error('Duplicate Statement line in presented output');
    items.set(line.id, { field: line.id, label: line.label, values: columns.map(column => row.values[column.id]),
      formats: columns.map(column => row.cellFormats?.[column.id] ?? column.format), errors: columns.map(column => row.cellErrors?.[column.id]) });
    members.set(section.id, items);
  }
  const sections = descriptor.sections.flatMap(section => {
    const items = section.lines.flatMap(line => members.get(section.id)?.get(line.id) ?? []);
    return items.length ? [{ id: section.id, name: section.label, items }] : [];
  });
  return { statement: 'template', headers, columns: [SECTION_COLUMN, ITEM_COLUMN, ...headers], sections, rows: exportRows(sections, headers) };
}

/** Ordinary financial rows retain their existing taxonomy and supplied FY/Q/TTM headers. */
export function projectGenericStatementDataset(data: WidgetDataset, spec?: TableSpec): StatementRows | null {
  const result = statementRows(data.rows.map(row => row.values), spec, (index, field) => Object.hasOwn(data.rows[index].cellErrors ?? {}, field));
  if (!result) return null;
  const columns = new Map(data.columns.map(column => [column.id, column]));
  // Per-row cell formats and errors map onto periods only for wide rows (one row
  // per period); long-form rows were widened, and each line keeps item.format.
  const perPeriod = result.headers.length === data.rows.length;
  for (const section of result.sections) for (const item of section.items) {
    item.formats = perPeriod ? data.rows.map(row => row.cellFormats?.[item.field] ?? columns.get(item.field)?.format ?? item.format) : result.headers.map(() => item.format);
    item.errors = perPeriod ? data.rows.map(row => row.cellErrors?.[item.field]) : result.headers.map(() => undefined);
  }
  result.rows = exportRows(result.sections, result.headers);
  return result;
}
