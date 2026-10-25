// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { cellFormat, decimalPlacesExample, formatCell, isIsoDate } from "./format";

describe("formatCell", () => {
  it("renders null and undefined as an em dash", () => {
    expect(formatCell(null, "close", 2, "en-US")).toBe("—");
    expect(formatCell(undefined, "close", 2, "en-US")).toBe("—");
  });

  it("passes strings through", () => {
    expect(formatCell("AAPL", "symbol", 2, "en-US")).toBe("AAPL");
  });

  it("formats an ISO date column as a calendar date", () => {
    expect(formatCell("2026-08-12T00:00:00Z", "date", 2, "en-US")).toBe("2026-08-12");
  });

  it("keeps the calendar date for a date-time string with no timezone suffix", () => {
    // "2024-01-15T23:00:00" has no Z/offset. Parsing it with `new Date()`
    // reads it as local time, and converting back to UTC for
    // toISOString() can push it onto "2024-01-16" depending on the host
    // timezone — the exact bug this contract avoids by never parsing at
    // all. Slicing the leading YYYY-MM-DD cannot shift it.
    expect(formatCell("2024-01-15T23:00:00", "date", 2, "en-US")).toBe("2024-01-15");
  });

  it("leaves a non-date string in a date column alone", () => {
    expect(formatCell("not a date", "date", 2, "en-US")).toBe("not a date");
  });

  it("leaves a date-hinted column that isn't a leading calendar date alone", () => {
    // No new Date() guessing: a differently-shaped (but genuinely
    // date-like) string is left as-is rather than parsed.
    expect(formatCell("08/12/2026", "date", 2, "en-US")).toBe("08/12/2026");
  });

  it("renders a percent-named column as an ordinary number, with no unit guessing", () => {
    // A backend sending 5.12 to mean "5.12%" (OpenBB-style) is the common
    // case; the old ×100 heuristic could not tell that apart from a
    // fraction and would have rendered this as 512.00%.
    expect(formatCell(5.12, "change_percent", 2, "en-US")).toBe("5.12");
    expect(formatCell(-3.12, "pct_change", 2, "en-US")).toBe("-3.12");
    // A genuine fraction is likewise left unmultiplied — there is no way to
    // distinguish it from percentage points by column name alone.
    expect(formatCell(0.0512, "change_percent", 2, "en-US")).toBe("0.05");
  });

  it("abbreviates large numbers, trimmed of trailing zeros", () => {
    expect(formatCell(1_500, "volume", 2, "en-US")).toBe("1.5K");
    expect(formatCell(2_300_000, "volume", 2, "en-US")).toBe("2.3M");
    expect(formatCell(4_100_000_000, "market_cap", 2, "en-US")).toBe("4.1B");
    expect(formatCell(1_200_000_000_000, "market_cap", 2, "en-US")).toBe("1.2T");
  });

  it("renders ordinary numbers with up to 2 decimals, trimmed", () => {
    // The app-wide default is 2 decimals (DEFAULT_SETTINGS.maxDecimalPlaces),
    // so 123.456 rounds to 123.46 when maxDecimals is 2.
    expect(formatCell(123.456, "close", 2, "en-US")).toBe("123.46");
    expect(formatCell(42, "close", 2, "en-US")).toBe("42");
  });

  it("respects an explicit maxDecimals argument, trimming trailing zeros", () => {
    expect(formatCell(123.456, "close", 4, "en-US")).toBe("123.456");
    expect(formatCell(123.456, "close", 0, "en-US")).toBe("123");
    expect(formatCell(1.2, "close", 5, "en-US")).toBe("1.2");
  });

  it("applies maxDecimals to the abbreviated (K/M/B/T) branch too", () => {
    expect(formatCell(1_500, "volume", 0, "en-US")).toBe("2K");
    // 1_234 needs a maxDecimals of at least 3 to show "1.234K" -- a value
    // (like the former 1_500) that also renders "1.5K" at maxDecimals 1
    // can't tell 3 apart from a lower setting.
    expect(formatCell(1_234, "volume", 3, "en-US")).toBe("1.234K");
  });

  // The unit used to be chosen before rounding, so a value that rounds up
  // into the next unit printed four digits of the smaller one.
  it("steps up a unit when rounding reaches a thousand of the current one", () => {
    expect(formatCell(999_999.5, "volume", 2, "en-US")).toBe("1M");
    expect(formatCell(-999.996, "volume", 2, "en-US")).toBe("-1K");
    expect(formatCell(600, "volume", 0, "en-US")).toBe("600");
    expect(formatCell(999_999, "volume", 0, "en-US")).toBe("1M");
  });

  it("renders a non-finite number without a unit suffix", () => {
    expect(formatCell(Infinity, "close", 2, "en-US")).toBe("∞");
    expect(formatCell(-Infinity, "close", 2, "en-US")).toBe("-∞");
    expect(formatCell(Number.NaN, "close", 2, "en-US")).toBe("NaN");
  });

  it("rounds a tiny negative (or literal -0) to plain 0, not the Intl-default -0", () => {
    // Intl.NumberFormat prints "-0" for a value that rounds to zero but
    // keeps its sign -- both a genuine tiny negative and a literal -0.
    expect(formatCell(-0.001, "close", 2, "en-US")).toBe("0");
    expect(formatCell(-0, "close", 2, "en-US")).toBe("0");
    expect(formatCell(-0.4, "close", 0, "en-US")).toBe("0");
    // A negative that does NOT round away to zero keeps its sign.
    expect(formatCell(-1.5, "close", 2, "en-US")).toBe("-1.5");
  });

  it("renders booleans and objects readably", () => {
    expect(formatCell(true, "flag", 2, "en-US")).toBe("true");
    expect(formatCell({ a: 1 }, "meta", 2, "en-US")).toBe('{"a":1}');
  });

  it("uses a comma decimal separator in de-DE", () => {
    expect(formatCell(123.456, "close", 2, "de-DE")).toBe("123,46");
  });

  it("abbreviates regardless of column name, even a price column, in both locales", () => {
    // formatNumber has no column-awareness: any magnitude >= 1000 takes the
    // K/M/B/T branch, so a 1234.5 "close" price abbreviates exactly like a
    // volume figure would. That means a plain (non-abbreviated) number can
    // never show a thousands grouping separator through this path — grouping
    // only has room to appear once a value already carries a unit suffix.
    expect(formatCell(1234.5, "close", 2, "en-US")).toBe("1.23K");
    expect(formatCell(1234.5, "close", 2, "de-DE")).toBe("1,23K");
  });

  it("uses de-DE's comma inside the abbreviated (K/M/B/T) branch too", () => {
    expect(formatCell(1_500, "volume", 2, "de-DE")).toBe("1,5K");
  });
});

