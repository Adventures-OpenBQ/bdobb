// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { bindableKeys } from "./params";
import type { DashboardCard, ParamGroup, WidgetDef, WidgetParam } from "./types";

/**
 * The key two controls must share to sit in one group. Declared when the
 * manifest says so; otherwise a date control is `date` — two day pickers
 * named differently are the same kind of thing — and anything else is its
 * own paramName, which is exactly the rule the app has always applied,
 * since a group used to be joinable only by name. A group's own groupType
 * defaults the same way (dashboardsFile.ts, appsJson.ts), so every group
 * that existed before this function did keeps its membership.
 */
export function paramGroupType(param: Pick<WidgetParam, "paramName" | "type" | "groupType">): string {
  if (param.groupType) return param.groupType;
  return param.type === "date" ? "date" : param.paramName;
}

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

export function groupsForCard(card: DashboardCard, groups: ParamGroup[] | undefined): ParamGroup[] {
  return liveBindings(card, groups).map((b) => b.group);
}

/** The group `paramName` is bound to on this card, if any. */
export function groupFor(
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
  paramName: string,
): ParamGroup | undefined {
  return liveBindings(card, groups).find((b) => b.paramName === paramName)?.group;
}

/**
 * Narrowed to params the widget genuinely declares: a card can carry a
 * binding for a param its widget never asked for (an import, a widget that
 * changed shape), and binding regardless would append a query parameter the
 * endpoint does not understand.
 *
 * Types are NOT re-checked here. What may join a group is decided once, by
 * compatibleGroups, when the menu offers it; a binding that exists is
 * honoured. Re-deriving compatibility on every read would make a group that
 * imported fine silently stop binding the day a widget's declared type
 * changed, with nothing on screen saying why.
 */
export function groupedParamNames(
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
  widget: WidgetDef,
  groupsDisabled = false,
): Set<string> {
  // The dashboard's Disable grouping toggle. Answering "nothing is bound"
  // here — rather than at each call site — is what keeps the displayed
  // value, the edit target and the badge in agreement. The groups and the
  // bindings themselves are kept, never deleted.
  if (groupsDisabled) return new Set();
  // bindableKeys, not widget.params: a form field named `symbol` is grouped
  // by `symbol` even though it is STORED as `<form>.symbol`.
  const declared = new Set(bindableKeys(widget).values());
  return new Set(
    liveBindings(card, groups)
      .map((b) => b.paramName)
      .filter((name) => declared.has(name)),
  );
}

/**
 * The group wins, deliberately: a card's stored value for a grouped parameter
 * is stale by definition — whatever it held before joining, or whatever the
 * widget seeded — and letting it win would make the group visibly do nothing.
 *
 * Always returns a fresh object (even with nothing bound) so callers can
 * treat the result uniformly without risking a mutation reaching back into
 * the dashboard store's own card.params.
 */
export function effectiveParams(
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
  widget: WidgetDef,
  groupsDisabled = false,
): Record<string, string> {
  const bound = groupedParamNames(card, groups, widget, groupsDisabled);
  const out = { ...card.params };
  if (bound.size === 0) return out;
  // Over the KEYS, not the bound names: a bound `symbol` writes onto the
  // card's own `symbol` and onto `<form>.symbol` alike, so a form field joins
  // its group exactly as a top-level param does.
  for (const [key, name] of bindableKeys(widget)) {
    if (!bound.has(name)) continue;
    const group = groupFor(card, groups, name);
    if (group) out[key] = group.value;
  }
  return out;
}

export type ParamEdit = {
  cardParams: Record<string, string>;
  groupEdits: Array<{ groupId: string; value: string }>;
};

/**
 * Without the split, editing a grouped control would write onto the card and
 * be masked by the group on the very next render — the control would snap
 * back and the change would look lost.
 *
 * Only genuine changes are reported: writing a group whose value has not
 * moved would refetch every member card whether or not anything changed.
 */
export function splitParamEdit(
  edits: Record<string, string>,
  card: DashboardCard,
  groups: ParamGroup[] | undefined,
  widget: WidgetDef,
  groupsDisabled = false,
): ParamEdit {
  const bound = groupedParamNames(card, groups, widget, groupsDisabled);
  const keys = bindableKeys(widget);

  const cardParams = { ...card.params };
  const groupEdits: Array<{ groupId: string; value: string }> = [];

  // `edits` is keyed by STORAGE key, which is the param name for every param
  // the widget declares directly and `<form>.<field>` for a form field. The
  // lookup resolves both; an edit to a key the widget never declared falls
  // through to itself and lands on the card, as it always has.
  for (const [key, value] of Object.entries(edits)) {
    const name = keys.get(key) ?? key;
    if (!bound.has(name)) {
      cardParams[key] = value;
      continue;
    }
    const group = groupFor(card, groups, name);
    if (group && group.value !== value && !groupEdits.some((e) => e.groupId === group.id)) {
      groupEdits.push({ groupId: group.id, value });
    }
  }

  return { cardParams, groupEdits };
}

/** What the menu offers a control: the dashboard's groups of its own type, in order. */
export function compatibleGroups(groups: ParamGroup[] | undefined, groupType: string): ParamGroup[] {
  return (groups ?? []).filter((g) => g.groupType === groupType);
}

/** "Group 1", then the first unused number — not highest + 1, matching dedupe in appsJson.ts. */
export function nextGroupName(groups: ParamGroup[] | undefined): string {
  const taken = new Set((groups ?? []).map((g) => g.name));
  for (let n = 1; ; n += 1) {
    const name = `Group ${n}`;
    if (!taken.has(name)) return name;
  }
}
