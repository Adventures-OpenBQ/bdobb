// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CalendarDate } from "@internationalized/date";
import { Calendar, CalendarCell, I18nProvider } from "react-aria-components";
import { formatWeek, isoWeek, parseWeek, weekSpan } from "../../lib/periods";
import { CalendarBody } from "./CalendarBody";
import { weekLabel } from "./labels";
import { PeriodPopover } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  label: string;
  /** An ISO week label (`2026-W37`) or "". */
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The Relative tab's context (v5.3.0); absent means no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. `value` stays the resolved display. */
  stored?: string;
};

/**
 * Trigger showing `W37 2026 · Sep 7–13`; popover holding a calendar whose
 * cells select their whole ISO week. React Aria's Calendar already moves
 * focus by a week with Up/Down and by a day with Left/Right, and reports the
 * one day picked; this snaps that day to its week, so the selection is
 * always seven days. The seven are marked with a `week-selected` class
 * rather than RAC's own `data-selected`, which RAC reserves for the single
 * day it thinks is selected and sets itself. Monday starts the row, so a
 * week never straddles two rows.
 */
export function WeekPicker({ label, value, disabled = false, onChange, relative, stored: storedValue }: Props) {
  const week = parseWeek(value);
  const span = week ? weekSpan(week) : null;

  const inWeek = (date: CalendarDate) =>
    span !== null && date.compare(span.start) >= 0 && date.compare(span.end) <= 0;

  return (
    <PeriodPopover
      label={label}
      trigger={weekLabel(value)}
      disabled={disabled}
      relative={relative ? { type: "week", context: relative, value: storedValue ?? value, onApply: onChange } : undefined}
    >
      {(close) => (
        <I18nProvider locale="en-CA">
          <Calendar
            aria-label={label}
            firstDayOfWeek="mon"
            value={span?.start ?? null}
            onChange={(date) => {
              close();
              onChange(formatWeek(isoWeek(date)));
            }}
          >
            <CalendarBody
              renderCell={(date) => (
                <CalendarCell
                  date={date}
                  className={({ defaultClassName = "" }) =>
                    inWeek(date) ? `${defaultClassName} week-selected` : defaultClassName
                  }
                />
              )}
            />
          </Calendar>
        </I18nProvider>
      )}
    </PeriodPopover>
  );
}
