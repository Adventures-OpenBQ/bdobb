// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  BLANK_LABEL,
  KEY_SEP,
  LABEL_FIELD,
  aggregate,
  pivotTable,
  type FieldKind,
  type PivotInput,
} from "./pivotTable";
import { tableColumns, type Row } from "./tableColumns";
import type { PivotConfig } from "./types";
import { pivotValueKey } from "./pivotKeys";

it("keeps numeric, text, and separator-bearing groups and folds independent", () => {
  const rows: Row[] = [{ g: 1, v: 2 }, { g: "1", v: 3 }, { g: "a\u001fb", v: 5 }];
  const columns = tableColumns(rows, undefined);
  const result = pivotTable({ rows, columns, kinds: new Map([["g", "text"], ["v", "number"]]),
    order: ["g", "v"], config: { enabled: true, grouping: ["g"], split: [], aggregationFns: { v: "sum" },
      keyEncoding: "typed-v1", expanded: { [pivotValueKey(1)]: false } }, sorting: [] });
  if (!result || !result.ok) throw new Error("expected pivot result");
  const groups = result.meta.flatMap((meta, index) => meta.kind === "group" ? [{ meta, value: result.rows[index].v }] : []);
  expect(groups.map(({ meta, value }) => [meta.path, value, meta.open])).toEqual([
    [pivotValueKey(1), 2, false], [pivotValueKey("1"), 3, true], [pivotValueKey("a\u001fb"), 5, true],
  ]);
});

it("never applies a legacy fold whose raw spelling resembles a typed key", () => {
  const value = pivotValueKey("A");
  const rows = [{ g: value, v: 2 }, { g: "A", v: 3 }];
  const columns = tableColumns(rows, undefined);
  const result = pivotTable({ rows, columns, kinds: new Map([["g", "text"], ["v", "number"]]),
    order: ["g", "v"], config: { enabled: true, grouping: ["g"], split: [], expanded: { [value]: false } }, sorting: [] });
  if (!result || !result.ok) throw new Error("expected pivot result");
  expect(result.meta.filter((m) => m.kind === "group").every((m) => m.open)).toBe(true);
});

it("keeps typed and separator-bearing split columns independent", () => {
  const rows: Row[] = [{ g: 1, v: 2 }, { g: "1", v: 3 }, { g: "a\u001fb", v: 5 }];
  const columns = tableColumns(rows, undefined);
  const result = pivotTable({ rows, columns, kinds: new Map([["g", "text"], ["v", "number"]]),
    order: ["g", "v"], config: { enabled: true, grouping: [], split: ["g"], aggregationFns: { v: "sum" } }, sorting: [] });
  if (!result || !result.ok) throw new Error("expected pivot result");
  expect(result.rows[0][`${pivotValueKey(1)}${KEY_SEP}v`]).toBe(2);
  expect(result.rows[0][`${pivotValueKey("1")}${KEY_SEP}v`]).toBe(3);
  expect(result.rows[0][`${pivotValueKey("a\u001fb")}${KEY_SEP}v`]).toBe(5);
  expect(new Set(result.columns.map((column) => column.field)).size).toBe(result.columns.length);
});

const ROWS: Row[] = [
  { sector: "Tech", symbol: "AAPL", date: "2024-01-31", revenue: 10, note: "a" },
  { sector: "Tech", symbol: "AAPL", date: "2024-02-29", revenue: 20, note: null },
  { sector: "Tech", symbol: "MSFT", date: "2024-01-31", revenue: 5, note: "b" },
  { sector: "Energy", symbol: "XOM", date: "2024-01-31", revenue: 7, note: "c" },
  { sector: "Energy", symbol: "XOM", date: "2024-04-30", revenue: null, note: "d" },
  { sector: null, symbol: "ZZZ", date: "2024-03-31", revenue: 1, note: "e" },
];
const KINDS = new Map<string, FieldKind>([
  ["sector", "text"],
  ["symbol", "text"],
  ["date", "date"],
  ["revenue", "number"],
  ["note", "text"],
]);

