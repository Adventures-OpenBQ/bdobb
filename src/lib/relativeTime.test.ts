// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const NOW = Date.UTC(2026, 8, 19, 21, 0, 0);
const s = 1000, m = 60 * s, h = 60 * m, d = 24 * h;

describe("relativeTime", () => {
  it.each([
    [0, "just now"],
    [44 * s, "just now"],
    [45 * s, "1 minute ago"],
    [90 * s, "2 minutes ago"],
    [12 * m, "12 minutes ago"],
    [59 * m, "59 minutes ago"],
    [59 * m + 29 * s, "59 minutes ago"],
    // Rounds to 60 minutes, which is an hour -- never "60 minutes ago".
    [59 * m + 30 * s, "1 hour ago"],
    [60 * m, "1 hour ago"],
    [3 * h, "3 hours ago"],
    [24 * h, "yesterday"],
    [47 * h, "yesterday"],
    [3 * d, "3 days ago"],
    [7 * d, "7 days ago"],
  ])("%i ms ago reads %s", (ago, text) => {
    expect(relativeTime(NOW - ago, NOW)).toBe(text);
  });

  it("names the date beyond a week", () => {
    expect(relativeTime(NOW - 8 * d, NOW)).toMatch(/^Sep 1[01], 2026$/);
  });

  it("treats a future stamp as just now", () => {
    expect(relativeTime(NOW + 5 * m, NOW)).toBe("just now");
  });
});
