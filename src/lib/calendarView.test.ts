// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import {
  eodhdLogoUrl,
  addDays, bucketRows, businessDaysBetween, continuousWeeks, createWheelStepper, detectDateColumn, detectTitleColumn, distinctValues, fetchWindow, filterSeries, firstOfMonth, gridWeeks, hiddenEventCount,
  buildTree, eventPath, filterTree, toggleTreePath, treeAllows, treeCounts,
  isoWeekday, lastOfMonth, localClock, localDate, mondayOf, parseEventTime, resolveMode, sortedBusinessDays, staticWeeks, stepCursor, todayLocal,
} from "./calendarView";

describe("parseEventTime", () => {
  it("reads an offset or Z string as that instant", () => {
    const t = parseEventTime("2026-09-11T12:30:00Z");
    expect(t).toEqual({ kind: "instant", at: new Date("2026-09-11T12:30:00Z") });
    expect(parseEventTime("2026-09-11T08:30:00-04:00")).toEqual({
      kind: "instant",
      at: new Date("2026-09-11T12:30:00Z"),
    });
  });

  it("reads a naive datetime as UTC, with T or a space", () => {
    // EODHD: "2026-09-11 12:30:00" is the 08:30 Eastern CPI release.
    expect(parseEventTime("2026-09-11 12:30:00")).toEqual({
      kind: "instant",
      at: new Date("2026-09-11T12:30:00Z"),
    });
    expect(parseEventTime("2026-09-11T12:30")).toEqual({
      kind: "instant",
      at: new Date("2026-09-11T12:30:00Z"),
    });
  });

  it("reads a bare date as an all-day event that never shifts", () => {
    expect(parseEventTime("2026-09-08")).toEqual({ kind: "allday", date: "2026-09-08" });
    expect(parseEventTime("2026-09-08T00:00:00")).toEqual({
      kind: "instant",
      at: new Date("2026-09-08T00:00:00Z"),
    });
  });

  it("accepts a Date object and rejects everything else", () => {
    const d = new Date("2026-09-11T12:30:00Z");
    expect(parseEventTime(d)).toEqual({ kind: "instant", at: d });
    expect(parseEventTime(null)).toBeNull();
    expect(parseEventTime(2026)).toBeNull();
    expect(parseEventTime("Sept 11")).toBeNull();
    expect(parseEventTime("2026-13-40")).toBeNull();
  });
});

describe("localDate / localClock", () => {
  const fed = new Date("2026-09-17T20:30:00Z"); // Fed balance sheet, 16:30 New York
  it("places an instant on its local date in the given zone", () => {
    expect(localDate(fed, "America/New_York")).toBe("2026-09-17");
    expect(localDate(fed, "Asia/Tokyo")).toBe("2026-09-18");
  });
  it("gives the local wall clock and its hour fraction", () => {
    expect(localClock(fed, "America/New_York")).toEqual({ hh: "16", mm: "30", frac: 16.5 });
    expect(localClock(fed, "Asia/Tokyo")).toEqual({ hh: "05", mm: "30", frac: 5.5 });
  });
  it("uses 24-hour digits, never '24' at midnight", () => {
    expect(localClock(new Date("2026-09-07T00:00:00Z"), "UTC")).toEqual({ hh: "00", mm: "00", frac: 0 });
  });
});

