// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { deriveRows, parseZones, zoneLabel } from "./zones";

// A fixed instant so offsets and clock faces are deterministic.
// 2026-01-15T17:30:00Z is winter in the northern hemisphere, so New York is
// on standard time (GMT-5) rather than DST.
const T = new Date("2026-01-15T17:30:00Z");

describe("zoneLabel", () => {
  it("produces the three labels the spec names", () => {
    expect(zoneLabel("America/New_York")).toBe("US/Eastern");
    expect(zoneLabel("Asia/Shanghai")).toBe("PRC");
    expect(zoneLabel("Europe/London")).toBe("GB");
  });

  it("prefers a place-style alias over a POSIX one", () => {
    // EST5EDT also canonicalises to America/New_York and is SHORTER than
    // US/Eastern. If this returns it, the digit rule has been lost.
    expect(zoneLabel("America/New_York")).not.toBe("EST5EDT");
  });

  it("never returns a label containing a digit, across the default zone list", () => {
    // A stronger, whole-list form of the POSIX-vs-place test above: rather
    // than pinning one instance (America/New_York vs EST5EDT), this checks
    // the digit-exclusion property holds for every zone the alias map
    // covers, including the other three with a POSIX rival in
    // ALIAS_CANDIDATES (Chicago, Denver, Los Angeles).
    const defaultZones = [
      "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
      "America/Anchorage", "Pacific/Honolulu", "America/Phoenix", "Pacific/Pago_Pago",
      "America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver",
      "America/Halifax", "America/St_Johns",
      "America/Mexico_City", "America/Tijuana", "America/Mazatlan",
      "America/Sao_Paulo", "America/Rio_Branco",
      "America/Santiago", "Pacific/Easter",
      "Europe/London", "Europe/Lisbon", "Atlantic/Reykjavik", "Europe/Warsaw", "Europe/Istanbul",
      "Asia/Jerusalem", "Africa/Cairo", "Africa/Tripoli", "Asia/Tehran", "America/Havana", "America/Jamaica",
      "Asia/Shanghai", "Asia/Taipei", "Asia/Seoul", "Asia/Tokyo", "Asia/Singapore", "Asia/Hong_Kong",
      "Pacific/Auckland", "Pacific/Chatham",
      "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Darwin",
      "Australia/Adelaide", "Australia/Perth", "Australia/Hobart",
    ];
    for (const zone of defaultZones) {
      expect(zoneLabel(zone)).not.toMatch(/[0-9]/);
    }
  });

  it("falls back to the IANA name when no shorter alias exists", () => {
    expect(zoneLabel("Europe/Berlin")).toBe("Europe/Berlin");
    expect(zoneLabel("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("falls back to the IANA name for a zone it has never heard of", () => {
    expect(zoneLabel("Antarctica/Troll")).toBe("Antarctica/Troll");
  });
});

describe("the alias map is built lazily (Finding D)", () => {
  // buildAliasMap constructs one Intl.DateTimeFormat per ALIAS_CANDIDATES
  // entry (~54). Run unconditionally at import time, that is measurable
  // startup cost paid by every user, including one who never adds a clock.
  // Asserted by counting Intl.DateTimeFormat constructions rather than
  // timing, per the finding.
  it("builds nothing merely by importing the module", async () => {
    vi.resetModules();
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    await import("./zones");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("builds the map on the first zoneLabel call, and only once", async () => {
    vi.resetModules();
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const mod = await import("./zones");

    mod.zoneLabel("America/New_York");
    const afterFirst = spy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    mod.zoneLabel("Asia/Tokyo");
    expect(spy.mock.calls.length).toBe(afterFirst);

    spy.mockRestore();
  });
});

describe("parseZones", () => {
  it("splits on commas and trims", () => {
    expect(parseZones(" Europe/London , Asia/Tokyo ")).toEqual([
      "Europe/London",
      "Asia/Tokyo",
    ]);
  });

  it("drops empty entries rather than complaining about them", () => {
    expect(parseZones("Europe/London,,Asia/Tokyo,")).toEqual([
      "Europe/London",
      "Asia/Tokyo",
    ]);
  });

  it("returns nothing for an empty string", () => {
    expect(parseZones("   ")).toEqual([]);
  });

  it("dedupes an exact repeat, keeping the first occurrence", () => {
    expect(parseZones("Europe/London,Asia/Tokyo,Europe/London")).toEqual([
      "Europe/London",
      "Asia/Tokyo",
    ]);
  });

  it("dedupes on the canonical zone, since a raw alias names the same zone", () => {
    // America/New_York and US/Eastern are the same IANA zone under different
    // spellings — a pasted list mixing them should still produce one row,
    // not two clocks reading the same time under different labels.
    expect(parseZones("America/New_York,US/Eastern,Asia/Tokyo")).toEqual([
      "America/New_York",
      "Asia/Tokyo",
    ]);
  });

  it("does not dedupe two different invalid entries with the same raw text case", () => {
    // An invalid zone canonicalises to nothing; entries are only merged when
    // their raw text is identical, never guessed at.
    expect(parseZones("Europe/Lundon,Europe/lundon")).toEqual([
      "Europe/Lundon",
      "Europe/lundon",
    ]);
  });
});

describe("deriveRows", () => {
  it("derives the city from the last path segment", () => {
    const { rows } = deriveRows(["America/New_York"], T, "24");
    expect(rows[0].city).toBe("New York");
  });

  it("keeps a single-segment zone name as its own city", () => {
    const { rows } = deriveRows(["UTC"], T, "24");
    expect(rows[0].city).toBe("UTC");
  });

  it("formats 24-hour time with no suffix", () => {
    const { rows } = deriveRows(["Europe/London"], T, "24");
    expect(rows[0].time).toBe("17:30");
    expect(rows[0].suffix).toBe("");
  });

  it("formats 12-hour time with a bare A or P, never AM or PM", () => {
    const { rows } = deriveRows(["Europe/London"], T, "12");
    expect(rows[0].time).toBe("05:30");
    expect(rows[0].suffix).toBe("P");
  });

  it("reports the GMT offset in the spec's format", () => {
    const { rows } = deriveRows(["America/New_York"], T, "24");
    expect(rows[0].offset).toBe("GMT-5");
  });

  it("gives AnalogFace 24-hour numbers regardless of the hour cycle", () => {
    const twelve = deriveRows(["Europe/London"], T, "12").rows[0];
    const twentyFour = deriveRows(["Europe/London"], T, "24").rows[0];
    expect(twelve.hour).toBe(17);
    expect(twelve.minute).toBe(30);
    expect(twentyFour.hour).toBe(17);
  });

  it("filters an unknown zone into `unknown` and still renders the rest", () => {
    const { rows, unknown } = deriveRows(["Europe/Lundon", "Asia/Tokyo"], T, "24");
    expect(unknown).toEqual(["Europe/Lundon"]);
    expect(rows.map((r) => r.zone)).toEqual(["Asia/Tokyo"]);
  });

  it("preserves the given order", () => {
    const { rows } = deriveRows(["Asia/Tokyo", "Europe/London"], T, "24");
    expect(rows.map((r) => r.zone)).toEqual(["Asia/Tokyo", "Europe/London"]);
  });

  it("derives city and region from the canonical zone, not the raw spelling given", () => {
    // Intl accepts more than the canonical spelling. Lowercase and legacy
    // alias forms must resolve through the same canonical zone as the
    // IANA-spelled name before city/region are derived from them.
    const lower = deriveRows(["america/new_york"], T, "24").rows[0];
    expect(lower.city).toBe("New York");
    expect(lower.region).toBe("US/Eastern");

    const alias = deriveRows(["US/Eastern"], T, "24").rows[0];
    expect(alias.city).toBe("New York");
    expect(alias.region).toBe("US/Eastern");
  });

  it("keeps ZoneRow.zone as the string the caller gave, even when it is an alias", () => {
    const { rows } = deriveRows(["US/Eastern"], T, "24");
    expect(rows[0].zone).toBe("US/Eastern");
  });

  // Each zone used to be resolved twice: once to separate the invalid ones and
  // again inside rowFor. Counted as the bare `{ timeZone }` formats of these
  // two zones, the only ones that resolution builds (the region labels' alias
  // map builds its own, for other zones).
  it("resolves each zone's canonical form once", () => {
    // A pass-through constructor: a bare spy hands back instances that
    // formatToParts rejects as an incompatible receiver.
    const Real = Intl.DateTimeFormat;
    const spy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(((...args: ConstructorParameters<typeof Real>) => new Real(...args)) as typeof Real);
    deriveRows(["Europe/London", "Asia/Tokyo"], T, "24");
    const resolves = spy.mock.calls.filter(
      ([, opts]) =>
        opts !== undefined &&
        Object.keys(opts).length === 1 &&
        (opts.timeZone === "Europe/London" || opts.timeZone === "Asia/Tokyo"),
    );
    expect(resolves).toHaveLength(2);
    spy.mockRestore();
  });
});
