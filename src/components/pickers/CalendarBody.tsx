// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement } from "react";
import type { CalendarDate } from "@internationalized/date";
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
} from "react-aria-components";

/**
 * The month header and day grid every calendar here draws — the day picker's
 * popover, the datetime popover, the range popover's RangeCalendar and the
 * week picker. Rendered INSIDE a `Calendar` or `RangeCalendar`, which is what
 * gives the `previous` / `next` slots and the Heading their month to show.
 * The week picker passes its own cell renderer, since its cells highlight a
 * whole week.
 */
export function CalendarBody({
  renderCell,
}: {
  renderCell?: (date: CalendarDate) => ReactElement;
} = {}) {
  return (
    <>
      <header className="picker-header">
        <Button slot="previous" aria-label="Previous month">
          ◀
        </Button>
        <Heading />
        <Button slot="next" aria-label="Next month">
          ▶
        </Button>
      </header>
      <CalendarGrid>
        <CalendarGridHeader>{(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (renderCell ? renderCell(date) : <CalendarCell date={date} />)}
        </CalendarGridBody>
      </CalendarGrid>
    </>
  );
}
