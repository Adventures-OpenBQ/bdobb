// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { filterFns } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tableColumns, type Row } from "../../lib/tableColumns";
import type { TableSpec } from "../../lib/types";
import { FilterControl, filterFnFor, filterKindFor, parseDateBound } from "./TableFilterRow";

const columnFor = (rows: Row[], spec: TableSpec | undefined, field: string) =>
  tableColumns(rows, spec).find((c) => c.field === field)!;

describe("filterKindFor", () => {
  const rows = [{ a: 1 }];

  it("uses cellDataType when the spec gives one", () => {
    const kinds: Array<[NonNullable<TableSpec["columns"][number]["cellDataType"]>, string]> = [
      ["text", "text"],
      ["number", "number"],
      ["boolean", "boolean"],
      ["date", "date"],
      ["dateString", "date"],
      ["object", "none"],
    ];
    for (const [cellDataType, expected] of kinds) {
      const spec: TableSpec = { columns: [{ field: "a", cellDataType }] };
      expect(filterKindFor(columnFor(rows, spec, "a"), rows)).toBe(expected);
    }
  });

  it("falls back to the first non-null value's type", () => {
    const cases: Array<[unknown, string]> = [
      [1.5, "number"],
      [true, "boolean"],
      ["AAPL", "text"],
      ["2026-08-28T00:00:00Z", "date"],
      [{ nested: 1 }, "none"],
    ];
    for (const [value, expected] of cases) {
      const data = [{ a: null }, { a: value }];
      expect(filterKindFor(columnFor(data, undefined, "a"), data)).toBe(expected);
    }
  });

  it("offers no filter for a column that is null all the way down", () => {
    const data = [{ a: null }, { a: undefined }];
    expect(filterKindFor(columnFor(data, undefined, "a"), data)).toBe("none");
  });
});

describe("filterFnFor", () => {
  /** A stand-in for the one method the filter functions use. */
  const row = (value: unknown) => ({ getValue: () => value }) as never;
  /** Built-in names are resolved out of table-core exactly as the table does. */
  const run = (kind: "text" | "number" | "date" | "boolean", value: unknown, cell: unknown) => {
    const fn = filterFnFor(kind)!;
    return (typeof fn === "string" ? filterFns[fn] : fn)(row(cell), "a", value, () => {});
  };

  it("hands text to table-core's own includesString rather than a copy of it", () => {
    expect(filterFnFor("text")).toBe("includesString");
  });

  it("text matches case-insensitively, anywhere in the value", () => {
    expect(run("text", "aap", "AAPL")).toBe(true);
    expect(run("text", "PL", "AAPL")).toBe(true);
    expect(run("text", "msft", "AAPL")).toBe(false);
    // Stringified, so a number column filtered as text still works.
    expect(run("text", "23", 1234)).toBe(true);
    expect(run("text", "x", null)).toBe(false);
  });

  it("number honours min alone, max alone, and both, inclusively", () => {
    expect(run("number", { min: 5 }, 5)).toBe(true);
    expect(run("number", { min: 5 }, 4.9)).toBe(false);
    expect(run("number", { max: 5 }, 5)).toBe(true);
    expect(run("number", { max: 5 }, 5.1)).toBe(false);
    expect(run("number", { min: 1, max: 5 }, 3)).toBe(true);
    expect(run("number", { min: 1, max: 5 }, 6)).toBe(false);
    // A non-number cell cannot satisfy a numeric range.
    expect(run("number", { min: 1 }, "3")).toBe(false);
    expect(run("number", { min: 1 }, null)).toBe(false);
  });

  it("date compares the leading calendar date, never a parsed Date", () => {
    expect(run("date", { from: "2026-01-01" }, "2026-08-28T23:00:00")).toBe(true);
    expect(run("date", { to: "2026-01-01" }, "2026-08-28T23:00:00")).toBe(false);
    expect(run("date", { from: "2026-08-28", to: "2026-08-28" }, "2026-08-28T23:00:00")).toBe(true);
    expect(run("date", { from: "2026-01-01" }, 20260828)).toBe(false);
  });

  it("boolean matches the stringified cell", () => {
    expect(run("boolean", "true", true)).toBe(true);
    expect(run("boolean", "false", false)).toBe(true);
    expect(run("boolean", "true", false)).toBe(false);
  });

  it("gives an object column no filter function at all", () => {
    expect(filterFnFor("none")).toBeUndefined();
  });
});

