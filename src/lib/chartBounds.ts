// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Date controls are UTC days; datetime controls must resolve an explicit timezone. */
function utcBound(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match || match[0] !== value) return;
  const [, y, m, d, h, minute, second, fraction, zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return;
  if (h !== undefined && (Number(h) > 23 || Number(minute) > 59 || Number(second) > 59)) return;
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return;
  const parsed = Date.parse(h === undefined ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(parsed)) return;
  if (zone === 'Z') return value; // Retain canonical sub-millisecond precision.
  const utc = new Date(parsed).toISOString();
  if (!/^\d{4}-/.test(utc)) return;
  return fraction ? utc.replace(/\.\d{3}Z$/, `${fraction}Z`) : utc;
}
const ordered = (value: string) => value.replace(/(\.\d+)?Z$/, part => (part === 'Z' ? '.000000000Z' : part.slice(0, -1).padEnd(10, '0') + 'Z'));

export function chartBounds(startInput: string | undefined, endInput: string | undefined, defaultStart: string):
  {ok: true; start: string; end?: string} | {ok: false; message: string} {
  const start = utcBound(startInput || defaultStart);
  if (!start) return {ok: false, message: 'Start is invalid. Choose a date or a resolved datetime with a timezone.'};
  const end = endInput ? utcBound(endInput) : undefined;
  if (endInput && !end) return {ok: false, message: 'End is invalid. Choose a date or a resolved datetime with a timezone.'};
  if (end && ordered(end) <= ordered(start)) return {ok: false, message: 'End must be later than Start. Review the chart bounds.'};
  return {ok: true, start, ...(end ? {end} : {})};
}
