// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ColumnFormatterFn, ColumnSpec, TableSpec } from "./types";

const DATE_HINT = /(date|time|timestamp|period)/i;
/** Only a leading calendar date is handled — slicing it can't shift it. */
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Exported because the filter row has to answer the same question (is this
 * column's first non-null value a date?) and must not re-derive the pattern.
 */
export function isIsoDate(value: string): boolean {
  return ISO_DATE_PREFIX.test(value);
}

/**
 * What one cell needs to know about its column's formatting, already resolved:
 * the column's own formatterFn or, failing that, the table-level default.
 * Nothing here is a TanStack type and nothing here is persisted.
 */
export type CellFormat = { formatterFn?: ColumnFormatterFn; decimalPlaces?: number };

/**
 * `undefined` — not an empty object — when the column and the table both say
 * nothing, so formatCell takes exactly its pre-columnsDefs path. `column` may
 * be undefined: a data-only field that no columnsDefs entry declares still
 * inherits the table-level default.
 */
export function cellFormat(
  column: ColumnSpec | undefined,
  table: TableSpec | undefined,
): CellFormat | undefined {
  const formatterFn = column?.formatterFn ?? table?.formatterFn;
  const decimalPlaces = column?.decimalPlaces;
  if (formatterFn === undefined && decimalPlaces === undefined) return undefined;
  return { formatterFn, decimalPlaces };
}

const UNITS: Array<[number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

// Intl.NumberFormat construction is expensive and TableRenderer calls
// formatCell per cell, so formatters are cached by locale + precision. Keyed
// on min|max|locale so the plain (min 0) and example (min === max) shapes
// share one cache instead of each keeping a separate Map.
const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(locale: string | undefined, maxDecimals: number, minDecimals = 0): Intl.NumberFormat {
  const key = `${minDecimals}|${maxDecimals}|${locale}`;
  let nf = formatterCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { minimumFractionDigits: minDecimals, maximumFractionDigits: maxDecimals });
    formatterCache.set(key, nf);
  }
  return nf;
}

function formatNumber(value: number, maxDecimals: number, locale?: string): string {
  const nf = getFormatter(locale, maxDecimals);
  // Infinity would otherwise clear every threshold below and print "∞T".
  if (!Number.isFinite(value)) return nf.format(value);
  const magnitude = Math.abs(value);
  // The unit is picked on the raw magnitude but printed rounded, so a value
  // just under the next unit (999_999.5 at 2 decimals is 999.9995K) printed
  // "1,000K". When rounding reaches a thousand of the picked unit -- or of no
  // unit at all -- it steps up one. One step is enough: a rounded thousand
  // of one unit is exactly 1 of the next.
  const rounded = (x: number) => Math.round(Math.abs(x) * 10 ** maxDecimals) / 10 ** maxDecimals;
  let i = UNITS.findIndex(([size]) => magnitude >= size);
  if (i === -1) i = UNITS.length;
  if (i > 0 && rounded(value / (UNITS[i]?.[0] ?? 1)) >= 1000) i -= 1;
  if (i < UNITS.length) {
    const [size, suffix] = UNITS[i];
    return `${nf.format(value / size)}${suffix}`;
  }
  // Intl.NumberFormat.format(-0.001).format() with 2 max decimals prints
  // "-0" (and so does a literal -0): the value rounds to zero but keeps its
  // negative sign. `signDisplay: "negative"` would suppress that, but older
  // WebViews throw a RangeError on that option value, so this checks the
  // sign explicitly instead. `value < 0` alone misses literal -0 (-0 < 0 is
  // false in JS), so -0 is checked separately via Object.is.
  const isNegative = value < 0 || Object.is(value, -0);
  if (isNegative && magnitude < 0.5 * 10 ** -maxDecimals) return nf.format(0);
  return nf.format(value);
}

export function formatCell(
  value: unknown,
  column: string,
  maxDecimals: number,
  locale?: string,
  format?: CellFormat,
): string {
  if (value === null || value === undefined) return "—";

  // The column's own decimalPlaces wins over the app-wide setting, for this
  // column only.
  const decimals = format?.decimalPlaces ?? maxDecimals;

  // The widgets.json formatterFn branch. Each case stringifies a value of the
  // wrong type rather than producing NaN: a backend that sends "n/a" in a
  // percent column should show "n/a", not a fabricated number.
  switch (format?.formatterFn) {
    case "int":
      // Zero decimals is what `int` means; decimalPlaces cannot widen it.
      return typeof value === "number" ? formatNumber(value, 0, locale) : String(value);
    case "percent":
      return typeof value === "number"
        ? `${formatNumber(value, decimals, locale)} %`
        : String(value);
    case "normalized":
      return typeof value === "number" ? formatNumber(value * 100, decimals, locale) : String(value);
    case "normalizedPercent":
      return typeof value === "number"
        ? `${formatNumber(value * 100, decimals, locale)} %`
        : String(value);
    case "dateToYear":
      // Slicing four leading digits cannot shift a date; parsing could.
      return typeof value === "string" && ISO_DATE_PREFIX.test(value)
        ? value.slice(0, 4)
        : String(value);
    case "none":
      return String(value);
    default:
      break;
  }

  // No percent branch is inferred from the column NAME: a percent-named
  // column cannot be told apart from a plain number by name alone
  // (OpenBB-style backends commonly send 5.12 meaning 5.12%, not the fraction
  // 0.0512), so guessing produced a wrong number (512.00%) rather than an
  // honest, unformatted one. Percent-named columns fall through to the
  // ordinary number path unless widgets.json says otherwise — which is
  // exactly what the formatterFn switch above now does when it does.
  if (typeof value === "number") return formatNumber(value, decimals, locale);
  if (typeof value === "boolean") return String(value);

  if (typeof value === "string") {
    // `new Date(value).toISOString()` guesses at a timezone: a
    // timezone-less date-time like "2024-01-15T23:00:00" parses as local
    // time, and converting back to UTC can shift it onto the next calendar
    // day. Slicing the leading YYYY-MM-DD cannot shift anything, so that is
    // all this does; a string that isn't already in that shape is left
    // alone rather than guessed at.
    if (DATE_HINT.test(column) && ISO_DATE_PREFIX.test(value)) {
      return value.slice(0, 10);
    }
    return value;
  }

  return JSON.stringify(value);
}

/** The example shown beside a "Maximum decimal places" option: the digits 1..n after the separator (0.1234 at 4). */
export function decimalPlacesExample(n: number, locale?: string): string {
  // Digits 1..n, truncated rather than rounded, so the label for 4 reads
  // 0.1234 — a rounded 0.1235 looks like a different example, not 4 places.
  const digits = "12345".slice(0, n);
  return getFormatter(locale, n, n).format(digits ? Number(`0.${digits}`) : 0);
}
