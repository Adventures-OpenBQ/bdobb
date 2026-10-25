// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { CalendarError, parseBinding, type CalendarBinding } from "./contracts";
/** Security Master supplies the required payment systems; no currency is inferred. */
export function fxCalendarSet(
  calendar1: string,
  calendar2: string,
  calendar3?: string,
): Extract<CalendarBinding, { kind: "joint" }> {
  const ids = calendar3 === undefined ? [calendar1, calendar2] : [calendar1, calendar2, calendar3];
  if (ids.some((id) => typeof id !== "string" || !/^payment:[A-Z0-9_-]+$/.test(id)))
    throw new CalendarError("INVALID_FX_CALENDAR");
  return parseBinding({
    schemaVersion: 1,
    kind: "joint",
    members: [...new Set(ids)],
    mode: "all_open",
    referenceTimezone: "UTC",
  }) as Extract<CalendarBinding, { kind: "joint" }>;
}
