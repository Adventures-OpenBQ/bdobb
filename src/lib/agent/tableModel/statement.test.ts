// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { applyStatementOps } from "./statement";
import { intent } from "../../statementModel/testFixtures";
import type { StatementIntent } from "../../statementModel/types";

const run = (current: StatementIntent | undefined, op: Record<string, unknown>) =>
  applyStatementOps({ table: {}, search: "", ...(current ? { analytical: current } : {}) }, [{ op: op as never, index: 0 }]);

it("applies an installed template with explicit bindings and validates it with the shared validator", () => {
  const fixture = intent("income");
  const r = run(undefined, { op: "statement.apply", template_id: "income", template_version: "1.0.0", bindings: fixture.bindings, period_kind: fixture.periodKind });
  expect(r.errors).toEqual([]);
  expect(r.definition!.analytical as StatementIntent).toMatchObject({ kind: "statement", template: { id: "income", version: "1.0.0" }, bindings: fixture.bindings });
});
it("refuses a template version that is not installed and lists the installed ones", () => {
  const r = run(undefined, { op: "statement.apply", template_id: "income", template_version: "9.9.9", bindings: intent("income").bindings, period_kind: "FY" });
  expect(r.definition).toBeUndefined();
  expect(r.errors[0]).toMatchObject({ code: "validation", alternatives: expect.arrayContaining(["income@1.0.0"]) });
});
it("overrides a label, then resets it, through the shared override rules", () => {
  const current = intent("income");
  const line = current.template.lines[0].id;
  const labelled = run(current, { op: "statement.override", labels: { [line]: "Sales" } });
  expect((labelled.definition!.analytical as StatementIntent).overrides.labels[line]).toBe("Sales");
  const reset = run(labelled.definition!.analytical as StatementIntent, { op: "statement.reset", id: line });
  expect((reset.definition!.analytical as StatementIntent).overrides.labels[line]).toBeUndefined();
});
it("never fabricates a template update: only installed versions are adoptable", () => {
  const r = run(intent("income"), { op: "statement.update_template", template_version: "2.0.0" });
  expect(r.definition).toBeUndefined();
  expect(r.errors[0]).toMatchObject({ code: "validation", alternatives: ["income@1.0.0"] });
});
it("refuses override/reset/update before a template is applied", () => {
  for (const op of [{ op: "statement.override", labels: {} }, { op: "statement.reset" }, { op: "statement.update_template", template_version: "1.0.0" }]) {
    const r = run(undefined, op);
    expect(r.definition).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ code: "validation", message: "apply a Statement template first", operation_index: 0 });
  }
});
it("reports the failing operation index and yields no definition when a later operation is refused", () => {
  const fixture = intent("income");
  const r = applyStatementOps({ table: {}, search: "" }, [
    { op: { op: "statement.apply", template_id: "income", template_version: "1.0.0", bindings: fixture.bindings, period_kind: "FY" } as never, index: 2 },
    { op: { op: "statement.override", labels: { "no/such/line": "x" }, hidden_ids: ["no/such/line"] } as never, index: 5 },
  ]);
  expect(r.definition).toBeUndefined();
  expect(r.errors[0]).toMatchObject({ code: "validation", operation_index: 5 });
});
