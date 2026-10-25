// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { fiscalPeriod, parseFiscalYear } from "../../lib/periods";
import { fiscalYearCellLabel, fiscalYearLabel } from "./labels";
import { PeriodGrid } from "./PeriodGrid";
import { PeriodPopover } from "./PeriodPopover";
import type { RelativeContext } from "./RelativeTab";

type Props = {
  label: string;
  /** A fiscal year label (`2027`) under THIS param's year end, or "". */
  value: string;
  fiscalYearEnd?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The Relative tab's context (v5.3.0); absent means no tabs. */
  relative?: RelativeContext;
  /** The STORED value: an expression seeds the Relative tab. `value` stays the resolved display. */
  stored?: string;
};

/**
 * Trigger showing `FY2027`; popover with a `◀ 2020–2029 ▶` header and a 3×4
 * grid: the decade plus the year on either side, those two greyed, so a
 * year at a decade's edge is one click away rather than a page turn. Each
 * cell names its calendar span. A pick commits at once and closes.
 */
export function FiscalYearPicker({ label, value, fiscalYearEnd = 12, disabled = false, onChange, relative, stored: storedValue }: Props) {
  const stored = parseFiscalYear(value);
  const current = stored ?? fiscalPeriod(today(getLocalTimeZone()), fiscalYearEnd).fy;
  const [decade, setDecade] = useState(Math.floor(current / 10) * 10);

  const years = Array.from({ length: 12 }, (_, i) => decade - 1 + i);

  return (
    <PeriodPopover
      label={label}
      trigger={fiscalYearLabel(value)}
      disabled={disabled}
      onOpen={() => setDecade(Math.floor(current / 10) * 10)}
      relative={relative ? { type: "fiscal_year", context: relative, value: storedValue ?? value, onApply: onChange } : undefined}
    >
      {(close) => (
        <PeriodGrid
          heading={`${decade}–${decade + 9}`}
          prevLabel="Previous decade"
          nextLabel="Next decade"
          onStep={(dir) => setDecade(decade + 10 * dir)}
          gridClass="picker-grid-years"
          cells={years.map((fy) => ({
            key: fy,
            text: String(fy),
            ariaLabel: fiscalYearCellLabel(fy, fiscalYearEnd),
            selected: fy === stored,
            outside: fy < decade || fy > decade + 9,
            pick: () => {
              close();
              onChange(String(fy));
            },
          }))}
        />
      )}
    </PeriodPopover>
  );
}
