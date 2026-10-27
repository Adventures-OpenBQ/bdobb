// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { getHost, type DatetimePickerProps } from "../../host";

/** The host's v5 datetime picker (bdobb-v2 src/components/pickers/DatetimePicker.tsx). */
export function DatetimePicker(props: DatetimePickerProps) {
  const Picker = getHost().components.DatetimePicker;
  return <Picker {...props} />;
}
