// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { fiscalPeriod, formatFiscalLabel, formatQuarter, parseQuarter } from "../../lib/periods";
import { quarterCellLabel, quarterLabel } from "./labels";
import { PeriodGrid } from "./PeriodGrid";
import { PeriodPopover } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  label: string;
  /** A quarter label (`2027-Q1`) under THIS param's year end, or "". */
  value: string;
  /** The resolved year-end month; December when absent. */
  fiscalYearEnd?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The Relative tab's context (v5.3.0); absent means no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. `value` stays the resolved display. */
  stored?: string;
};

/**
 * Trigger showing `FY2027-Q3`; popover with a `◀ FY2027 ▶` header and a 2×2
 * grid of quarters, each named with its calendar months so a September
 * issuer's Q1 reads as `FY2027-Q1 (Oct–Dec 2026)`. A pick commits at once
 * and closes. Reopening starts from the stored quarter's year, or from
 * today's quarter under this year end when nothing is stored.
 */
export function QuarterPicker({ label, value, fiscalYearEnd = 12, disabled = false, onChange, relative, stored: storedValue }: Props) {
  const stored = parseQuarter(value);
  const current = stored ?? fiscalPeriod(today(getLocalTimeZone()), fiscalYearEnd);
  const [fy, setFy] = useState(current.fy);

  return (
    <PeriodPopover
      label={label}
      trigger={quarterLabel(value)}
      disabled={disabled}
      onOpen={() => setFy(current.fy)}
      relative={relative ? { type: "quarter", context: relative, value: storedValue ?? value, onApply: onChange } : undefined}
    >
      {(close) => (
        <PeriodGrid
          heading={formatFiscalLabel(fy)}
          prevLabel="Previous fiscal year"
          nextLabel="Next fiscal year"
          onStep={(dir) => setFy(fy + dir)}
          gridClass="picker-grid-quarters"
          cells={[1, 2, 3, 4].map((q) => ({
            key: q,
            text: `Q${q}`,
            ariaLabel: quarterCellLabel({ fy, q }, fiscalYearEnd),
            selected: stored?.fy === fy && stored.q === q,
            pick: () => {
              close();
              onChange(formatQuarter({ fy, q }));
            },
          }))}
        />
      )}
    </PeriodPopover>
  );
}
