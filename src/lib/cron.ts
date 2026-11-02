// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standard five-field cron -- minute, hour, day-of-month, month, day-of-week
 * -- as widgets.json's `refetchInterval` and `dataUpdateDisplay` use it, in
 * local time. Supported: `*`, numbers, lists `a,b`, ranges `a-b`, and steps
 * `*\/n` and `a-b/n`. Day-of-week runs 0-7 and both 0 and 7 are Sunday. No
 * names, no `?`, `L` or `#`: an expression using them is invalid.
 */
export type Cron = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /**
   * Both day fields restricted: a day matches if EITHER does (standard
   * cron). A field counts as unrestricted when it starts with `*`, as in
   * Vixie cron, so `*\/2` in one day field still ANDs with the other.
   */
  eitherDay: boolean;
};

const BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const DIGITS = /^\d+$/;

function parseField(text: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText, ...extra] = part.split("/");
    if (extra.length > 0) return null;
    let step = 1;
    if (stepText !== undefined) {
      if (!DIGITS.test(stepText)) return null;
      step = Number(stepText);
      if (step < 1) return null;
    }
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const ends = range.split("-");
      if (ends.length > 2 || !ends.every((e) => DIGITS.test(e))) return null;
      // `a/n` is not in the grammar: a step needs `*` or a range.
      if (stepText !== undefined && ends.length === 1) return null;
      lo = Number(ends[0]);
      hi = Number(ends[ends.length - 1]);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** null for anything that is not a valid expression in the grammar above. */
export function parseCron(expr: string): Cron | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(fields[i], BOUNDS[i][0], BOUNDS[i][1]);
    if (set === null) return null;
    sets.push(set);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = sets;
  if (dayOfWeek.delete(7)) dayOfWeek.add(0);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    eitherDay: !fields[2].startsWith("*") && !fields[4].startsWith("*"),
  };
}

export function cronMatches(cron: Cron, at: Date): boolean {
  if (!cron.minute.has(at.getMinutes()) || !cron.hour.has(at.getHours())) return false;
  if (!cron.month.has(at.getMonth() + 1)) return false;
  const dom = cron.dayOfMonth.has(at.getDate());
  const dow = cron.dayOfWeek.has(at.getDay());
  return cron.eitherDay ? dom || dow : dom && dow;
}

const MINUTE = 60_000;
// ponytail: minute-by-minute scan capped at four years (~2.1M steps, reached
// only by an expression that never matches, like `0 0 30 2 *`); jump field
// by field instead if it ever shows up in a profile.
const SCAN_LIMIT = 4 * 366 * 24 * 60;

/** The first matching minute strictly after the one containing `after`, or null within the cap. */
export function cronNext(cron: Cron, after: Date): Date | null {
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE;
  for (let i = 0; i < SCAN_LIMIT; i++) {
    t += MINUTE;
    const d = new Date(t);
    if (cronMatches(cron, d)) return d;
  }
  return null;
}

/** The latest matching minute at or before `atOrBefore`, or null within the cap. */
export function cronPrev(cron: Cron, atOrBefore: Date): Date | null {
  let t = Math.floor(atOrBefore.getTime() / MINUTE) * MINUTE;
  for (let i = 0; i < SCAN_LIMIT; i++, t -= MINUTE) {
    const d = new Date(t);
    if (cronMatches(cron, d)) return d;
  }
  return null;
}

/**
 * The refresh button's "Data update" line for `dataUpdateDisplay`: the
 * expression and its previous and next scheduled times, which come from the
 * schedule, not from when the card last fetched (data-update-display.md).
 */
export function dataUpdateText(expr: string, now: Date): string | undefined {
  const cron = parseCron(expr);
  if (cron === null) return undefined;
  const when = (d: Date | null) => (d === null ? "—" : d.toLocaleString());
  return `Data update: ${expr} · last ${when(cronPrev(cron, now))} · next ${when(cronNext(cron, now))}`;
}
