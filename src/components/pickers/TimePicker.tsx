// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { DateInput, DateSegment, I18nProvider, TimeField } from "react-aria-components";
import { parseWireTime, wireTime } from "../../lib/dateExpressions";

type Props = {
  label: string;
  /** A wire time (`09:30:00`) or "". */
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

/**
 * Inline, like the day picker: eight characters is a titlebar's worth. To
 * the second, on a 24-hour clock, whatever the locale would do — the wire
 * form is `09:30:00` and the field shows exactly that.
 */
export function TimePicker({ label, value, disabled = false, onChange, onBlur }: Props) {
  return (
    <I18nProvider locale="en-CA">
      <TimeField
        aria-label={label}
        value={parseWireTime(value)}
        granularity="second"
        hourCycle={24}
        isDisabled={disabled}
        onChange={(time) => onChange(time ? wireTime(time) : "")}
        onBlur={onBlur}
      >
        <DateInput>{(segment) => <DateSegment segment={segment} />}</DateInput>
      </TimeField>
    </I18nProvider>
  );
}
