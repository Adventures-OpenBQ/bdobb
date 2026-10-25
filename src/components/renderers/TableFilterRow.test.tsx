// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { filterFns } from "@tanstack/react-table";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tableColumns, type Row } from "../../lib/tableColumns";
import type { TableSpec } from "../../lib/types";
import { SourceFilterPanel, FilterControl, filterFnFor, filterKindFor, parseDateBound } from "./TableFilterRow";

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
    expect(from).toHaveAttribute("title", "Use YYYY-MM-DD or a date expression such as T-1bd");
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
it('unknown input types require an explicit choice even for prototype-named field IDs',()=>{
 render(<SourceFilterPanel columns={[{id:'constructor',label:'Empty input'}]} formulas={[]} filters={[]} readonly={false} onChange={()=>{}}/>);
 expect(screen.getByLabelText('Filter type for Empty input')).toHaveValue('none');expect(screen.queryByLabelText('Minimum Empty input')).not.toBeInTheDocument();expect(screen.queryByLabelText('From Empty input')).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Filter type for Empty input'),{target:{value:'number'}});expect(screen.getByLabelText('Minimum Empty input')).toBeInTheDocument();
});
// D-020: drafts save one at a time after a pause, wait while busy, and are
// dropped once the saved filters carry them; a second field is not lost.
it('saves typed drafts one at a time after a pause, never while busy, and keeps both fields (D-020)',()=>{
 vi.useFakeTimers();
 try {
  const columns=[{id:'company',label:'Company',dtype:'text' as const},{id:'desk',label:'Desk',dtype:'text' as const}];
  const onChange=vi.fn();
  const view=(filters:{id:string;value:unknown}[],busy:boolean)=><SourceFilterPanel columns={columns} formulas={[]} filters={filters} readonly={false} busy={busy} onChange={onChange}/>;
  const {rerender}=render(view([],true));
  fireEvent.change(screen.getByLabelText('Filter Company'),{target:{value:'AAPL'}});
  fireEvent.change(screen.getByLabelText('Filter Desk'),{target:{value:'Trading'}});
  act(()=>{vi.advanceTimersByTime(1000);});
  expect(onChange).not.toHaveBeenCalled();
  rerender(view([],false));
  act(()=>{vi.advanceTimersByTime(249);});
  expect(onChange).not.toHaveBeenCalled();
  act(()=>{vi.advanceTimersByTime(1);});
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith('company','AAPL');
  rerender(view([{id:'company',value:'AAPL'}],false));
  act(()=>{vi.advanceTimersByTime(250);});
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith('desk','Trading');
  rerender(view([{id:'company',value:'AAPL'},{id:'desk',value:'Trading'}],false));
  act(()=>{vi.advanceTimersByTime(1000);});
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Filter Company')).toHaveValue('AAPL');
  expect(screen.getByLabelText('Filter Desk')).toHaveValue('Trading');
 } finally { vi.useRealTimers(); }
});

describe("parseDateBound", () => {
  it("reads YYYY-MM-DD as a bound, and blank as no bound", () => {
    expect(parseDateBound("2026-01-06")).toEqual({ ok: true, value: "2026-01-06" });
    expect(parseDateBound("  2026-01-06 ")).toEqual({ ok: true, value: "2026-01-06" });
    expect(parseDateBound("")).toEqual({ ok: true, value: undefined });
    expect(parseDateBound("   ")).toEqual({ ok: true, value: undefined });
  });

  it("refuses anything else, including a date that is not on the calendar", () => {
    for (const text of ["2026-1-6", "06/01/2026", "2026-02-30", "2026-13-01", "abc", "T-1x", "T-1/T"]) {
      expect(parseDateBound(text)).toEqual({ ok: false });
    }
  });

  // v4: the boxes also take the date expressions params take (T-1bd, T-26w,
  // FQ-4 ...). The text is what is kept, so it re-resolves on every refresh;
  // `day` is what it names under the clock it was read with.
  it("keeps a date expression as its text, with the day it names now", () => {
    const ctx = { now: new Date("2026-10-14T15:00:00Z"), zone: "UTC" };
    expect(parseDateBound("T", ctx)).toEqual({ ok: true, value: "T", day: "2026-10-14" });
    expect(parseDateBound("T-1", ctx)).toEqual({ ok: true, value: "T-1", day: "2026-10-13" });
    expect(parseDateBound("T-1bd", ctx)).toEqual({ ok: true, value: "T-1bd", day: "2026-10-13" });
    expect(parseDateBound("T-26w", ctx)).toEqual({ ok: true, value: "T-26w", day: "2026-04-15" });
    expect(parseDateBound(" T-1bd ", { ...ctx, now: new Date("2026-10-15T15:00:00Z") })).toEqual({ ok: true, value: "T-1bd", day: "2026-10-14" });
  });
});

// The Input filters panel's date inputs are the same text boxes: Enter hands
// the bound to the D-020 draft, which saves it after the 250 ms pause.
it("a date typed into an Input filter saves through the D-020 draft", () => {
  vi.useFakeTimers();
  try {
    const onChange = vi.fn();
    render(
      <SourceFilterPanel
        columns={[{ id: "reportDate", label: "reportDate", dtype: "date" as const }]}
        formulas={[]}
        filters={[]}
        readonly={false}
        onChange={onChange}
      />,
    );
    const from = screen.getByLabelText("From reportDate");
    expect(from).toHaveAttribute("type", "text");
    fireEvent.change(from, { target: { value: "2025-01-01" } });
    fireEvent.keyDown(from, { key: "Enter" });
    act(() => { vi.advanceTimersByTime(249); });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onChange).toHaveBeenLastCalledWith("reportDate", { from: "2025-01-01", to: undefined });
  } finally {
    vi.useRealTimers();
  }
});

describe("a date expression in a filter box", () => {
  const ctx = { now: new Date("2026-01-07T17:00:00Z"), zone: "America/New_York" };

  it("is applied as its text, not as the day", async () => {
    const onChange = vi.fn();
    render(<FilterControl kind="date" header="Date" value={undefined} dateContext={ctx} onChange={onChange} />);
    const to = screen.getByLabelText("To Date");
    await userEvent.type(to, "T-1bd{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ from: undefined, to: "T-1bd" });
  });

  it("shows the expression, and the day it names today in its title", () => {
    render(<FilterControl kind="date" header="Date" value={{ to: "T-1bd" }} dateContext={ctx} onChange={vi.fn()} />);
    const to = screen.getByLabelText("To Date");
    expect(to).toHaveValue("T-1bd");
    expect(to).toHaveAttribute("title", "T-1bd is 2026-01-06 today");
  });
});
