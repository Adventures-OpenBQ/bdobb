// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { splitRange } from "../../lib/dateExpressions";
import { fiscalPeriod, formatFiscalLabel, formatQuarter, parseQuarter, type FiscalQuarter } from "../../lib/periods";
import { quarterCellLabel, quarterRangeLabel } from "./labels";
import { PeriodGrid, type PeriodCell } from "./PeriodGrid";
import { PeriodPopover } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  label: string;
  /** The composite `2025-Q4/2026-Q4` under THIS param's year end; either half may be "". */
  value: string;
  /** The resolved year-end month; December when absent. */
  fiscalYearEnd?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The Relative tab's context; absent means no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. `value` stays the resolved display. */
  stored?: string;
};

const compare = (a: FiscalQuarter, b: FiscalQuarter): number => a.fy - b.fy || a.q - b.q;
const same = (a: FiscalQuarter | null, b: FiscalQuarter): boolean => a !== null && compare(a, b) === 0;

/**
 * v5.4.0 (spec §4.2): one control driving two wire params, as RangePicker is
 * for dates — the card stores the composite and wireParams splits it. The
 * popover holds two quarter grids, each its own named group, so a screen
 * reader hears which end it is choosing. Pick-then-commit, the date range's
 * behaviour: a start pick only moves the draft; an end pick commits
 * `start/end` and closes. End cells before the draft start are disabled — a
 * reversed pair is not a range, so it cannot be picked at all. Escape closes
 * without writing, as every period popover does.
 */
export function QuarterRangePicker({ label, value, fiscalYearEnd = 12, disabled = false, onChange, relative, stored: storedValue }: Props) {
  const [startText, endText] = splitRange(value);
  const start = parseQuarter(startText);
  const end = parseQuarter(endText);
  const current = fiscalPeriod(today(getLocalTimeZone()), fiscalYearEnd);
  const [draft, setDraft] = useState<FiscalQuarter | null>(start);
  const [startFy, setStartFy] = useState((start ?? current).fy);
  const [endFy, setEndFy] = useState((end ?? start ?? current).fy);

  const cells = (fy: number, isEnd: boolean, close: () => void): PeriodCell[] =>
    [1, 2, 3, 4].map((q) => {
      const cell = { fy, q };
      const beforeStart = isEnd && draft !== null && compare(cell, draft) < 0;
      return {
        key: q,
        text: `Q${q}`,
        ariaLabel: quarterCellLabel(cell, fiscalYearEnd),
        selected: isEnd ? same(end, cell) : same(draft, cell),
        // v5.4.0 final-review fix: with no start drafted yet an end cell is
        // inert too (`pick` returns on a null draft), so it reads disabled.
        disabled: isEnd && (draft === null || beforeStart),
        pick: () => {
          if (!isEnd) {
            setDraft(cell);
            return;
          }
          if (draft === null || beforeStart) return;
          close();
          onChange(`${formatQuarter(draft)}/${formatQuarter(cell)}`);
        },
      };
    });

  return (
    <PeriodPopover
      label={label}
      trigger={quarterRangeLabel(value)}
      disabled={disabled}
      onOpen={() => {
        setDraft(start);
        setStartFy((start ?? current).fy);
        setEndFy((end ?? start ?? current).fy);
      }}
      relative={relative ? { type: "quarter_range", context: relative, value: storedValue ?? value, onApply: onChange } : undefined}
    >
      {(close) => (
        <div className="picker-range-quarters">
          <div role="group" aria-label={`${label} start`}>
            <PeriodGrid
              heading={formatFiscalLabel(startFy)}
              prevLabel="Previous fiscal year"
              nextLabel="Next fiscal year"
              onStep={(dir) => setStartFy(startFy + dir)}
              gridClass="picker-grid-quarters"
              cells={cells(startFy, false, close)}
            />
          </div>
          <div role="group" aria-label={`${label} end`}>
            <PeriodGrid
              heading={formatFiscalLabel(endFy)}
              prevLabel="Previous fiscal year"
              nextLabel="Next fiscal year"
              onStep={(dir) => setEndFy(endFy + dir)}
              gridClass="picker-grid-quarters"
              cells={cells(endFy, true, close)}
            />
          </div>
        </div>
      )}
    </PeriodPopover>
  );
}
