// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { ColumnSpec, TableSpec } from "./types";
import {
  cellClickOf,
  effectivePinned,
  hiddenFields,
  hoverCardOf,
  moveColumn,
  orderFields,
  setPinned,
  tableColumns,
  tableRows,
  type TableColumn,
} from "./tableColumns";

const rows = [
  { symbol: "AAPL", close: 190.5, volume: 2_300_000 },
  { symbol: "MSFT", close: 410.25, volume: 1_500 },
];

const fields = (columns: TableColumn[]) => columns.map((c) => c.field);

describe("tableRows", () => {
  it("accepts an array of plain records", () => {
    expect(tableRows(rows)).toBe(rows);
    expect(tableRows([])).toEqual([]);
  });

  it("refuses anything else, so the caller can fall back to the raw view", () => {
    expect(tableRows({ error: "nope" })).toBeNull();
    expect(tableRows([1, 2])).toBeNull();
    expect(tableRows([[1]])).toBeNull();
    expect(tableRows([null])).toBeNull();
    expect(tableRows(null)).toBeNull();
  });
});

describe("tableColumns with no spec", () => {
  it("uses the FIRST row's keys, in their own order, with the field as the header", () => {
    const columns = tableColumns(rows, undefined);
    expect(fields(columns)).toEqual(["symbol", "close", "volume"]);
    expect(columns[0]).toEqual({
      field: "symbol",
      header: "symbol",
      format: undefined,
      renderFn: [],
      colorRules: [],
      hiddenByDefault: false,
    });
  });

  it("does NOT widen to the union of every row's keys", () => {
    // Widening here would change what a widget with no columnsDefs renders,
    // and the design requires those to render exactly as before.
    expect(fields(tableColumns([{ a: 1 }, { a: 2, b: 3 }], undefined))).toEqual(["a"]);
  });
});

describe("tableColumns with a spec", () => {
  const spec: TableSpec = {
    columns: [
      { field: "close", headerName: "Close", prefix: "$", headerTooltip: "Closing price" },
      { field: "symbol", headerName: "Ticker", suffix: " ▾" },
      { field: "absent", headerName: "Not in the data" },
    ],
  };

  it("orders by columnsDefs, then appends data-only fields in first-seen order", () => {
    expect(fields(tableColumns(rows, spec))).toEqual(["close", "symbol", "volume"]);
  });

  it("drops a declared field the data does not carry", () => {
    expect(fields(tableColumns(rows, spec))).not.toContain("absent");
  });

  it("appends data-only fields across the WHOLE payload, not just the first row", () => {
    expect(
      fields(tableColumns([{ a: 1 }, { a: 2, b: 3 }], { columns: [{ field: "a" }] })),
    ).toEqual(["a", "b"]);
  });

  it("ignores a duplicate columnsDefs entry rather than rendering the column twice", () => {
    expect(
      fields(tableColumns(rows, { columns: [{ field: "close" }, { field: "close" }] })),
    ).toEqual(["close", "symbol", "volume"]);
  });

  it("builds the header from headerName wrapped in prefix and suffix", () => {
    const columns = tableColumns(rows, spec);
    expect(columns[0].header).toBe("$Close");
    expect(columns[1].header).toBe("Ticker ▾");
    expect(columns[0].tooltip).toBe("Closing price");
    // A data-only field keeps the raw field name and no tooltip.
    expect(columns[2].header).toBe("volume");
    expect(columns[2].tooltip).toBeUndefined();
  });

  it("falls back to the field name when there is no headerName", () => {
    expect(tableColumns(rows, { columns: [{ field: "close", prefix: "$" }] })[0].header).toBe("$close");
  });

  it("carries the sizes, the pin side and the default visibility across", () => {
    const columns = tableColumns(rows, {
      columns: [
        { field: "symbol", pinned: "left", width: 90, minWidth: 60, maxWidth: 300 },
        { field: "close", hide: true },
      ],
    });
    expect(columns[0]).toMatchObject({
      pinned: "left",
      size: 90,
      minSize: 60,
      maxSize: 300,
      hiddenByDefault: false,
    });
    expect(columns[1]).toMatchObject({ hiddenByDefault: true });
    expect(columns[1].pinned).toBeUndefined();
  });

  it("resolves each column's format, table default included, data-only fields too", () => {
    const columns = tableColumns(rows, {
      formatterFn: "int",
      columns: [{ field: "close", formatterFn: "normalizedPercent", decimalPlaces: 3 }],
    });
    expect(columns[0].format).toEqual({ formatterFn: "normalizedPercent", decimalPlaces: 3 });
    // symbol and volume are data-only here, and still inherit the default.
    expect(columns[1].format).toEqual({ formatterFn: "int", decimalPlaces: undefined });
  });

  it("parses colorRules once, per column, so the cell renderer never re-validates", () => {
    const columns = tableColumns(rows, {
      columns: [
        {
          field: "close",
          renderFnParams: {
            colorRules: [
              { condition: "lt", value: 0, color: "#f00" },
              { condition: "sideways", value: 0, color: "#f00" },
            ],
          },
        },
      ],
    });
    expect(columns[0].colorRules).toEqual([{ condition: "lt", value: 0, color: "#f00" }]);
    // A column that declares none gets an empty list, not undefined.
    expect(columns[1].colorRules).toEqual([]);
  });

  it("normalises renderFn to an array", () => {
    const columns = tableColumns(rows, {
      columns: [{ field: "close", renderFn: ["greenRed"], renderFnParams: { anything: 1 } }],
    });
    expect(columns[0].renderFn).toEqual(["greenRed"]);
    expect(columns[1].renderFn).toEqual([]);
  });
});

