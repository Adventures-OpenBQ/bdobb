// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { getHost, type AnchorChipsProps } from "../../host";

/** The host's anchor preset chips (bdobb-v2 src/components/pickers/AnchorChips.tsx). */
export function AnchorChips(props: AnchorChipsProps) {
  const Chips = getHost().components.AnchorChips;
  return <Chips {...props} />;
}
