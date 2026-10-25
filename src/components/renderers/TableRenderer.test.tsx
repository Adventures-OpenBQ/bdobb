// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import type { TableCardState, TableSpec } from "../../lib/types";
import { useSettingsStore } from "../../stores/settingsStore";
import { TableRenderer } from "./TableRenderer";

const rows = [
  { symbol: "AAPL", close: 190.5, volume: 2_300_000 },
  { symbol: "MSFT", close: 410.25, volume: 1_500 },
];

const ROW_HEIGHT = 28;
const VIEWPORT_HEIGHT = 400;

/**
 * jsdom has no layout: every element measures 0x0, and TanStack Virtual with
 * a zero-height scroll element renders ZERO rows — so without these stubs
 * every test in this file, new and old, sees an empty tbody. Three stubs,
 * one per thing the virtualiser actually reads:
 *
 * 1. `offsetHeight`. @tanstack/virtual-core's `getRect` sizes the scroll
 *    viewport from `offsetWidth`/`offsetHeight` — NOT getBoundingClientRect
 *    and NOT clientHeight. The `initialRect` option does not help either:
 *    the element observer runs on mount and overwrites it with the real
 *    (zero) offsetHeight.
 * 2. `HTMLTableRowElement.getBoundingClientRect`. TableRenderer passes
 *    `measureElement`, which measures each rendered <tr>. Left at jsdom's 0
 *    it measures every row to nothing, shrinks the total, re-ranges, and
 *    React throws "Maximum update depth exceeded". A fixed height makes
 *    estimateSize win instead.
 * 3. `scrollTo`. jsdom's is a no-op, so `virtualizer.scrollToIndex(0)` would
 *    never move scrollTop. This one moves it and fires the scroll event the
 *    virtualiser listens for.
 *
 * Scoped to this file and restored afterwards.
 */
let realOffsetHeight: PropertyDescriptor | undefined;
let realRowRect: typeof HTMLTableRowElement.prototype.getBoundingClientRect | undefined;
let realScrollTo: typeof HTMLElement.prototype.scrollTo | undefined;

beforeAll(() => {
  realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => VIEWPORT_HEIGHT,
  });

  realRowRect = HTMLTableRowElement.prototype.getBoundingClientRect;
  HTMLTableRowElement.prototype.getBoundingClientRect = () =>
    ({
      height: ROW_HEIGHT,
      width: 800,
      top: 0,
      left: 0,
      right: 800,
      bottom: ROW_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  realScrollTo = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, ...args: unknown[]) {
    const first = args[0] as number | { top?: number } | undefined;
    this.scrollTop = typeof first === "number" ? Number(args[1] ?? 0) : (first?.top ?? 0);
    this.dispatchEvent(new Event("scroll"));
  } as typeof HTMLElement.prototype.scrollTo;
});

afterAll(() => {
  if (realOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
  }
  if (realRowRect) HTMLTableRowElement.prototype.getBoundingClientRect = realRowRect;
  if (realScrollTo) HTMLElement.prototype.scrollTo = realScrollTo;
});

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe("TableRenderer", () => {
  it("renders a header per column and a row per record", () => {
    render(<TableRenderer data={rows} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("applies type-aware formatting, trimmed of trailing zeros", () => {
    render(<TableRenderer data={rows} />);
    expect(screen.getByText("2.3M")).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });

  it("sorts when a column header is clicked", async () => {
    render(<TableRenderer data={rows} />);
    await userEvent.click(screen.getByRole("columnheader", { name: /close/i }));

    const body = screen.getAllByRole("rowgroup")[1];
    const first = within(body).getAllByRole("row")[0];
    expect(within(first).getByText("AAPL")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("columnheader", { name: /close/i }));
    const afterSecond = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")[0];
    expect(within(afterSecond).getByText("MSFT")).toBeInTheDocument();
  });

  it("does not sort when the resize handle is pressed and released", () => {
    render(<TableRenderer data={rows} />);

    // Natural row order is AAPL, MSFT. Ascending-by-volume (MSFT=1_500 <
    // AAPL=2_300_000) would flip that order, so this column distinguishes
    // "no sort happened" from "sort happened to land back on the same order".
    const volumeHeader = screen.getByRole("columnheader", { name: /volume/i });
    const resizer = volumeHeader.querySelector(".column-resizer");
    if (!resizer) throw new Error("resize handle not found");

    fireEvent.mouseDown(resizer);
    fireEvent.mouseUp(resizer);
    fireEvent.click(resizer);

    const body = screen.getAllByRole("rowgroup")[1];
    const first = within(body).getAllByRole("row")[0];
    expect(within(first).getByText("AAPL")).toBeInTheDocument();
  });

  it("shows an empty state for an empty array", () => {
    render(<TableRenderer data={[]} />);
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  it("falls back to raw JSON when the payload is not an array of records", () => {
    render(<TableRenderer data={{ error: "unexpected" }} />);
    expect(screen.getByTestId("raw-json")).toBeInTheDocument();
  });

  it("formats numeric cells using the current maxDecimalPlaces setting", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, maxDecimalPlaces: 0 },
    });
    render(<TableRenderer data={[{ close: 123.456 }]} />);
    expect(screen.getByText("123")).toBeInTheDocument();
  });
});

describe("TableRenderer row virtualisation", () => {
  /** `rank` counts down, so ascending rank puts the LAST record first. */
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `row-${i}`, rank: n - i }));

  /** Only the real rows: the two spacer <tr> carry no data-index. */
  const bodyRows = () => document.querySelectorAll("tbody tr[data-index]");

  const scrollBox = () => document.querySelector(".table-scroll") as HTMLElement;

  it("keeps a 10,000-row table down to a window of rows in the DOM", () => {
    render(<TableRenderer data={many(10_000)} />);

    expect(bodyRows().length).toBeGreaterThan(0);
    expect(bodyRows().length).toBeLessThan(100);
    expect(screen.getByText("row-0")).toBeInTheDocument();
    expect(screen.queryByText("row-5000")).not.toBeInTheDocument();

    // Bottom spacer keeps the scrollbar honest about the un-rendered rows'
    // height. jsdom has no layout, so this reads the inline style rather
    // than a measured box, with a tolerance for the rows the estimate is off
    // by (measureElement is stubbed to ROW_HEIGHT for every rendered row, so
    // this is normally exact, but stay tolerant of overscan drift).
    const spacerBottom = document.querySelectorAll(".table-spacer td")[
      document.querySelectorAll(".table-spacer td").length - 1
    ] as HTMLElement;
    const expectedHeight = 10_000 * ROW_HEIGHT - bodyRows().length * ROW_HEIGHT;
    expect(parseFloat(spacerBottom.style.height)).toBeGreaterThan(expectedHeight - 5 * ROW_HEIGHT);
    expect(parseFloat(spacerBottom.style.height)).toBeLessThan(expectedHeight + 5 * ROW_HEIGHT);
  });

  it("brings rows from the middle of the set into the DOM when scrolled", () => {
    render(<TableRenderer data={many(10_000)} />);

    // 5,000 rows x the 28px estimate: a scroll offset only reachable by
    // rows that were never rendered at mount.
    fireEvent.scroll(scrollBox(), { target: { scrollTop: 140_000 } });

    expect(screen.getByText("row-5000")).toBeInTheDocument();
    expect(screen.queryByText("row-0")).not.toBeInTheDocument();
    expect(bodyRows().length).toBeLessThan(100);
  });

  it("sorts across the whole set, not the window, and returns to the top", async () => {
    render(<TableRenderer data={many(10_000)} />);
    fireEvent.scroll(scrollBox(), { target: { scrollTop: 140_000 } });

    await userEvent.click(screen.getByRole("columnheader", { name: /rank/i }));

    // rank 1 belongs to row-9999, which was in neither the mounted window
    // nor the scrolled-to one: the sort saw all 10,000 records.
    const first = bodyRows()[0];
    expect(within(first as HTMLElement).getByText("row-9999")).toBeInTheDocument();
    expect(scrollBox().scrollTop).toBe(0);
  });

  it("renders every row of a table short enough to fit, with no spacers", () => {
    render(<TableRenderer data={many(20)} />);

    expect(bodyRows()).toHaveLength(20);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(screen.getByText("row-0")).toBeInTheDocument();
    expect(screen.getByText("row-19")).toBeInTheDocument();
  });

  it("does not virtualise the header row", () => {
    render(<TableRenderer data={many(10_000)} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);

    fireEvent.scroll(scrollBox(), { target: { scrollTop: 140_000 } });

    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: /label/i })).toBeInTheDocument();
  });
});

