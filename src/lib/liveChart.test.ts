// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { foldTick, intervalSeconds, rowTick, seriesBars, volumeStep, type Tick, type VolumeCounter } from "./liveChart";

const bar = (time: number, close = 10, volume = 100) => ({ time, open: 10, high: 10, low: 10, close, volume });

describe("seriesBars", () => {
  it("maps live-grid's /series envelope to UdfBars in unix seconds, UTC", () => {
    const payload = {
      symbol: "AAPL",
      interval: "1m",
      bars: [
        { date: "2026-10-09T13:31:00+00:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, adjusted_close: 1.5 },
        { date: "2026-10-09T13:30:00Z", open: 1, high: 3, low: 1, close: 2, volume: 20 },
      ],
      cache: { cache: "hit" },
    };
    expect(seriesBars(payload)).toEqual([
      { time: Date.UTC(2026, 9, 9, 13, 30) / 1000, open: 1, high: 3, low: 1, close: 2, volume: 20 },
      { time: Date.UTC(2026, 9, 9, 13, 31) / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ]);
  });

  it("reads a date-only or zoneless date as UTC, never local time", () => {
    const rows = [
      { date: "2026-10-08", open: 1, high: 1, low: 1, close: 1 },
      { date: "2026-10-09 13:30:00", open: 1, high: 1, low: 1, close: 1, volume: 5 },
    ];
    expect(seriesBars({ bars: rows }).map((b) => [b.time, b.volume])).toEqual([
      [Date.UTC(2026, 9, 8) / 1000, 0],
      [Date.UTC(2026, 9, 9, 13, 30) / 1000, 5],
    ]);
  });

  it("takes a bare array, drops unusable rows, and keeps the last of a repeated time", () => {
    const rows = [
      { date: "2026-10-09T13:30:00Z", open: 1, high: 1, low: 1, close: 1 },
      { date: "2026-10-09T13:30:00Z", open: 2, high: 2, low: 2, close: 2 },
      { date: "not a date", open: 1, high: 1, low: 1, close: 1 },
      { date: "2026-10-09T13:31:00Z", open: "x", high: 1, low: 1, close: 1 },
      "junk",
    ];
    expect(seriesBars(rows)).toEqual([{ time: Date.UTC(2026, 9, 9, 13, 30) / 1000, open: 2, high: 2, low: 2, close: 2, volume: 0 }]);
  });

  it("throws on a payload that is not a series, so the card is an error and not a blank chart", () => {
    expect(() => seriesBars({ detail: "nope" })).toThrow("not a series payload");
    expect(() => seriesBars(null)).toThrow("not a series payload");
  });
});

describe("intervalSeconds", () => {
  it("reads every interval live-grid offers, and nothing else", () => {
    expect(["1s", "1m", "5m", "15m", "30m", "1h", "1d"].map(intervalSeconds)).toEqual([1, 60, 300, 900, 1800, 3600, 86400]);
    expect(intervalSeconds("")).toBeNull();
    expect(intervalSeconds("1mo")).toBeNull();
    expect(intervalSeconds("0m")).toBeNull();
  });
});

describe("rowTick", () => {
  const now = Date.UTC(2026, 9, 9, 14, 0, 30);
  it("takes the card's symbol only, case-insensitively, stamped from updated_at (UTC, today)", () => {
    expect(rowTick({ symbol: "aapl", price: 5, last_size: 3, updated_at: "13:59:58" }, "AAPL", now)).toEqual({
      time: Date.UTC(2026, 9, 9, 13, 59, 58) / 1000,
      price: 5,
      size: 3,
      counter: null,
    });
    expect(rowTick({ symbol: "MSFT", price: 5 }, "AAPL", now)).toBeNull();
  });
  it("is stamped on arrival without updated_at, and has no size without last_size", () => {
    expect(rowTick({ symbol: "AAPL", price: 5 }, "AAPL", now)).toEqual({ time: now / 1000, price: 5, size: 0, counter: null });
  });
  it("puts an updated_at over an hour later than now on yesterday (a tick from before UTC midnight)", () => {
    const justAfterMidnight = Date.UTC(2026, 9, 10, 0, 0, 5);
    expect(rowTick({ symbol: "AAPL", price: 5, updated_at: "23:59:59" }, "AAPL", justAfterMidnight)?.time).toBe(
      Date.UTC(2026, 9, 9, 23, 59, 59) / 1000,
    );
  });
  it("keeps a stamp a few seconds ahead of this clock (server skew) on today", () => {
    expect(rowTick({ symbol: "AAPL", price: 5, updated_at: "14:00:40" }, "AAPL", now)?.time).toBe(Date.UTC(2026, 9, 9, 14, 0, 40) / 1000);
  });
  it("prefers updated_ts, the full UTC instant, over updated_at", () => {
    const row = { symbol: "AAPL", price: 5, volume: 1000, updated_at: "14:00:01", updated_ts: "2026-10-09T13:59:57+00:00" };
    expect(rowTick(row, "AAPL", now)).toEqual({ time: Date.UTC(2026, 9, 9, 13, 59, 57) / 1000, price: 5, size: 0, counter: { key: "volume", value: 1000 } });
  });
  it("keeps a weekend replay's updated_ts on its own (earlier) day", () => {
    const sunday = Date.UTC(2026, 9, 11, 18, 0);
    const row = { symbol: "AAPL", price: 5, updated_at: "19:59:30", updated_ts: "2026-10-09T19:59:30+00:00" };
    expect(rowTick(row, "AAPL", sunday)?.time).toBe(Date.UTC(2026, 9, 9, 19, 59, 30) / 1000);
  });
  it("falls back to updated_at when updated_ts is absent or does not parse", () => {
    expect(rowTick({ symbol: "AAPL", price: 5, updated_at: "13:00:00", updated_ts: "junk" }, "AAPL", now)?.time).toBe(
      Date.UTC(2026, 9, 9, 13) / 1000,
    );
  });
  it("ignores a row with no usable price", () => {
    expect(rowTick({ symbol: "AAPL", price: null }, "AAPL", now)).toBeNull();
    expect(rowTick({ symbol: "AAPL" }, "AAPL", now)).toBeNull();
  });
});

describe("foldTick", () => {
  it("folds a tick in the current bucket into the last bar: high, low, close, and its size", () => {
    expect(foldTick(bar(600), { time: 659, price: 12, size: 5 }, 60)).toEqual({ time: 600, open: 10, high: 12, low: 10, close: 12, volume: 105 });
    expect(foldTick(bar(600), { time: 601, price: 8, size: 0 }, 60)).toEqual({ time: 600, open: 10, high: 10, low: 8, close: 8, volume: 100 });
  });
  it("opens a new bar for a tick in a later bucket, on the seed's own bucket grid", () => {
    expect(foldTick(bar(630), { time: 690, price: 11, size: 2 }, 60)).toEqual({ time: 690, open: 11, high: 11, low: 11, close: 11, volume: 2 });
    // Two buckets on: the bar still starts on the grid, not at the tick.
    expect(foldTick(bar(630), { time: 815, price: 11, size: 0 }, 60)?.time).toBe(810);
  });
  it("ignores a tick older than the last bar", () => {
    expect(foldTick(bar(600), { time: 599, price: 11, size: 1 }, 60)).toBeNull();
  });
  it("starts the first bar on the epoch grid when nothing was seeded", () => {
    expect(foldTick(undefined, { time: 125, price: 3, size: 1 }, 60)).toEqual({ time: 120, open: 3, high: 3, low: 3, close: 3, volume: 1 });
  });
});

describe("weekend replay with updated_ts (round 2)", () => {
  // The seed's newest bar is Friday 19:59 (1m); the socket replays on Sunday.
  const friday1959 = Date.UTC(2026, 9, 9, 19, 59) / 1000;
  const sunday = Date.UTC(2026, 9, 11, 18, 0);
  const replay = (hms: string) => rowTick({ symbol: "AAPL", price: 12, updated_ts: `2026-10-09T${hms}+00:00` }, "AAPL", sunday)!;
  it("folds into the Friday bar it belongs to", () => {
    expect(foldTick(bar(friday1959), replay("19:59:30"), 60)).toMatchObject({ time: friday1959, close: 12, high: 12 });
  });
  it("is ignored when older than the newest bar, and never opens a stray bar", () => {
    expect(foldTick(bar(friday1959), replay("15:00:00"), 60)).toBeNull();
  });
});

describe("rowTick's volume counter (review F2)", () => {
  const now = Date.UTC(2026, 9, 9, 14);
  it("prefers stream_volume, the stream's own count, over the re-seeded day volume", () => {
    expect(rowTick({ symbol: "AAPL", price: 1, stream_volume: 40, volume: 9000 }, "AAPL", now)?.counter).toEqual({ key: "stream_volume", value: 40 });
  });
  it("falls back to volume while stream_volume is still null, and to neither", () => {
    expect(rowTick({ symbol: "AAPL", price: 1, stream_volume: null, volume: 9000 }, "AAPL", now)?.counter).toEqual({ key: "volume", value: 9000 });
    expect(rowTick({ symbol: "AAPL", price: 1, last_size: 3 }, "AAPL", now)).toMatchObject({ counter: null, size: 3 });
  });
});

describe("rowTick's future clamp (review F8)", () => {
  const now = Date.UTC(2026, 9, 9, 14);
  it("clamps a stamp more than a minute ahead to now, and keeps seconds of lead", () => {
    expect(rowTick({ symbol: "AAPL", price: 1, updated_ts: "2026-10-09T14:05:00+00:00" }, "AAPL", now)?.time).toBe(now / 1000);
    expect(rowTick({ symbol: "AAPL", price: 1, updated_ts: "2026-10-09T14:00:30+00:00" }, "AAPL", now)?.time).toBe(now / 1000 + 30);
    // updated_at minutes ahead (within the hour, so not yesterday's): clamped too.
    expect(rowTick({ symbol: "AAPL", price: 1, updated_at: "14:10:00" }, "AAPL", now)?.time).toBe(now / 1000);
  });
  it("so one future-stamped tick cannot freeze the chart: the next real tick still folds", () => {
    const first = foldTick(bar(Date.UTC(2026, 9, 9, 13, 59) / 1000), rowTick({ symbol: "AAPL", price: 2, updated_ts: "2026-10-09T15:00:00+00:00" }, "AAPL", now)!, 60)!;
    const next = rowTick({ symbol: "AAPL", price: 3, updated_ts: "2026-10-09T14:00:00+00:00" }, "AAPL", now)!;
    expect(foldTick(first, next, 60)).toMatchObject({ close: 3 });
  });
});

describe("volumeStep", () => {
  const vol = (value: number): VolumeCounter => ({ key: "volume", value });
  const tick = (counter: VolumeCounter | null, size = 7): Tick => ({ time: 0, price: 1, size, counter });
  it("records the first tick after a seed as the baseline and adds nothing", () => {
    expect(volumeStep(undefined, tick(vol(1000)))).toEqual({ add: 0, prev: vol(1000) });
  });
  it("adds the change in the counter", () => {
    expect(volumeStep(vol(1000), tick(vol(1250)))).toEqual({ add: 250, prev: vol(1250) });
    expect(volumeStep(vol(1250), tick(vol(1250)))).toEqual({ add: 0, prev: vol(1250) });
    const sv = (value: number): VolumeCounter => ({ key: "stream_volume", value });
    expect(volumeStep(sv(10), tick(sv(14)))).toEqual({ add: 4, prev: sv(14) });
  });
  it("takes a drop (a new day's reset, a re-seed) as the new baseline and adds nothing", () => {
    expect(volumeStep(vol(5_000_000), tick(vol(300)))).toEqual({ add: 0, prev: vol(300) });
  });
  it("never diffs two different counters: a switch is a new baseline", () => {
    const sv: VolumeCounter = { key: "stream_volume", value: 5 };
    expect(volumeStep(vol(9000), tick(sv))).toEqual({ add: 0, prev: sv });
  });
  it("falls back to last_size only when the row has no counter, leaving the baseline alone", () => {
    expect(volumeStep(vol(1000), tick(null, 7))).toEqual({ add: 7, prev: vol(1000) });
    expect(volumeStep(undefined, tick(null, 7))).toEqual({ add: 7, prev: undefined });
  });
});
