// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarRenderer } from "./CalendarRenderer";
import { fetchWindow } from "../../lib/calendarView";
import type { CalendarCardState } from "../../lib/types";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-09T14:00:00Z")); // Wed 9 Sep, 10:00 New York
});
afterEach(() => vi.useRealTimers());

const NY = "America/New_York";
const rows = [
  { date: "2026-09-11 12:30:00", event: "Inflation Rate YOY", previous: 3.4, estimate: 3.4 },
  { date: "2026-09-11 12:30:00", event: "Core Inflation Rate YOY", previous: 2.5, estimate: 2.4 },
  { date: "2026-09-08", event: "3-Year Note Auction" },
  { date: "2026-09-12 19:30:00", event: "CFTC Gold Speculative net positions" }, // Saturday
  { date: "2026-09-17 20:30:00", event: "Central Bank Balance Sheet" },
];

function cell(day: string) {
  return screen.getByTestId(`cal-cell-${day}`);
}

describe("CalendarRenderer", () => {
  it("month: draws the weeks of September over Mon–Fri with today marked", () => {
    render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(25);
    expect(cell("2026-09-09")).toHaveClass("calendar-cell-today");
    expect(cell("2026-08-31")).toHaveClass("calendar-cell-out");
  });

  it("lists a day's events all-day first then by local time, and shows the count", () => {
    render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    const fri = within(cell("2026-09-11"));
    expect(fri.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("08:30Inflation Rate YOY"),
      expect.stringContaining("08:30Core Inflation Rate YOY"),
    ]);
    // Both CPI rows carry an estimate, so both are set in medium weight.
    expect(fri.getAllByRole("listitem")[0]).toHaveClass("calendar-ev-est");
    expect(within(cell("2026-09-08")).getByText("ALL DAY")).toBeInTheDocument();
    expect(within(cell("2026-09-11")).getByText("2")).toBeInTheDocument();
  });

  it("reports events on hidden days and the business-day label", async () => {
    render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    const biz = screen.getByRole("button", { name: "Mon–Fri" });
    await userEvent.click(biz);
    expect(screen.getByText("1 event falls on hidden days in this range")).toBeInTheDocument();
  });

  it("toolbar writes each facet through onPatch", async () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{}} onPatch={onPatch} timeZone={NY} />);
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onPatch).toHaveBeenLastCalledWith({ unit: "week" });
    await userEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(onPatch).toHaveBeenLastCalledWith({ cellMode: "timeline" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Even rows" }));
    expect(onPatch).toHaveBeenLastCalledWith({ evenRows: true });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPatch).toHaveBeenLastCalledWith({ cursor: "2026-10-01" });
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onPatch).toHaveBeenLastCalledWith({ cursor: "2026-09-09" });
    await userEvent.click(screen.getByRole("button", { name: "Mon–Fri" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Sat" }));
    expect(onPatch).toHaveBeenLastCalledWith({ businessDays: [1, 2, 3, 4, 5, 6] });
  });

  it("will not uncheck the last business day", async () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{ businessDays: [3] }} onPatch={onPatch} timeZone={NY} />);
    await userEvent.click(screen.getByRole("button", { name: "Wed" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Wed" }));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("even rows marks the grid; the default does not", () => {
    const { rerender } = render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getByTestId("cal-grid")).not.toHaveClass("calendar-even");
    rerender(<CalendarRenderer rows={rows} state={{ evenRows: true }} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getByTestId("cal-grid")).toHaveClass("calendar-even");
  });

  it("week and day units", () => {
    const { rerender } = render(
      <CalendarRenderer rows={rows} state={{ unit: "week" }} onPatch={vi.fn()} timeZone={NY} />,
    );
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(5);
    // The range reads as a span of two dates, with no weekday and no leading
    // space left behind by slicing one off.
    expect(document.querySelector(".calendar-range")?.textContent).toMatch(/^7 \S+ 2026 – 11 \S+ 2026$/);
    rerender(<CalendarRenderer rows={rows} state={{ unit: "day", cursor: "2026-09-12" }} onPatch={vi.fn()} timeZone={NY} />);
    // Saturday is not a business day: the day view shows the next one.
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(1);
    expect(cell("2026-09-14")).toBeInTheDocument();
  });

  it("wheel steps one unit per gesture, except over a cell that can scroll", () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{}} onPatch={onPatch} timeZone={NY} />);
    const grid = screen.getByTestId("cal-grid");
    fireEvent.wheel(grid, { deltaY: 50 });
    expect(onPatch).toHaveBeenLastCalledWith({ cursor: "2026-10-01" });
    fireEvent.wheel(grid, { deltaY: 50 }); // inside the 300 ms lock
    expect(onPatch).toHaveBeenCalledTimes(1);
    // A scrollable list: jsdom has no layout, so fake the two heights.
    const list = within(cell("2026-09-11")).getByRole("list");
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    vi.advanceTimersByTime(400);
    fireEvent.wheel(list, { deltaY: 50 });
    expect(onPatch).toHaveBeenCalledTimes(1);
    // The day-of-week header is outside the grid but inside the sheet, and in a
    // dense month it is often the only target that is not a scrollable list.
    vi.advanceTimersByTime(400);
    fireEvent.wheel(screen.getByRole("row"), { deltaY: 50 });
    expect(onPatch).toHaveBeenCalledTimes(2);
  });

  it("keyboard: arrows step, Home is today", () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{ unit: "week" }} onPatch={onPatch} timeZone={NY} />);
    const grid = screen.getByTestId("cal-grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(onPatch).toHaveBeenLastCalledWith({ cursor: "2026-09-16" });
    fireEvent.keyDown(grid, { key: "Home" });
    expect(onPatch).toHaveBeenLastCalledWith({ cursor: "2026-09-09" });
  });

  it("keyboard: continuous leaves the arrows to the scroll box", () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{ unit: "continuous" }} onPatch={onPatch} timeZone={NY} />);
    fireEvent.keyDown(screen.getByTestId("cal-grid"), { key: "ArrowDown" });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("asks for the fetch window once per settled cursor", () => {
    const onRange = vi.fn();
    render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenCalledWith({ start_date: "2026-07-27", end_date: "2026-11-01" });
  });

  it("read-only hides the toolbar and ignores the wheel", () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{}} onPatch={onPatch} readOnly timeZone={NY} />);
    expect(screen.queryByRole("button", { name: "Week" })).toBeNull();
    fireEvent.wheel(screen.getByTestId("cal-grid"), { deltaY: 50 });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("falls back to detection when a persisted column override is gone from the rows", () => {
    render(<CalendarRenderer rows={rows} state={{ dateField: "gone" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(25);
    expect(within(cell("2026-09-11")).getAllByRole("listitem")).toHaveLength(2);
  });

  // Review S-rend-3: the columns were read off the first row only, so an
  // override naming a field the first row happens to lack was dropped.
  it("honours a column override that the first row does not carry", () => {
    const sparse = [
      { date: "2026-09-08", event: "3-Year Note Auction" },
      { date: "2026-09-08", event: "10-Year Note Auction", headline: "Tens reopen" },
    ];
    render(<CalendarRenderer rows={sparse} state={{ titleField: "headline" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(within(cell("2026-09-08")).getByText("Tens reopen")).toBeInTheDocument();
  });

  it("explains itself when no date column can be found", () => {
    render(<CalendarRenderer rows={[{ label: "Q3", value: 1 }]} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getByText(/no date column/i)).toBeInTheDocument();
  });

  it("captures the wheel with a non-passive listener, but not over a scrollable list", () => {
    render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    const grid = screen.getByTestId("cal-grid");
    const gridEvent = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
    grid.dispatchEvent(gridEvent);
    expect(gridEvent.defaultPrevented).toBe(true);

    const list = within(cell("2026-09-11")).getByRole("list");
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    const listEvent = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
    list.dispatchEvent(listEvent);
    expect(listEvent.defaultPrevented).toBe(false);
  });

  it("continuous: a prepend is corrected once React has committed the new rows", () => {
    render(<CalendarRenderer rows={rows} state={{ unit: "continuous" }} onPatch={vi.fn()} timeZone={NY} />);
    const grid = screen.getByTestId("cal-grid");
    expect(screen.getAllByTestId(/^cal-cell-/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".calendar-week")).toHaveLength(7);

    // jsdom lays nothing out, so stand in for a layout: every week row is worth
    // 50 px, which makes scrollHeight grow exactly as the DOM does and lets the
    // correction be measured rather than assumed.
    Object.defineProperty(grid, "scrollTop", { value: 0, writable: true, configurable: true });
    // 200 px of view, so the thirteen rows after the prepend leave more than
    // CONT_EDGE below it and the fill effect has nothing to add.
    Object.defineProperty(grid, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(grid, "scrollHeight", {
      configurable: true,
      get: () => grid.querySelectorAll(".calendar-week").length * 50,
    });
    fireEvent.scroll(grid);
    expect(document.querySelectorAll(".calendar-week")).toHaveLength(13); // grew by 6, once
    // Six rows of 50 px went in above: the reader is scrolled past them, so the
    // week they were looking at is still under their eyes.
    expect(grid.scrollTop).toBe(300);

    fireEvent.scroll(grid); // no longer within CONT_EDGE of the top: no second prepend
    expect(document.querySelectorAll(".calendar-week")).toHaveLength(13);
    expect(grid.scrollTop).toBe(300);
  });

  it("continuous: opens with the cursor's week at the top of the box", () => {
    // Same absent layout, faked at the prototype: the effect reads offsetTop
    // and writes scrollTop on elements that do not exist until it renders.
    const scrolls = new WeakMap<Element, number>();
    const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get() { return scrolls.get(this) ?? 0; },
      set(v: number) { scrolls.set(this, v); },
    });
    const offsetTop = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      // Week rows stack at 50 px each; everything else, the grid included,
      // starts at the top, which is what the effect subtracts.
      return this.classList.contains("calendar-week") && this.parentElement
        ? [...this.parentElement.children].indexOf(this) * 50
        : 0;
    });
    try {
      render(<CalendarRenderer rows={rows} state={{ unit: "continuous" }} onPatch={vi.fn()} timeZone={NY} />);
      // The sheet opens one week before the cursor's, so the cursor's week is
      // the second row: 1 × 50 px of past scrolled out of sight.
      expect(screen.getByTestId("cal-grid").scrollTop).toBe(50);
    } finally {
      offsetTop.mockRestore();
      Object.defineProperty(Element.prototype, "scrollTop", scrollTop);
    }
  });

  it("continuous: still lands on the cursor's week when Monday itself is a hidden business day", () => {
    // Same instrumentation as the test above: jsdom lays nothing out, so
    // offsetTop and scrollTop are faked at the prototype so the layout effect
    // has something real to read and write.
    const scrolls = new WeakMap<Element, number>();
    const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get() { return scrolls.get(this) ?? 0; },
      set(v: number) { scrolls.set(this, v); },
    });
    const offsetTop = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("calendar-week") && this.parentElement
        ? [...this.parentElement.children].indexOf(this) * 50
        : 0;
    });
    try {
      render(
        <CalendarRenderer
          rows={rows}
          state={{ unit: "continuous", businessDays: [2, 3, 4, 5] }}
          onPatch={vi.fn()}
          timeZone={NY}
        />,
      );
      // Business days are Tue-Fri, so a row's first drawn day is Tuesday, not
      // its Monday. If the landing query still matched against days[0] it
      // would miss every row and open at scrollTop 0, a week in the past.
      const row = document.querySelector<HTMLElement>('.calendar-week[data-week="2026-09-07"]');
      expect(row).not.toBeNull();
      expect(screen.getByTestId("cal-grid").scrollTop).toBe(row!.offsetTop);
    } finally {
      offsetTop.mockRestore();
      Object.defineProperty(Element.prototype, "scrollTop", scrollTop);
    }
  });

  it("continuous: the month name prints once a row and once a month, not in every cell", () => {
    render(<CalendarRenderer rows={rows} state={{ unit: "continuous" }} onPatch={vi.fn()} timeZone={NY} />);
    const weeks = [...document.querySelectorAll(".calendar-week")];
    // The rule is "first cell of each month, first cell of each row": one per
    // row, plus every 1st of a month that is not already a row's first cell.
    const firstsMidRow = weeks.reduce(
      (n, w) => n + [...w.children].filter((c, i) => i > 0 && (c as HTMLElement).dataset.testid?.endsWith("-01")).length,
      0,
    );
    expect(weeks).toHaveLength(7);
    expect(firstsMidRow).toBeGreaterThan(0); // 1 Sep and 1 Oct are weekdays, mid-row
    expect(document.querySelectorAll(".calendar-mon")).toHaveLength(weeks.length + firstsMidRow);
  });

  it("timeline: a vertical axis per cell, events as blocks at their local hour, same-instant releases grouped", () => {
    render(<CalendarRenderer rows={rows} state={{ unit: "week", cursor: "2026-09-11", cellMode: "timeline" }} onPatch={vi.fn()} timeZone={NY} />);
    const fri = within(cell("2026-09-11"));
    const blocks = fri.getAllByTestId("cal-block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveTextContent("08:30 Inflation Rate YOY");
    expect(blocks[0]).toHaveTextContent("×2");
    // The axis fits the events with an hour of air each side and is never narrower
    // than 08:00–17:00, so an 08:30 print starts it at 07: 08:30 sits 1.5/10 down.
    expect(blocks[0].style.top).toBe("calc(15% + 1px)");
    expect(fri.getAllByTestId("cal-hour").map((h) => h.textContent)).toEqual(
      ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17"],
    );
  });

  it("timeline: all-day events sit in a band above the axis", () => {
    render(<CalendarRenderer rows={rows} state={{ unit: "week", cursor: "2026-09-08", cellMode: "timeline" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(within(cell("2026-09-08")).getByText("3-Year Note Auction")).toHaveClass("calendar-chip");
  });

  it("timeline: month cells label every third hour and group by half hour", () => {
    const halfHour = [
      { date: "2026-09-16 14:00:00", event: "NAHB Housing Market Index" },
      { date: "2026-09-16 14:30:00", event: "EIA Crude Oil Stocks Change" },
      { date: "2026-09-16 14:45:00", event: "Late one" },
    ];
    render(<CalendarRenderer rows={halfHour} state={{ cellMode: "timeline" }} onPatch={vi.fn()} timeZone={NY} />);
    const wed = within(cell("2026-09-16"));
    expect(wed.getAllByTestId("cal-block")).toHaveLength(2);
    expect(wed.getAllByTestId("cal-hour").filter((h) => h.textContent !== "").map((h) => h.textContent)).toEqual(["08", "11", "14", "17"]);
  });

  it("timeline: the now-line appears only on today's cell", () => {
    render(<CalendarRenderer rows={rows} state={{ unit: "week", cellMode: "timeline" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(within(cell("2026-09-09")).getByTestId("cal-now")).toBeInTheDocument();
    expect(within(cell("2026-09-10")).queryByTestId("cal-now")).toBeNull();
  });
});

/**
 * jsdom lays nothing out, so a scroll offset has to be faked at the prototype
 * for an effect to have something real to read and write. `axis` picks which
 * pair, and `unit` is the class whose siblings stack at 50 px each — the same
 * standing-in-for-a-layout the Continuous tests above do, factored out because
 * four of the mode tests need it.
 */
function fakeLayout(axis: "top" | "left", unit: string) {
  const scrolls = new WeakMap<Element, number>();
  const scrollProp = axis === "top" ? "scrollTop" : "scrollLeft";
  const offsetProp = axis === "top" ? "offsetTop" : "offsetLeft";
  const saved = Object.getOwnPropertyDescriptor(Element.prototype, scrollProp)!;
  Object.defineProperty(Element.prototype, scrollProp, {
    configurable: true,
    get() { return scrolls.get(this) ?? 0; },
    set(v: number) { scrolls.set(this, v); },
  });
  const offset = vi.spyOn(HTMLElement.prototype, offsetProp, "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(unit) && this.parentElement
      ? [...this.parentElement.children].indexOf(this) * 50
      : 0;
  });
  return () => {
    offset.mockRestore();
    Object.defineProperty(Element.prototype, scrollProp, saved);
  };
}

describe("CalendarRenderer modes", () => {
  it("the toolbar leads with the mode and then shows that mode's own controls", async () => {
    const onPatch = vi.fn();
    const { rerender } = render(<CalendarRenderer rows={rows} state={{}} onPatch={onPatch} timeZone={NY} />);
    const modes = within(screen.getByRole("group", { name: "Mode" })).getAllByRole("button");
    expect(modes.map((b) => b.textContent)).toEqual(["Static", "Vertical", "Horizontal", "Paged"]);
    expect(modes[3]).toHaveAttribute("aria-pressed", "true");
    // Paged owns the unit control; `continuous` is no longer one of its units.
    expect(within(screen.getByRole("group", { name: "Unit" })).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Day", "Week", "Month"]);
    await userEvent.click(modes[1]);
    expect(onPatch).toHaveBeenLastCalledWith({ mode: "vertical" });

    rerender(<CalendarRenderer rows={rows} state={{ mode: "vertical" }} onPatch={onPatch} timeZone={NY} />);
    expect(screen.queryByRole("group", { name: "Unit" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Days" }));
    expect(onPatch).toHaveBeenLastCalledWith({ rowUnit: "day" });
    await userEvent.click(screen.getByRole("button", { name: "Weeks" }));
    expect(onPatch).toHaveBeenLastCalledWith({ rowUnit: "week" });

    rerender(<CalendarRenderer rows={rows} state={{ mode: "horizontal" }} onPatch={onPatch} timeZone={NY} />);
    expect(screen.queryByRole("button", { name: "Days" })).toBeNull();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("compat: a pre-rework continuous card is Vertical weeks, any other unit is that Paged unit", () => {
    const { rerender } = render(<CalendarRenderer rows={rows} state={{ unit: "continuous" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(document.querySelectorAll(".calendar-week")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Vertical" })).toHaveAttribute("aria-pressed", "true");
    rerender(<CalendarRenderer rows={rows} state={{ unit: "week" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getByRole("button", { name: "Paged" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(5);
  });

  it("static: draws the widget's own range, dims outside it, and never pushes a window", () => {
    const onRange = vi.fn();
    render(
      <CalendarRenderer
        rows={rows}
        state={{ mode: "static" }}
        range={{ start: "2026-09-09", end: "2026-09-22" }}
        onPatch={vi.fn()}
        onRange={onRange}
        timeZone={NY}
      />,
    );
    // The weeks of 7, 14 and 21 September over Mon–Fri.
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(15);
    expect(cell("2026-09-08")).toHaveClass("calendar-cell-out");
    expect(cell("2026-09-09")).not.toHaveClass("calendar-cell-out");
    expect(cell("2026-09-25")).toHaveClass("calendar-cell-out");
    // The parameter panel is the control: no cursor motion in the toolbar.
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
    vi.advanceTimersByTime(400);
    expect(onRange).not.toHaveBeenCalled();
  });

  it("static: without a range, spans the rows it was given", () => {
    render(<CalendarRenderer rows={rows} state={{ mode: "static" }} onPatch={vi.fn()} timeZone={NY} />);
    // The rows run 8 to 17 September: the weeks of the 7th and the 14th.
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(10);
  });

  it("static: an unparseable range bound spans the rows instead of crashing", () => {
    render(<CalendarRenderer rows={rows} state={{ mode: "static" }} range={{ start: "not a date", end: "2026-09-22" }} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(10);
  });

  it("vertical days: an agenda row per business day, opening on the cursor's day", () => {
    const restore = fakeLayout("top", "calendar-agenda-row");
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "vertical", rowUnit: "day" }} onPatch={vi.fn()} timeZone={NY} />);
      const agenda = [...document.querySelectorAll<HTMLElement>(".calendar-agenda-row")];
      expect(agenda).toHaveLength(35); // seven weeks of Mon–Fri: one before the cursor's, five after
      // One week of Mon–Fri is five rows, and the cursor is the Wednesday of
      // the week after them: row 7, at 50 px each, scrolled out of sight.
      expect(agenda[7].dataset.day).toBe("2026-09-09");
      expect(screen.getByTestId("cal-grid").scrollTop).toBe(350);
    } finally {
      restore();
    }
  });

  it("horizontal: a ribbon of day columns, landing on the cursor and taking a vertical wheel sideways", () => {
    const restore = fakeLayout("left", "calendar-col");
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "horizontal" }} onPatch={vi.fn()} timeZone={NY} />);
      const ribbon = document.querySelector<HTMLElement>(".calendar-ribbon")!;
      const cols = [...ribbon.querySelectorAll<HTMLElement>(".calendar-col[data-day]")];
      expect(cols).toHaveLength(35);
      expect(cols[7].dataset.day).toBe("2026-09-09");
      expect(ribbon.scrollLeft).toBe(350);
      // A mouse has no horizontal wheel: a vertical one moves the ribbon, and
      // only a non-passive listener can take the event off the ancestors.
      const wheel = new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true });
      ribbon.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      expect(ribbon.scrollLeft).toBe(400);
    } finally {
      restore();
    }
  });

  it("horizontal: a left-hand prepend is corrected once React has committed the new columns", () => {
    const restore = fakeLayout("left", "nothing-lays-out");
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "horizontal" }} onPatch={vi.fn()} timeZone={NY} />);
      const ribbon = document.querySelector<HTMLElement>(".calendar-ribbon")!;
      Object.defineProperty(ribbon, "clientWidth", { value: 400, configurable: true });
      Object.defineProperty(ribbon, "scrollWidth", {
        configurable: true,
        get: () => ribbon.querySelectorAll(".calendar-col").length * 50,
      });
      fireEvent.scroll(ribbon); // at the left edge: six more weeks go in on the left
      expect(ribbon.querySelectorAll(".calendar-col")).toHaveLength(65);
      // Thirty columns of 50 px went in ahead of the reader; the correction is
      // exactly that growth, and it happens in a layout effect, not here.
      expect(ribbon.scrollLeft).toBe(1500);
    } finally {
      restore();
    }
  });

  it("keyboard: Home re-lands an endless mode on today", () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={rows} state={{ mode: "horizontal", cursor: "2026-08-03" }} onPatch={onPatch} timeZone={NY} />);
    fireEvent.keyDown(document.querySelector(".calendar-ribbon")!, { key: "Home" });
    expect(onPatch).toHaveBeenLastCalledWith({ cursor: "2026-09-09" });
  });

  it("horizontal: Today re-lands the ribbon even though the cursor never moved", () => {
    // The cursor is already today's, so clicking Today patches a
    // value-identical `{ cursor: today }` — onPatch is a spy here and never
    // feeds a changed prop back in. Only the `landing` counter can be moving
    // the ribbon back; a regression here means that counter (or its wiring
    // into the landing layout effect's deps) is gone.
    const restore = fakeLayout("left", "calendar-col");
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "horizontal" }} onPatch={vi.fn()} timeZone={NY} />);
      const ribbon = document.querySelector<HTMLElement>(".calendar-ribbon")!;
      expect(ribbon.scrollLeft).toBe(350); // opens landed on the cursor's column
      ribbon.scrollLeft = 9999; // the reader scrolls the ribbon far away
      fireEvent.click(screen.getByRole("button", { name: "Today" }));
      expect(ribbon.scrollLeft).toBe(350);
    } finally {
      restore();
    }
  });

  it("vertical weeks: Home re-lands the sheet even though the cursor never moved", () => {
    const restore = fakeLayout("top", "calendar-week");
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "vertical" }} onPatch={vi.fn()} timeZone={NY} />);
      const grid = screen.getByTestId("cal-grid");
      expect(grid.scrollTop).toBe(50); // opens landed on the cursor's week
      grid.scrollTop = 9999; // the reader scrolls the sheet far away
      fireEvent.keyDown(grid, { key: "Home" });
      expect(grid.scrollTop).toBe(50);
    } finally {
      restore();
    }
  });

  it("pushes the window each mode asks for, and nothing at all in Static", () => {
    const onRange = vi.fn();
    const { rerender } = render(<CalendarRenderer rows={rows} state={{ mode: "vertical" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    expect(onRange).toHaveBeenLastCalledWith(fetchWindow("continuous", "2026-09-09"));
    rerender(<CalendarRenderer rows={rows} state={{ mode: "horizontal" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    expect(onRange).toHaveBeenLastCalledWith(fetchWindow("continuous", "2026-09-09"));
    rerender(<CalendarRenderer rows={rows} state={{ mode: "paged", unit: "week" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    expect(onRange).toHaveBeenLastCalledWith(fetchWindow("week", "2026-09-09"));
    onRange.mockClear();
    rerender(<CalendarRenderer rows={rows} state={{ mode: "static" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(400);
    expect(onRange).not.toHaveBeenCalled();
  });

  it.each([
    ["vertical weeks", { mode: "vertical" as const }],
    ["vertical days", { mode: "vertical" as const, rowUnit: "day" as const }],
    ["horizontal", { mode: "horizontal" as const }],
  ])("%s: opens on, and pushes, one week back through five weeks ahead", (_, state) => {
    const onRange = vi.fn();
    render(<CalendarRenderer rows={rows} state={state} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    // Today is Wednesday 9 September: the Monday before its week, through
    // the Sunday five weeks after its own Monday — and the sheet draws
    // exactly those days, no more.
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenLastCalledWith({ start_date: "2026-08-31", end_date: "2026-10-18" });
    const drawn = [...document.querySelectorAll<HTMLElement>("[data-testid^='cal-cell-']")].map((c) => c.dataset.day!);
    expect(drawn[0]).toBe("2026-08-31");
    expect(drawn[drawn.length - 1]).toBe("2026-10-16"); // the last Friday, Mon–Fri
  });

  it("vertical weeks: growing past the bottom edge re-pushes the whole grown sheet", () => {
    const onRange = vi.fn();
    render(<CalendarRenderer rows={rows} state={{ mode: "vertical" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    const grid = screen.getByTestId("cal-grid");
    Object.defineProperty(grid, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(grid, "scrollHeight", {
      configurable: true,
      get: () => grid.querySelectorAll(".calendar-week").length * 50,
    });
    Object.defineProperty(grid, "scrollTop", { value: 200, writable: true, configurable: true });
    fireEvent.scroll(grid); // 350 px of sheet, 200 of view at 200: the bottom edge
    expect(grid.querySelectorAll(".calendar-week")).toHaveLength(13);
    vi.advanceTimersByTime(350);
    expect(onRange).toHaveBeenCalledTimes(2);
    expect(onRange).toHaveBeenLastCalledWith({ start_date: "2026-08-31", end_date: "2026-11-29" });
  });

  it("horizontal: growing past the left edge re-pushes the whole grown sheet", () => {
    const onRange = vi.fn();
    const restore = fakeLayout("left", "nothing-lays-out");
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "horizontal" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
      vi.advanceTimersByTime(350);
      const ribbon = document.querySelector<HTMLElement>(".calendar-ribbon")!;
      Object.defineProperty(ribbon, "clientWidth", { value: 400, configurable: true });
      Object.defineProperty(ribbon, "scrollWidth", {
        configurable: true,
        get: () => ribbon.querySelectorAll(".calendar-col").length * 50,
      });
      fireEvent.scroll(ribbon); // at the left edge: six weeks go in before the first
      vi.advanceTimersByTime(350);
      expect(onRange).toHaveBeenCalledTimes(2);
      expect(onRange).toHaveBeenLastCalledWith({ start_date: "2026-07-20", end_date: "2026-10-18" });
    } finally {
      restore();
    }
  });

  it("vertical weeks: a sheet shorter than its box grows until the box can scroll", () => {
    const onRange = vi.fn();
    // A tall box: 700 px of view over rows that stand in at 50 px each. With
    // nothing to scroll there would be no scroll event, and so no growth.
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "cal-grid" ? 700 : 0;
    });
    const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.querySelectorAll(".calendar-week").length * 50;
    });
    try {
      render(<CalendarRenderer rows={rows} state={{ mode: "vertical" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
      // 7 rows (350 px) and 13 (650 px) both leave under CONT_EDGE below a
      // 700 px view; 19 rows (950 px) are the first that scroll.
      expect(document.querySelectorAll(".calendar-week")).toHaveLength(19);
      vi.advanceTimersByTime(350);
      // The fill happens before the debounce fires: one request, for the
      // sheet as drawn.
      expect(onRange).toHaveBeenCalledTimes(1);
      expect(onRange).toHaveBeenLastCalledWith({ start_date: "2026-08-31", end_date: "2027-01-10" });
    } finally {
      height.mockRestore();
      scrollHeight.mockRestore();
    }
  });

  it("paged month: still pushes the month window, whole weeks around it plus a month each side", () => {
    const onRange = vi.fn();
    render(<CalendarRenderer rows={rows} state={{ mode: "paged", unit: "month" }} onPatch={vi.fn()} onRange={onRange} timeZone={NY} />);
    vi.advanceTimersByTime(350);
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenLastCalledWith({ start_date: "2026-07-27", end_date: "2026-11-01" });
  });
});

describe("CalendarRenderer value column", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-09T14:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("formats through the table's data dictionary and the app's decimals, with one-letter labels", () => {
    const dict = [
      { date: "2026-09-11 12:30:00", event: "Inflation Rate YOY", previous: 3.4, estimate: 3.45 },
      { auction_date: "2026-09-08", security_term: "3-Year", offering_amount: 58000000000 },
    ];
    // Row 2 has no `date`, so the date column is `auction_date` only when the
    // first row says so; give both rows the same shape the app would see.
    const econ = [dict[0]];
    const ust = [dict[1]];
    const first = render(<CalendarRenderer rows={econ} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    const row = within(screen.getByTestId("cal-cell-2026-09-11")).getByRole("listitem");
    // The numbers are in the hover tooltip, labelled in full; the row itself keeps its title.
    expect(row).toHaveAttribute("title", "Inflation Rate YOY\nEstimate 3.45\nPrevious 3.4");
    expect(row).not.toHaveTextContent("3.45");
    first.unmount();
    render(<CalendarRenderer rows={ust} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    // 58000000000 abbreviates to 58B like every table cell, and an amount is dollars;
    // the tooltip carries it in full.
    const auction = within(screen.getByTestId("cal-cell-2026-09-08")).getByRole("listitem");
    expect(auction).toHaveTextContent("$58B");
    expect(auction).toHaveAttribute("title", "3-Year\nAmount $58,000,000,000");
  });

  it("abbreviates amounts only: claims stay 1,779, an offering becomes $58B", () => {
    const econ = [{ date: "2026-09-11 12:30:00", event: "Continuing Jobless Claims", previous: 1779, estimate: 1790 }];
    render(<CalendarRenderer rows={econ} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    expect(within(screen.getByTestId("cal-cell-2026-09-11")).getByRole("listitem")).toHaveAttribute(
      "title",
      "Continuing Jobless Claims\nEstimate 1,790\nPrevious 1,779",
    );
  });

  it("honours a column's own formatterFn from the dictionary", () => {
    const econ = [{ date: "2026-09-11 12:30:00", event: "Inflation Rate YOY", previous: 3.4 }];
    const table = { columns: [{ field: "previous", headerName: "Prior", formatterFn: "percent" as const }] };
    render(<CalendarRenderer rows={econ} state={{}} onPatch={vi.fn()} timeZone={NY} table={table} />);
    // The dictionary's header name labels the tooltip line, and its formatterFn formats it.
    expect(within(screen.getByTestId("cal-cell-2026-09-11")).getByRole("listitem")).toHaveAttribute(
      "title",
      "Inflation Rate YOY\nPrior 3.4 %",
    );
  });
});

/**
 * The Type / Series filter. The EODHD earnings calendar is the case it was
 * built for: several hundred tickers a day, unreadable as a calendar until
 * the reader names the ones they follow.
 */
describe("CalendarRenderer series filter", () => {
  const earnings = [
    { date: "2026-09-10", symbol: "AAPL.US", announce_time: "AfterMarket" },
    { date: "2026-09-10", symbol: "MSFT.US", announce_time: "AfterMarket" },
    { date: "2026-09-10", symbol: "DNLM.LSE", announce_time: "BeforeMarket" },
  ];

  it("keeps only the named series and says how many rows survived", () => {
    render(
      <CalendarRenderer
        rows={earnings}
        state={{ seriesField: "symbol", series: ["aapl", "MSFT.US"] }}
        onPatch={vi.fn()}
        timeZone={NY}
      />,
    );
    const day = within(cell("2026-09-10"));
    expect(day.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("AAPL.US"),
      expect.stringContaining("MSFT.US"),
    ]);
    expect(screen.getByText("2 of 3")).toHaveClass("calendar-series-count");
  });

  it("commits the Series box on Enter and on blur, and clearing it drops the filter", async () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={earnings} state={{ seriesField: "symbol" }} onPatch={onPatch} timeZone={NY} />);
    // An <input list=...> is a combobox to ARIA, not a textbox.
    const box = screen.getByRole("combobox", { name: "Series" });
    await userEvent.type(box, "NVDA, TSLA{Enter}");
    expect(onPatch).toHaveBeenLastCalledWith({ series: ["NVDA", "TSLA"] });

    onPatch.mockClear();
    await userEvent.clear(box);
    fireEvent.blur(box);
    expect(onPatch).toHaveBeenLastCalledWith({ series: [] });
  });

  it("keeps focus in the Series box after Enter, so the next commit is not dropped", async () => {
    // A plain render with a static `state` prop can't catch this bug: the
    // regression was the box remounting when the *committed* `series` came
    // back in as a changed prop, which only happens once something plays
    // WidgetCard's role and feeds the patch back in. This wrapper does that.
    const onPatchSpy = vi.fn();
    function Stateful() {
      const [state, setState] = useState<CalendarCardState>({ seriesField: "symbol" });
      return (
        <CalendarRenderer
          rows={earnings}
          state={state}
          onPatch={(patch) => {
            onPatchSpy(patch);
            setState((s) => ({ ...s, ...patch }));
          }}
          timeZone={NY}
        />
      );
    }
    render(<Stateful />);
    const box = screen.getByRole("combobox", { name: "Series" });
    await userEvent.type(box, "NVDA, TSLA{Enter}");
    expect(document.activeElement).toBe(box);
    expect(onPatchSpy).toHaveBeenCalledTimes(1);
    expect(onPatchSpy).toHaveBeenLastCalledWith({ series: ["NVDA", "TSLA"] });

    await userEvent.type(box, ", AAPL{Enter}");
    expect(document.activeElement).toBe(box);
    expect(onPatchSpy).toHaveBeenLastCalledWith({ series: ["NVDA", "TSLA", "AAPL"] });
  });

  it("the Type select offers every column but the date one and writes the field", async () => {
    const onPatch = vi.fn();
    render(<CalendarRenderer rows={earnings} state={{ seriesField: "symbol" }} onPatch={onPatch} timeZone={NY} />);
    const type = screen.getByRole("combobox", { name: "Type" });
    expect(within(type).getAllByRole("option").map((o) => o.textContent)).toEqual(["symbol", "announce_time"]);
    await userEvent.selectOptions(type, "announce_time");
    // A new column starts unfiltered: a Series list chosen under the old
    // column would otherwise keep filtering the new one and silently show
    // "0 of N" with no clue why.
    expect(onPatch).toHaveBeenLastCalledWith({ seriesField: "announce_time", series: [] });
  });

  it("changing Type clears a Series list that no longer applies to the new column", async () => {
    const onPatch = vi.fn();
    render(
      <CalendarRenderer
        rows={earnings}
        state={{ seriesField: "symbol", series: ["AAPL.US"] }}
        onPatch={onPatch}
        timeZone={NY}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type" }), "announce_time");
    expect(onPatch).toHaveBeenLastCalledWith({ seriesField: "announce_time", series: [] });
  });

  it("falls back to the title column when the persisted seriesField is gone from the rows", () => {
    render(
      <CalendarRenderer
        rows={earnings}
        state={{ seriesField: "ticker", series: ["DNLM.LSE"] }}
        onPatch={vi.fn()}
        timeZone={NY}
      />,
    );
    // The title column here is `symbol`, so the filter still bites rather than
    // matching a missing key and emptying the grid.
    expect(within(cell("2026-09-10")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("symbol");
  });
});

describe("CalendarRenderer stock logos", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-09T14:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("draws an EODHD logo before a symbol title and nothing before a release name", () => {
    const rows = [
      { report_date: "2026-09-08", symbol: "AAPL.US" },
      { report_date: "2026-09-08", symbol: "Not a symbol" },
    ];
    render(<CalendarRenderer rows={rows} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    const items = within(screen.getByTestId("cal-cell-2026-09-08")).getAllByRole("listitem");
    expect(items[0].querySelector("img.calendar-logo")).toHaveAttribute("src", "https://eodhd.com/img/logos/US/aapl.png");
    expect(items[0].querySelector("img.calendar-logo")).toHaveAttribute("loading", "lazy");
    expect(items[1].querySelector("img.calendar-logo")).toBeNull();
  });

  // Review S-rend-1: the failed logo was hidden imperatively on the element,
  // and the list reuses elements by index, so the next symbol drawn in that
  // place inherited the hidden style although its own logo loads.
  it("shows the next symbol's logo where a failed one was hidden", () => {
    const at = (symbol: string) => [{ report_date: "2026-09-08", symbol }];
    const { rerender } = render(<CalendarRenderer rows={at("ZZZZ.US")} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    const logo = () => within(screen.getByTestId("cal-cell-2026-09-08")).getByRole("listitem").querySelector<HTMLImageElement>("img.calendar-logo")!;
    fireEvent.error(logo());
    expect(logo().style.visibility).toBe("hidden");
    rerender(<CalendarRenderer rows={at("AAPL.US")} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    expect(logo()).toHaveAttribute("src", "https://eodhd.com/img/logos/US/aapl.png");
    expect(logo().style.visibility).not.toBe("hidden");
  });
});

/**
 * The tree filter. It is what Type / Series becomes once the rows carry a
 * `source`: three levels the reader ticks rather than a column and a list of
 * values they have to know how to spell.
 */
describe("CalendarRenderer tree filter", () => {
  const econ = [
    { date: "2026-09-09 14:30:00", event: "EIA Crude Oil Stocks Change", source: "EIA", category: "Weekly Petroleum Status" },
    { date: "2026-09-09 14:30:00", event: "EIA Gasoline Stocks Change", source: "EIA", category: "Weekly Petroleum Status" },
    { date: "2026-09-10 14:30:00", event: "EIA Natural Gas Stocks Change", source: "EIA", category: "Natural Gas Storage" },
    { date: "2026-09-11 12:30:00", event: "Core PPI", source: "BLS", category: "Producer Prices" },
    { date: "2026-09-08", event: "Mystery Index", source: null, category: null },
  ];

  /** Plays WidgetCard: the patch comes back in as state, so the grid moves. */
  function Stateful({ initial = {} as CalendarCardState, onPatch = vi.fn() }) {
    const [state, setState] = useState<CalendarCardState>(initial);
    return (
      <CalendarRenderer
        rows={econ}
        state={state}
        onPatch={(patch) => { onPatch(patch); setState((s) => ({ ...s, ...patch })); }}
        timeZone={NY}
      />
    );
  }

  function eventTitles() {
    return screen.getAllByTestId(/^cal-cell-/).flatMap((c) =>
      within(c).queryAllByRole("listitem").map((li) => li.textContent ?? ""));
  }

  it("replaces Type / Series with a Filter button when the rows carry a source", async () => {
    render(<CalendarRenderer rows={econ} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    expect(screen.queryByRole("combobox", { name: "Series" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Type" })).toBeNull();
    const button = screen.getByRole("button", { name: "Filter" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the Type / Series controls when no row carries a source", () => {
    render(
      <CalendarRenderer
        rows={[{ date: "2026-09-10", symbol: "AAPL.US" }]}
        state={{}}
        onPatch={vi.fn()}
        timeZone={NY}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Series" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter/ })).toBeNull();
  });

  it("lists the sources with counts, Other last, and expands to releases and statistics", async () => {
    render(<CalendarRenderer rows={econ} state={{}} onPatch={vi.fn()} timeZone={NY} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    // Back-port of dev 9fc10c6: a labelled group of real checkboxes and
    // Expand/Collapse buttons, not a tree (which promises arrow-key navigation).
    const tree = screen.getByRole("group", { name: "Filter" });
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
    expect(within(tree).getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"))).toEqual([
      "BLS", "EIA", "Other",
    ]);
    expect(within(tree).getByText("3")).toBeInTheDocument(); // EIA's three rows
    await userEvent.click(within(tree).getByRole("button", { name: "Expand EIA" }));
    expect(within(tree).getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"))).toEqual([
      "BLS", "EIA", "Natural Gas Storage", "Weekly Petroleum Status", "Other",
    ]);
    await userEvent.click(within(tree).getByRole("button", { name: "Expand Weekly Petroleum Status" }));
    expect(within(tree).getByRole("checkbox", { name: "EIA Crude Oil Stocks Change" })).toBeInTheDocument();
  });

  it("unticking a source excludes it and hides its rows", async () => {
    const onPatch = vi.fn();
    render(<Stateful onPatch={onPatch} />);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "EIA" }));
    expect(onPatch).toHaveBeenLastCalledWith({ exclude: [["EIA"]], include: [] });
    expect(eventTitles().join(" ")).not.toContain("EIA");
    expect(eventTitles().join(" ")).toContain("Core PPI");
    // Rows kept of rows received, on the button itself.
    expect(screen.getByRole("button", { name: "Filter · 2 of 5" })).toBeInTheDocument();
  });

  it("re-ticking a release under an excluded source includes just that release", async () => {
    const onPatch = vi.fn();
    render(<Stateful initial={{ exclude: [["EIA"]] }} onPatch={onPatch} />);
    await userEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    // A source carrying a rule opens with the popover; nothing to expand first.
    const eia = screen.getByRole("checkbox", { name: "EIA" });
    expect(eia).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByRole("checkbox", { name: "Natural Gas Storage" }));
    expect(onPatch).toHaveBeenLastCalledWith({ exclude: [["EIA"]], include: [["EIA", "Natural Gas Storage"]] });
    const titles = eventTitles().join(" ");
    expect(titles).toContain("EIA Natural Gas Stocks Change");
    expect(titles).not.toContain("EIA Crude Oil Stocks Change");
    // Some but not all of EIA is shown, so its own box is now indeterminate.
    expect(screen.getByRole("checkbox", { name: "EIA" })).toHaveAttribute("aria-checked", "mixed");
    expect((screen.getByRole("checkbox", { name: "EIA" }) as HTMLInputElement).indeterminate).toBe(true);
  });

  it("Reset clears both lists, and Escape closes the popover", async () => {
    const onPatch = vi.fn();
    render(<Stateful initial={{ exclude: [["EIA"]] }} onPatch={onPatch} />);
    const button = screen.getByRole("button", { name: /^Filter/ });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onPatch).toHaveBeenLastCalledWith({ exclude: [], include: [] });
    expect(eventTitles().join(" ")).toContain("EIA Crude Oil Stocks Change");

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Filter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute("aria-expanded", "false");
  });
});