describe("orderFields", () => {
  const columns = tableColumns(rows, undefined);

  it("returns the spec order when nothing is persisted", () => {
    expect(orderFields(columns, undefined)).toEqual(["symbol", "close", "volume"]);
  });

  it("honours a persisted order", () => {
    expect(orderFields(columns, ["volume", "symbol", "close"])).toEqual([
      "volume",
      "symbol",
      "close",
    ]);
  });

  it("drops a persisted field the payload no longer carries", () => {
    expect(orderFields(columns, ["gone", "volume"])).toEqual(["volume", "symbol", "close"]);
  });

  it("appends a new field the persisted order does not mention, rather than hiding it", () => {
    expect(orderFields(columns, ["volume"])).toEqual(["volume", "symbol", "close"]);
  });
});

describe("hiddenFields", () => {
  const columns = tableColumns(rows, {
    columns: [{ field: "symbol" }, { field: "close", hide: true }],
  });

  it("uses the spec's hide: true columns when nothing is persisted", () => {
    expect(hiddenFields(columns, undefined)).toEqual(["close"]);
  });

  it("lets an EMPTY persisted list un-hide a column the spec ships hidden", () => {
    expect(hiddenFields(columns, [])).toEqual([]);
  });

  it("honours a persisted list and drops fields the payload no longer carries", () => {
    expect(hiddenFields(columns, ["volume", "gone"])).toEqual(["volume"]);
  });
});

