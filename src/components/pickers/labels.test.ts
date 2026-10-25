// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  datetimeLabel,
  fiscalYearCellLabel,
  fiscalYearLabel,
  monthSpanLabel,
  quarterCellLabel,
  quarterLabel,
  rangeLabel,
  weekLabel,
} from "./labels";

describe("period labels", () => {
  it("names a month span within one year and across two", () => {
    expect(monthSpanLabel(parseDate("2026-07-01"), parseDate("2026-09-30"))).toBe("Jul–Sep 2026");
    expect(monthSpanLabel(parseDate("2026-10-01"), parseDate("2027-09-30"))).toBe("Oct 2026–Sep 2027");
    expect(monthSpanLabel(parseDate("2026-01-01"), parseDate("2026-12-31"))).toBe("Jan–Dec 2026");
  });

  it("labels a quarter and its grid cells with FY, December included", () => {
    expect(quarterLabel("2027-Q3")).toBe("FY2027-Q3");
    expect(quarterLabel("2026-Q3")).toBe("FY2026-Q3");
    expect(quarterLabel("")).toBe("—");
    expect(quarterLabel("T-1q")).toBe("T-1q");
    expect(quarterCellLabel({ fy: 2027, q: 1 }, 6)).toBe("FY2027-Q1 (Jul–Sep 2026)");
    expect(quarterCellLabel({ fy: 2026, q: 3 }, 12)).toBe("FY2026-Q3 (Jul–Sep 2026)");
  });

  it("labels a fiscal year and its grid cells", () => {
    expect(fiscalYearLabel("2027")).toBe("FY2027");
    expect(fiscalYearLabel("")).toBe("—");
    expect(fiscalYearCellLabel(2027, 9)).toBe("FY2027 (Oct 2026–Sep 2027)");
    expect(fiscalYearCellLabel(2026, 12)).toBe("FY2026 (Jan–Dec 2026)");
  });

  it("labels a week with its Monday–Sunday span", () => {
    expect(weekLabel("2026-W37")).toBe("W37 2026 · Sep 7–13");
    expect(weekLabel("2026-W40")).toBe("W40 2026 · Sep 28–Oct 4");
    expect(weekLabel("2026-W01")).toBe("W01 2026 · Dec 29–Jan 4");
    expect(weekLabel("")).toBe("—");
  });

  it("labels a datetime in the given zone with that zone's short name", () => {
    expect(datetimeLabel("2026-09-14T09:30:15-04:00", "America/New_York")).toBe("2026-09-14 09:30:15 EDT");
    expect(datetimeLabel("2026-01-14T09:30:15-05:00", "America/New_York")).toBe("2026-01-14 09:30:15 EST");
    expect(datetimeLabel("2026-09-14T09:30:15-04:00", "Europe/London")).toMatch(/^2026-09-14 14:30:15 \S+$/);
    expect(datetimeLabel("", "America/New_York")).toBe("—");
  });

  it("labels a range with an en dash, and each missing half as a dash", () => {
    expect(rangeLabel("2025-01-01/2026-09-14")).toBe("2025-01-01 – 2026-09-14");
    expect(rangeLabel("2025-01-01/")).toBe("2025-01-01 – —");
    expect(rangeLabel("")).toBe("— – —");
  });
});

it("labels a prefixed quarter or fiscal year the same as an unprefixed one (v5.4.0)", () => {
  expect(quarterLabel("FY2026-Q3")).toBe("FY2026-Q3");
  expect(fiscalYearLabel("FY2026")).toBe("FY2026");
});
