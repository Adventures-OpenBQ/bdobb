// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { groupIdentity, identifyRows } from "./identity";

describe("dataset row identities", () => {
  it("keeps unique typed provider keys stable across reorder and content changes", () => {
    const rows = [{ key: 1, label: "same" }, { key: "1", label: "same" }];
    const first = identifyRows(rows, ["key"]);
    const next = identifyRows([{ key: "1", label: "changed" }, rows[0]], ["key"]);
    expect(first[0].id).not.toBe(first[1].id);
    expect(next.map(r => r.id)).toEqual([first[1].id, first[0].id]);
  });
  it("falls back to content when keys duplicate or are missing", () => {
    const rows = [{ key: 1, value: "a" }, { key: 1, value: "b" }];
    expect(identifyRows(rows, ["key"]).map(r => r.id)).toEqual(identifyRows(rows).map(r => r.id));
    expect(identifyRows(rows, ["absent"]).map(r => r.id)).toEqual(identifyRows(rows).map(r => r.id));
  });
  it("uses content identities independent of property order and changes identity with content", () => {
    const first = identifyRows([{ a: 1, b: "x" }])[0].id;
    expect(identifyRows([{ b: "x", a: 1 }])[0].id).toBe(first);
    expect(identifyRows([{ a: "1", b: "x" }])[0].id).not.toBe(first);
  });
  it("assigns distinct occurrence IDs to identical duplicate rows", () => {
    const rows = identifyRows([{ a: 1 }, { a: 1 }]);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(identifyRows([{ a: 1 }, { a: 1 }]).map(r => r.id)).toEqual(rows.map(r => r.id));
  });
  it("reads literal dotted and __proto__ keys and preserves raw missing values", () => {
    const row = JSON.parse('{"a.b":1,"__proto__":"own","value":null}');
    const other = { "a.b": 2, ["__proto__"]: "other", value: undefined };
    const result = identifyRows([row, other], ["a.b", "__proto__"]);
    expect(result[0].id).not.toBe(result[1].id);
    expect(result[0].values["__proto__"]).toBe("own");
    expect(result[0].values.value).toBeNull();
    expect(result[1].values.value).toBeUndefined();
    expect(identifyRows([{}, { ["__proto__"]: "own" }], ["__proto__"]).map(r => r.id))
      .toEqual(identifyRows([{}, { ["__proto__"]: "own" }]).map(r => r.id));
  });
  it("distinguishes absent, undefined, null, nested typed values and nonfinite numbers", () => {
    const rows = [{}, { v: undefined }, { v: null }, { v: NaN }, { v: Infinity },
      { v: -Infinity }, { v: -0 }, { v: 0 }, { v: [1] }, { v: ["1"] }];
    expect(new Set(identifyRows(rows).map(r => r.id)).size).toBe(rows.length);
  });
});

it("names group identities by encoded typed path and grouping definition including buckets", () => {
  const id = groupIdentity('["number",1]', 'date:month');
  expect(groupIdentity('["string","1"]', 'date:month')).not.toBe(id);
  expect(groupIdentity('["number",1]', 'date:year')).not.toBe(id);
  expect(groupIdentity('["number",1]', 'other:month')).not.toBe(id);
  expect(groupIdentity('a|b', 'c')).not.toBe(groupIdentity('a', 'b|c'));
});
