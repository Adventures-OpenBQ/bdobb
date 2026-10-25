// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isPeriodType } from "./dateExpressions";
import { bindableKeys } from "./params";
import { relabel } from "./periods";
import type { DashboardCard, ParamGroup, WidgetDef, WidgetParam } from "./types";

/**
 * The key two controls must share to sit in one group. Declared when the
 * manifest says so; otherwise a period control (date, datetime, date_range,
 * quarter, fiscal_year, week, time) is keyed by its type — two week pickers
 * named differently are the same kind of thing, as two day pickers were —
 * and anything else is its own paramName, which is exactly the rule the app
 * has always applied, since a group used to be joinable only by name. A
 * group's own groupType defaults the same way (dashboardsFile.ts,
 * appsJson.ts), so every group that existed before this function did keeps
 * its membership.
 */
export function paramGroupType(param: Pick<WidgetParam, "paramName" | "type" | "groupType">): string {
  if (param.groupType) return param.groupType;
  // The `date → "date"` rule of v5.1.0, generalised: two week pickers named
  // differently are the same kind of thing, as two day pickers were.
  return isPeriodType(param.type) ? param.type : param.paramName;
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
  card: Pick<DashboardCard, "params" | "bindings">,
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

export function groupsForCard(card: Pick<DashboardCard, "params" | "bindings">, groups: ParamGroup[] | undefined): ParamGroup[] {
  return liveBindings(card, groups).map((b) => b.group);
}

/** The group `paramName` is bound to on this card, if any. */
export function groupFor(
  card: Pick<DashboardCard, "params" | "bindings">,
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
  card: Pick<DashboardCard, "params" | "bindings">,
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
  // v5.4.0 (spec §4.3): a param its widget marks `groupable: false` is never
  // bound, even by a binding a saved dashboard already holds. WidgetCard
  // drops such a binding from the file once the widget is known; this keeps
  // every render before that write honest.
  const ungroupable = new Set(widget.params.filter((p) => p.groupable === false).map((p) => p.paramName));
  return new Set(
    liveBindings(card, groups)
      .map((b) => b.paramName)
      .filter((name) => !reservedPivotName(name) && declared.has(name) && !ungroupable.has(name)),
  );
}

/*
 * A `quarter` / `fiscal_year` group stores the label computed with a
 * DECEMBER year end, so one stored value means the same calendar span to
 * every member (design §5). A member reads it relabelled under its own year
 * end and writes it back relabelled to December; a member with no entry in
 * the map is December, as every param was before this map existed. Every
 * other type passes through untouched — relabel itself is the identity for
 * anything that is not a label, expressions included.
 */

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
  card: Pick<DashboardCard, "params" | "bindings">,
  groups: ParamGroup[] | undefined,
  widget: WidgetDef,
  groupsDisabled = false,
  fiscalYearEnd?: Record<string, number>,
): Record<string, string> {
  const bound = groupedParamNames(card, groups, widget, groupsDisabled);
  const out = Object.fromEntries(Object.entries(card.params).filter(([key])=>!reservedPivotName(key)));
  if (bound.size === 0) return out;
  // Over the KEYS, not the bound names: a bound `symbol` writes onto the
  // card's own `symbol` and onto `<form>.symbol` alike, so a form field joins
  // its group exactly as a top-level param does.
  for (const [key, name] of bindableKeys(widget)) {
    if (!bound.has(name)) continue;
    const group = groupFor(card, groups, name);
    if (!group) continue;
    // The map carries only the names takesFiscalYearEnd covers (useFiscalYearEnd
    // builds it for those types alone); any other name relabels 12 → 12.
    // v5.4.0: the map now covers date types too; relabel passes a date value through unchanged.
    out[key] = relabel(group.value, 12, fiscalYearEnd?.[name] ?? 12);
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
  card: Pick<DashboardCard, "params" | "bindings">,
  groups: ParamGroup[] | undefined,
  widget: WidgetDef,
  groupsDisabled = false,
  fiscalYearEnd?: Record<string, number>,
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
    if(reservedPivotName(name)||reservedPivotName(key))continue;
    if (!bound.has(name)) {
      cardParams[key] = value;
      continue;
    }
    const group = groupFor(card, groups, name);
    // Only the names takesFiscalYearEnd covers are in the map (useFiscalYearEnd);
    // any other name relabels 12 → 12, which is the identity.
    // v5.4.0: the map now covers date types too; relabel passes a date value through unchanged.
    const stored = relabel(value, fiscalYearEnd?.[name] ?? 12, 12);
    if (group && group.value !== stored && !groupEdits.some((e) => e.groupId === group.id)) {
      groupEdits.push({ groupId: group.id, value: stored });
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

/** Reserved model parameter names never become endpoint/form storage keys. */
export const reservedPivotName=(name:string)=>name.startsWith('pivot:');
