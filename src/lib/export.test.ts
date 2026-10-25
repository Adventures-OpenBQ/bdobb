// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

// The real SheetJS is exercised nowhere in this suite: toXlsx's contract is
// "hand json_to_sheet the rows, name the sheet Data, ask write() for an
// array, return it as bytes", and that is what these fakes pin. Verified in
// a prototype that a lazy `await import("xlsx")` does resolve to this mock.
const write = vi.fn(() => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer);
const json_to_sheet = vi.fn(() => ({ marker: "sheet" }));
const book_new = vi.fn(() => ({ SheetNames: [], Sheets: {} }));
const book_append_sheet = vi.fn();
const sheet_add_aoa = vi.fn();

vi.mock("xlsx", () => ({
  utils: { json_to_sheet, book_new, book_append_sheet, sheet_add_aoa },
  write,
}));

import { exportFilename, rowsForExport, toCsv, toJson, toJsonRows, toXlsx } from "./export";

describe("rowsForExport", () => {
  it("passes an array of records straight through", () => {
    const data = [{ a: 1 }, { a: 2 }];
    expect(rowsForExport(data)).toBe(data);
  });

  it("wraps a single object as one row", () => {
    expect(rowsForExport({ a: 1 })).toEqual([{ a: 1 }]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "hello"],
    ["a number", 42],
    ["an array of scalars", [1, 2, 3]],
    ["a mixed array", [{ a: 1 }, 2]],
    ["an empty array (no columns to write)", []],
    ["an array of arrays", [[1], [2]]],
  ])("refuses %s", (_label, value) => {
    expect(rowsForExport(value)).toBeNull();
  });
});

describe("toCsv", () => {
  it("heads a column with its backend label when one is given, the field key otherwise", () => {
    expect(
      toCsv([{ date: "2026-01-01", RPI: 1.5 }], undefined, { RPI: "Real Personal Income" }),
    ).toBe("date,Real Personal Income\r\n2026-01-01,1.5");
  });

  it("writes a header row and CRLF line ends, with no trailing newline", () => {
    expect(toCsv([{ symbol: "AAPL", close: 190.5 }])).toBe(
      "symbol,close\r\nAAPL,190.5",
    );
  });

  it("takes the columns as the union of every row's keys, in first-seen order", () => {
    expect(
      toCsv([
        { b: 1, a: 2 },
        { c: 3, a: 4 },
      ]),
    ).toBe("b,a,c\r\n1,2,\r\n,4,3");
  });

  it("quotes a field containing a comma, a quote, CR or LF, and doubles the quotes", () => {
    expect(toCsv([{ v: "a,b" }])).toBe('v\r\n"a,b"');
    expect(toCsv([{ v: 'say "hi"' }])).toBe('v\r\n"say ""hi"""');
    expect(toCsv([{ v: "line1\nline2" }])).toBe('v\r\n"line1\nline2"');
    expect(toCsv([{ v: "line1\r\nline2" }])).toBe('v\r\n"line1\r\nline2"');
  });

  // A backend string opening with = + - @ (or a tab or CR) is run as a formula
  // when the CSV is opened in a spreadsheet; a leading ' makes it text.
  it("defuses a string that a spreadsheet would run as a formula", () => {
    expect(toCsv([{ v: "=HYPERLINK(\"http://x\")" }])).toBe('v\r\n"\'=HYPERLINK(""http://x"")"');
    expect(toCsv([{ v: "+cmd" }, { v: "-2+3" }, { v: "@SUM(A1)" }])).toBe("v\r\n'+cmd\r\n'-2+3\r\n'@SUM(A1)");
  });

  it("leaves numbers, and strings that are plain numbers, alone", () => {
    expect(toCsv([{ a: -5, b: "-1.25", c: "+3" }])).toBe("a,b,c\r\n-5,-1.25,+3");
  });

  it("quotes a header that would otherwise break the row", () => {
    expect(toCsv([{ "a,b": 1 }])).toBe('"a,b"\r\n1');
  });

  it("writes null and undefined as empty, and numbers and booleans bare", () => {
    expect(toCsv([{ a: null, b: undefined, c: 0, d: false }])).toBe("a,b,c,d\r\n,,0,false");
  });

  it("JSON-stringifies a nested object or array", () => {
    expect(toCsv([{ v: { x: 1 } }])).toBe('v\r\n"{""x"":1}"');
    expect(toCsv([{ v: [1, 2] }])).toBe('v\r\n"[1,2]"');
  });

  it("writes the columns it is handed, in that order, rather than the row's own key order", () => {
    // An integer-like key enumerates FIRST in Object.keys regardless of
    // insertion order, so a transposed row's `Field` would lose its place
    // without an explicit list (see transposeRows).
    expect(toCsv([{ Field: "v", "2024": 1 }], ["Field", "2024"])).toBe("Field,2024\r\nv,1");
    expect(toCsv([{ Field: "v", "2024": 1 }])).toBe("2024,Field\r\n1,v");
  });

  it("does not let an inherited Object.prototype member stand in for a missing cell", () => {
    // Only the first row owns `constructor`, so the second row's cell must be
    // empty — not String(Object) picked up off the prototype chain.
    const rows: Record<string, unknown>[] = [{ constructor: "own" }, { other: 1 }];
    expect(toCsv(rows)).toBe("constructor,other\r\nown,\r\n,1");
  });
});

