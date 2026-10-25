// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { WidgetDataset } from '../widgetData/types';
import { input } from '../tableExecution/fixtures';
import { intent } from './testFixtures';
import { statementOwnedIds } from './types';
export function fixture() {
    const statement = intent();
    const ids = statementOwnedIds(statement.template);
    statement.bindings.mappings = ['revenue', 'cost_of_revenue'].map(sourceFieldId => ({ sourceFieldId, lineId: ids.line(sourceFieldId) }));
    statement.bindings.fiscal = { companyFieldId: 'symbol', dateFieldId: 'date', fiscalYearFieldId: 'year', periodStartFieldId: 'start', periodEndFieldId: 'end', periodKind: 'FY' };
    const values = { symbol: 'ACME', period: 'FY', date: '2025-12-31', year: 2025, start: '2025-01-01', end: '2025-12-31', revenue: 100, cost_of_revenue: 60 };
    const source: WidgetDataset = { ...input, columns: Object.keys(values).map(id => ({ id, label: id })), rows: [{ id: 'a', values }] };
    return { statement, source, ids };
}