describe("moveColumn", () => {
  const columns = tableColumns(rows, {
    columns: [
      { field: "symbol", pinned: "left" },
      { field: "close", pinned: "left" },
      { field: "volume" },
    ],
  });
  const order = ["symbol", "close", "volume"];

  const plain = tableColumns(rows, undefined);
  const allLeft = tableColumns(rows, {
    columns: [
      { field: "symbol", pinned: "left" },
      { field: "close", pinned: "left" },
      { field: "volume", pinned: "left" },
    ],
  });

  it("lands a column dragged BACKWARDS immediately before its drop target", () => {
    expect(moveColumn(["symbol", "close", "volume"], plain, "volume", "close")).toEqual([
      "symbol",
      "volume",
      "close",
    ]);
    expect(moveColumn(["symbol", "close", "volume"], plain, "volume", "symbol")).toEqual([
      "volume",
      "symbol",
      "close",
    ]);
  });

  it("lands a column dragged FORWARDS after its drop target, so the last slot is reachable", () => {
    // The standard list-reorder rule. Inserting before the target in both
    // directions would leave the final position unreachable: dragging the
    // first column onto the last would land it second-to-last instead.
    expect(moveColumn(["symbol", "close", "volume"], plain, "symbol", "close")).toEqual([
      "close",
      "symbol",
      "volume",
    ]);
    expect(moveColumn(["symbol", "close", "volume"], plain, "symbol", "volume")).toEqual([
      "close",
      "volume",
      "symbol",
    ]);
  });

  it("reaches the last and first slot of a pinned group, in both directions", () => {
    expect(moveColumn(["symbol", "close", "volume"], allLeft, "symbol", "volume")).toEqual([
      "close",
      "volume",
      "symbol",
    ]);
    expect(moveColumn(["symbol", "close", "volume"], allLeft, "volume", "symbol")).toEqual([
      "volume",
      "symbol",
      "close",
    ]);
  });

  it("moves a pinned column within its own pinned group", () => {
    expect(moveColumn(order, columns, "close", "symbol")).toEqual(["close", "symbol", "volume"]);
  });

  it("refuses a move across the pinned boundary, in both directions", () => {
    // A drag must never silently pin or unpin a column: pinning comes from
    // the widget's spec and has no UI.
    expect(moveColumn(order, columns, "symbol", "volume")).toBeNull();
    expect(moveColumn(order, columns, "volume", "symbol")).toBeNull();
  });

  it("refuses a no-op and an unknown field", () => {
    expect(moveColumn(order, columns, "close", "close")).toBeNull();
    expect(moveColumn(order, columns, "gone", "close")).toBeNull();
    expect(moveColumn(order, columns, "close", "gone")).toBeNull();
  });

  it("does not mutate the order it was given", () => {
    const before = [...order];
    moveColumn(order, columns, "close", "symbol");
    expect(order).toEqual(before);
  });

  it("refuses a move across a boundary the USER created", () => {
    // The spec pins nothing here; the card pins `close` left. The drag rule
    // follows the effective side, so this is now a cross-group move.
    expect(moveColumn(order, plain, "close", "volume", { close: "left" })).toBeNull();
  });

  it("allows a move the spec's own pinning refused, once the user has unpinned", () => {
    // `symbol` is spec-pinned left and `volume` is not, which moveColumn
    // refuses; unpinning `symbol` puts both in the unpinned group.
    expect(moveColumn(order, columns, "symbol", "volume")).toBeNull();
    expect(moveColumn(order, columns, "symbol", "volume", { symbol: null })).toEqual([
      "close",
      "volume",
      "symbol",
    ]);
  });
});

/**
 * a and b are pinned left, e is pinned right, c is unpinned and d is unpinned
 * AND hidden -- so every placement assertion below also proves that a hidden
 * column keeps its slot in the order rather than being skipped over.
 */
const pinRows = [{ a: 1, b: 2, c: 3, d: 4, e: 5 }];
const pinColumns = tableColumns(pinRows, {
  columns: [
    { field: "a", pinned: "left" },
    { field: "b", pinned: "left" },
    { field: "c" },
    { field: "d", hide: true },
    { field: "e", pinned: "right" },
  ],
});
const pinOrder = ["a", "b", "c", "d", "e"];
const column = (field: string) => pinColumns.find((c) => c.field === field) as TableColumn;

