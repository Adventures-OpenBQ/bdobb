// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { parseZonedDateTime } from "@internationalized/date";
import { addBusinessDays, bundledCalendar } from "../calendar";
import { resolveValue } from "../dateExpressions";
it("zero session shift preserves a closed anchor under legacy policy", () => {
  const at = parseZonedDateTime("2026-01-03T12:00[America/New_York]");
  expect(addBusinessDays(bundledCalendar("XNYS")!, at, 0).toString()).toBe(
    "2026-01-03T12:00:00-05:00[America/New_York]",
  );
});
it("weekday tokens stay inclusive and offsets remain ordered", () => {
  const ctx = { now: new Date("2026-09-28T16:00:00Z"), zone: "America/New_York" };
  expect(resolveValue("date", "T-MON", ctx)).toBe("2026-09-28");
  expect(resolveValue("date", "T+MON", ctx)).toBe("2026-09-28");
  expect(resolveValue("date", "T-1bd+1d", { ...ctx, calendar: bundledCalendar("XNYS")! })).toBe("2026-09-26");
});
