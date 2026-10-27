// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { getHost, type GroupActions } from "../host";

/** ChartGroupChip's three group actions, through bdobb-v2's selector shape. */
export function useDashboardStore<T>(select: (actions: GroupActions) => T): T {
  return select(getHost().groups);
}