describe("decimalPlacesExample", () => {
  // The digits 1..n shown at each maxDecimals value, the label shown beside
  // each "Maximum decimal places" radio: 0.1234 at 4, never a rounded 0.1235.
  // minimumFractionDigits === maximumFractionDigits here (unlike formatNumber)
  // so the example always shows exactly n digits.
  it("shows en-US decimal points", () => {
    expect(decimalPlacesExample(0, "en-US")).toBe("0");
    expect(decimalPlacesExample(1, "en-US")).toBe("0.1");
    expect(decimalPlacesExample(2, "en-US")).toBe("0.12");
    expect(decimalPlacesExample(3, "en-US")).toBe("0.123");
    expect(decimalPlacesExample(4, "en-US")).toBe("0.1234");
    expect(decimalPlacesExample(5, "en-US")).toBe("0.12345");
  });

  it("shows de-DE decimal commas", () => {
    expect(decimalPlacesExample(0, "de-DE")).toBe("0");
    expect(decimalPlacesExample(1, "de-DE")).toBe("0,1");
    expect(decimalPlacesExample(2, "de-DE")).toBe("0,12");
    expect(decimalPlacesExample(3, "de-DE")).toBe("0,123");
    expect(decimalPlacesExample(4, "de-DE")).toBe("0,1234");
    expect(decimalPlacesExample(5, "de-DE")).toBe("0,12345");
  });
});

describe("cellFormat", () => {
  it("prefers the column's own formatterFn over the table default", () => {
    expect(
      cellFormat({ field: "a", formatterFn: "percent" }, { columns: [], formatterFn: "int" }),
    ).toEqual({ formatterFn: "percent", decimalPlaces: undefined });
  });

  it("falls back to the table default", () => {
    expect(cellFormat({ field: "a" }, { columns: [], formatterFn: "int" })).toEqual({
      formatterFn: "int",
      decimalPlaces: undefined,
    });
  });

  it("carries decimalPlaces even with no formatterFn anywhere", () => {
    expect(cellFormat({ field: "a", decimalPlaces: 4 }, { columns: [] })).toEqual({
      formatterFn: undefined,
      decimalPlaces: 4,
    });
  });

  it("returns undefined when there is nothing to say, so formatCell takes its default path", () => {
    expect(cellFormat({ field: "a" }, { columns: [] })).toBeUndefined();
    expect(cellFormat(undefined, undefined)).toBeUndefined();
  });

  it("applies the table default to a column that has no spec of its own", () => {
    // A data-only field, appended after the declared columns, still gets the
    // table-level default.
    expect(cellFormat(undefined, { columns: [], formatterFn: "normalized" })).toEqual({
      formatterFn: "normalized",
      decimalPlaces: undefined,
    });
  });
});

