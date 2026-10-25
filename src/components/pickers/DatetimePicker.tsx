// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import {
  CalendarDate,
  getLocalTimeZone,
  now,
  toCalendarDateTime,
  toZoned,
  type ZonedDateTime,
} from "@internationalized/date";
import { Calendar, DateField, DateInput, DateSegment, I18nProvider } from "react-aria-components";
import { parseWireDatetime, wireDatetime } from "../../lib/dateExpressions";
import type { Granularity } from "../../lib/types";
import { CalendarBody } from "./CalendarBody";
import { datetimeLabel } from "./labels";
import { PeriodPopover } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  label: string;
  /** A wire datetime (`2026-09-14T09:30:15-04:00`) or "". */
  value: string;
  /** How deep the field goes; the wire is always to the second. */
  granularity?: Granularity;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The Relative tab's context (v5.3.0); absent means no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. `value` stays the resolved display. */
  stored?: string;
};

/**
 * Trigger showing `2026-09-14 09:30:15 EDT`; popover holding a segmented
 * field at the param's granularity, zone shown, and a calendar. The popover
 * keeps a DRAFT: field keystrokes change it without writing, Enter or a
 * calendar pick commits it and closes the popover, and Escape discards it.
 * Committing on every segment keystroke would refetch the card once per
 * digit, which is what the day picker's blur path exists to avoid.
 */
export function DatetimePicker({ label, value, granularity = "minute", disabled = false, onChange, relative, stored: storedValue }: Props) {
  const zone = getLocalTimeZone();
  const stored = parseWireDatetime(value, zone);
  const [draft, setDraft] = useState<ZonedDateTime | null>(stored);

  /**
   * v5.4.0 (spec §4.6): `year`, `month` and `day` show React Aria's smallest
   * date field — the day — and a pick there is midnight, local. Display only:
   * the wire stays to the second.
   */
  const dateOnly = granularity === "year" || granularity === "month" || granularity === "day";
  const commit = (at: ZonedDateTime | null) => {
    if (!at) return;
    onChange(wireDatetime(dateOnly ? toZoned(toCalendarDateTime(new CalendarDate(at.year, at.month, at.day)), zone) : at));
  };

  return (
    <PeriodPopover
      label={label}
      trigger={datetimeLabel(value, zone)}
      disabled={disabled}
      onOpen={() => setDraft(stored ?? now(zone))}
      relative={relative ? { type: "datetime", context: relative, value: storedValue ?? value, onApply: onChange } : undefined}
    >
      {(close) => (
        <I18nProvider locale="en-CA">
          <div className="picker-fields">
            <DateField
              aria-label={`${label} time`}
              value={draft}
              granularity={dateOnly ? "day" : granularity}
              hideTimeZone={false}
              hourCycle={24}
              onChange={setDraft}
              onKeyDown={(e) => {
                // Enter commits AND closes, as a calendar pick does (design §6).
                if (e.key === "Enter" && draft) {
                  close();
                  commit(draft);
                }
              }}
            >
              <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
            </DateField>
          </div>
          <Calendar
            aria-label={`${label} date`}
            firstDayOfWeek="mon"
            value={draft ? new CalendarDate(draft.year, draft.month, draft.day) : null}
            onChange={(date) => {
              // The picked day, with the draft's time of day kept — or midnight
              // when there is no draft yet.
              const next = draft
                ? draft.set({ year: date.year, month: date.month, day: date.day })
                : toZoned(toCalendarDateTime(date), zone);
              setDraft(next);
              close();
              commit(next);
            }}
          >
            <CalendarBody />
          </Calendar>
        </I18nProvider>
      )}
    </PeriodPopover>
  );
}
