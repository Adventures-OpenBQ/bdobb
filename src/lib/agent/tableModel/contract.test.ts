// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { ARRANGE_LIMITS, parseArrangement } from "./contract";

const env = (operations: unknown[]) => ({ contract: "table-model/1", operations });

describe("parseArrangement", () => {
  it("accepts a layout that references an alias declared earlier in the same arrangement", () => {
    const { arrangement, errors } = parseArrangement(env([
      { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
      { op: "layout.set", values: [{ alias: "rev" }] },
    ]));
    expect(errors).toEqual([]);
    expect(arrangement?.operations).toHaveLength(2);
  });
  it("refuses another contract version", () => {
    expect(parseArrangement({ contract: "table-model/2", operations: [] }).errors[0]).toMatchObject({ code: "invalid-envelope" });
  });
  it("reports every independent structural problem together, with operation index and path", () => {
    const { arrangement, errors } = parseArrangement(env([
      { op: "measure.explode" },
      { op: "measure.add", source_field_id: 7 },
      { op: "measure.add", source_field_id: "a", aggregation: "average" },
      { op: "measure.add", source_field_id: "a", colour: "red" },
    ]));
    expect(arrangement).toBeUndefined();
    expect(errors.map(e => [e.code, e.operation_index, e.path])).toEqual([
      ["unknown-operation", 0, "operations[0].op"],
      ["invalid-field", 1, "operations[1].source_field_id"],
      ["invalid-field", 2, "operations[2].aggregation"],
      ["invalid-field", 3, "operations[3].colour"],
    ]);
    expect(errors[2].alternatives).toContain("sum");
  });
  it("refuses duplicate aliases and references to an alias not yet declared", () => {
    const { errors } = parseArrangement(env([
      { op: "layout.set", values: [{ alias: "later" }] },
      { op: "measure.add", alias: "later", source_field_id: "a" },
      { op: "measure.add", alias: "later", source_field_id: "b" },
    ]));
    expect(errors.map(e => e.code)).toEqual(["unknown-reference", "duplicate-alias"]);
  });
  it("bounds the request", () => {
    const many = Array.from({ length: ARRANGE_LIMITS.operations + 1 }, () => ({ op: "page.clear" }));
    expect(parseArrangement(env(many)).errors[0]).toMatchObject({ code: "invalid-envelope" });
    expect(parseArrangement(env([{ op: "category.add", name: "x".repeat(5000), source_field_id: "a", transform: "native" }])).errors[0]).toMatchObject({ code: "invalid-field" });
  });
  it("refuses source retargeting and arbitrary persistence fields", () => {
    const { errors } = parseArrangement({ ...env([]), source: "other", widgetId: "x" });
    expect(errors.map(e => e.path)).toEqual(["source", "widgetId"]);
  });
  it("treats inherited and __proto__ keys as unknown fields, not crashes", () => {
    for (const key of ["constructor", "toString"]) {
      expect(parseArrangement(env([{ op: "page.clear", [key]: 1 }])).errors).toMatchObject([{ code: "invalid-field", path: `operations[0].${key}` }]);
    }
    const proto = JSON.parse('{"contract":"table-model/1","operations":[{"op":"page.clear","__proto__":1}]}');
    expect(parseArrangement(proto).errors).toMatchObject([{ code: "invalid-field", path: "operations[0].__proto__" }]);
  });
  it("checks alias references inside formula bindings and members, pointing at the holding field", () => {
    const formula = { op: "formula.set", target: { id: "f1" }, name: "n", scope: "source", expression: "x", bindings: { x: { ref: { alias: "m" } } }, members: [{ category: { alias: "c" } }] };
    expect(parseArrangement(env([formula])).errors.map(e => [e.code, e.path])).toEqual([
      ["unknown-reference", "operations[0].bindings.x.ref"],
      ["unknown-reference", "operations[0].members[0].category"],
    ]);
    expect(parseArrangement(env([
      { op: "measure.add", alias: "m", source_field_id: "a" },
      { op: "category.add", alias: "c", name: "c", source_field_id: "d", transform: "native" },
      formula,
    ])).errors).toEqual([]);
    expect(parseArrangement(env([{ op: "layout.set", rows: [{ alias: "z" }] }])).errors[0]).toMatchObject({ path: "operations[0].rows[0]" });
  });
  it("rejects empty strings and lists enum alternatives for any operation", () => {
    expect(parseArrangement(env([{ op: "measure.add", source_field_id: "a", label: "" }])).errors[0]).toMatchObject({ code: "invalid-field", path: "operations[0].label" });
    expect(parseArrangement(env([{ op: "category.add", name: "n", source_field_id: "a", transform: "bogus" }])).errors[0].alternatives).toEqual(["native", "Y", "Q", "M", "FY", "FQ"]);
  });
  it("says what shape a reference field takes when it gets bare ids (live Rita looped on 'invalid rows')", () => {
    const e = parseArrangement(env([{ op: "layout.set", rows: ["abc"], values: [{ id: "m" }] }])).errors;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ code: "invalid-field", path: "operations[0].rows" });
    expect(e[0].message).toContain('{"id":"..."}');
    expect(e[0].message).toContain('{"alias":"..."}');
    expect(parseArrangement(env([{ op: "page.set", category: "c", member_keys: ["a"] }])).errors[0].message).toContain('{"id":"..."}');
  });
});