describe("TableRenderer with a columnsDefs spec", () => {
  const spec: TableSpec = {
    columns: [
      { field: "close", headerName: "Close", prefix: "$", headerTooltip: "Closing price" },
      { field: "symbol", headerName: "Ticker" },
      { field: "hidden_note", headerName: "Note", hide: true },
    ],
  };
  const specRows = [
    { symbol: "AAPL", close: 190.5, volume: 2_300_000, hidden_note: "n1" },
    { symbol: "MSFT", close: 410.25, volume: 1_500, hidden_note: "n2" },
  ];

  const headerFields = () =>
    screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field"));

  it("renders columnsDefs order first, then the data-only fields", () => {
    render(<TableRenderer data={specRows} spec={spec} />);
    expect(headerFields()).toEqual(["close", "symbol", "volume"]);
  });

  it("uses headerName with its prefix, and puts headerTooltip in the title", () => {
    render(<TableRenderer data={specRows} spec={spec} />);
    const close = screen.getByRole("columnheader", { name: /\$Close/ });
    expect(close).toHaveAttribute("title", "Closing price");
    expect(screen.getByRole("columnheader", { name: /Ticker/ })).toBeInTheDocument();
  });

  it("starts a hide: true column hidden, in the header and in every row", () => {
    render(<TableRenderer data={specRows} spec={spec} />);
    expect(headerFields()).not.toContain("hidden_note");
    expect(document.querySelector('td[data-field="hidden_note"]')).toBeNull();
    expect(screen.queryByText("n1")).not.toBeInTheDocument();
  });

  it("applies the column's formatterFn and decimalPlaces to its cells", () => {
    // 0.051234 x 100 is 5.1234, which actually needs the third decimal —
    // decimalPlaces is a MAXIMUM, so a value of 0.0512 would render "5.12 %"
    // at 3 places just as it does at 2 and prove nothing.
    render(
      <TableRenderer
        data={[{ pct: 0.051234, other: 0.0512 }]}
        spec={{
          columns: [{ field: "pct", formatterFn: "normalizedPercent", decimalPlaces: 3 }],
        }}
      />,
    );
    expect(screen.getByText("5.123 %")).toBeInTheDocument();
    // `other` is data-only with no table default, so it keeps today's format.
    expect(screen.getByText("0.05")).toBeInTheDocument();
  });

  it("applies the table-level formatterFn to a column that names none", () => {
    render(
      <TableRenderer
        data={[{ a: 2_300_000 }]}
        spec={{ formatterFn: "none", columns: [{ field: "a" }] }}
      />,
    );
    expect(screen.getByText("2300000")).toBeInTheDocument();
  });

  it("title-cases a titleCase column's text", () => {
    render(
      <TableRenderer
        data={[{ trend: "strong buy" }]}
        spec={{ columns: [{ field: "trend", renderFn: ["titleCase"] }] }}
      />,
    );
    expect(screen.getByText("Strong Buy")).toBeInTheDocument();
  });

  it("classes greenRed cells by sign, and leaves zero alone", () => {
    render(
      <TableRenderer
        data={[{ chg: 1.5 }, { chg: -1.5 }, { chg: 0 }]}
        spec={{ columns: [{ field: "chg", renderFn: ["greenRed"] }] }}
      />,
    );
    const cells = [...document.querySelectorAll('td[data-field="chg"]')];
    expect(cells.map((c) => c.className)).toEqual(["cell-pos", "cell-neg", ""]);
  });

  it("colours a cell from the first matching colorRule, and fills the background when asked", () => {
    render(
      <TableRenderer
        data={[{ score: 5 }, { score: -5 }]}
        spec={{
          columns: [
            {
              field: "score",
              renderFn: ["greenRed"],
              renderFnParams: {
                colorRules: [
                  { condition: "gt", value: 0, color: "rgb(0, 128, 0)" },
                  { condition: "lt", value: 0, color: "rgb(128, 0, 0)", fill: true },
                ],
              },
            },
          ],
        }}
      />,
    );
    const cells = [...document.querySelectorAll('td[data-field="score"]')] as HTMLElement[];
    expect(cells[0].style.color).toBe("rgb(0, 128, 0)");
    expect(cells[0].style.background).toBe("");
    expect(cells[1].style.background).toBe("rgb(128, 0, 0)");
    expect(cells[1].style.color).toBe("");
    // colorRules governs the colour, so no sign class is added.
    expect(cells[0].className).toBe("");
  });

  it("uses columnsDefs width as the initial column size", () => {
    render(
      <TableRenderer
        data={[{ a: 1, b: 2 }]}
        spec={{ columns: [{ field: "a", width: 90 }, { field: "b" }] }}
      />,
    );
    const [a, b] = screen.getAllByRole("columnheader") as HTMLElement[];
    expect(a.style.width).toBe("90px");
    // No width: TanStack's own default of 150, exactly as before.
    expect(b.style.width).toBe("150px");
  });

  // bdobb#10: a 100%-wide table treats column widths as hints and squeezes the
  // other columns to fit the card. The data table is as wide as its columns
  // (fixed layout), so a width is exact, a wide table scrolls in .table-scroll
  // and a narrow one leaves empty space on the right.
  it("sizes the data table to the sum of its column widths, with fixed layout", () => {
    render(
      <TableRenderer
        data={[{ a: 1, b: 2 }]}
        spec={{ columns: [{ field: "a", width: 90 }, { field: "b" }] }}
      />,
    );
    const table = screen.getByRole("table");
    expect(table.style.width).toBe("240px");
    expect(table).toHaveClass("sized");
  });

  it("leaves a hidden column out of the table's width", () => {
    render(
      <TableRenderer
        data={[{ a: 1, b: 2 }]}
        spec={{ columns: [{ field: "a", width: 90 }, { field: "b", hide: true }] }}
      />,
    );
    expect(screen.getByRole("table").style.width).toBe("90px");
  });

  it("renders exactly as before for a payload whose widget has no spec", () => {
    render(<TableRenderer data={specRows} />);
    expect(headerFields()).toEqual(["symbol", "close", "volume", "hidden_note"]);
    expect(screen.getByRole("columnheader", { name: /symbol/ })).not.toHaveAttribute("title");
  });
});

describe("TableRenderer sticky pinning", () => {
  const pinnedSpec: TableSpec = {
    columns: [
      { field: "symbol", headerName: "Ticker", pinned: "left", width: 80 },
      { field: "close", pinned: "left", width: 120 },
      { field: "note", pinned: "right", width: 60 },
      { field: "volume", width: 100 },
    ],
  };
  const pinnedRows = [{ symbol: "AAPL", close: 190.5, volume: 2_300_000, note: "x" }];

  it("renders pinned-left columns first and pinned-right last, header and body in step", () => {
    render(<TableRenderer data={pinnedRows} spec={pinnedSpec} />);
    expect(screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field"))).toEqual([
      "symbol",
      "close",
      "volume",
      "note",
    ]);
    const bodyRow = document.querySelector("tbody tr[data-index]") as HTMLElement;
    expect([...bodyRow.querySelectorAll("td")].map((td) => td.getAttribute("data-field"))).toEqual([
      "symbol",
      "close",
      "volume",
      "note",
    ]);
  });

  it("gives every pinned cell its side class and its summed offset", () => {
    render(<TableRenderer data={pinnedRows} spec={pinnedSpec} />);
    const th = (field: string) =>
      document.querySelector(`th[data-field="${field}"]`) as HTMLElement;
    const td = (field: string) =>
      document.querySelector(`td[data-field="${field}"]`) as HTMLElement;

    expect(th("symbol").className).toBe("pin-left");
    expect(th("symbol").style.left).toBe("0px");
    // 80px, the width of the pinned column before it.
    expect(th("close").className).toBe("pin-left");
    expect(th("close").style.left).toBe("80px");
    expect(th("note").className).toBe("pin-right");
    expect(th("note").style.right).toBe("0px");
    expect(th("volume").className).toBe("");
    expect(th("volume").style.left).toBe("");

    expect(td("symbol").className).toBe("pin-left");
    expect(td("symbol").style.left).toBe("0px");
    expect(td("close").style.left).toBe("80px");
    expect(td("note").style.right).toBe("0px");
    expect(td("volume").style.left).toBe("");
  });

  it("keeps pinning out of the way of an unpinned-only table", () => {
    render(<TableRenderer data={pinnedRows} />);
    for (const cell of document.querySelectorAll("th, td")) {
      expect(cell.className).not.toMatch(/pin-/);
    }
  });
});