describe("bucketRows", () => {
  const rows = [
    { date: "2026-09-17 20:30:00", event: "Central Bank Balance Sheet" },
    { date: "2026-09-17 12:30:00", event: "Initial Jobless Claims" },
    { date: "2026-09-17", event: "10-Year TIPS Auction" },
    { date: "not a date", event: "junk" },
    { date: "2026-09-18 17:00:00", event: "Baker Hughes Oil Rig Count" },
  ];

  it("keys by local day, all-day first, then by time", () => {
    const b = bucketRows(rows, "date", "event", "America/New_York");
    expect([...b.keys()].sort()).toEqual(["2026-09-17", "2026-09-18"]);
    expect(b.get("2026-09-17")!.map((e) => e.title)).toEqual([
      "10-Year TIPS Auction",
      "Initial Jobless Claims",
      "Central Bank Balance Sheet",
    ]);
  });

  it("moves an instant to the next day in a zone east of UTC, but not the all-day row", () => {
    const b = bucketRows(rows, "date", "event", "Asia/Tokyo");
    expect(b.get("2026-09-17")!.map((e) => e.title)).toEqual([
      "10-Year TIPS Auction",
      "Initial Jobless Claims",
    ]);
    expect(b.get("2026-09-18")!.map((e) => e.title)).toEqual(["Central Bank Balance Sheet"]);
  });

  it("drops rows whose date does not parse and titles a missing title column with the day", () => {
    const b = bucketRows([{ date: "2026-09-17", event: null }], "date", "event");
    expect(b.get("2026-09-17")![0].title).toBe("2026-09-17");
    expect(bucketRows(rows, "date", "event").size).toBe(2);
  });
});