describe("FilterControl", () => {
  it("renders nothing for an object column", () => {
    const { container } = render(
      <FilterControl kind="none" header="meta" value={undefined} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reports each keystroke of a contains box, and an empty box as undefined-by-value", async () => {
    const onChange = vi.fn();
    render(<FilterControl kind="text" header="Ticker" value="" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Filter Ticker"), "A");

    // "" is what table-core auto-removes, so an empty box needs no special case.
    expect(onChange).toHaveBeenCalledWith("A");
  });

  it("reports a number range, and undefined once both ends are empty", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterControl kind="number" header="Close" value={undefined} onChange={onChange} />,
    );

    await userEvent.type(screen.getByLabelText("Minimum Close"), "5");
    expect(onChange).toHaveBeenCalledWith({ min: 5, max: undefined });

    rerender(<FilterControl kind="number" header="Close" value={{ min: 5 }} onChange={onChange} />);
    await userEvent.clear(screen.getByLabelText("Minimum Close"));
    // An empty object would keep the filter alive and match everything;
    // undefined is what removes it.
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("prefills From and To as text with the column's first and last date, and filters nothing", () => {
    const onChange = vi.fn();
    render(
      <FilterControl kind="date" header="Date" value={undefined} bounds={{ first: "2026-01-02", last: "2026-01-08" }} onChange={onChange} />,
    );
    const from = screen.getByLabelText("From Date");
    expect(from).toHaveAttribute("type", "text");
    expect(from).toHaveValue("2026-01-02");
    expect(screen.getByLabelText("To Date")).toHaveValue("2026-01-08");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies an edited date on Enter, not on each keystroke", async () => {
    const onChange = vi.fn();
    render(
      <FilterControl kind="date" header="Date" value={undefined} bounds={{ first: "2026-01-02", last: "2026-01-08" }} onChange={onChange} />,
    );
    const from = screen.getByLabelText("From Date");
    await userEvent.clear(from);
    await userEvent.type(from, "2026-01-05");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-01-05", to: undefined });
  });

  it("applies on leaving the box, and an emptied box removes its bound", async () => {
    const onChange = vi.fn();
    render(
      <FilterControl kind="date" header="Date" value={{ to: "2026-01-06" }} bounds={{ first: "2026-01-02", last: "2026-01-08" }} onChange={onChange} />,
    );
    const to = screen.getByLabelText("To Date");
    expect(to).toHaveValue("2026-01-06");
    await userEvent.clear(to);
    fireEvent.blur(to);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("marks text that is not YYYY-MM-DD and leaves the filter alone", async () => {
    const onChange = vi.fn();
    render(
      <FilterControl kind="date" header="Date" value={undefined} bounds={{ first: "2026-01-02", last: "2026-01-08" }} onChange={onChange} />,
    );
    const from = screen.getByLabelText("From Date");
    await userEvent.clear(from);
    await userEvent.type(from, "01/05/2026{Enter}");
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(from).toHaveAttribute("title", "Use YYYY-MM-DD");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers any/true/false for a boolean column, with any clearing the filter", async () => {
    const onChange = vi.fn();
    render(<FilterControl kind="boolean" header="Active" value="true" onChange={onChange} />);

    const select = screen.getByLabelText("Filter Active");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "any",
      "true",
      "false",
    ]);

    await userEvent.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    await userEvent.selectOptions(select, "false");
    expect(onChange).toHaveBeenLastCalledWith("false");
  });
});

describe("parseDateBound", () => {
  it("reads YYYY-MM-DD as a bound, and blank as no bound", () => {
    expect(parseDateBound("2026-01-06")).toEqual({ ok: true, value: "2026-01-06" });
    expect(parseDateBound("  2026-01-06 ")).toEqual({ ok: true, value: "2026-01-06" });
    expect(parseDateBound("")).toEqual({ ok: true, value: undefined });
    expect(parseDateBound("   ")).toEqual({ ok: true, value: undefined });
  });

  it("refuses anything else, including a date that is not on the calendar", () => {
    for (const text of ["2026-1-6", "06/01/2026", "2026-02-30", "2026-13-01", "T-1", "abc"]) {
      expect(parseDateBound(text)).toEqual({ ok: false });
    }
  });
});
