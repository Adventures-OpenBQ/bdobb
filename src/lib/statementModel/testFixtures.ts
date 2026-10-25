// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { StatementIntent } from './types';

import { statementTemplate } from './catalog';
export function intent(id: 'income' | 'balance' | 'cashflow' = 'income'): StatementIntent {
  return { schemaVersion: 2, kind: 'statement', template: statementTemplate(id, '1.0.0')!, bindings: { shape: 'wide', companyFieldId: 'symbol', periodKindFieldId: 'period', fiscal: { companyFieldId: 'symbol', dateFieldId: 'date' }, mappings: [] }, overrides: { labels: {}, lineOrder: {}, hiddenIds: [], formulas: [] }, periodKind: 'FY', checklists: [], resultFilters: [] };
}