function run(config: Partial<PivotConfig>, over: Partial<PivotInput> = {}) {
  const columns = tableColumns(ROWS, undefined);
  return pivotTable({
    rows: ROWS,
    columns,
    kinds: KINDS,
    order: columns.map((c) => c.field),
    config: { enabled: true, grouping: [], split: [], ...config },
    sorting: [],
    ...over,
  });
}
function ok(config: Partial<PivotConfig>, over: Partial<PivotInput> = {}) {
  const result = run(config, over);
  if (!result || !result.ok) throw new Error(`expected a pivot, got ${JSON.stringify(result)}`);
  return result;
}
const labels = (r: ReturnType<typeof ok>) =>
  r.meta.map((m) => (m.kind === "leaf" ? "·" : `${"  ".repeat(m.depth)}${m.label}`));

describe("not pivoting", () => {
  it("returns null when disabled, when both lists are empty, or when every field is stale", () => {
    expect(run({ enabled: false, grouping: ["sector"] })).toBeNull();
    expect(run({})).toBeNull();
    expect(run({ grouping: ["gone"] })).toBeNull();
  });
});

describe("Row Groups only", () => {
  it("nests the REAL rows under their groups, keys ascending, blank last", () => {
    const r = ok({ grouping: ["sector"] });
    expect(labels(r)).toEqual(["Energy", "·", "·", "Tech", "·", "·", "·", BLANK_LABEL, "·"]);
    // Leaf rows are the original objects, so cell-click linking still works.
    expect(r.rows[1]).toBe(ROWS[3]);
    expect(r.meta[0]).toMatchObject({ kind: "group", depth: 0, path: pivotValueKey("Energy"), count: 2, expandable: true, open: true });
    expect(r.meta[1]).toEqual({ kind: "leaf", depth: 1 });
  });

  it("keeps the source columns, behind a pinned label column", () => {
    const r = ok({ grouping: ["sector"] });
    expect(r.columns.map((c) => c.field)).toEqual([LABEL_FIELD, "symbol", "date", "revenue", "note"]);
    expect(r.columns[0]).toMatchObject({ header: "sector", pinned: "left", groupPath: [] });
  });

  it("nests a second level, and folds by path", () => {
    const folded = `${pivotValueKey("Tech")}${KEY_SEP}${pivotValueKey("AAPL")}`;
    const r = ok({ grouping: ["sector", "symbol"], keyEncoding: "typed-v1", expanded: { [pivotValueKey("Energy")]: false, [folded]: false } });
    expect(labels(r)).toEqual(["Energy", "Tech", "  AAPL", "  MSFT", "·", BLANK_LABEL, "  ZZZ", "·"]);
    expect(r.meta[0]).toMatchObject({ open: false });
    expect(r.meta[2]).toMatchObject({ path: folded, open: false });
  });

  it("shows nothing on a group row until a column is given an aggregation", () => {
    const bare = ok({ grouping: ["sector"] });
    expect(bare.rows[0]).toEqual({ [LABEL_FIELD]: "Energy" });
    const summed = ok({ grouping: ["sector"], aggregationFns: { revenue: "sum" } });
    expect(summed.rows[0]).toEqual({ [LABEL_FIELD]: "Energy", revenue: 7 });
    expect(summed.rows[3]).toEqual({ [LABEL_FIELD]: "Tech", revenue: 35 });
  });

  it("aggregates every level from its own source rows, never from its children", () => {
    const r = ok({ grouping: ["sector", "symbol"], aggregationFns: { revenue: "mean" } });
    // Tech: (10 + 20 + 5) / 3, not the mean of AAPL's 15 and MSFT's 5.
    const tech = r.rows[r.meta.findIndex((m) => m.kind === "group" && m.label === "Tech")];
    expect(tech.revenue).toBeCloseTo(35 / 3);
  });

  it("sorts siblings within their parent, missing last in both directions, and leaves within their group", () => {
    const desc = ok(
      { grouping: ["sector"], aggregationFns: { revenue: "sum" } },
      { sorting: [{ id: "revenue", desc: true }] },
    );
    expect(labels(desc).filter((l) => l !== "·")).toEqual(["Tech", "Energy", BLANK_LABEL]);
    // Tech's leaves, by revenue descending.
    expect(desc.rows.slice(1, 4).map((row) => row.revenue)).toEqual([20, 10, 5]);
    // Energy's leaves: 7, then the null — last, though the sort is descending.
    expect(desc.rows.slice(5, 7).map((row) => row.revenue)).toEqual([7, null]);

    const byLabel = ok({ grouping: ["sector"] }, { sorting: [{ id: LABEL_FIELD, desc: true }] });
    expect(labels(byLabel).filter((l) => l !== "·")).toEqual(["Tech", "Energy", BLANK_LABEL]);
  });

  it("ignores a sort naming a column this pivot does not have", () => {
    const r = ok({ grouping: ["sector"] }, { sorting: [{ id: "gone", desc: true }] });
    expect(labels(r).filter((l) => l !== "·")).toEqual(["Energy", "Tech", BLANK_LABEL]);
  });

  it("leaves a hidden column out", () => {
    const r = ok({ grouping: ["sector"] }, { order: ["sector", "symbol", "revenue"] });
    expect(r.columns.map((c) => c.field)).toEqual([LABEL_FIELD, "symbol", "revenue"]);
  });
});