describe("effectivePinned", () => {
  it("falls back to the widget spec's own side when the card holds no entry", () => {
    expect(effectivePinned(column("a"), undefined)).toBe("left");
    expect(effectivePinned(column("a"), {})).toBe("left");
    expect(effectivePinned(column("c"), {})).toBeUndefined();
  });

  it("reads null as unpinned, overriding a spec pin", () => {
    expect(effectivePinned(column("a"), { a: null })).toBeUndefined();
    expect(effectivePinned(column("e"), { e: null })).toBeUndefined();
  });

  it("reads a side as that side, overriding both no spec pin and a different one", () => {
    expect(effectivePinned(column("c"), { c: "right" })).toBe("right");
    expect(effectivePinned(column("a"), { a: "right" })).toBe("right");
  });

  it("ignores keys inherited from Object.prototype", () => {
    // The map arrives from JSON.parse, so it inherits Object.prototype: a
    // column named "toString" must not read that function as its pin side.
    const odd = tableColumns([{ toString: 1, constructor: 2 }], undefined);
    expect(effectivePinned(odd[0], {})).toBeUndefined();
    expect(effectivePinned(odd[1], {})).toBeUndefined();
  });
});

describe("setPinned", () => {
  it("pins an unpinned column left, at the inner edge of the left group", () => {
    // d moves from the middle to just after b, the last left column.
    expect(setPinned(pinColumns, pinOrder, undefined, "d", "left")).toEqual({
      pinned: { d: "left" },
      columnOrder: ["a", "b", "d", "c", "e"],
    });
  });

  it("pins an unpinned column right, just before the first right column", () => {
    expect(setPinned(pinColumns, pinOrder, undefined, "c", "right")).toEqual({
      pinned: { c: "right" },
      columnOrder: ["a", "b", "d", "c", "e"],
    });
  });

  it("moves a spec-pinned-left column to the right group", () => {
    expect(setPinned(pinColumns, pinOrder, undefined, "b", "right")).toEqual({
      pinned: { b: "right" },
      columnOrder: ["a", "c", "d", "b", "e"],
    });
  });

  it("unpins a spec-pinned-left column, landing it directly after the left group", () => {
    expect(setPinned(pinColumns, pinOrder, undefined, "a", null)).toEqual({
      pinned: { a: null },
      columnOrder: ["b", "a", "c", "d", "e"],
    });
  });

  it("unpins a spec-pinned-right column to the same place", () => {
    expect(setPinned(pinColumns, pinOrder, undefined, "e", null)).toEqual({
      pinned: { e: null },
      columnOrder: ["a", "b", "e", "c", "d"],
    });
  });

  it("never writes an entry that agrees with the backend default", () => {
    // Pinning right a column the spec already pins right, and unpinning one
    // the spec does not pin: both are the default, so neither is recorded.
    expect(setPinned(pinColumns, pinOrder, undefined, "e", "right")).toEqual({
      pinned: undefined,
      columnOrder: ["a", "b", "c", "d", "e"],
    });
    expect(setPinned(pinColumns, pinOrder, undefined, "c", null)).toEqual({
      pinned: undefined,
      columnOrder: ["a", "b", "c", "d", "e"],
    });
  });

  it("drops an entry that returns to the backend default, emptying the map", () => {
    // The card had unpinned `a`; pinning it left again is the spec's own
    // answer, so the whole key goes rather than being written as "left".
    expect(setPinned(pinColumns, pinOrder, { a: null }, "a", "left")).toEqual({
      pinned: undefined,
      columnOrder: ["b", "a", "c", "d", "e"],
    });
  });

  it("keeps the other columns' entries when it drops this one", () => {
    expect(setPinned(pinColumns, pinOrder, { a: null, c: "right" }, "a", "left")).toEqual({
      pinned: { c: "right" },
      columnOrder: ["b", "a", "c", "d", "e"],
    });
  });

  it("places a first left pin at the very front, and a first right pin at the very end", () => {
    const plain = tableColumns([{ symbol: "AAPL", close: 1, volume: 2 }], undefined);
    const order = ["symbol", "close", "volume"];
    expect(setPinned(plain, order, undefined, "volume", "left").columnOrder).toEqual([
      "volume",
      "symbol",
      "close",
    ]);
    expect(setPinned(plain, order, undefined, "symbol", "right").columnOrder).toEqual([
      "close",
      "volume",
      "symbol",
    ]);
  });

  it("computes placement against the OTHER columns' effective sides, not the spec's", () => {
    // With `b` already unpinned by the card, the left group is just `a`, so a
    // newly left-pinned `c` lands second rather than third.
    expect(setPinned(pinColumns, pinOrder, { b: null }, "c", "left")).toEqual({
      pinned: { b: null, c: "left" },
      columnOrder: ["a", "c", "b", "d", "e"],
    });
  });

  it("returns the WHOLE order, hidden fields included", () => {
    const out = setPinned(pinColumns, pinOrder, undefined, "c", "left");
    expect([...out.columnOrder].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("mutates neither the order nor the map it was given", () => {
    const order = [...pinOrder];
    const persisted = { c: "right" as const };
    setPinned(pinColumns, order, persisted, "a", null);
    expect(order).toEqual(pinOrder);
    expect(persisted).toEqual({ c: "right" });
  });

  it("keeps a field named __proto__ as an own key rather than a prototype write", () => {
    // A computed key, because `{ __proto__: 1 }` in a literal is the prototype
    // setter and would not create an own property at all.
    const rows = [{ ["__proto__"]: 1, close: 2 }];
    const columns = tableColumns(rows, undefined);
    const out = setPinned(columns, ["__proto__", "close"], undefined, "__proto__", "left");

    expect(Object.hasOwn(out.pinned ?? {}, "__proto__")).toBe(true);
    expect(effectivePinned(columns[0], out.pinned)).toBe("left");
  });
});

describe("hoverCardOf", () => {
  // The reference backend's table_widget_with_hover_card column, verbatim.
  const reference: ColumnSpec = {
    field: "name",
    renderFn: ["hoverCard"],
    renderFnParams: {
      hoverCard: {
        cellField: "value",
        title: "Project Details",
        markdown: "### {value} (since {foundedDate})",
      },
    },
  };

  it("reads cellField, title and markdown", () => {
    expect(hoverCardOf(reference)).toEqual({
      cellField: "value",
      title: "Project Details",
      markdown: "### {value} (since {foundedDate})",
    });
  });

  it("is undefined without the renderFn, or without a markdown string", () => {
    expect(hoverCardOf({ ...reference, renderFn: ["greenRed"] })).toBeUndefined();
    expect(
      hoverCardOf({ ...reference, renderFnParams: { hoverCard: { cellField: "value" } } }),
    ).toBeUndefined();
  });
});

describe("cellClickOf", () => {
  /** One columnsDefs entry that asks for a groupBy cell click on `symbol`. */
  const groupBy = (over: Record<string, unknown> = {}): ColumnSpec => ({
    field: "symbol",
    renderFn: ["cellOnClick"],
    renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol", ...over } },
  });

  it("reads paramName alone, defaulting forceUpdate to false and leaving valueField out", () => {
    expect(cellClickOf(groupBy())).toEqual({ paramName: "symbol", forceUpdate: false });
  });

  it("reads forceUpdate and valueField when the manifest supplies them", () => {
    expect(cellClickOf(groupBy({ forceUpdate: true, valueField: "ticker" }))).toEqual({
      paramName: "symbol",
      forceUpdate: true,
      valueField: "ticker",
    });
  });

  it("takes forceUpdate only from a literal true, never from a truthy value", () => {
    // The manifest is untrusted JSON: "true" and 1 are not the boolean the
    // reference documents, and treating them as one would refetch a table
    // whose author never asked for it.
    expect(cellClickOf(groupBy({ forceUpdate: "true" }))?.forceUpdate).toBe(false);
    expect(cellClickOf(groupBy({ forceUpdate: 1 }))?.forceUpdate).toBe(false);
  });

  it("ignores a valueField that is not a non-empty string", () => {
    expect(cellClickOf(groupBy({ valueField: "" }))).toEqual({
      paramName: "symbol",
      forceUpdate: false,
    });
    expect(cellClickOf(groupBy({ valueField: 7 }))).toEqual({
      paramName: "symbol",
      forceUpdate: false,
    });
  });

  it("accepts cellOnClick listed among other renderFns", () => {
    expect(
      cellClickOf({
        field: "symbol",
        renderFn: ["greenRed", "cellOnClick", "titleCase"],
        renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol" } },
      }),
    ).toEqual({ paramName: "symbol", forceUpdate: false });
  });

  // Every rejection renders the column as a plain cell rather than a broken
  // control: an unusable declaration must never produce a button that does
  // nothing when clicked.
  it.each([
    ["no renderFn at all", { field: "symbol" }],
    [
      "a renderFn without cellOnClick",
      {
        field: "symbol",
        renderFn: ["greenRed"],
        renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol" } },
      },
    ],
    ["no renderFnParams", { field: "symbol", renderFn: ["cellOnClick"] }],
    [
      "a missing actionType",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { groupBy: { paramName: "symbol" } },
      },
    ],
    [
      "an actionType that is not groupBy",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "hoverCard", groupBy: { paramName: "symbol" } },
      },
    ],
    [
      "no groupBy block",
      { field: "symbol", renderFn: ["cellOnClick"], renderFnParams: { actionType: "groupBy" } },
    ],
    [
      "a null groupBy",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "groupBy", groupBy: null },
      },
    ],
    [
      "a string groupBy",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "groupBy", groupBy: "x" },
      },
    ],
    [
      "an array groupBy",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "groupBy", groupBy: [] },
      },
    ],
    [
      "an empty paramName",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "groupBy", groupBy: { paramName: "" } },
      },
    ],
    [
      "a paramName that is not a string",
      {
        field: "symbol",
        renderFn: ["cellOnClick"],
        renderFnParams: { actionType: "groupBy", groupBy: { paramName: 3 } },
      },
    ],
  ])("returns undefined for %s", (_label, spec) => {
    expect(cellClickOf(spec as ColumnSpec)).toBeUndefined();
  });

  it("carries cellClick onto the declared column, and leaves data-only columns without one", () => {
    const columns = tableColumns(rows, {
      columns: [
        {
          field: "symbol",
          renderFn: ["cellOnClick"],
          renderFnParams: {
            actionType: "groupBy",
            groupBy: { paramName: "symbol", forceUpdate: true },
          },
        },
      ],
    });
    expect(columns[0].cellClick).toEqual({ paramName: "symbol", forceUpdate: true });
    // close and volume are data-only here: no columnsDefs entry, no cellClick.
    expect(columns[1].cellClick).toBeUndefined();
    expect(columns[2].cellClick).toBeUndefined();
  });
});

describe("showCellChange parsing", () => {
  it("parses a showCellChange column, honouring enableCellChangeWs:false", () => {
    const [price, volume] = tableColumns(
      [{ price: 1, change: 1, volume: 1 }],
      {
        columns: [
          { field: "price", renderFn: ["showCellChange"], renderFnParams: { colorValueKey: "change" } },
          { field: "volume", renderFn: ["showCellChange"], enableCellChangeWs: false },
        ],
      } as unknown as TableSpec,
    );
    expect(price.cellChange).toEqual({ colorValueKey: "change", enabled: true });
    expect(volume.cellChange?.enabled).toBe(false);
  });
});

describe("colorValueKey", () => {
  it("resolves a non-empty renderFnParams.colorValueKey onto the column, and drops an empty or non-string one", () => {
    const cols = tableColumns([{ a: 1, b: 2, c: 3 }], {
      columns: [
        { field: "a", renderFnParams: { colorValueKey: "b" } },
        { field: "b", renderFnParams: { colorValueKey: "" } },
        { field: "c", renderFnParams: { colorValueKey: 7 } },
      ],
    });
    expect(cols.map((c) => c.colorValueKey)).toEqual(["b", undefined, undefined]);
  });
});