describe("TableRenderer sticky offsets come from measured widths", () => {
  /**
   * `.widget-table` is `width: 100%` with the browser's automatic table
   * layout, so a columnsDefs `width` is only a hint: a column whose content
   * needs more room gets more room. Summing the DECLARED sizes would then put
   * the second pinned column's sticky offset short of the first column's real
   * right edge and the two would overlap. These tests give the header cells
   * real measured widths that disagree with their declared ones.
   *
   * Stubbed on HTMLTableCellElement rather than Element so the <tr> measuring
   * the virtualiser does (HTMLTableRowElement, stubbed in this file's
   * beforeAll) is untouched.
   */
  const measure = (widths: Record<string, number>) => {
    const real = Object.getOwnPropertyDescriptor(
      HTMLTableCellElement.prototype,
      "getBoundingClientRect",
    );
    HTMLTableCellElement.prototype.getBoundingClientRect = function (this: HTMLTableCellElement) {
      const field = this.getAttribute("data-field") ?? "";
      return { width: widths[field] ?? 0, height: 22, top: 0, left: 0, right: 0, bottom: 22, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    return () => {
      if (real) Object.defineProperty(HTMLTableCellElement.prototype, "getBoundingClientRect", real);
      else delete (HTMLTableCellElement.prototype as Partial<HTMLTableCellElement>)
        .getBoundingClientRect;
    };
  };

  const th = (field: string) => document.querySelector(`th[data-field="${field}"]`) as HTMLElement;
  const td = (field: string) => document.querySelector(`td[data-field="${field}"]`) as HTMLElement;

  it("offsets a second pinned-left column by the first's MEASURED width, not its declared size", () => {
    // symbol declares 80 but actually renders 140 wide.
    const restore = measure({ symbol: 140, close: 200, volume: 90, note: 50 });
    try {
      render(
        <TableRenderer
          data={[{ symbol: "AAPL", close: 190.5, volume: 2_300_000, note: "x" }]}
          spec={{
            columns: [
              { field: "symbol", pinned: "left", width: 80 },
              { field: "close", pinned: "left", width: 120 },
              { field: "note", pinned: "right", width: 60 },
              { field: "volume", width: 100 },
            ],
          }}
        />,
      );

      expect(th("symbol").style.left).toBe("0px");
      expect(th("close").style.left).toBe("140px");
      expect(td("close").style.left).toBe("140px");
      // The single right-pinned column still sits flush with the right edge.
      expect(th("note").style.right).toBe("0px");
    } finally {
      restore();
    }
  });

  it("accumulates a pinned-right group inwards from the right edge", () => {
    const restore = measure({ symbol: 140, note: 50, volume: 90 });
    try {
      render(
        <TableRenderer
          data={[{ symbol: "AAPL", volume: 2_300_000, note: "x" }]}
          spec={{
            columns: [
              { field: "symbol", pinned: "left", width: 80 },
              { field: "note", pinned: "right", width: 60 },
              { field: "volume", pinned: "right", width: 100 },
            ],
          }}
        />,
      );

      // volume is the rightmost pinned column, so note is inset by volume's
      // measured 90 — not by its declared 100.
      expect(th("volume").style.right).toBe("0px");
      expect(th("note").style.right).toBe("90px");
      expect(td("note").style.right).toBe("90px");
    } finally {
      restore();
    }
  });

  it("offsets the FILTER row's pinned cells by the same measured widths", () => {
    // The filter row is a second row of <th>s in the same <thead>. Offsetting
    // it by the declared sizes while the header row above it uses the measured
    // ones would leave the two rows' pinned cells at different edges.
    const restore = measure({ symbol: 140, close: 200, volume: 90 });
    try {
      render(
        <TableRenderer
          data={[{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }]}
          filterRow
          spec={{
            columns: [
              { field: "symbol", pinned: "left", width: 80 },
              { field: "close", pinned: "left", width: 120 },
              { field: "volume", width: 100 },
            ],
          }}
        />,
      );

      const filterCell = (field: string) =>
        document.querySelector(`tr.filter-row th[data-filter-for="${field}"]`) as HTMLElement;
      expect(filterCell("symbol").style.left).toBe("0px");
      expect(filterCell("close").style.left).toBe("140px");
      expect(th("close").style.left).toBe("140px");
    } finally {
      restore();
    }
  });

  it("keeps TanStack's declared-size offsets when nothing can be measured", () => {
    // jsdom measures every cell at 0. A zero-width measurement is not a real
    // one, so the fallback has to be explicit rather than summing zeros and
    // stacking every pinned column at offset 0.
    render(
      <TableRenderer
        data={[{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }]}
        spec={{
          columns: [
            { field: "symbol", pinned: "left", width: 80 },
            { field: "close", pinned: "left", width: 120 },
            { field: "volume", width: 100 },
          ],
        }}
      />,
    );
    expect(th("close").style.left).toBe("80px");
    expect(td("close").style.left).toBe("80px");
  });

  it("gives a hidden pinned column no width in the next column's offset", () => {
    render(
      <TableRenderer
        data={[{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }]}
        spec={{
          columns: [
            { field: "symbol", pinned: "left", width: 80, hide: true },
            { field: "close", pinned: "left", width: 120 },
            { field: "volume", width: 100 },
          ],
        }}
      />,
    );
    expect(th("symbol")).toBeNull();
    // close is now the first visible pinned column, so it sits at 0 rather
    // than behind the 80px a hidden column would have claimed.
    expect(th("close").style.left).toBe("0px");
    expect(td("close").style.left).toBe("0px");
  });

  it("re-measures the offsets when a pinned column is hidden between renders", () => {
    const restore = measure({ symbol: 140, close: 200, volume: 90 });
    // One array identity across both renders, so `rows` cannot be what
    // triggers the re-measurement.
    const data = [{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }];
    const spec = (hideSymbol: boolean): TableSpec => ({
      columns: [
        { field: "symbol", pinned: "left", width: 80, hide: hideSymbol },
        { field: "close", pinned: "left", width: 120 },
        { field: "volume", width: 100 },
      ],
    });
    try {
      const { rerender } = render(<TableRenderer data={data} spec={spec(false)} />);
      expect(th("close").style.left).toBe("140px");

      rerender(<TableRenderer data={data} spec={spec(true)} />);
      // symbol is gone, so close is now the first visible pinned column and
      // belongs at 0. Left at the previous render's measurement it would still
      // claim 140px and hang a column-width gap off the left edge.
      expect(th("symbol")).toBeNull();
      expect(th("close").style.left).toBe("0px");
      expect(td("close").style.left).toBe("0px");
    } finally {
      restore();
    }
  });

  it("re-measures when the CARD's hidden list changes and the spec does not", () => {
    // The same column set, the same rows and the same spec object across both
    // renders: the only thing that moves is the persisted state. Without
    // columnVisibility recomputing from it, close would keep the offset it was
    // measured at while symbol was still on screen.
    const restore = measure({ symbol: 140, close: 200, volume: 90 });
    const data = [{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }];
    const spec: TableSpec = {
      columns: [
        { field: "symbol", pinned: "left", width: 80 },
        { field: "close", pinned: "left", width: 120 },
        { field: "volume", width: 100 },
      ],
    };
    try {
      const { rerender } = render(
        <TableRenderer data={data} spec={spec} state={{}} onStateChange={vi.fn()} />,
      );
      expect(th("close").style.left).toBe("140px");

      rerender(
        <TableRenderer
          data={data}
          spec={spec}
          state={{ hidden: ["symbol"] }}
          onStateChange={vi.fn()}
        />,
      );
      expect(th("symbol")).toBeNull();
      expect(th("close").style.left).toBe("0px");
      expect(td("close").style.left).toBe("0px");
    } finally {
      restore();
    }
  });

  it("measures a pinned column named __proto__ like any other", () => {
    // Built with JSON.parse, not a literal: `{ __proto__: 1 }` sets the
    // prototype instead of creating the key, and a payload out of a backend
    // arrives through JSON.parse anyway. The accumulator the offsets are built
    // in has to be null-prototype for the same reason -- on a plain object
    // this one column would miss the measured path and silently read a
    // declared offset while its neighbours read measured ones.
    const widths = JSON.parse('{"symbol": 140, "__proto__": 200, "close": 90}');
    const data = JSON.parse('[{"symbol": "AAPL", "__proto__": 1, "close": 2}]');
    const restore = measure(widths);
    try {
      render(
        <TableRenderer
          data={data}
          spec={{
            columns: [
              { field: "symbol", pinned: "left", width: 80 },
              { field: "__proto__", pinned: "left", width: 120 },
            ],
          }}
        />,
      );

      expect(th("symbol").style.left).toBe("0px");
      // symbol's MEASURED 140, not the 80 it declares.
      expect(th("__proto__").style.left).toBe("140px");
      expect(td("__proto__").style.left).toBe("140px");
    } finally {
      restore();
    }
  });

  it("shrinks the virtualiser spacer's colSpan when a column is hidden", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ a: i, b: i, c: i }));
    render(<TableRenderer data={many} spec={{ columns: [{ field: "b", hide: true }] }} />);

    const spacer = document.querySelector(".table-spacer td") as HTMLElement;
    // Three fields, one hidden: a spacer spanning 3 would stretch the table
    // one phantom column wider than its own header row.
    expect(spacer.getAttribute("colspan")).toBe("2");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  });
});

describe("TableRenderer persisted state", () => {
  const stateRows = [
    { symbol: "AAPL", close: 190.5, volume: 2_300_000 },
    { symbol: "MSFT", close: 410.25, volume: 1_500 },
  ];

  /** Mirrors WidgetCard: the state lives outside, patches are merged in. */
  function Controlled({ initial = {} }: { initial?: TableCardState }) {
    const [state, setState] = useState<TableCardState>(initial);
    return (
      <TableRenderer
        data={stateRows}
        state={state}
        onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
      />
    );
  }

  const headerFields = () =>
    screen.getAllByRole("columnheader").map((th) => th.getAttribute("data-field"));
  const th = (field: string) => document.querySelector(`th[data-field="${field}"]`) as HTMLElement;

  it("renders in the persisted column order", () => {
    render(<Controlled initial={{ columnOrder: ["volume", "symbol", "close"] }} />);
    expect(headerFields()).toEqual(["volume", "symbol", "close"]);
  });

  it("hides the persisted columns, and an empty list un-hides a spec-hidden one", () => {
    render(
      <TableRenderer
        data={stateRows}
        spec={{ columns: [{ field: "close", hide: true }] }}
        state={{ hidden: [] }}
        onStateChange={vi.fn()}
      />,
    );
    expect(headerFields()).toContain("close");
  });

  it("renders in the persisted sort order", () => {
    render(<Controlled initial={{ sorting: [{ id: "close", desc: true }] }} />);
    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(within(body).getAllByRole("row")[0]).getByText("MSFT")).toBeInTheDocument();
  });

  it("uses the persisted width as the column's size", () => {
    render(<Controlled initial={{ widths: { close: 240 } }} />);
    expect(th("close").style.width).toBe("240px");
  });

  it("emits a sorting patch and does not move a row until the owner hands it back", async () => {
    // Controlled means controlled: with a fixed `state`, the click reports the
    // change and changes nothing on screen.
    const onStateChange = vi.fn();
    render(<TableRenderer data={stateRows} state={{}} onStateChange={onStateChange} />);

    await userEvent.click(screen.getByRole("columnheader", { name: /close/i }));

    expect(onStateChange).toHaveBeenCalledWith({ sorting: [{ id: "close", desc: false }] });
    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(within(body).getAllByRole("row")[0]).getByText("AAPL")).toBeInTheDocument();
  });

  it("round-trips a sort through the owner", async () => {
    render(<Controlled />);
    await userEvent.click(screen.getByRole("columnheader", { name: /volume/i }));

    const body = screen.getAllByRole("rowgroup")[1];
    // Ascending by volume puts MSFT (1,500) first.
    expect(within(within(body).getAllByRole("row")[0]).getByText("MSFT")).toBeInTheDocument();
  });

  it("still sorts in memory when no owner is wired at all", async () => {
    render(<TableRenderer data={stateRows} />);
    await userEvent.click(screen.getByRole("columnheader", { name: /volume/i }));

    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(within(body).getAllByRole("row")[0]).getByText("MSFT")).toBeInTheDocument();
  });
});

