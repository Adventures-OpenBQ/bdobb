// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Bar wire boundary only: date keys and documented legacy-naive UTC.
 * Explicit offsets win. Chart projection uses JavaScript millisecond precision;
 * this numeric display value is not a lossless source/evidence representation.
 */
export function barTimeSeconds(value: string): number {
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text);
  if (!match) return NaN;
  const [, y, m, d, h, min, sec, , zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const hour = Number(h ?? 0), minute = Number(min ?? 0), second = Number(sec ?? 0);
  if (year === 0 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return NaN;
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return NaN;
  let iso = text.replace(' ', 'T');
  if (h && !zone) iso += 'Z';
  return Date.parse(iso) / 1000;
}
