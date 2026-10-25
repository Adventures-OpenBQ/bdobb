// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { dataBounds } from "./dataBounds";

describe("dataBounds (v5.3.0 data_bounds)", () => {
  it("is the first and last date in the payload, whatever order the rows came in", () => {
    const rows = [
      { date: "2024-03-01", close: 2 }, { date: "2019-01-02", close: 1 }, { date: "2026-09-17", close: 3 },
    ];
    // Bare dates are calendar dates: local noon, so the DAY is what survives.
    const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
    expect(dataBounds(rows)).toEqual({ min: day(2019, 1, 2), max: day(2026, 9, 17) });
    expect(dataBounds({ results: rows })).toEqual({ min: day(2019, 1, 2), max: day(2026, 9, 17) });
    // A value that carries a time is an instant.
    expect(dataBounds([{ date: "2026-09-17T13:30:00Z" }, { date: "2026-09-17T20:00:00Z" }]))
      .toEqual({ min: new Date("2026-09-17T13:30:00Z"), max: new Date("2026-09-17T20:00:00Z") });
  });

  it("defers rather than guesses: no rows, or no date column, is no bounds", () => {
    expect(dataBounds(null)).toBeUndefined();
    expect(dataBounds([])).toBeUndefined();
    expect(dataBounds([{ symbol: "AAPL", price: 1 }])).toBeUndefined();
    expect(dataBounds("not rows")).toBeUndefined();
  });
});
