// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBackendsStore } from "../../stores/backendsStore";
import { __reset, writeFile } from "../../test/memfs";
import { dataFromBytes, LocalTableRenderer } from "./LocalTableRenderer";

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
  __reset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useBackendsStore.setState({ backends: [], statuses: {} });
});

const records = [
  { date: "2026-01-02T00:00:00Z", sector: "Tech", revenue: 10.25 },
  { date: "2026-01-03T00:00:00Z", sector: "Tech", revenue: 20.25 },
  { date: "2026-01-04T00:00:00Z", sector: "Energy", revenue: 7 },
];

// Removing the local table's generic pivot path must remove these grouped Sum
// rows. This exercises real parsing and rendering, with no backend configured.
describe("local file linked baseline", () => {
  it.each(["csv", "xls"] as const)("imports %s numeric cells and renders explicit Sum date/sector groups", async (extension) => {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(records), "Revenue");
    const bytes = extension === "csv"
      ? new TextEncoder().encode(XLSX.utils.sheet_to_csv(book.Sheets.Revenue!))
      : new Uint8Array(XLSX.write(book, { bookType: "xls", type: "array" }));
    const file = `11111111-1111-4111-8111-111111111111.${extension}`;
    const parsed = await dataFromBytes(file, bytes) as typeof records;
    expect(parsed.map((row) => row.revenue)).toEqual([10.25, 20.25, 7]);
    expect(parsed.every((row) => typeof row.revenue === "number")).toBe(true);
    expect(parsed.map((row) => typeof row.date === "string" ? row.date.slice(0, 10) : row.date)).toEqual(["2026-01-02", "2026-01-03", "2026-01-04"]);
    await writeFile(`files/${file}`, bytes);
    const state = { pivot: {
      enabled: true,
      grouping: ["date", "sector"],
      split: [],
      buckets: { date: "month" as const },
      aggregationFns: { revenue: "sum" as const },
    } };
    render(<LocalTableRenderer file={file} label={`revenue.${extension}`} refreshKey={0} state={state} onStateChange={() => {}} />);
    const sector = await screen.findByRole("button", { name: "Collapse Tech" });
    const group = sector.closest("tr")!;
    expect(within(group).getByText("30.5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse 2026-01" })).toBeInTheDocument();
    expect(useBackendsStore.getState().backends).toEqual([]);
  });
});

// Date formats identify spreadsheet dates; an ordinary numeric serial-looking
// measure must remain a number. These boundaries catch timezone/day truncation.
describe("file date semantics", () => {
  it("preserves CSV date-only and timestamp text around a year boundary", async () => {
    const bytes = new TextEncoder().encode("date,revenue\n2025-12-31,46022\n2025-12-31T23:30:00Z,10.25\n2026-01-01T00:30:00+02:00,20.25\n");
    expect(await dataFromBytes("boundary.csv", bytes)).toEqual([
      { date: "2025-12-31", revenue: 46022 },
      { date: "2025-12-31T23:30:00Z", revenue: 10.25 },
      { date: "2026-01-01T00:30:00+02:00", revenue: 20.25 },
    ]);
  });

  it("decodes XLS native calendar dates and times without changing ordinary numeric cells", async () => {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    // Native workbook dates are calendar serials, without a timezone.
    const sheet = XLSX.utils.aoa_to_sheet([
      ["date", "revenue"],
      [{ t: "n", v: 46022, z: "yyyy-mm-dd" }, 46022],
      [{ t: "n", v: 46022 + 23.5 / 24, z: "yyyy-mm-dd hh:mm:ss" }, 10.25],
      [{ t: "n", v: 46023 + 0.5 / 24, z: "yyyy-mm-dd hh:mm:ss" }, 20.25],
    ]);
    XLSX.utils.book_append_sheet(book, sheet, "Boundary");
    const bytes = new Uint8Array(XLSX.write(book, { bookType: "xls", type: "array" }));
    expect(await dataFromBytes("boundary.xls", bytes)).toEqual([
      { date: "2025-12-31", revenue: 46022 },
      { date: "2025-12-31T23:30:00", revenue: 10.25 },
      { date: "2026-01-01T00:30:00", revenue: 20.25 },
    ]);
  });
});
