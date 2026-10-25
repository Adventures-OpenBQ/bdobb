// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import type { CalendarDate } from "@internationalized/date";
import { DateField, DateInput, DateSegment, I18nProvider, RangeCalendar } from "react-aria-components";
import { parseWireDate, splitRange } from "../../lib/dateExpressions";
import { CalendarBody } from "./CalendarBody";
import { rangeLabel } from "./labels";
import { PeriodPopover } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  label: string;
  /** The composite `start/end`, both wire dates, either possibly "". */
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The Relative tab's context (v5.3.0); absent means no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. `value` stays the resolved display. */
  stored?: string;
};

type Draft = { start: CalendarDate | null; end: CalendarDate | null };

function split(value: string): Draft {
  const [start, end] = splitRange(value);
  return { start: parseWireDate(start), end: parseWireDate(end) };
}

/**
 * One control driving two wire params (design §1): the card stores the
 * composite, and wireParams splits it. The trigger shows both ends; the
 * popover is the body of a DateRangePicker — two fields and a range calendar
 * — kept as a draft that commits on a completed calendar range or on Enter
 * in a field, and only when start ≤ end: a reversed pair is not a range and
 * is not written. A commit closes the popover; a refused Enter leaves it open
 * on the draft, since closing would throw the edit away unseen — Escape is
 * the way to close without writing.
 */
export function RangePicker({ label, value, disabled = false, onChange, relative, stored: storedValue }: Props) {
  const [draft, setDraft] = useState<Draft>(() => split(value));

  const commit = (d: Draft): boolean => {
    if (d.start && d.end && d.start.compare(d.end) <= 0) {
      onChange(`${d.start.toString()}/${d.end.toString()}`);
      return true;
    }
    return false;
  };
  const onEnter = (close: () => void) => (e: { key: string }) => {
    if (e.key === "Enter" && commit(draft)) close();
  };

  return (
    <PeriodPopover
      label={label}
      trigger={rangeLabel(value)}
      disabled={disabled}
      onOpen={() => setDraft(split(value))}
      relative={relative ? { type: "date_range", context: relative, value: storedValue ?? value, onApply: onChange } : undefined}
    >
      {(close) => (
        <I18nProvider locale="en-CA">
          <div className="picker-fields">
            <DateField aria-label={`${label} start`} value={draft.start} onChange={(start) => setDraft({ ...draft, start })} onKeyDown={onEnter(close)}>
              <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
            </DateField>
            <span aria-hidden="true">–</span>
            <DateField aria-label={`${label} end`} value={draft.end} onChange={(end) => setDraft({ ...draft, end })} onKeyDown={onEnter(close)}>
              <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
            </DateField>
          </div>
          <RangeCalendar
            aria-label={label}
            firstDayOfWeek="mon"
            value={draft.start && draft.end ? { start: draft.start, end: draft.end } : null}
            onChange={(range) => {
              const next = { start: range.start, end: range.end };
              setDraft(next);
              close();
              commit(next);
            }}
          >
            <CalendarBody />
          </RangeCalendar>
        </I18nProvider>
      )}
    </PeriodPopover>
  );
}
