// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { StatementIntent, StatementTemplate, StatementOverrides } from './types';
import { validateStatementIntent } from './validation';
/** Detached canonical intent; compilation output never enters durable data. */
export function statementSnapshot(raw: unknown): StatementIntent {
  const checked = validateStatementIntent(raw);
  if (!checked.value) throw new Error(checked.diagnostics.map(d => `${d.path}: ${d.message}`).join('; '));
  return checked.value;
}
export function validateStatementTemplate(template: StatementTemplate, overrides: StatementOverrides = {labels:{},lineOrder:{},hiddenIds:[],formulas:[]}): StatementTemplate {
  return statementSnapshot({schemaVersion:2,kind:'statement',template,overrides,bindings:{shape:'wide',companyFieldId:'company',periodKindFieldId:'kind',fiscal:{companyFieldId:'company',dateFieldId:'date'},mappings:[]},periodKind:'FY',checklists:[],resultFilters:[]}).template;
}
