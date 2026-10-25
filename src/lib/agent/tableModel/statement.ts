// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { INSTALLED_STATEMENT_TEMPLATES, statementTemplate } from "../../statementModel/catalog";
import { resetStatementOverrides } from "../../statementModel/overrides";
import { previewStatementUpdate, type StatementUpdateConflict } from "../../statementModel/updates";
import { validateStatementIntent } from "../../statementModel/validation";
import type { StatementBindings, StatementIntent } from "../../statementModel/types";
import type { TableDefinition } from "../../tableExecution/types";
import { OpError, TEMPLATES, toArrangeError, type ArrangeError, type Operation } from "./contract";
import { isStatement } from "./describe";

type Result = { definition?: TableDefinition; errors: ArrangeError[]; conflicts?: StatementUpdateConflict[] };

const installed = (id: string) => INSTALLED_STATEMENT_TEMPLATES.filter(t => t.id === id).map(t => `${t.id}@${t.version}`);
const checked = (candidate: unknown): StatementIntent => {
  const v = validateStatementIntent(candidate);
  const e = v.diagnostics.find(d => d.severity === "error");
  if (e || !v.value) throw new OpError({ code: "validation", message: e?.message ?? "invalid Statement", ...(e?.path ? { path: e.path } : {}) });
  return v.value;
};
const template = (id: string, version: string) => {
  const t = statementTemplate(id as (typeof TEMPLATES)[number], version);
  if (!t) throw new OpError({ code: "validation", message: `template ${id}@${version} is not installed`, alternatives: installed(id) });
  return t;
};

function step(current: StatementIntent | undefined, op: Operation): StatementIntent {
  if (op.op === "statement.apply") {
    return checked({
      schemaVersion: 2, kind: "statement", template: template(op.template_id as string, op.template_version as string), bindings: op.bindings as StatementBindings,
      overrides: { labels: {}, lineOrder: {}, hiddenIds: [], formulas: [] }, periodKind: op.period_kind, checklists: [], resultFilters: [],
    });
  }
  if (!current) throw new OpError({ code: "validation", message: "apply a Statement template first" });
  if (op.op === "statement.override") {
    const next = structuredClone(current);
    Object.assign(next.overrides.labels, op.labels);
    Object.assign(next.overrides.lineOrder, op.line_order);
    if (op.section_order !== undefined) next.overrides.sectionOrder = op.section_order as string[];
    if (op.hidden_ids !== undefined) next.overrides.hiddenIds = op.hidden_ids as string[];
    return checked(next);
  }
  if (op.op === "statement.reset") return checked(resetStatementOverrides(current, op.id as string | undefined));
  if (op.op === "statement.update_template") {
    const next = template(current.template.id, op.template_version as string);
    const { next: updated, conflicts } = previewStatementUpdate(current, next);
    if (conflicts.length) throw new OpError({ code: "validation", message: "template update has conflicts" }, conflicts);
    return checked(updated);
  }
  throw new OpError({ code: "validation", message: `${op.op} is not a Statement operation` });
}

/** Applies statement.* operations in order to a detached copy; the first refusal yields no definition. */
export function applyStatementOps(current: TableDefinition, ops: { op: Operation; index: number }[]): Result {
  const definition: TableDefinition = structuredClone(current);
  let intent = isStatement(definition.analytical) ? definition.analytical : undefined;
  for (const { op, index } of ops) {
    try { intent = step(intent, op); }
    catch (error) {
      if (!(error instanceof OpError)) throw error;
      return { errors: [toArrangeError(error, index)], ...(error.conflicts ? { conflicts: error.conflicts } : {}) };
    }
  }
  if (intent) definition.analytical = intent;
  return { definition, errors: [] };
}