describe("TableRenderer width debounce", () => {
  const wRows = [{ symbol: "AAPL", close: 190.5 }];

  /**
   * TWO moves, not one. table-core stages each new size inside the React
   * state UPDATER it passes to setColumnSizingInfo and reads that object back
   * on the NEXT call, so the first mousemove of a drag only records the offset
   * and leaves the width untouched (measured: 150px after one move, 190px
   * after the second). Harmless in a real drag, which fires dozens of moves,
   * and unchanged from before this plan — but a two-event simulation is what
   * a test has to do.
   */
  function drag(field: string, toClientX: number) {
    const resizer = document
      .querySelector(`th[data-field="${field}"]`)!
      .querySelector(".column-resizer")!;
    fireEvent.mouseDown(resizer, { clientX: 0 });
    fireEvent.mouseMove(document, { clientX: toClientX });
    fireEvent.mouseMove(document, { clientX: toClientX });
  }

  const widthPatches = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.map(([p]) => p as TableCardState).filter((p) => p.widths !== undefined);

  it("widens the table by exactly what the dragged column gained (bdobb#10)", () => {
    render(<TableRenderer data={wRows} state={{}} onStateChange={vi.fn()} />);
    const table = screen.getByRole("table");
    const header = document.querySelector('th[data-field="close"]') as HTMLElement;
    const before = parseFloat(table.style.width);
    expect(before).toBeGreaterThan(0);
    drag("close", 40);
    const gained = parseFloat(header.style.width) - 150;
    expect(gained).toBeGreaterThan(0);
    expect(parseFloat(table.style.width)).toBe(before + gained);
  });

  it("resizes immediately but saves once, 300ms after the last move", () => {
    vi.useFakeTimers();
    try {
      const onStateChange = vi.fn();
      render(<TableRenderer data={wRows} state={{}} onStateChange={onStateChange} />);
      const header = document.querySelector('th[data-field="close"]') as HTMLElement;
      // TanStack's default size, before any drag.
      expect(header.style.width).toBe("150px");

      drag("close", 40);

      // The column moved on screen straight away — the width is the ONE piece
      // of state the renderer keeps locally, precisely so this works.
      expect(parseFloat(header.style.width)).toBeGreaterThan(150);
      expect(widthPatches(onStateChange)).toHaveLength(0);

      vi.advanceTimersByTime(299);
      expect(widthPatches(onStateChange)).toHaveLength(0);

      vi.advanceTimersByTime(1);
      const patches = widthPatches(onStateChange);
      expect(patches).toHaveLength(1);
      expect(patches[0].widths!.close).toBeGreaterThan(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses a burst of moves into a single save", () => {
    vi.useFakeTimers();
    try {
      const onStateChange = vi.fn();
      render(<TableRenderer data={wRows} state={{}} onStateChange={onStateChange} />);

      drag("close", 20);
      vi.advanceTimersByTime(100);
      fireEvent.mouseMove(document, { clientX: 60 });
      vi.advanceTimersByTime(100);
      fireEvent.mouseMove(document, { clientX: 90 });
      vi.advanceTimersByTime(300);

      expect(widthPatches(onStateChange)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // A view toggle or tab switch inside the 300ms used to drop the width the
  // user had just dragged: the pending save was cancelled, not made.
  it("saves a pending width at unmount, once, instead of dropping it", () => {
    vi.useFakeTimers();
    try {
      const onStateChange = vi.fn();
      const { unmount } = render(
        <TableRenderer data={wRows} state={{}} onStateChange={onStateChange} />,
      );
      drag("close", 40);
      unmount();
      expect(widthPatches(onStateChange)).toHaveLength(1);
      expect(widthPatches(onStateChange)[0].widths!.close).toBeGreaterThan(150);

      vi.advanceTimersByTime(1000);
      expect(widthPatches(onStateChange)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not save again at unmount once the debounced save has landed", () => {
    vi.useFakeTimers();
    try {
      const onStateChange = vi.fn();
      const { unmount } = render(
        <TableRenderer data={wRows} state={{}} onStateChange={onStateChange} />,
      );
      drag("close", 40);
      vi.advanceTimersByTime(300);
      unmount();

      expect(widthPatches(onStateChange)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
/** jsdom 25 implements no DataTransfer constructor; this is the whole surface used. */
function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    get types() {
      return [...store.keys()];
    },
    dropEffect: "move",
    effectAllowed: "move",
  };
}

describe("TableRenderer filter row", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      label: `row-${i}`,
      bucket: `b-${i % 7}`,
      score: i,
      day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      active: i % 2 === 0,
      meta: { i },
    }));

  function Controlled({ rows = many(10_000) }: { rows?: Record<string, unknown>[] }) {
    const [state, setState] = useState<TableCardState>({});
    return (
      <TableRenderer
        data={rows}
        filterRow
        state={state}
        onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
      />
    );
  }

  const count = () => document.querySelector(".filter-count")!.textContent;

  it("shows no filter row until it is asked for", () => {
    render(<TableRenderer data={many(20)} />);
    expect(document.querySelector("tr.filter-row")).toBeNull();
  });

  it("renders one cell per visible column, and the right control for each type", () => {
    render(<Controlled rows={many(20)} />);
    // One per column; the actions cell after them has no data-filter-for.
    const cells = [...document.querySelectorAll("tr.filter-row th[data-filter-for]")];
    expect(cells.map((c) => c.getAttribute("data-filter-for"))).toEqual([
      "label",
      "bucket",
      "score",
      "day",
      "active",
      "meta",
    ]);
    expect(screen.getByLabelText("Filter label")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Minimum score")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("From day")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Filter active").tagName).toBe("SELECT");
    // An object column gets no control at all.
    expect(
      document.querySelector('tr.filter-row th[data-filter-for="meta"]')!.querySelector("input"),
    ).toBeNull();
  });

  it("narrows 10,000 rows by a contains filter and updates the count", async () => {
    render(<Controlled />);
    expect(count()).toBe("10000 of 10000 rows");

    await userEvent.type(screen.getByLabelText("Filter label"), "row-123");

    // row-123, row-1230..row-1239 — 11 of the 10,000.
    await waitFor(() => expect(count()).toBe("11 of 10000 rows"));
    expect(screen.getByText("row-1234")).toBeInTheDocument();
    expect(screen.queryByText("row-0")).not.toBeInTheDocument();
  });

  it("narrows by a number range across the whole set, not the rendered window", async () => {
    render(<Controlled />);
    await userEvent.type(screen.getByLabelText("Minimum score"), "9995");

    await waitFor(() => expect(count()).toBe("5 of 10000 rows"));
    expect(screen.getByText("row-9999")).toBeInTheDocument();
  });

  it("narrows by a boolean choice", async () => {
    render(<Controlled rows={many(100)} />);
    await userEvent.selectOptions(screen.getByLabelText("Filter active"), "false");

    await waitFor(() => expect(count()).toBe("50 of 100 rows"));
  });

  it("Clear drops every filter and restores the count", async () => {
    render(<Controlled rows={many(100)} />);
    await userEvent.type(screen.getByLabelText("Filter label"), "row-1");
    await waitFor(() => expect(count()).not.toBe("100 of 100 rows"));

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(count()).toBe("100 of 100 rows"));
    expect(screen.getByLabelText("Filter label")).toHaveValue("");
  });

  it("puts Clear and the count after the last column, in no column's filter cell", () => {
    render(<Controlled rows={many(20)} />);
    const clear = screen.getByRole("button", { name: "Clear" });
    const counter = document.querySelector(".filter-count")!;
    for (const el of [clear, counter]) {
      expect(el.closest("th[data-filter-for]")).toBeNull();
      expect(el.closest("tr.filter-row > th:last-child")).toHaveClass("filter-actions-col");
    }
    // The actions column is a whole column while filtering: every row has a
    // cell for it, so the rows stay in step.
    const widths = [...document.querySelectorAll("table.widget-table tr:not(.table-spacer)")].map(
      (tr) => tr.children.length,
    );
    expect(new Set(widths)).toEqual(new Set([7]));
  });

  it("has no actions column while the filter row is closed", () => {
    render(<TableRenderer data={many(20)} />);
    expect(document.querySelector(".filter-actions-col")).toBeNull();
  });

  it("Clear puts the date boxes back to the column's first and last date", async () => {
    render(<Controlled rows={many(100)} />);
    const from = screen.getByLabelText("From day");
    expect(from).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("To day")).toHaveValue("2026-01-28");

    await userEvent.clear(from);
    await userEvent.type(from, "2026-01-27{Enter}");
    await waitFor(() => expect(count()).toBe("6 of 100 rows"));
    await userEvent.clear(from);
    await userEvent.type(from, "nonsense");
    // To never applied anything: its invalid text must reset all the same.
    const to = screen.getByLabelText("To day");
    await userEvent.clear(to);
    await userEvent.type(to, "bad{Enter}");
    expect(to).toHaveAttribute("aria-invalid", "true");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(count()).toBe("100 of 100 rows"));
    expect(screen.getByLabelText("From day")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("From day")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("To day")).toHaveValue("2026-01-28");
    expect(screen.getByLabelText("To day")).not.toHaveAttribute("aria-invalid");
  });

  it("reports each filter change as a columnFilters patch, by value", async () => {
    const onStateChange = vi.fn();
    render(<TableRenderer data={many(20)} filterRow state={{}} onStateChange={onStateChange} />);

    await userEvent.type(screen.getByLabelText("Filter label"), "r");

    expect(onStateChange).toHaveBeenCalledWith({
      columnFilters: [{ id: "label", value: "r" }],
    });
  });

  it("renders a persisted filter, narrowed, on first paint", () => {
    render(
      <TableRenderer
        data={many(100)}
        filterRow
        state={{ columnFilters: [{ id: "bucket", value: "b-3" }] }}
        onStateChange={vi.fn()}
      />,
    );
    // i % 7 === 3 for i in 0..99: 3, 10, 17, ... 94 — fourteen of them.
    expect(count()).toBe("14 of 100 rows");
    expect(screen.getByLabelText("Filter bucket")).toHaveValue("b-3");
  });
});

describe("TableRenderer multi-sort", () => {
  const msRows = [
    { grp: "a", n: 2 },
    { grp: "a", n: 1 },
    { grp: "b", n: 3 },
  ];

  const th = (field: string) => document.querySelector(`th[data-field="${field}"]`) as HTMLElement;

  function Controlled() {
    const [state, setState] = useState<TableCardState>({});
    return (
      <TableRenderer
        data={msRows}
        state={state}
        onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
      />
    );
  }

  it("marks a single sorted column with an arrow and no index", async () => {
    render(<Controlled />);
    await userEvent.click(th("n"));

    expect(th("n").querySelector(".sort-marker")).toHaveTextContent("▲");
    expect(th("n").querySelector(".sort-index")).toBeNull();
  });

  it("adds a second column on shift-click and numbers both, in click order", () => {
    render(<Controlled />);
    fireEvent.click(th("grp"));
    fireEvent.click(th("n"), { shiftKey: true });

    expect(th("grp").querySelector(".sort-index")).toHaveTextContent("1");
    expect(th("n").querySelector(".sort-index")).toHaveTextContent("2");
    expect(th("grp").querySelector(".sort-marker")).toHaveTextContent("▲");
  });

  it("actually sorts by both keys", () => {
    render(<Controlled />);
    fireEvent.click(th("grp"));
    fireEvent.click(th("n"), { shiftKey: true });

    const body = screen.getAllByRole("rowgroup")[1];
    const cells = within(body)
      .getAllByRole("row")
      .map((r) => r.querySelector('td[data-field="n"]')!.textContent);
    expect(cells).toEqual(["1", "2", "3"]);
  });

  it("replaces a multi-sort when a plain click lands on a column that is not last in it", () => {
    // table-core's own rule (RowSorting.js): in single-sort mode a click on
    // the LAST column of the sort toggles that column's direction and keeps
    // the rest, and a click anywhere else replaces the whole sort. Pinned
    // here so the behaviour is described rather than assumed.
    render(<Controlled />);
    fireEvent.click(th("grp"));
    fireEvent.click(th("n"), { shiftKey: true });
    fireEvent.click(th("grp"));

    expect(th("n").querySelector(".sort-marker")).toBeNull();
    expect(th("grp").querySelector(".sort-index")).toBeNull();
    expect(th("grp").querySelector(".sort-marker")).toHaveTextContent("▼");
  });

  it("toggles just the last sorted column on a plain click, leaving the rest of the sort", () => {
    render(<Controlled />);
    fireEvent.click(th("grp"));
    fireEvent.click(th("n"), { shiftKey: true });
    fireEvent.click(th("n"));

    expect(th("grp").querySelector(".sort-index")).toHaveTextContent("1");
    expect(th("n").querySelector(".sort-marker")).toHaveTextContent("▼");
  });

  it("persists the whole sorting array, not just the last column", () => {
    const onStateChange = vi.fn();
    render(
      <TableRenderer
        data={msRows}
        state={{ sorting: [{ id: "grp", desc: false }] }}
        onStateChange={onStateChange}
      />,
    );
    fireEvent.click(th("n"), { shiftKey: true });

    expect(onStateChange).toHaveBeenCalledWith({
      sorting: [
        { id: "grp", desc: false },
        { id: "n", desc: false },
      ],
    });
  });
});

describe("TableRenderer fields containing a dot", () => {
  // A transposed payload's keys are the data's own first-column values --
  // `BRK.B`, `AAPL.US`, `1.5` -- and table-core reads a dotted accessorKey
  // as a nested path, so every one of these cells read undefined.
  const dotted = [
    { sym: "b", "BRK.B": 3 },
    { sym: "a", "BRK.B": 1 },
    { sym: "c", "BRK.B": 2 },
  ];
  const cells = (field: string) =>
    Array.from(document.querySelectorAll(`td[data-field="${field}"]`)).map((c) => c.textContent);

  it("shows the field's own values", () => {
    render(<TableRenderer data={dotted} />);
    expect(cells("BRK.B")).toEqual(["3", "1", "2"]);
  });

  it("sorts by the field's own values", async () => {
    render(<TableRenderer data={dotted} />);
    await userEvent.click(screen.getByRole("columnheader", { name: /BRK\.B/ }));
    expect(cells("sym")).toEqual(["a", "c", "b"]);
  });
});

describe("TableRenderer sort order by column type", () => {
  const cells = (field: string) =>
    Array.from(document.querySelectorAll(`td[data-field="${field}"]`)).map((c) => c.textContent);

  // Fewer than ten rows on purpose: table-core's own type sniffing skips the
  // first ten (`flatRows.slice(10)`), so a short table fell back to `>`,
  // where null compares like 0 and lands mid-column in a signed column --
  // change %, say.
  const signed = [
    { sym: "p5", chg: 5 },
    { sym: "n1", chg: null },
    { sym: "m3", chg: -3 },
    { sym: "z0", chg: 0 },
    { sym: "n2", chg: null },
    { sym: "p12", chg: 12 },
    { sym: "m1", chg: -1 },
    // No `chg` at all: absent is missing too, same as null.
    { sym: "u" },
  ];

  it("sorts a short numeric column numerically, missing values last, ascending", async () => {
    render(<TableRenderer data={signed} />);
    await userEvent.click(screen.getByRole("columnheader", { name: /chg/ }));
    expect(cells("sym")).toEqual(["m3", "m1", "z0", "p5", "p12", "n1", "n2", "u"]);
  });

  it("keeps missing values last when the same column sorts descending", async () => {
    render(<TableRenderer data={signed} />);
    const header = screen.getByRole("columnheader", { name: /chg/ });
    await userEvent.click(header);
    await userEvent.click(header);
    expect(cells("sym")).toEqual(["p12", "p5", "z0", "m1", "m3", "n1", "n2", "u"]);
  });

  it("sorts a string column case-insensitively", async () => {
    render(<TableRenderer data={[{ name: "cherry" }, { name: "Banana" }, { name: "apple" }]} />);
    await userEvent.click(screen.getByRole("columnheader", { name: /name/ }));
    expect(cells("name")).toEqual(["apple", "Banana", "cherry"]);
  });
});

describe("TableRenderer header drag reorder", () => {
  const dragRows = [{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }];

  const th = (field: string) => document.querySelector(`th[data-field="${field}"]`) as HTMLElement;
  const headerFields = () =>
    screen.getAllByRole("columnheader").map((e) => e.getAttribute("data-field"));

  function Controlled() {
    const [state, setState] = useState<TableCardState>({});
    return (
      <TableRenderer
        data={dragRows}
        state={state}
        onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
      />
    );
  }

  function dragTo(from: string, to: string) {
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(th(from), { dataTransfer });
    fireEvent.dragOver(th(to), { dataTransfer });
    fireEvent.drop(th(to), { dataTransfer });
  }

  it("moves a dragged header in front of the one it was dropped on", () => {
    render(<Controlled />);
    dragTo("volume", "symbol");
    expect(headerFields()).toEqual(["volume", "symbol", "close"]);
  });

  it("does not also sort the column it was dragged from", () => {
    render(<Controlled />);
    dragTo("volume", "symbol");
    expect(document.querySelector(".sort-marker")).toBeNull();
  });

  it("emits the new order as a columnOrder patch", () => {
    const onStateChange = vi.fn();
    render(<TableRenderer data={dragRows} state={{}} onStateChange={onStateChange} />);
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(th("volume"), { dataTransfer });
    fireEvent.drop(th("symbol"), { dataTransfer });

    expect(onStateChange).toHaveBeenCalledWith({
      columnOrder: ["volume", "symbol", "close"],
    });
  });

  it("cancels a dragstart that began on the resize handle, so the resize still runs", () => {
    render(<Controlled />);
    const resizer = th("volume").querySelector(".column-resizer")!;
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer() });

    resizer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(resizer).toHaveAttribute("draggable", "false");
  });

  // What browsers actually do (bdobb#7): a press on the non-draggable resizer
  // starts a drag of its draggable ancestor, so dragstart's target is the
  // <th>, never the span. That drag must be cancelled and must not reorder.
  it("cancels the header drag a resize press starts, even though dragstart targets the <th>", () => {
    render(<Controlled />);
    const resizer = th("volume").querySelector(".column-resizer")!;
    fireEvent.mouseDown(resizer, { button: 0, clientX: 100 });
    const dataTransfer = makeDataTransfer();
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });

    th("volume").dispatchEvent(event);
    fireEvent.drop(th("symbol"), { dataTransfer });
    fireEvent.mouseUp(document);

    expect(event.defaultPrevented).toBe(true);
    expect(headerFields()).toEqual(["symbol", "close", "volume"]);
  });

  it("still lets the same header be dragged after a resize press has ended", () => {
    render(<Controlled />);
    const resizer = th("volume").querySelector(".column-resizer")!;
    fireEvent.mouseDown(resizer, { button: 0, clientX: 100 });
    fireEvent.mouseUp(document);

    dragTo("volume", "symbol");

    expect(headerFields()).toEqual(["volume", "symbol", "close"]);
  });
});