describe("Column Groups", () => {
  it("drops the leaf rows and builds one header group per combination that occurs", () => {
    const r = ok(
      { grouping: ["sector"], split: ["symbol"], aggregationFns: { revenue: "sum" } },
      { order: ["sector", "symbol", "revenue"] },
    );
    expect(r.meta.every((m) => m.kind === "group")).toBe(true);
    expect(r.meta[0]).toMatchObject({ expandable: false, open: false });
    expect(r.columns.map((c) => c.groupPath.join("/"))).toEqual(["", "AAPL", "MSFT", "XOM", "ZZZ"]);
    const tech = r.rows[1];
    expect(tech[`${pivotValueKey("AAPL")}${KEY_SEP}revenue`]).toBe(30);
    expect(tech[`${pivotValueKey("MSFT")}${KEY_SEP}revenue`]).toBe(5);
    // Tech has no XOM rows: the cell is absent, not zero.
    expect(Object.hasOwn(tech, `${pivotValueKey("XOM")}${KEY_SEP}revenue`)).toBe(false);
  });

  it("strips what cannot apply to a synthetic column, and keeps the rest", () => {
    // v3 has no later logo/edit/range renderers. Feed their opaque source
    // metadata to the maintained engine directly, retaining every strip assertion.
    const columns = tableColumns(ROWS, { columns: [
      { field: "revenue", prefix: "$", pinned: "left", renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol" } } },
      { field: "note" },
    ] });
    const revenue = columns.find((c) => c.field === "revenue")!;
    const note = columns.find((c) => c.field === "note")!;
    Object.assign(revenue, { editable: true, isLogo: true, flash: true, percentKey: "pct",
      rangeBar: { lowKey: "low", highKey: "high", valueKey: "revenue" } });
    Object.assign(note, { rangeMeter: { min: 0, max: 100 } });
    expect(revenue).toMatchObject({ pinned: "left", editable: true, isLogo: true, flash: true, percentKey: "pct" });
    expect(revenue.cellClick).toBeDefined();
    expect(revenue.rangeBar).toBeDefined();
    expect(note.rangeMeter).toBeDefined();

    const r = ok({ split: ["symbol"] }, { columns, order: ["symbol", "revenue", "note"] });
    const [, split, meter] = r.columns;
    // Formatting is inherited: the header keeps its prefix.
    expect(split).toMatchObject({ source: "revenue", header: "$revenue", groupPath: ["AAPL"] });
    expect(split.pinned).toBeUndefined();
    expect(split.cellClick).toBeUndefined();
    // Typing into an aggregate means nothing, and an aggregate is no image URL.
    expect(split.editable).toBe(false);
    expect(split.isLogo).toBe(false);
    // These read OTHER keys of the same row, which a group row does not carry.
    expect(split.rangeBar).toBeUndefined();
    expect(split.percentKey).toBeUndefined();
    expect(meter).toMatchObject({ source: "note", groupPath: ["AAPL"] });
    expect(meter.rangeMeter).toBeUndefined();
    // Kept by ruling: a synthetic column inherits its source's formatting, so
    // an aggregate that changes under live ticks flashes like its source.
    expect(split.flash).toBe(true);
  });

  it("never lets a split column's id collide with the label column's", () => {
    // A data field named `group` under a blank split key: the id is
    // "" + KEY_SEP + "group", which a label id built from KEY_SEP would equal.
    const rows: Row[] = [
      { k: null, group: 1 },
      { k: "a", group: 2 },
    ];
    const result = pivotTable({
      rows,
      columns: tableColumns(rows, undefined),
      kinds: new Map<string, FieldKind>([["k", "text"], ["group", "number"]]),
      order: ["k", "group"],
      config: { enabled: true, grouping: [], split: ["k"] },
      sorting: [],
    });
    if (!result || !result.ok) throw new Error("expected a pivot");
    const ids = result.columns.map((c) => c.field);
    expect(ids).toContain(`${pivotValueKey(null)}${KEY_SEP}group`);
    expect(ids.filter((id) => id === LABEL_FIELD)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is a single Total row when there are no Row Groups", () => {
    const r = ok({ split: ["sector"], aggregationFns: { revenue: "sum" } }, { order: ["sector", "revenue"] });
    expect(r.meta).toEqual([{ kind: "total", depth: 0, label: "Total", count: 6 }]);
    expect(r.rows[0][`${pivotValueKey("Tech")}${KEY_SEP}revenue`]).toBe(35);
  });

  it("buckets a date field, orders the buckets in time, and marks an incomplete period", () => {
    const r = ok(
      { split: ["date"], buckets: { date: "quarter" }, aggregationFns: { revenue: "sum" } },
      { order: ["date", "revenue"] },
    );
    // Monthly data: Q1 has Jan, Feb, Mar; Q2 has April only.
    expect(r.columns.map((c) => c.groupPath[0])).toEqual([undefined, "2024 Q1", "2024 Q2 (1 of 3)"]);
    // Jan 10 + 5 + 7, Feb 20, Mar 1.
    expect(r.rows[0][`${pivotValueKey("2024-Q1")}${KEY_SEP}revenue`]).toBe(43);
  });

  it("marks an incomplete ROW group through meta, leaving the label clean", () => {
    const r = ok({ grouping: ["date"], buckets: { date: "quarter" } });
    expect(r.meta.filter((m) => m.kind === "group")).toMatchObject([
      { label: "2024 Q1" },
      { label: "2024 Q2", incomplete: { have: 1, expected: 3 } },
    ]);
    expect(Object.hasOwn(r.meta[0], "incomplete")).toBe(false);
  });

  it("refuses rather than hangs past 500 columns, and says which field did it", () => {
    const many: Row[] = Array.from({ length: 251 }, (_, i) => ({ k: `k${i}`, a: i, b: i }));
    const columns = tableColumns(many, undefined);
    const config: PivotConfig = { enabled: true, grouping: [], split: ["k"], aggregationFns: { a: "sum" } };
    const result = pivotTable({
      rows: many,
      columns,
      kinds: new Map<string, FieldKind>([["k", "text"], ["a", "number"], ["b", "number"]]),
      order: ["k", "a", "b"],
      config,
      sorting: [],
    });
    expect(result).toEqual({
      ok: false,
      reason:
        "Column Groups on k would make 503 columns (the limit is 500). Pick a coarser bucket, or move a field to Row Groups.",
    });
    expect(config).toEqual({ enabled: true, grouping: [], split: ["k"], aggregationFns: { a: "sum" } });
  });

  it("allows 500 actual split columns and refuses 501 without changing config", () => {
    const config: PivotConfig = { enabled: true, grouping: [], split: ["k"], aggregationFns: { v: "sum" } };
    const execute = (count: number) => {
      const rows = Array.from({ length: count }, (_, i) => ({ k: `k${i}`, v: i }));
      return pivotTable({ rows, columns: tableColumns(rows, undefined), kinds: new Map([["k", "text"], ["v", "number"]]),
        order: ["k", "v"], config, sorting: [] });
    };
    const allowed = execute(499);
    expect(allowed?.ok).toBe(true);
    if (!allowed || !allowed.ok) throw new Error("expected 500 columns");
    expect(allowed.columns).toHaveLength(500);
    expect(execute(500)).toMatchObject({ ok: false, reason: expect.stringContaining("501 columns") });
    expect(config).toEqual({ enabled: true, grouping: [], split: ["k"], aggregationFns: { v: "sum" } });
  });

  it("counts the label in an unsplit grouped table's 500-column limit", () => {
    const row = Object.fromEntries([["g", "A"], ...Array.from({ length: 500 }, (_, i) => [`v${i}`, i])]);
    const columns = tableColumns([row], undefined);
    const config: PivotConfig = { enabled: true, grouping: ["g"], split: [] };
    const execute = (order: string[]) => pivotTable({ rows: [row], columns, kinds: new Map([["g", "text"]]), order,
      config, sorting: [] });
    const order = columns.map((column) => column.field);
    const allowed = execute(order.slice(0, 500));
    expect(allowed?.ok).toBe(true);
    if (!allowed || !allowed.ok) throw new Error("expected 500 columns");
    expect(allowed.columns).toHaveLength(500);
    expect(execute(order)).toMatchObject({ ok: false, reason: expect.stringContaining("501 columns") });
    expect(config).toEqual({ enabled: true, grouping: ["g"], split: [] });
  });
});

describe("aggregate", () => {
  const rows: Row[] = [
    { d: "2024-02-29", v: 20, t: "b" },
    { d: "2024-01-31", v: 10, t: "a" },
    { d: "2024-03-31", v: null, t: "a" },
    { d: "2024-01-31", v: 12, t: null },
  ];
  it("skips nulls, and is blank when nothing is left", () => {
    expect(aggregate("sum", rows, "v", "d")).toBe(42);
    expect(aggregate("mean", rows, "v", "d")).toBe(14);
    expect(aggregate("median", rows, "v", "d")).toBe(12);
    expect(aggregate("min", rows, "v", "d")).toBe(10);
    expect(aggregate("max", rows, "t", "d")).toBe("b");
    expect(aggregate("sum", [{ v: null }], "v", undefined)).toBeUndefined();
  });
  it("counts non-null values, as strings", () => {
    expect(aggregate("count", rows, "v", "d")).toBe("3");
    expect(aggregate("uniqueCount", rows, "t", "d")).toBe("2");
    expect(aggregate("count", [{ v: null }], "v", undefined)).toBe("0");
  });
  it("orders first and last by the date column; ties keep source order; a null value is passed over", () => {
    // Two rows share the earliest date: `first` is the earlier in the source.
    expect(aggregate("first", rows, "v", "d")).toBe(10);
    // The latest-dated row has a null v, so `last` falls back to February's.
    expect(aggregate("last", rows, "v", "d")).toBe(20);
    expect(aggregate("last", rows, "t", "d")).toBe("a");
  });
  it("has no first or last without a date column", () => {
    expect(aggregate("first", rows, "v", undefined)).toBeUndefined();
  });
  it("will not add up text", () => {
    expect(aggregate("sum", rows, "t", "d")).toBeUndefined();
  });
});

it('evaluates duplicate measures independently from the same scope and preserves literal keys', () => {
  let reads = 0;
  const rows = [10, 20, 90].map(value => Object.defineProperty({ group: 'A', date: `2026-01-${value === 10 ? '03' : value === 20 ? '01' : '02'}` }, 'volume.x', { enumerable: true, get: () => { reads++; return value; } }));
  const columns = ['group', 'date', 'volume.x'].map(field => ({ field, header: field, renderFn: [], colorRules: [], hiddenByDefault: false }));
  const result = pivotTable({ rows, columns, kinds: new Map([['date', 'date']]), order: columns.map(c => c.field), sorting: [], config: { enabled: true, grouping: ['group'], split: [], keyEncoding: "typed-v1", expanded: { [pivotValueKey("A")]: false }, measures: [
    { id: 'volume.x', sourceFieldId: 'volume.x', aggregation: 'mean' },
    { id: '__proto__', sourceFieldId: 'volume.x', aggregation: 'sum' },
    { id: 'last', sourceFieldId: 'volume.x', aggregation: 'last' },
    { id: 'unset', sourceFieldId: 'volume.x' },
  ] } });
  if (!result?.ok) throw new Error('expected pivot');
  expect(result.rows[0]).toMatchObject(JSON.parse('{"volume.x":40,"__proto__":120,"last":10}'));
  expect(Object.hasOwn(result.rows[0], 'unset')).toBe(false);
  expect(reads).toBe(3);
  expect(result.columns.map(c => c.header)).toEqual(['group', 'volume.x — Average', 'volume.x — Total', 'volume.x — Last', 'volume.x']);
});

it('sorts duplicate leaf columns by their bound source and carries raw leaf values', () => {
  const result = ok({ grouping: ['sector'], measures: [{ id: 'copy', sourceFieldId: 'revenue', aggregation: 'sum' }] }, { sorting: [{ id: 'copy', desc: true }] });
  expect(result.rows.filter((_, i) => result.meta[i].kind === 'leaf').map(row => row.copy)).toEqual([20, 10, 5, 7, null, 1]);
});

function categoryCollisionPivot(split: string[] = [], desc = false) {
  const rows = [{ region: 'A', segment: 'Z', volume: 90 }, { region: 'A', segment: 'Y', volume: 10 }, { region: 'B', segment: 'Z', volume: 20 }];
  const columns = tableColumns(rows, undefined);
  const category = split[0] ?? 'region';
  const result = pivotTable({ rows, columns, kinds: new Map([['region', 'text'], ['segment', 'text'], ['volume', 'number']]), order: columns.map(c => c.field), sorting: [{ id: category, desc }], config: { enabled: true, grouping: ['region'], split, expanded: true, measures: [{ id: category, sourceFieldId: 'volume', aggregation: 'sum' }] } });
  if (!result?.ok) throw new Error('expected pivot');
  return result;
}

it.each([false, true])('sorts a colliding category by its group value, descending=%s', desc => {
  const result = categoryCollisionPivot([], desc);
  expect(result.meta.flatMap(meta => meta.kind === 'group' ? [meta.label] : [])).toEqual(desc ? ['B', 'A'] : ['A', 'B']);
});

it('keeps equal-category leaves in source order when a measure shares the category ID', () => {
  const result = categoryCollisionPivot();
  expect(result.rows.filter((_, i) => result.meta[i].kind === 'leaf').map(row => row.volume)).toEqual([90, 10, 20]);
});

it('does not reinterpret a split category sort as a colliding measure sort', () => {
  const result = categoryCollisionPivot(['segment'], true);
  expect(result.meta.flatMap(meta => meta.kind === 'group' ? [meta.label] : [])).toEqual(['A', 'B']);
  expect(result.rows.map(row => row['["string","Z"]\x1fsegment'])).toEqual([90, 20]);
});

it("groups hover-card object cells by their cellField, never [object Object] (#17)", () => {
  const rows: Row[] = [["Ethereum", 45], ["Bitcoin", 35], ["Solana", 8]].map(([value, tvl]) => ({ name: { value, extra: 1 }, tvl }));
  const columns = tableColumns(rows, { columns: [{ field: "name", renderFn: ["hoverCard"], renderFnParams: { hoverCard: { cellField: "value", markdown: "{value}" } } }, { field: "tvl" }] });
  const result = pivotTable({ rows, columns, kinds: new Map([["name", "none"], ["tvl", "number"]]),
    order: ["name", "tvl"], config: { enabled: true, grouping: ["name"], split: [], aggregationFns: { tvl: "sum" } }, sorting: [] });
  if (!result || !result.ok) throw new Error("expected pivot result");
  const groups = result.meta.flatMap((meta, index) => meta.kind === "group" ? [[meta.label, result.rows[index].tvl]] : []);
  expect(groups).toEqual([["Bitcoin", 35], ["Ethereum", 45], ["Solana", 8]]);
});

it("groups an undeclared object cell by its scalar value on a backend card too (#17)", () => {
  const rows: Row[] = [["Ethereum", 45], ["Bitcoin", 30], ["Bitcoin", 5], ["Solana", 8]].map(([value, tvl]) => ({ name: { value, extra: 1 }, tvl }));
  const columns = tableColumns(rows, { columns: [{ field: "name" }, { field: "tvl" }] });
  const result = pivotTable({ rows, columns, kinds: new Map([["name", "none"], ["tvl", "number"]]),
    order: ["name", "tvl"], config: { enabled: true, grouping: ["name"], split: [], aggregationFns: { tvl: "sum" } }, sorting: [] });
  if (!result || !result.ok) throw new Error("expected pivot result");
  const groups = result.meta.flatMap((meta, index) => meta.kind === "group" ? [[meta.label, result.rows[index].tvl]] : []);
  expect(groups).toEqual([["Bitcoin", 35], ["Ethereum", 45], ["Solana", 8]]);
});

// The reference's "Mean and Count" tab: a leaf row under an expanded group is
// one row. Every aggregation of one value is that value -- except a count,
// which counts the row: 1, or 0 for a null (as a group of only nulls reads 0),
// never the raw value it counted.
it('a leaf row counts itself in a Count column, and carries the value elsewhere', () => {
  const rows = [
    { asset: 'AAA', volume: 100, day: '2026-01-02' },
    { asset: 'AAA', volume: 200, day: '2026-01-03' },
    { asset: 'AAA', volume: 300, day: '2026-01-04' },
    { asset: 'BBB', volume: 50, day: '2026-01-02' },
    { asset: 'BBB', volume: null, day: '2026-01-03' },
  ];
  const columns = tableColumns(rows, undefined);
  const aggs = ['mean', 'count', 'uniqueCount', 'sum', 'median', 'min', 'max', 'first', 'last'] as const;
  const result = pivotTable({
    rows, columns, kinds: new Map([['asset', 'text'], ['volume', 'number'], ['day', 'date']]), order: columns.map(c => c.field), sorting: [],
    config: { enabled: true, grouping: ['asset'], split: [], expanded: true, measures: aggs.map(a => ({ id: a, sourceFieldId: 'volume', aggregation: a })) },
  });
  if (!result?.ok) throw new Error('expected pivot');
  const leaves = result.rows.filter((_, i) => result.meta[i].kind === 'leaf');
  const groups = result.rows.filter((_, i) => result.meta[i].kind === 'group');
  // Groups as before: AAA 200 / 3, BBB 50 / 1.
  expect(groups.map(g => [g.mean, g.count])).toEqual([[200, '3'], [50, '1']]);
  const cells = (row: Row) => aggs.map(a => row[a]);
  expect(cells(leaves[0])).toEqual([100, '1', '1', 100, 100, 100, 100, 100, 100]);
  // A null stays null, as leaves always carried it; only the counts read 0.
  expect(cells(leaves[4])).toEqual([null, '0', '0', null, null, null, null, null, null]);
});
