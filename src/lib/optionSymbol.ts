// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CalendarDate } from "@internationalized/date";
import { isOpen, prevOpen, type CalendarTrace, type ExchangeCalendar } from "./calendar";
import { isoWeekday } from "./periods";

/**
 * An OCC option symbol, which carries its own expiry.
 *
 * `AAPL260918C00150000` is AAPL, 2026-09-18, call, strike 150. The canonical
 * form pads the root to six characters with spaces (`AAPL  260918C…`); both
 * are read, since the padded form is what a feed sends and the bare one is
 * what a person types.
 *
 * This is the whole reason `EXP` can exist for options with no reference data
 * at all: the expiry is IN the symbol, not looked up from a chain.
 */
export type OptionSymbol = { root: string; expiry: CalendarDate; call: boolean; strike: number };

const OCC = /^([A-Z][A-Z0-9.]{0,5})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/** An OCC symbol as its parts, or null for anything that is not one. */
export function parseOptionSymbol(symbol: string): OptionSymbol | null {
  const m = OCC.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  const [, root, yy, mm, dd, kind, strike] = m;
  const month = Number(mm);
  const day = Number(dd);
  // The date has to be real: `…261332C…` matches the shape and is not a date.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // OCC years are two digits. 2000-2099 is the only sane reading for a live
  // contract, and a 1900s option is not a thing this app will ever be shown.
  const expiry = new CalendarDate(2000 + Number(yy), month, day);
  if (expiry.month !== month || expiry.day !== day) return null; // Feb 30 and friends.
  return { root, expiry, call: kind === "C", strike: Number(strike) / 1000 };
}

/**
 * The standard monthly expiry for a month: the third Friday, moved EARLIER
 * when that day is closed.
 *
 * The holiday rule is the exchange's own -- Good Friday is the case that bites
 * -- and it needs no new data, because the trading calendar the app already
 * loads knows which days are open.
 */
export function monthlyExpiry(cal: ExchangeCalendar, year: number, month: number, trace?: CalendarTrace): CalendarDate {
  const first = new CalendarDate(year, month, 1);
  // 0 = Sunday. The first Friday is however far it is from the 1st, and the
  // third is two weeks past that.
  const firstDow = isoWeekday(first) % 7;
  const thirdFriday = first.add({ days: ((5 - firstDow + 7) % 7) + 14 });
  return isOpen(cal, thirdFriday, trace) ? thirdFriday : prevOpen(cal, thirdFriday.subtract({ days: 1 }), trace);
}

/**
 * Whether a contract expires on its month's standard monthly date.
 *
 * `EXP` itself never needs this -- the symbol says when it expires. `EXP-n`
 * does: stepping back a contract means stepping back a MONTHLY expiry, which
 * is only the right answer for a monthly contract. A weekly's previous
 * expiry is the previous week, and nothing here knows a weekly chain, so
 * `EXP-n` refuses on one rather than quietly answering with the monthly.
 */
export function isMonthlyExpiry(cal: ExchangeCalendar, expiry: CalendarDate, trace?: CalendarTrace): boolean {
  return monthlyExpiry(cal, expiry.year, expiry.month, trace).compare(expiry) === 0;
}

/**
 * `n` monthly expiries before `expiry` (n > 0), after it (n < 0, which is
 * `EXP+n`), or the contract's own (n = 0).
 * Null when the contract is not a monthly, for the reason above.
 */
export function expiryBack(
  cal: ExchangeCalendar, expiry: CalendarDate, n: number, trace?: CalendarTrace,
): CalendarDate | null {
  if (n === 0) return expiry;
  if (!isMonthlyExpiry(cal, expiry, trace)) return null;
  const shifted = new CalendarDate(expiry.year, expiry.month, 1).add({ months: -n });
  return monthlyExpiry(cal, shifted.year, shifted.month, trace);
}
