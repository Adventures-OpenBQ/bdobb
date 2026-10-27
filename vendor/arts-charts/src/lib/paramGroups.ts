// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { DashboardCard, ParamGroup } from "./types";

/**
 * The bindings whose group still exists. A group can be deleted from the
 * dashboard without the cards being rewritten, so a dangling binding is
 * skipped rather than treated as live.
 *
 * Takes the groups array rather than the whole Dashboard so a caller's memo
 * can depend on exactly what this function reads — nothing else on Dashboard
 * can silently go stale in a dependency array that only lists `.groups`.
 */
function liveBindings(
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
): Array<{ paramName: string; group: ParamGroup }> {
  const all = groups ?? [];
  const out: Array<{ paramName: string; group: ParamGroup }> = [];
  for (const b of card.bindings ?? []) {
    const group = all.find((g) => g.id === b.groupId);
    if (group) out.push({ paramName: b.paramName, group });
  }
  return out;
}

/** The group `paramName` is bound to on this card, if any. */
export function groupFor(
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
  paramName: string,
): ParamGroup | undefined {
  return liveBindings(card, groups).find((b) => b.paramName === paramName)?.group;
}

/** What the menu offers a control: the dashboard's groups of its own type, in order. */
export function compatibleGroups(groups: ParamGroup[] | undefined, groupType: string): ParamGroup[] {
  return (groups ?? []).filter((g) => g.groupType === groupType);
}
