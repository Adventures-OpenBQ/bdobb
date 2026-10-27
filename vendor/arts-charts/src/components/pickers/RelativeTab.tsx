// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { getHost, type RelativeTabProps } from "../../host";

export type { RelativeContext } from "../../host";

/** The host's Relative tab (bdobb-v2 src/components/pickers/RelativeTab.tsx). */
export function RelativeTab(props: RelativeTabProps) {
  const Tab = getHost().components.RelativeTab;
  return <Tab {...props} />;
}