describe("civil dates", () => {
  it("adds days across month and year ends without a zone", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("finds month edges and weekdays", () => {
    expect(firstOfMonth("2026-09-17", 0)).toBe("2026-09-01");
    expect(firstOfMonth("2026-09-17", 1)).toBe("2026-10-01");
    expect(firstOfMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(lastOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(isoWeekday("2026-09-07")).toBe(1); // Labour Day, a Monday
    expect(isoWeekday("2026-09-13")).toBe(7);
    expect(mondayOf("2026-09-09")).toBe("2026-09-07");
    expect(mondayOf("2026-09-07")).toBe("2026-09-07");
  });
  it("normalises the business-day set", () => {
    expect(sortedBusinessDays([5, 1, 1, 3])).toEqual([1, 3, 5]);
    expect(sortedBusinessDays([])).toEqual([1, 2, 3, 4, 5]);
    expect(sortedBusinessDays(undefined)).toEqual([1, 2, 3, 4, 5]);
    expect(sortedBusinessDays([0, 8, 2])).toEqual([2]);
  });
  it("todayLocal is the current instant's civil date in the zone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T20:30:00Z"));
    try {
      expect(todayLocal("America/New_York")).toBe("2026-09-17");
      expect(todayLocal("Asia/Tokyo")).toBe("2026-09-18");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("gridWeeks", () => {
  const weekdays = [1, 2, 3, 4, 5];
  it("month: the weeks that cover the month, business days only", () => {
    const g = gridWeeks("month", "2026-09-17", weekdays);
    expect(g).toHaveLength(5);
    expect(g[0]).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(g[4]).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
  it("month: a Sunday-only set gives one cell per week", () => {
    const g = gridWeeks("month", "2026-09-17", [7]);
    expect(g.map((w) => w[0])).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"]);
  });
  it("week: one row from the cursor's Monday", () => {
    expect(gridWeeks("week", "2026-09-09", [1, 3, 5])).toEqual([["2026-09-07", "2026-09-09", "2026-09-11"]]);
  });
  it("day: the cursor alone", () => {
    expect(gridWeeks("day", "2026-09-09", weekdays)).toEqual([["2026-09-09"]]);
  });
  it("continuous: `count` rows from a Monday", () => {
    const g = continuousWeeks("2026-09-07", 3, [1, 5]);
    expect(g).toEqual([
      ["2026-09-07", "2026-09-11"],
      ["2026-09-14", "2026-09-18"],
      ["2026-09-21", "2026-09-25"],
    ]);
  });
});

describe("resolveMode", () => {
  it("a card with nothing persisted is a paged month of weeks", () => {
    expect(resolveMode({})).toEqual({ mode: "paged", unit: "month", rowUnit: "week" });
  });
  it("reads a pre-rework `continuous` card as the vertical week sheet", () => {
    expect(resolveMode({ unit: "continuous" })).toEqual({ mode: "vertical", unit: "month", rowUnit: "week" });
  });
  it("keeps a `rowUnit` patched onto a pre-rework `continuous` card before `mode` was ever written", () => {
    // A card left on `unit: "continuous"` whose reader had already flipped
    // the (pre-existing, mode-less) Days control patches `rowUnit: "day"`
    // straight onto that state. The `continuous` branch used to hardcode
    // "week" here, so the grid never changed and the Days button never
    // showed pressed.
    expect(resolveMode({ unit: "continuous", rowUnit: "day" })).toEqual({ mode: "vertical", unit: "month", rowUnit: "day" });
  });
  it("reads any other pre-rework unit as that paged unit", () => {
    expect(resolveMode({ unit: "week" })).toEqual({ mode: "paged", unit: "week", rowUnit: "week" });
  });
  it("a written mode wins over the unit it was left on", () => {
    expect(resolveMode({ mode: "horizontal", unit: "continuous" }).mode).toBe("horizontal");
    expect(resolveMode({ mode: "vertical", rowUnit: "day" }).rowUnit).toBe("day");
  });
});

describe("businessDaysBetween", () => {
  it("is inclusive, ascending and skips the hidden days", () => {
    expect(businessDaysBetween("2026-09-04", "2026-09-09", [1, 2, 3, 4, 5])).toEqual([
      "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
  });
});

describe("staticWeeks", () => {
  it("covers the week holding the start through the week holding the end", () => {
    expect(staticWeeks("2026-09-09", "2026-09-22", [1, 2, 3, 4, 5]).map((w) => w[0])).toEqual([
      "2026-09-07", "2026-09-14", "2026-09-21",
    ]);
  });
});

describe("stepCursor", () => {
  const weekdays = [1, 2, 3, 4, 5];
  it("moves a month to the first of the next month, a week by seven days", () => {
    expect(stepCursor("month", "2026-09-17", 1, weekdays)).toBe("2026-10-01");
    expect(stepCursor("month", "2026-09-17", -1, weekdays)).toBe("2026-08-01");
    expect(stepCursor("week", "2026-09-09", 1, weekdays)).toBe("2026-09-16");
  });
  it("day: skips days outside the business set in either direction", () => {
    expect(stepCursor("day", "2026-09-11", 1, weekdays)).toBe("2026-09-14"); // Fri -> Mon
    expect(stepCursor("day", "2026-09-14", -1, weekdays)).toBe("2026-09-11");
    expect(stepCursor("day", "2026-09-09", 1, [3])).toBe("2026-09-16"); // Wed only
  });
  it("continuous: unchanged, the scroll box owns movement", () => {
    expect(stepCursor("continuous", "2026-09-09", 1, weekdays)).toBe("2026-09-09");
  });
});

describe("fetchWindow", () => {
  it("month: whole weeks around the month plus a month each side", () => {
    expect(fetchWindow("month", "2026-09-17")).toEqual({
      start_date: "2026-07-27", // Monday of the week holding 1 Aug
      end_date: "2026-11-01",   // Sunday of the week holding 31 Oct
    });
  });
  it("week and day: the week plus one week each side", () => {
    expect(fetchWindow("week", "2026-09-09")).toEqual({ start_date: "2026-08-31", end_date: "2026-09-20" });
    expect(fetchWindow("day", "2026-09-09")).toEqual({ start_date: "2026-08-31", end_date: "2026-09-20" });
  });
  it("continuous: twelve weeks either side of the cursor's week", () => {
    expect(fetchWindow("continuous", "2026-09-09")).toEqual({ start_date: "2026-06-15", end_date: "2026-12-06" });
  });
});

describe("hiddenEventCount", () => {
  it("counts events on days outside the business set within a range", () => {
    const buckets = new Map<string, unknown[]>([
      ["2026-09-12", [1, 2]], // Saturday
      ["2026-09-13", [3]],    // Sunday
      ["2026-09-14", [4]],    // Monday
    ]);
    expect(hiddenEventCount(buckets, "2026-09-07", "2026-09-20", [1, 2, 3, 4, 5])).toBe(3);
    expect(hiddenEventCount(buckets, "2026-09-07", "2026-09-20", [6, 7])).toBe(1);
    expect(hiddenEventCount(buckets, "2026-09-14", "2026-09-20", [1, 2, 3, 4, 5])).toBe(0);
  });
});

describe("column detection", () => {
  const econ = [
    { date: "2026-09-11 12:30:00", country: "US", type: "CPI", previous: 333.92 },
    { date: "2026-09-11 12:30:00", country: "US", type: "Core CPI", previous: 336.79 },
  ];
  const auctions = [
    // The real treasury_auctions shape: `type` is the literal "Note", which is
    // why security_term is preferred over it.
    { cusip: "91282CRL7", type: "Note", security_term: "3-Year", auction_date: "2026-09-08", issue_date: "2026-09-15" },
  ];
  it("prefers a column named date, then auction_date, then the first date-valued column", () => {
    expect(detectDateColumn(econ)).toBe("date");
    expect(detectDateColumn(auctions)).toBe("auction_date");
    expect(detectDateColumn([{ when: "2026-09-08", n: 1 }])).toBe("when");
  });
  it("returns null when no column is date-valued, or there are no rows", () => {
    expect(detectDateColumn([{ label: "Q3", value: 1 }])).toBeNull();
    expect(detectDateColumn([])).toBeNull();
  });
  it("picks the title: event, then security_term, then type, then the first other string column", () => {
    expect(detectTitleColumn(econ, "date")).toBe("type");
    expect(detectTitleColumn(auctions, "auction_date")).toBe("security_term");
    expect(detectTitleColumn([{ date: "2026-09-08", event: "CPI", type: "x" }], "date")).toBe("event");
    expect(detectTitleColumn([{ date: "2026-09-08", n: 1 }], "date")).toBeNull();
  });
});

describe("createWheelStepper", () => {
  it("steps once the accumulated delta passes the threshold, then locks", () => {
    const step = createWheelStepper(40, 300);
    expect(step(15, 0)).toBe(0);
    expect(step(15, 10)).toBe(0);
    expect(step(15, 20)).toBe(1);   // 45 accumulated
    expect(step(100, 100)).toBe(0); // locked
    expect(step(100, 320)).toBe(1); // lock expired
    expect(step(-50, 700)).toBe(-1);
  });
  it("resets the accumulator when the direction flips", () => {
    const step = createWheelStepper(40, 300);
    expect(step(30, 0)).toBe(0);
    expect(step(-30, 10)).toBe(0);
    expect(step(-15, 20)).toBe(-1);
  });
});

describe("filterSeries", () => {
  const rows = [
    { symbol: "AAPL.US", announce_time: "BeforeMarket" },
    { symbol: "MSFT.US", announce_time: "AfterMarket" },
    { symbol: "DNLM.LSE", announce_time: "BeforeMarket" },
    { symbol: "BRK-B", announce_time: "" },
  ];

  it("keeps an exact match, case-insensitively", () => {
    expect(filterSeries(rows, "announce_time", ["aftermarket"])).toEqual([rows[1]]);
  });

  it("keeps a bare ticker against an exchange-suffixed symbol", () => {
    expect(filterSeries(rows, "symbol", ["AAPL", "MSFT.US"])).toEqual([rows[0], rows[1]]);
    // The suffix rule is dotted, not a prefix: BRK must not match BRK-B.
    expect(filterSeries(rows, "symbol", ["BRK"])).toEqual([]);
  });

  it("passes the rows through, by reference, when there is no filter", () => {
    expect(filterSeries(rows, "symbol", undefined)).toBe(rows);
    expect(filterSeries(rows, "symbol", [])).toBe(rows);
  });
});

describe("distinctValues", () => {
  it("returns the sorted unique non-empty values, capped", () => {
    const rows = [
      { symbol: "MSFT.US" }, { symbol: "AAPL.US" }, { symbol: "MSFT.US" },
      { symbol: "" }, { symbol: null }, { symbol: "DNLM.LSE" },
    ];
    expect(distinctValues(rows, "symbol")).toEqual(["AAPL.US", "DNLM.LSE", "MSFT.US"]);
    expect(distinctValues(rows, "symbol", 2)).toEqual(["AAPL.US", "DNLM.LSE"]);
  });
});

describe("eodhdLogoUrl", () => {
  it("builds the public logo path from an EODHD symbol: exchange upper, ticker lower", () => {
    expect(eodhdLogoUrl("AAPL.US")).toBe("https://eodhd.com/img/logos/US/aapl.png");
    expect(eodhdLogoUrl("DNLM.LSE")).toBe("https://eodhd.com/img/logos/LSE/dnlm.png");
    expect(eodhdLogoUrl("BRK-B.US")).toBe("https://eodhd.com/img/logos/US/brk-b.png");
  });
  it("gives nothing for anything that is not a dotted symbol", () => {
    expect(eodhdLogoUrl("Inflation Rate")).toBeNull();
    expect(eodhdLogoUrl("3-Year")).toBeNull();
    expect(eodhdLogoUrl("CPI s.a")).toBeNull();
    expect(eodhdLogoUrl(42)).toBeNull();
    expect(eodhdLogoUrl("")).toBeNull();
  });
});

/**
 * The three-level tree filter. The fixtures carry the `source` / `category`
 * pair openbb-eodhd 9.6.0 fills in from its statistics index, plus one row it
 * could not classify — the case that must never disappear silently.
 */
describe("the tree filter", () => {
  const rows = [
    { event: "EIA Crude Oil Stocks Change", source: "EIA", category: "Weekly Petroleum Status" },
    { event: "EIA Gasoline Stocks Change", source: "EIA", category: "Weekly Petroleum Status" },
    { event: "EIA Natural Gas Stocks Change", source: "EIA", category: "Natural Gas Storage" },
    { event: "Core PPI", source: "BLS", category: "Producer Prices" },
    { event: "CPI", source: "BLS", category: "Consumer Prices" },
    { event: "Mystery Index", source: null, category: null },
  ];

  describe("eventPath", () => {
    it("reads source, category and the title column as the three segments", () => {
      expect(eventPath(rows[0])).toEqual(["EIA", "Weekly Petroleum Status", "EIA Crude Oil Stocks Change"]);
    });
    it("puts a row the provider could not classify under Other", () => {
      expect(eventPath(rows[5])).toEqual(["Other", "Other", "Mystery Index"]);
      expect(eventPath({ event: "X", source: "", category: "  " })).toEqual(["Other", "Other", "X"]);
    });
    it("reads the title from the column it is given", () => {
      expect(eventPath({ type: "CPI", source: "BLS", category: "Consumer Prices" }, "type")[2]).toBe("CPI");
    });
  });

  describe("treeAllows", () => {
    it("allows everything when there are no rules", () => {
      expect(treeAllows(["EIA", "Natural Gas Storage", "EIA Natural Gas Stocks Change"], [], [])).toBe(true);
      expect(treeAllows(["EIA", "Natural Gas Storage", "x"], undefined, undefined)).toBe(true);
    });
    it("blocks a path under an excluded prefix", () => {
      expect(treeAllows(["EIA", "Natural Gas Storage", "x"], [["EIA"]], [])).toBe(false);
      expect(treeAllows(["BLS", "Producer Prices", "Core PPI"], [["EIA"]], [])).toBe(true);
    });
    it("lets the longest rule win, whichever list it is in", () => {
      const exclude = [["EIA"]];
      const include = [["EIA", "Natural Gas Storage"]];
      expect(treeAllows(["EIA", "Natural Gas Storage", "x"], exclude, include)).toBe(true);
      expect(treeAllows(["EIA", "Weekly Petroleum Status", "x"], exclude, include)).toBe(false);
      // And the other way round: a deeper exclude under an included release.
      expect(treeAllows(["EIA", "Natural Gas Storage", "x"], [["EIA", "Natural Gas Storage", "x"]], include)).toBe(false);
    });
  });

  describe("filterTree", () => {
    it("passes the rows through, by reference, when there are no rules", () => {
      expect(filterTree(rows, undefined, undefined)).toBe(rows);
      expect(filterTree(rows, [], [])).toBe(rows);
    });
    it("drops a whole source and keeps the re-included release under it", () => {
      expect(filterTree(rows, [["EIA"]], []).map((r) => r.event)).toEqual(["Core PPI", "CPI", "Mystery Index"]);
      expect(filterTree(rows, [["EIA"]], [["EIA", "Natural Gas Storage"]]).map((r) => r.event)).toEqual([
        "EIA Natural Gas Stocks Change", "Core PPI", "CPI", "Mystery Index",
      ]);
    });
    it("drops the unclassified rows only when Other itself is excluded", () => {
      expect(filterTree(rows, [["Other"]], []).map((r) => r.event)).not.toContain("Mystery Index");
    });
  });

  describe("buildTree", () => {
    it("builds Source → Release → Statistic with row counts, sorted, Other last", () => {
      const tree = buildTree(rows);
      expect(tree.map((n) => [n.name, n.count])).toEqual([["BLS", 2], ["EIA", 3], ["Other", 1]]);
      const eia = tree[1];
      expect(eia.path).toEqual(["EIA"]);
      expect(eia.children.map((n) => [n.name, n.count])).toEqual([
        ["Natural Gas Storage", 1], ["Weekly Petroleum Status", 2],
      ]);
      expect(eia.children[1].children.map((n) => n.name)).toEqual([
        "EIA Crude Oil Stocks Change", "EIA Gasoline Stocks Change",
      ]);
      expect(eia.children[1].children[0].path).toEqual([
        "EIA", "Weekly Petroleum Status", "EIA Crude Oil Stocks Change",
      ]);
      expect(eia.children[1].children[0].children).toEqual([]);
    });
  });

  describe("treeCounts", () => {
    const tree = buildTree(rows);
    const eia = tree[1];
    it("counts the allowed leaves of a node against its total", () => {
      expect(treeCounts(eia, [], [])).toEqual({ allowed: 3, total: 3 });
      expect(treeCounts(eia, [["EIA"]], [])).toEqual({ allowed: 0, total: 3 });
      expect(treeCounts(eia, [["EIA", "Natural Gas Storage"]], [])).toEqual({ allowed: 2, total: 3 });
    });
  });

  describe("toggleTreePath", () => {
    it("excludes a fully allowed node and re-includes it from under its parent", () => {
      const off = toggleTreePath(["EIA"], [], [], true);
      expect(off).toEqual({ exclude: [["EIA"]], include: [] });
      const back = toggleTreePath(["EIA", "Natural Gas Storage"], off.exclude, off.include, false);
      expect(back).toEqual({ exclude: [["EIA"]], include: [["EIA", "Natural Gas Storage"]] });
    });

    it("drops every rule under the node it toggles", () => {
      const { exclude, include } = toggleTreePath(
        ["EIA"],
        [["EIA"], ["BLS", "Consumer Prices"]],
        [["EIA", "Natural Gas Storage"]],
        false,
      );
      expect(exclude).toEqual([["BLS", "Consumer Prices"]]);
      expect(include).toEqual([]);
    });

    it("simplifies a rule that says what its nearest ancestor already says", () => {
      // Ticking everything back on from the default card leaves nothing persisted.
      expect(toggleTreePath(["EIA"], [["EIA"]], [], false)).toEqual({ exclude: [], include: [] });
      // An exclude under an already-excluded parent is not written either.
      expect(toggleTreePath(["EIA", "Natural Gas Storage"], [["EIA"]], [], false).include).toEqual([
        ["EIA", "Natural Gas Storage"],
      ]);
      const partly = toggleTreePath(["EIA", "Natural Gas Storage"], [["EIA"]], [["EIA", "Natural Gas Storage"]], true);
      expect(partly).toEqual({ exclude: [["EIA"]], include: [] });
    });
  });
});