describe("formatCell with a column format", () => {
  it("int renders zero decimals, whatever maxDecimals says", () => {
    expect(formatCell(123.456, "n", 4, "en-US", { formatterFn: "int" })).toBe("123");
    expect(formatCell(-0.4, "n", 4, "en-US", { formatterFn: "int" })).toBe("0");
  });

  it("percent appends a spaced percent sign to the formatted number", () => {
    expect(formatCell(5.125, "n", 2, "en-US", { formatterFn: "percent" })).toBe("5.13 %");
  });

  it("normalized multiplies by 100 and adds no unit", () => {
    expect(formatCell(0.0512, "n", 2, "en-US", { formatterFn: "normalized" })).toBe("5.12");
  });

  it("normalizedPercent multiplies by 100 and appends the percent sign", () => {
    expect(formatCell(0.0512, "n", 2, "en-US", { formatterFn: "normalizedPercent" })).toBe("5.12 %");
    expect(formatCell(-0.0312, "n", 2, "en-US", { formatterFn: "normalizedPercent" })).toBe("-3.12 %");
  });

  it("dateToYear keeps the leading four digits of an ISO date", () => {
    expect(formatCell("2026-08-28T00:00:00Z", "period", 2, "en-US", { formatterFn: "dateToYear" })).toBe("2026");
  });

  it("dateToYear leaves anything that is not a leading calendar date alone", () => {
    // No Date parsing: a value that is not already YYYY-MM-DD... is
    // stringified rather than guessed at.
    expect(formatCell("FY2026", "period", 2, "en-US", { formatterFn: "dateToYear" })).toBe("FY2026");
    expect(formatCell(2026, "period", 2, "en-US", { formatterFn: "dateToYear" })).toBe("2026");
  });

  it("none stringifies without formatting, abbreviating or rounding", () => {
    expect(formatCell(2_300_000, "volume", 2, "en-US", { formatterFn: "none" })).toBe("2300000");
    expect(formatCell(123.456, "close", 2, "en-US", { formatterFn: "none" })).toBe("123.456");
  });

  it("still renders null and undefined as an em dash, formatterFn or not", () => {
    expect(formatCell(null, "n", 2, "en-US", { formatterFn: "none" })).toBe("—");
    expect(formatCell(undefined, "n", 2, "en-US", { formatterFn: "normalizedPercent" })).toBe("—");
  });

  it("stringifies a non-number under a numeric formatterFn instead of producing NaN", () => {
    expect(formatCell("n/a", "n", 2, "en-US", { formatterFn: "normalizedPercent" })).toBe("n/a");
    expect(formatCell("n/a", "n", 2, "en-US", { formatterFn: "int" })).toBe("n/a");
  });

  it("decimalPlaces overrides maxDecimals for that column alone", () => {
    expect(formatCell(123.456789, "close", 2, "en-US", { decimalPlaces: 4 })).toBe("123.4568");
    // And inside a formatterFn too.
    expect(formatCell(0.0512345, "n", 2, "en-US", { formatterFn: "normalizedPercent", decimalPlaces: 3 })).toBe("5.123 %");
  });

  it("uses the locale's separator inside the new branches", () => {
    expect(formatCell(0.0512, "n", 2, "de-DE", { formatterFn: "normalizedPercent" })).toBe("5,12 %");
  });

  it("is byte-identical to the four-argument call when no format is given", () => {
    for (const value of [null, 5.12, 1_500, true, "AAPL", "2026-08-12T00:00:00Z", { a: 1 }]) {
      expect(formatCell(value, "date", 2, "en-US", undefined)).toBe(
        formatCell(value, "date", 2, "en-US"),
      );
    }
  });
});

describe("isIsoDate", () => {
  it("accepts a leading calendar date and nothing else", () => {
    expect(isIsoDate("2026-08-28")).toBe(true);
    expect(isIsoDate("2026-08-28T23:00:00")).toBe(true);
    expect(isIsoDate("08/28/2026")).toBe(false);
    expect(isIsoDate("2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("year columns (#20)", () => {
  it.each(["year", "fiscalYear", "fiscal_year", "Year"])("prints an integer %s as the year, not compact", (column) => {
    expect(formatCell(2024, column, 2)).toBe("2024");
  });
  it("still compacts a magnitude in an ordinary column", () => {
    expect(formatCell(2024, "revenue", 2)).toBe("2.02K");
  });
});