describe("toJson", () => {
  it("pretty-prints with two spaces", () => {
    expect(toJson({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  it("handles a payload that is not an object at all", () => {
    expect(toJson("hello")).toBe('"hello"');
  });
});

describe("toJsonRows", () => {
  it("writes the columns it is handed, in that order, rather than the row's own key order", () => {
    // The same hazard toCsv documents: "2024" is an integer-like key and
    // enumerates before "Field" whatever the insertion order, so plain
    // JSON.stringify would demote `Field`.
    expect(toJsonRows([{ Field: "v", "2024": 1 }], ["Field", "2024"])).toBe(
      '[\n  {\n    "Field": "v",\n    "2024": 1\n  }\n]',
    );
  });

  it("is byte-identical to toJson whenever the key order already agrees", () => {
    // Including a nested value: the hand-assembled top level must not change
    // how anything below it is written.
    const rows = [{ a: 1, b: { x: [1, 2] } }, { a: 2 }];

    expect(toJsonRows(rows)).toBe(toJson(rows));
  });

  it("omits a key the row does not own, and writes no rows as []", () => {
    expect(toJsonRows([{ a: 1 }, { b: 2 }], ["a", "b"])).toBe(
      '[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]',
    );
    expect(toJsonRows([{ a: 1 }], ["b"])).toBe("[\n  {}\n]");
    expect(toJsonRows([])).toBe("[]");
  });
});

describe("toXlsx", () => {
  it("writes the backend labels over the header row, the field key where there is none", async () => {
    sheet_add_aoa.mockClear();
    await toXlsx([{ date: "2026-01-01", RPI: 1.5 }], undefined, { RPI: "Real Personal Income" });
    expect(sheet_add_aoa).toHaveBeenCalledWith({ marker: "sheet" }, [["date", "Real Personal Income"]], { origin: "A1" });
  });

  it("leaves the header row alone when there are no labels", async () => {
    sheet_add_aoa.mockClear();
    await toXlsx([{ a: 1 }]);
    expect(sheet_add_aoa).not.toHaveBeenCalled();
  });

  it("builds one sheet named Data from the rows and returns its bytes", async () => {
    const rows = [{ a: 1 }, { a: 2 }];

    const bytes = await toXlsx(rows);

    expect(json_to_sheet).toHaveBeenCalledWith(rows, { header: ["a"] });
    expect(book_append_sheet).toHaveBeenCalledWith(
      expect.anything(),
      { marker: "sheet" },
      "Data",
    );
    expect(write).toHaveBeenCalledWith(expect.anything(), {
      bookType: "xlsx",
      type: "array",
    });
    // write() answers an ArrayBuffer; the helper's job is to hand back bytes.
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("hands SheetJS a copy of the column list, never the caller's own array", async () => {
    // SheetJS appends to the header array it is given. For the transposed
    // view that array IS Transposed.columns, held by WidgetCard's memo and
    // read again by toCsv/toJsonRows -- mutating it would corrupt them.
    const columns = ["a", "b"];
    // Nothing clears mocks between tests in this suite, so calls[0] is this
    // call's.
    json_to_sheet.mockClear();

    await toXlsx([{ a: 1, b: 2 }], columns);

    const [, options] = json_to_sheet.mock.calls[0] as unknown as [
      unknown,
      { header: string[] },
    ];
    const passed = options.header;
    expect(passed).toEqual(columns);
    expect(passed).not.toBe(columns);
  });
});

describe("exportFilename", () => {
  const day = new Date(2026, 7, 28); // 28 Aug 2026, local time

  it("joins the widget name, its params and the date", () => {
    expect(exportFilename("Price History", { symbol: "AAPL" }, "csv", day)).toBe(
      "Price History symbol=AAPL 2026-08-28.csv",
    );
  });

  it("orders params by name so the same card always produces the same filename", () => {
    expect(exportFilename("Q", { z: "1", a: "2" }, "json", day)).toBe(
      "Q a=2 z=1 2026-08-28.json",
    );
  });

  it("drops empty params rather than writing a bare k=", () => {
    expect(exportFilename("Q", { symbol: "AAPL", provider: "" }, "csv", day)).toBe(
      "Q symbol=AAPL 2026-08-28.csv",
    );
  });

  it("uses the date alone when there are no params", () => {
    expect(exportFilename("Q", {}, "xlsx", day)).toBe("Q 2026-08-28.xlsx");
  });

  it("dates the file by the wall clock, not UTC, on both sides of midnight", () => {
    // Whatever the runner's zone, one of these two instants falls on a
    // different UTC calendar day than the local one; the suggested name is
    // for the person looking at the card, so it follows the local day.
    expect(exportFilename("Q", {}, "csv", new Date(2026, 7, 28, 23, 30))).toBe("Q 2026-08-28.csv");
    expect(exportFilename("Q", {}, "csv", new Date(2026, 7, 28, 0, 30))).toBe("Q 2026-08-28.csv");
  });

  it("replaces path separators, reserved characters and control characters with a dash", () => {
    expect(exportFilename('A/B\\C:D*E?F"G<H>I|J', {}, "csv", day)).toBe(
      "A-B-C-D-E-F-G-H-I-J 2026-08-28.csv",
    );
    expect(exportFilename("A\u0000B\u001fC", {}, "csv", day)).toBe("A-B-C 2026-08-28.csv");
  });

  it("pads a single-digit month and day", () => {
    expect(exportFilename("Q", {}, "csv", new Date(2026, 0, 5))).toBe("Q 2026-01-05.csv");
  });

  it("trims the whole name to 120 characters, extension included", () => {
    const name = exportFilename("x".repeat(200), { a: "b" }, "csv", day);
    expect(name).toHaveLength(120);
    expect(name.endsWith(".csv")).toBe(true);
  });

  it("leaves no trailing space where the trim landed", () => {
    // 116 x's + " a=b …" would be cut mid-separator; the result must not end
    // in a space before the dot.
    const name = exportFilename("x".repeat(116), { a: "b" }, "csv", day);
    expect(name).toHaveLength(120);
    expect(name).not.toMatch(/ \.csv$/);
  });

  it("defaults to today when no date is given", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(exportFilename("Q", {}, "csv")).toBe(`Q ${expected}.csv`);
  });
});
