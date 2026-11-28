// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { pivotValueKey } from '../pivotKeys';
import { IDENTITY_FIELDS, detectStatement } from '../statementTaxonomy';
import type { Row } from '../tableColumns';
import { CURRENT_STATEMENT_TEMPLATE_VERSION, statementTemplate } from './catalog';
import { statementOwnedIds, type StatementIntent } from './types';

/**
 * A Statement template proposed for a statement card's rows, so nobody maps a
 * hundred lines by hand. It reads the rows a bound card is given
 * (statementFiscal.ts: each carries its company, FY or FQ, a fiscal year and
 * the period's two dates) and binds:
 *
 *   - the current template for the statement the columns are;
 *   - company, period kind, report date and the explicit fiscal fields;
 *   - one mapping per column whose name IS a template line's field. Exact
 *     names only: nothing is matched by resemblance.
 *
 * Numeric columns it could not map come back as `unmapped`, for the panel to
 * show. The proposal is a draft: the panel previews it and the user saves.
 */
export type StatementProposal = { intent: StatementIntent; unmapped: string[] };
export type StatementRefusal = { reason: string };

/** What a bound card's rows carry beyond what the provider sent. */
const BOUND_FIELDS = ['symbol', 'period_kind', 'fiscal_year', 'period_start', 'period_end'] as const;

export function proposeStatement(columns: readonly { id: string }[], rows: readonly Row[]): StatementProposal | StatementRefusal {
  const ids = columns.map((c) => c.id);
  const has = new Set(ids);
  const detected = detectStatement(has);
  if (detected === null) return { reason: 'These rows are not an income statement, a balance sheet or a cash flow statement.' };
  const date = has.has('period_ending') ? 'period_ending' : has.has('date') ? 'date' : undefined;
  const missing = BOUND_FIELDS.filter((f) => !has.has(f));
  if (missing.length > 0 || date === undefined) {
    return { reason: 'The rows carry no fiscal year to bind. A statement whose fiscal labels are as reported cannot take a template.' };
  }
  const kinds = new Set(rows.map((r) => r.period_kind));
  const periodKind = kinds.size === 1 && kinds.has('FY') ? 'FY' : kinds.size === 1 && kinds.has('FQ') ? 'FQ' : undefined;
  if (periodKind === undefined) return { reason: 'A Statement takes rows of one period kind, annual or quarterly.' };

  const template = statementTemplate(detected === 'cash' ? 'cashflow' : detected, CURRENT_STATEMENT_TEMPLATE_VERSION)!;
  const owned = statementOwnedIds(template);
  const lines = new Set(template.lines.filter((l) => l.policy !== 'formula').map((l) => l.id));
  const mappings = ids.filter((f) => lines.has(owned.line(f))).map((f) => ({ sourceFieldId: f, lineId: owned.line(f) }));
  if (mappings.length === 0) return { reason: 'No column is a line of this statement.' };

  const mapped = new Set(mappings.map((m) => m.sourceFieldId));
  const identity = new Set<string>([...IDENTITY_FIELDS, ...BOUND_FIELDS]);
  const unmapped = ids.filter((f) => !mapped.has(f) && !identity.has(f) && rows.some((r) => typeof r[f] === 'number'));

  // A formula line whose inputs are not among the mapped columns would show an error in every period.
  const mappedLines = new Set(mappings.map((m) => m.lineId));
  const inputs = (line: (typeof template.lines)[number]) => [...JSON.stringify(line.formula?.ast ?? null).matchAll(/"memberKey":"([^"]+)"/g)].map((m) => m[1]);
  const hiddenIds = template.lines.filter((l) => l.policy === 'formula' && inputs(l).some((id) => !mappedLines.has(id))).map((l) => l.id);

  const companies = [...new Set(rows.flatMap((r) => (typeof r.symbol === 'string' && r.symbol !== '' ? [r.symbol] : [])))];
  const intent: StatementIntent = {
    schemaVersion: 2, kind: 'statement', template,
    bindings: {
      shape: 'wide', companyFieldId: 'symbol', periodKindFieldId: 'period_kind',
      ...(has.has('reported_currency') ? { currencyFieldId: 'reported_currency' } : {}),
      fiscal: {
        companyFieldId: 'symbol', dateFieldId: date, periodKind,
        fiscalYearFieldId: 'fiscal_year', periodStartFieldId: 'period_start', periodEndFieldId: 'period_end',
        ...(periodKind === 'FQ' ? { fiscalQuarterFieldId: 'fiscal_period' } : {}),
      },
      mappings,
    },
    overrides: { labels: {}, lineOrder: {}, hiddenIds, formulas: [] },
    periodKind,
    // Several companies: one at a time, the first to start with. The engine will not add them together.
    ...(companies.length > 1 ? { page: { categoryId: owned.company, memberKeys: [pivotValueKey(companies[0])] } } : {}),
    checklists: [], resultFilters: [],
  };
  return { intent, unmapped };
}
