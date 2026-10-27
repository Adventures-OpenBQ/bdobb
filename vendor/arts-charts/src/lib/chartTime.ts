// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The advanced chart's time labels: the x axis's tick marks and the
 * crosshair's time readout.
 *
 * lightweight-charts labels a UTC timestamp in UTC, and with its defaults an
 * intraday axis showed only day numbers ("14", "15") -- no clock time at all
 * (reported 2026-09-15). Intraday intervals now label in the viewer's own
 * clock: HH:MM between days (HH:MM:SS on the 1s interval), and the weekday
 * and date where a new day starts. The crosshair reads the full local date
 * and time.
 *
 * WHICH ticks are day, month and year changes -- the bold ones -- is not a
 * formatting question: the library decides it from each point's time,
 * in UTC, so on its own it bolded UTC midnight (20:00 in New York). The chart
 * therefore runs on `createTimeScaleBehavior` below, which makes that call in
 * local time too, and the labels here only have to name what it chose.
 *
 * Daily bars stay in UTC. A daily bar's time is UTC midnight, which in any
 * zone west of Greenwich is the previous evening, so a local label would
 * put every bar on the day before it covers.
 *
 * `timeZone` and `locale` exist for the tests; the chart passes neither, so
 * both are the viewer's own.
 */

import { defaultHorzScaleBehavior, type IHorzScaleBehavior, type Time } from "lightweight-charts";

// lightweight-charts' TickMarkType, a `const enum` in its typings -- so its
// numbers, spelled out, rather than an import that vanishes at build time.
const YEAR = 0;
const MONTH = 1;
const DAY_OF_MONTH = 2;
const TIME_WITH_SECONDS = 4;

export function chartTimeLabels(intervalSeconds: number, timeZone?: string, locale?: string) {
  const daily = intervalSeconds >= 86400;
  const seconds = intervalSeconds < 60;
  const zone = daily ? "UTC" : timeZone;
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
  // 24-hour on the axis: "14:32" fits a tick where "2:32 PM" crowds its
  // neighbours, and it reads the same in every locale.
  const clock: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const year = format({ year: "numeric" });
  const month = format({ month: "short", year: "numeric" });
  const day = format({ weekday: "short", month: "short", day: "numeric" });
  const time = format(clock);
  const timeWithSeconds = format({ ...clock, second: "2-digit" });
  const crosshair = format(
    daily
      ? { weekday: "short", year: "numeric", month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", ...clock, ...(seconds ? { second: "2-digit" } : {}) },
  );
  const at = (value: unknown) => new Date(Number(value) * 1000);
  return {
    timeVisible: !daily,
    secondsVisible: seconds,
    tickMarkFormatter: (value: unknown, type: number): string => {
      const date = at(value);
      if (type === YEAR) return year.format(date);
      if (type === MONTH) return month.format(date);
      if (type === DAY_OF_MONTH) return day.format(date);
      if (type === TIME_WITH_SECONDS) return timeWithSeconds.format(date);
      return time.format(date);
    },
    timeFormatter: (value: unknown): string => crosshair.format(at(value)),
  };
}

// lightweight-charts' TickMarkWeight, also a `const enum`: its numbers, and
// the intraday boundaries it weighs, exactly as its default behaviour does.
const WEIGHT_YEAR = 70;
const WEIGHT_MONTH = 60;
const WEIGHT_DAY = 50;
const INTRADAY_WEIGHTS: ReadonlyArray<readonly [divisorMs: number, weight: number]> = [
  [1_000, 10], [60_000, 20], [300_000, 21], [1_800_000, 22],
  [3_600_000, 30], [10_800_000, 31], [21_600_000, 32], [43_200_000, 33],
];

/** The viewer's own offset from UTC, in minutes, at `ms`. */
const localOffsetMinutes = (ms: number) => -new Date(ms).getTimezoneOffset();

/**
 * The library's `weightByTime`, read on the wall clock instead of UTC: a
 * Date shifted by the zone's offset at that instant, then read with its UTC
 * getters. Per point, so a daylight-saving change moves the marks with it.
 * `offsetMinutes` exists for the tests; the chart uses the viewer's zone.
 */
export function localTickWeight(
  currentSeconds: number, previousSeconds: number,
  offsetMinutes: (ms: number) => number = localOffsetMinutes,
): number {
  const wall = (seconds: number) => {
    const ms = seconds * 1000;
    return new Date(ms + offsetMinutes(ms) * 60_000);
  };
  const current = wall(currentSeconds);
  const previous = wall(previousSeconds);
  if (current.getUTCFullYear() !== previous.getUTCFullYear()) return WEIGHT_YEAR;
  if (current.getUTCMonth() !== previous.getUTCMonth()) return WEIGHT_MONTH;
  if (current.getUTCDate() !== previous.getUTCDate()) return WEIGHT_DAY;
  for (let i = INTRADAY_WEIGHTS.length - 1; i >= 0; i--) {
    const [divisor, weight] = INTRADAY_WEIGHTS[i];
    if (Math.floor(previous.getTime() / divisor) !== Math.floor(current.getTime() / divisor)) return weight;
  }
  return 0;
}

type Behavior = IHorzScaleBehavior<Time>;
type Points = Parameters<Behavior["fillWeightsForPoints"]>[0];

/**
 * The library's own time-scale behaviour with one change: when `local()`
 * says so, tick weights -- which ticks are the bold day, month and year
 * changes -- are decided in local time. The bars' times are untouched, so
 * drawings, anchors and clicks stay in UTC. `local` is read on every
 * recalculation, so the chart can flip it when the interval changes: daily
 * bars keep UTC weights, because a daily bar is stamped at UTC midnight and
 * a local reading would put every month mark a bar late west of Greenwich.
 * Timestamps come through the behaviour's public `key()`, not the library's
 * internal field names, which a production build can rename.
 */
export function createTimeScaleBehavior(local: () => boolean): Behavior {
  const Base = defaultHorzScaleBehavior();
  class LocalTimeScaleBehavior extends Base {
    fillWeightsForPoints(points: Points, startIndex: number): void {
      if (!local()) {
        super.fillWeightsForPoints(points, startIndex);
        return;
      }
      if (points.length === 0) return;
      const seconds = (index: number) => Number(this.key(points[index].time));
      const weigh = (index: number, weight: number) => {
        points[index].timeWeight = weight as Points[number]["timeWeight"];
      };
      let previous: number | null = startIndex === 0 ? null : seconds(startIndex - 1);
      let total = 0;
      for (let index = startIndex; index < points.length; index++) {
        const current = seconds(index);
        if (previous !== null) weigh(index, localTickWeight(current, previous));
        total += current - (previous ?? current);
        previous = current;
      }
      // The first point has no predecessor, so, like the library, guess one
      // an average step back in history.
      if (startIndex === 0 && points.length > 1) {
        const step = Math.ceil(total / (points.length - 1));
        weigh(0, localTickWeight(seconds(0), seconds(0) - step));
      }
    }
  }
  return new LocalTimeScaleBehavior();
}