describe("TableRenderer re-measures when a pinned header cell resizes", () => {
  /**
   * jsdom implements no ResizeObserver, and the renderer's is guarded rather
   * than stubbed — so it never runs unless a test plants one. Each instance is
   * recorded so a test can see which nodes are actually watched and fire the
   * callback itself. Stubbed only inside this describe: the rest of the file
   * exercises the unobserved path, and @tanstack/react-virtual picks a
   * ResizeObserver up too when one exists.
   */
  type FakeObserver = { fire: () => void; targets: Element[]; disconnected: boolean };
  let observers: FakeObserver[] = [];

  class ResizeObserverStub {
    private readonly record: FakeObserver;

    constructor(callback: () => void) {
      this.record = { fire: callback, targets: [], disconnected: false };
      observers.push(this.record);
    }

    observe(target: Element): void {
      this.record.targets.push(target);
    }

    unobserve(): void {}

    disconnect(): void {
      this.record.disconnected = true;
    }
  }

  /**
   * The renderer's own observer, told apart from the virtualiser's (which
   * watches the scroll container and the <tr>s) by what it watches.
   */
  const headerObserver = () =>
    observers.find((o) => o.targets.length > 0 && o.targets.every((t) => t.tagName === "TH"));

  /** Mutable, so a test can re-width a column and then fire the observer. */
  let widths: Record<string, number> = {};
  let restoreRect: (() => void) | undefined;

  const spec: TableSpec = {
    columns: [
      { field: "symbol", pinned: "left", width: 80 },
      { field: "close", pinned: "left", width: 120 },
      { field: "volume", width: 100 },
    ],
  };
  const data = [{ symbol: "AAPL", close: 190.5, volume: 2_300_000 }];
  const th = (field: string) => document.querySelector(`th[data-field="${field}"]`) as HTMLElement;

  beforeEach(() => {
    observers = [];
    widths = { symbol: 140, close: 200, volume: 90 };
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);

    const real = Object.getOwnPropertyDescriptor(
      HTMLTableCellElement.prototype,
      "getBoundingClientRect",
    );
    HTMLTableCellElement.prototype.getBoundingClientRect = function (this: HTMLTableCellElement) {
      const field = this.getAttribute("data-field") ?? "";
      return {
        width: widths[field] ?? 0,
        height: 22,
        top: 0,
        left: 0,
        right: 0,
        bottom: 22,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
    restoreRect = () => {
      if (real) {
        Object.defineProperty(HTMLTableCellElement.prototype, "getBoundingClientRect", real);
      } else {
        delete (HTMLTableCellElement.prototype as Partial<HTMLTableCellElement>)
          .getBoundingClientRect;
      }
    };
  });

  afterEach(() => {
    restoreRect?.();
    vi.unstubAllGlobals();
  });

  it("observes the pinned HEADER cells, and not the filter row's copies of them", () => {
    render(<TableRenderer data={data} spec={spec} filterRow />);

    // Both pinned header cells, in order, and nothing else: not the unpinned
    // header cell, and not the filter row's pinned cells (which are offset by
    // these widths and so report nothing new).
    expect(headerObserver()?.targets).toEqual([th("symbol"), th("close")]);
    // The filter row does have its own pinned cells; they are simply not in
    // the observed set.
    expect(document.querySelectorAll("tr.filter-row th.pin-left")).toHaveLength(2);
  });

  it("re-measures the offsets when an observed cell's width changes", () => {
    render(<TableRenderer data={data} spec={spec} />);
    expect(th("close").style.left).toBe("140px");

    // A wider value scrolled into the virtual window widens the auto-layout
    // column without changing a prop: nothing but the observer notices.
    widths.symbol = 220;
    act(() => headerObserver()?.fire());

    expect(th("close").style.left).toBe("220px");
    expect(
      (document.querySelector('td[data-field="close"]') as HTMLElement).style.left,
    ).toBe("220px");
  });

  it("disconnects the observer when the table unmounts", () => {
    const { unmount } = render(<TableRenderer data={data} spec={spec} />);
    const observer = headerObserver();
    expect(observer).toBeDefined();

    unmount();

    expect(observer?.disconnected).toBe(true);
  });
});

describe("TableRenderer column menu", () => {
  const menuRows = [
    { symbol: "AAPL", close: 190.5, volume: 2_300_000 },
    { symbol: "MSFT", close: 410.25, volume: 1_500 },
  ];
  const pinnedSpec: TableSpec = {
    columns: [{ field: "symbol", pinned: "left" }, { field: "close" }, { field: "volume" }],
  };

  const th = (field: string) => document.querySelector(`th[data-field="${field}"]`) as HTMLElement;
  const headerFields = () =>
    screen.getAllByRole("columnheader").map((e) => e.getAttribute("data-field"));
  const item = (name: string) => screen.getByRole("menuitem", { name });

  function Controlled({ spec }: { spec?: TableSpec }) {
    const [state, setState] = useState<TableCardState>({});
    return (
      <TableRenderer
        data={menuRows}
        spec={spec}
        state={state}
        onStateChange={(patch) => setState((s) => ({ ...s, ...patch }))}
      />
    );
  }

  /** A right-click, as the browser delivers it: no click follows button 2. */
  const rightClick = (field: string) =>
    fireEvent.contextMenu(th(field), { clientX: 120, clientY: 60 });

  it("opens at the pointer on a header right-click, and does not sort", () => {
    render(<Controlled />);
    rightClick("close");

    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("60px");
    expect(document.querySelector(".sort-marker")).toBeNull();
  });

  it("does not start a drag from the right-click", () => {
    render(<Controlled />);
    rightClick("close");
    // Nothing was dragged, so a drop is a no-op and the order is untouched.
    fireEvent.drop(th("symbol"), { dataTransfer: makeDataTransfer() });

    expect(headerFields()).toEqual(["symbol", "close", "volume"]);
  });

  it("disables the item matching the column's current effective side", () => {
    render(<Controlled spec={pinnedSpec} />);
    rightClick("symbol");

    expect(item("Pin left")).toBeDisabled();
    expect(item("Pin right")).toBeEnabled();
    expect(item("Unpin")).toBeEnabled();
  });

  it("opens the header menu from the keyboard, anchored to the cell", async () => {
    render(<Controlled />);
    const cell = th("symbol");
    // jsdom measures everything as 0x0; a real rect is what makes "anchored
    // to the cell" an assertion rather than a coincidence.
    cell.getBoundingClientRect = () => ({ left: 30, bottom: 24 }) as DOMRect;

    // Tab, not .focus(): what this pins is that a header is IN the tab order.
    await userEvent.tab();
    expect(cell).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("30px");
    expect(menu.style.top).toBe("24px");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Sort ascending",
      "Sort descending",
      "Pin left",
      "Pin right",
      "Unpin",
      "Hide",
    ]);
  });

  it.each(["{Enter}", "[Space]", "{ContextMenu}", "{Shift>}{F10}{/Shift}"])(
    "opens the header menu on %s",
    async (keys) => {
      render(<Controlled />);
      await userEvent.tab();
      await userEvent.keyboard(keys);

      expect(screen.getByRole("menu")).toBeInTheDocument();
      // The header's own click handler sorts; none of these keys may reach it.
      expect(document.querySelector(".sort-marker")).toBeNull();
    },
  );

  it("returns focus to the header cell when a keyboard-opened menu closes", async () => {
    render(<Controlled />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(th("symbol")).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(th("symbol")).toHaveFocus();
  });

  it("disables Pin right on a column pinned right", async () => {
    render(<Controlled />);
    rightClick("volume");
    await userEvent.click(item("Pin right"));

    rightClick("volume");
    expect(item("Pin right")).toBeDisabled();
    expect(item("Pin left")).toBeEnabled();
    expect(item("Unpin")).toBeEnabled();
  });

  it("separates Hide from the pin items", () => {
    render(<Controlled />);
    rightClick("close");

    // Hide's own separator, not the menu's first: the sort items sit above
    // the pin items with a separator of their own.
    expect(item("Hide").previousElementSibling).toHaveAttribute("role", "separator");
  });

  it("sorts from the keyboard alone, through the header menu", async () => {
    render(<Controlled />);
    const symbols = () =>
      Array.from(document.querySelectorAll('td[data-field="symbol"]')).map((c) => c.textContent);
    await userEvent.tab(); // symbol
    await userEvent.tab(); // close
    expect(th("close")).toHaveFocus();

    // Unsorted: nothing to clear, so no Clear sort item.
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("menuitem", { name: "Clear sort" })).toBeNull();
    // The menu focuses its first item, Sort ascending; one ArrowDown is Sort descending.
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(symbols()).toEqual(["MSFT", "AAPL"]);
    expect(th("close")).toHaveAttribute("aria-sort", "descending");
    // Choosing an item hands focus back to the header, so the next sort is
    // one Enter away.
    expect(th("close")).toHaveFocus();

    await userEvent.keyboard("{Enter}");
    expect(item("Sort descending")).toBeDisabled();
    await userEvent.keyboard("{Enter}"); // Sort ascending, the first item
    expect(symbols()).toEqual(["AAPL", "MSFT"]);
    expect(th("close")).toHaveAttribute("aria-sort", "ascending");

    await userEvent.keyboard("{Enter}");
    // Sort ascending is disabled now, so focus starts on Sort descending.
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}"); // Clear sort
    expect(th("close")).toHaveAttribute("aria-sort", "none");
    expect(document.querySelector(".sort-marker")).toBeNull();
  });

  it("says how every header is sorted, through aria-sort", () => {
    render(
      <TableRenderer
        data={menuRows}
        state={{ sorting: [{ id: "close", desc: true }] }}
        onStateChange={vi.fn()}
      />,
    );
    expect(th("close")).toHaveAttribute("aria-sort", "descending");
    expect(th("symbol")).toHaveAttribute("aria-sort", "none");
    expect(th("volume")).toHaveAttribute("aria-sort", "none");
  });

  it("pins left, and the state the owner keeps says so", async () => {
    const onStateChange = vi.fn();
    render(<TableRenderer data={menuRows} state={{}} onStateChange={onStateChange} />);
    rightClick("close");
    await userEvent.click(item("Pin left"));

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange.mock.calls[0][0].pinned).toEqual({ close: "left" });
  });

  it("disables Unpin on a column that is not pinned", () => {
    render(<Controlled spec={pinnedSpec} />);
    rightClick("volume");

    expect(item("Unpin")).toBeDisabled();
    expect(item("Pin left")).toBeEnabled();
  });

  it("emits ONE patch carrying both pinned and columnOrder", async () => {
    const onStateChange = vi.fn();
    render(<TableRenderer data={menuRows} state={{}} onStateChange={onStateChange} />);
    rightClick("symbol");
    await userEvent.click(item("Pin right"));

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith({
      pinned: { symbol: "right" },
      columnOrder: ["close", "volume", "symbol"],
    });
  });

  it("pins for real: the header moves, sticks, and the menu closes", async () => {
    render(<Controlled />);
    rightClick("symbol");
    await userEvent.click(item("Pin right"));

    expect(headerFields()).toEqual(["close", "volume", "symbol"]);
    expect(th("symbol").className).toBe("pin-right");
    expect(th("symbol").style.right).toBe("0px");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("unpins a column the widget spec pins", async () => {
    render(<Controlled spec={pinnedSpec} />);
    expect(th("symbol").className).toBe("pin-left");

    rightClick("symbol");
    await userEvent.click(item("Unpin"));

    expect(th("symbol").className).toBe("");
    expect(headerFields()).toEqual(["symbol", "close", "volume"]);
  });

  it("hides the column, emitting the same list the Columns menu writes", async () => {
    const onStateChange = vi.fn();
    render(<TableRenderer data={menuRows} state={{}} onStateChange={onStateChange} />);
    rightClick("close");
    await userEvent.click(item("Hide"));

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith({ hidden: ["close"] });
  });

  it("closes on Escape without emitting anything", () => {
    const onStateChange = vi.fn();
    render(<TableRenderer data={menuRows} state={{}} onStateChange={onStateChange} />);
    rightClick("close");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("hands focus back to the header cell the menu was opened from", () => {
    render(<TableRenderer data={menuRows} state={{}} onStateChange={vi.fn()} />);
    rightClick("close");
    // The menu focuses its first item on open, so the cell does not hold focus.
    expect(th("close")).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });

    // Only real because the <th> is focusable: .focus() on an element the
    // browser will not focus leaves activeElement at <body>.
    expect(th("close")).toHaveFocus();
  });

  it("closes the menu when a refresh drops the column it was opened on", () => {
    const onStateChange = vi.fn();
    const { rerender } = render(
      <TableRenderer data={menuRows} state={{}} onStateChange={onStateChange} />,
    );
    rightClick("close");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Programmatic, not a click: a click's mousedown would close the menu via
    // the outside-dismiss handler and mask the bug this guards against.
    act(() => {
      rerender(
        <TableRenderer
          data={menuRows.map(({ symbol, volume }) => ({ symbol, volume }))}
          state={{}}
          onStateChange={onStateChange}
        />,
      );
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe("hoverCard cells", () => {
  // The reference backend's table_widget_with_hover_card: the cell is an
  // object, which rendered as "[object Object]".
  const rows = [{ name: { value: "Ethereum", foundedDate: "2015-07-30" }, tvl: 45 }];
  const spec: TableSpec = {
    columns: [
      {
        field: "name",
        renderFn: ["hoverCard"],
        renderFnParams: {
          hoverCard: { cellField: "value", title: "Project Details", markdown: "**{value}** (since {foundedDate})" },
        },
      },
      { field: "tvl" },
    ],
  };

  it("shows the cellField value instead of the object", () => {
    render(<TableRenderer data={rows} spec={spec} />);
    expect(document.querySelector('td[data-field="name"]')).toHaveTextContent(/^Ethereum$/);
  });

  // A column can be both: the click must send the value the cell shows, not
  // the cell's object stringified to "[object Object]".
  it("sends the cellField value when a hoverCard column is also clicked", () => {
    const onCellClick = vi.fn();
    const both: TableSpec = {
      columns: [
        {
          field: "name",
          renderFn: ["hoverCard", "cellOnClick"],
          renderFnParams: {
            hoverCard: { cellField: "value", markdown: "{value}" },
            actionType: "groupBy",
            groupBy: { paramName: "asset" },
          },
        },
      ],
    };
    render(<TableRenderer data={rows} spec={both} onCellClick={onCellClick} />);
    fireEvent.click(document.querySelector('td[data-field="name"] button.cell-link')!);
    expect(onCellClick).toHaveBeenCalledWith(expect.objectContaining({ paramName: "asset", value: "Ethereum" }));
  });

  it("shows the title and the filled markdown on hover", () => {
    render(<TableRenderer data={rows} spec={spec} />);
    fireEvent.mouseEnter(screen.getByText("Ethereum"));
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("Project Details");
    expect(within(card).getByText("Ethereum", { selector: "strong" })).toBeInTheDocument();
    expect(card).toHaveTextContent("(since 2015-07-30)");
    fireEvent.mouseLeave(screen.getByText("Ethereum", { selector: "td *" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("cellOnClick cells", () => {
  const clickRows = [
    { symbol: "AAPL", ticker: "AAPL.US", chg: 1.5 },
    { symbol: "MSFT", ticker: "MSFT.US", chg: -2 },
    { symbol: "NVDA", ticker: null, chg: 0 },
  ];

  /** A spec whose `symbol` column asks for a groupBy cell click. */
  function spec(over: Record<string, unknown> = {}): TableSpec {
    return {
      columns: [
        {
          field: "symbol",
          renderFn: ["cellOnClick"],
          renderFnParams: {
            actionType: "groupBy",
            groupBy: { paramName: "symbol", ...over },
          },
        },
        { field: "chg", renderFn: ["greenRed"] },
      ],
    };
  }

  const cells = (field: string) =>
    [...document.querySelectorAll(`td[data-field="${field}"]`)] as HTMLElement[];

  it("renders a button.cell-link in the declared column and plain cells everywhere else", () => {
    render(<TableRenderer data={clickRows} spec={spec()} onCellClick={vi.fn()} />);

    const buttons = cells("symbol").map((td) => td.querySelector("button.cell-link"));
    expect(buttons.every((b) => b !== null)).toBe(true);
    expect(buttons[0]).toHaveAttribute("type", "button");
    // The formatted text is the SAME text a plain cell shows -- the button
    // wraps the existing cell content, it does not re-render it.
    expect(buttons[0]).toHaveTextContent("AAPL");
    // Not the declared column: no button, just text.
    expect(cells("chg")[0].querySelector("button")).toBeNull();
    // The cell's own visual classes stay on the td, where the stylesheet's
    // `.widget-table td.cell-pos` selector can still reach them.
    expect(cells("chg")[0]).toHaveClass("cell-pos");
  });

  it("emits paramName, the cell value and forceUpdate", async () => {
    const onCellClick = vi.fn();
    render(
      <TableRenderer data={clickRows} spec={spec({ forceUpdate: true })} onCellClick={onCellClick} />,
    );

    await userEvent.click(cells("symbol")[1].querySelector("button")!);

    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick).toHaveBeenCalledWith({
      paramName: "symbol",
      value: "MSFT",
      forceUpdate: true,
    });
  });

  it("takes the value from valueField when the column names one", async () => {
    const onCellClick = vi.fn();
    render(
      <TableRenderer
        data={clickRows}
        spec={spec({ valueField: "ticker" })}
        onCellClick={onCellClick}
      />,
    );

    await userEvent.click(cells("symbol")[0].querySelector("button")!);

    // The DISPLAYED text is still the symbol column's; only the emitted value
    // comes from the other field. textContent, not toHaveTextContent: the
    // latter is a substring match and "AAPL" is a substring of "AAPL.US", so
    // it could not tell the two apart.
    expect(cells("symbol")[0].textContent).toBe("AAPL");
    expect(onCellClick).toHaveBeenCalledWith({
      paramName: "symbol",
      value: "AAPL.US",
      forceUpdate: false,
    });
  });

  it("emits an empty string for a null value, and still delivers the click", async () => {
    const onCellClick = vi.fn();
    render(
      <TableRenderer
        data={clickRows}
        spec={spec({ valueField: "ticker" })}
        onCellClick={onCellClick}
      />,
    );

    // Row 3's ticker is null. The card decides what an empty value means; the
    // renderer's job is only to deliver it.
    await userEvent.click(cells("symbol")[2].querySelector("button")!);

    expect(onCellClick).toHaveBeenCalledWith({
      paramName: "symbol",
      value: "",
      forceUpdate: false,
    });
  });

  it("emits an empty string for a valueField the row does not own, not a stringified prototype method", async () => {
    const onCellClick = vi.fn();
    render(
      <TableRenderer
        data={clickRows}
        spec={spec({ valueField: "toString" })}
        onCellClick={onCellClick}
      />,
    );

    // Every row inherits Object.prototype.toString; the Object.hasOwn guard
    // must treat that as absent, not stringify the inherited function.
    await userEvent.click(cells("symbol")[0].querySelector("button")!);

    expect(onCellClick).toHaveBeenCalledWith({
      paramName: "symbol",
      value: "",
      forceUpdate: false,
    });
  });

  it("does not sort the column or start a drag", async () => {
    const onStateChange = vi.fn();
    render(
      <TableRenderer
        data={clickRows}
        spec={spec()}
        onCellClick={vi.fn()}
        onStateChange={onStateChange}
      />,
    );
    const firstBefore = cells("symbol")[0].textContent;

    await userEvent.click(cells("symbol")[0].querySelector("button")!);

    // Sorting is wired to the <th>'s onClick and the header is draggable; a
    // cell click must reach neither. No patch at all is the assertion --
    // sorting is the only thing a click on this table can persist.
    expect(onStateChange).not.toHaveBeenCalled();
    expect(cells("symbol")[0].textContent).toBe(firstBefore);
    expect(document.querySelector(".sort-marker")).toBeNull();
  });

  it("falls back to the column's OWN field, not the paramName it groups", async () => {
    const onCellClick = vi.fn();
    render(
      <TableRenderer
        data={clickRows}
        spec={{
          columns: [
            {
              // The column displays `ticker` and groups `symbol`: the two
              // names differ, so this is the one case that can tell
              // `valueField ?? field` from `valueField ?? paramName` apart.
              field: "ticker",
              renderFn: ["cellOnClick"],
              renderFnParams: { actionType: "groupBy", groupBy: { paramName: "symbol" } },
            },
          ],
        }}
        onCellClick={onCellClick}
      />,
    );

    await userEvent.click(cells("ticker")[0].querySelector("button")!);

    expect(onCellClick).toHaveBeenCalledWith({
      paramName: "symbol",
      value: "AAPL.US",
      forceUpdate: false,
    });
  });

  it("renders plain cells when no onCellClick is wired, even though the spec asks for one", () => {
    // A bare <TableRenderer data={...} />: nobody owns a parameter to assign,
    // so a button that did nothing would be a lie.
    render(<TableRenderer data={clickRows} spec={spec()} />);

    expect(document.querySelector("button.cell-link")).toBeNull();
    expect(cells("symbol")[0]).toHaveTextContent("AAPL");
  });
});

describe("plain mode", () => {
  const plainRows = [
    { Field: "open", "2026-01-02": 1 },
    { Field: "close", "2026-01-02": 2 },
  ];

  it("draws a static header and rows with no sort, filter or column menu", () => {
    render(<TableRenderer data={plainRows} plain columns={["Field", "2026-01-02"]} filterRow />);

    expect(screen.getByRole("columnheader", { name: "Field" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "2026-01-02" })).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("close")).toBeInTheDocument();
    // No toolkit surface at all: no sort buttons, no filter row, no menus.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("draws the columns in the order given, never the row's own key order", () => {
    // "2024" is an integer-like key: JS enumerates it before "Field" on the
    // row object whatever the insertion order. The rendered header order must
    // therefore come from `columns` alone.
    render(<TableRenderer data={[{ Field: "v", "2024": 1 }]} plain columns={["Field", "2024"]} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Field",
      "2024",
    ]);
  });

  it("still falls through to the usual empties", () => {
    render(<TableRenderer data={[]} plain columns={[]} />);

    expect(screen.getByText("No rows.")).toBeInTheDocument();
  });
});

describe("showCellChange flash", () => {
  const spec = {
    columns: [
      { field: "symbol" },
      { field: "price", renderFn: ["showCellChange"], renderFnParams: { colorValueKey: "change" } },
      { field: "volume", renderFn: ["showCellChange"], enableCellChangeWs: false },
    ],
  } as unknown as TableSpec;

  it("flashes a showCellChange cell up on change, but not an opted-out column", () => {
    const { rerender } = render(
      <TableRenderer data={[{ symbol: "T", price: 10, change: 1, volume: 100 }]} spec={spec} rowIdColumn="symbol" />,
    );
    rerender(
      <TableRenderer data={[{ symbol: "T", price: 12, change: 1, volume: 200 }]} spec={spec} rowIdColumn="symbol" />,
    );
    expect(document.querySelector('td[data-field="price"]')).toHaveAttribute("data-flash", "up");
    expect(document.querySelector('td[data-field="volume"]')).not.toHaveAttribute("data-flash");
  });

  // Without a rowIdColumn the change is tracked by data index; under a sort
  // the rendered row must look its flash up by that same index, not by its
  // on-screen position, or the wrong row flashes.
  it("flashes the changed row under a sort when there is no rowIdColumn", () => {
    const sorted = { sorting: [{ id: "price", desc: true }] };
    const { rerender } = render(
      <TableRenderer
        data={[{ symbol: "A", price: 10, change: 1 }, { symbol: "B", price: 20, change: 1 }]}
        spec={spec}
        state={sorted}
        onStateChange={vi.fn()}
      />,
    );
    rerender(
      <TableRenderer
        data={[{ symbol: "A", price: 11, change: 1 }, { symbol: "B", price: 20, change: 1 }]}
        spec={spec}
        state={sorted}
        onStateChange={vi.fn()}
      />,
    );
    const priceCell = (symbol: string) =>
      within(screen.getByText(symbol).closest("tr")!).getByText((_, el) => el?.getAttribute("data-field") === "price");
    expect(priceCell("A")).toHaveAttribute("data-flash", "up");
    expect(priceCell("B")).not.toHaveAttribute("data-flash");
  });

  // Every snapshot is freshly parsed, so an object cell is a new reference
  // each time: only a change of its CONTENT is a change.
  it("does not flash an object cell whose content is unchanged", () => {
    const { rerender } = render(
      <TableRenderer data={[{ symbol: "T", price: [1, 2], change: 1 }]} spec={spec} rowIdColumn="symbol" />,
    );
    rerender(<TableRenderer data={[{ symbol: "T", price: [1, 2], change: 1 }]} spec={spec} rowIdColumn="symbol" />);
    expect(document.querySelector('td[data-field="price"]')).not.toHaveAttribute("data-flash");
  });

  // The tracked values are the CURRENT rows' only: a row that leaves is
  // forgotten, so one that comes back later is new, not a change.
  it("forgets a row that has left the data", () => {
    const { rerender } = render(
      <TableRenderer data={[{ symbol: "T", price: 10, change: 1 }]} spec={spec} rowIdColumn="symbol" />,
    );
    // Another row, not an empty grid: "No rows." unmounts the table itself.
    rerender(<TableRenderer data={[{ symbol: "U", price: 5, change: 1 }]} spec={spec} rowIdColumn="symbol" />);
    rerender(<TableRenderer data={[{ symbol: "T", price: 12, change: 1 }]} spec={spec} rowIdColumn="symbol" />);
    expect(document.querySelector('td[data-field="price"]')).not.toHaveAttribute("data-flash");
  });
});

describe("sparkline cells", () => {
  it("renders a sparkline SVG for a column with a sparkline config and array cells", () => {
    const spec: TableSpec = {
      columns: [
        { field: "symbol" },
        { field: "trend", sparkline: { type: "line", options: { stroke: "#22c55e" } } },
      ],
    } as unknown as TableSpec;
    const { container } = render(
      <TableRenderer data={[{ symbol: "AAPL", trend: [1, 3, 2, 5] }]} spec={spec} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    // the array is NOT rendered as its text form
    expect(container.textContent).not.toContain("1,3,2,5");
  });

  it("draws object points through the column's yKey instead of printing them", () => {
    const spec: TableSpec = {
      columns: [{ field: "monthly", sparkline: { type: "bar", options: { xKey: "x", yKey: "y" } } }],
    } as unknown as TableSpec;
    const { container } = render(
      <TableRenderer data={[{ monthly: [{ x: "Jan", y: 2.1 }, { x: "Feb", y: -1.5 }] }]} spec={spec} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toContain('"x"');
  });

  it("falls back to text when a sparkline column's cell has no usable numbers", () => {
    const spec: TableSpec = {
      columns: [{ field: "trend", sparkline: { type: "line" } }],
    } as unknown as TableSpec;
    const { container } = render(<TableRenderer data={[{ trend: [] }]} spec={spec} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
