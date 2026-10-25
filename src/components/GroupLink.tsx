// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { logError } from "../lib/logger";
import { compatibleGroups, groupFor, paramGroupType } from "../lib/paramGroups";
import type { DashboardCard, ParamGroup, WidgetParam } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { GroupMenu } from "./GroupMenu";
import { MenuPanel } from "./RowContextMenu";

type Props = {
  card: DashboardCard;
  param: Pick<WidgetParam, "paramName" | "type" | "groupType" | "label">;
  groups: ParamGroup[] | undefined;
  groupsDisabled: boolean;
  /** The control's current display value; a new group starts from it. */
  value: string;
};

/**
 * The join/leave affordance beside one control. A chain-link while the param
 * is local; the group's number once it is bound, so a sighted user sees which
 * controls move together and a screen reader hears that an edit is shared.
 *
 * Owns the menu's open state and the store calls, and nothing else: what a
 * control shows and when it commits is ParamControls' business.
 */
export function GroupLink({ card, param, groups, groupsDisabled, value }: Props) {
  const createGroup = useDashboardStore((s) => s.createGroup);
  const joinGroup = useDashboardStore((s) => s.joinGroup);
  const leaveGroup = useDashboardStore((s) => s.leaveGroup);
  const [open, setOpen] = useState(false);
  /**
   * The button that opened the menu -- the chain-link, or the badge once the
   * param is bound -- which the menu hangs under and hands focus back to.
   * Escape, an outside press and the arrow keys are MenuPanel's, the contract
   * every menu in the app shares; its Escape listener is on window in the
   * capture phase and stops the press there, so a maximized card's restore
   * listener, registered before this menu opened, never sees it. One press,
   * one thing; the next one restores.
   */
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  /** Undefined while the menu is closed -- the `?.` never measures. */
  const rect = open ? anchor?.getBoundingClientRect() : undefined;

  const bound = groupsDisabled ? undefined : groupFor(card, groups, param.paramName);
  const all = groups ?? [];
  const numberOf = (g: ParamGroup) => all.findIndex((x) => x.id === g.id) + 1;
  const label = param.label ?? param.paramName;
  const groupType = paramGroupType(param);

  /**
   * The groups of this type, minus any this card already holds through
   * ANOTHER of its controls. A group carries one value, so two controls of
   * one card in it would only ever show that value twice — and both
   * deleteGroup and apps.json treat a card's binding to a group as singular.
   * The group this control is itself in is never filtered out by that test,
   * so leaving still works.
   */
  const offerable = compatibleGroups(groups, groupType).filter(
    (g) => !card.bindings?.some((b) => b.groupId === g.id && b.paramName !== param.paramName),
  );

  const run = (what: string, p: Promise<unknown>) => {
    setOpen(false);
    void p.catch((err) => logError(`failed to ${what} for card ${card.id}: ${err}`));
  };

  return (
    <span className="param-link-wrap">
      {bound ? (
        <button
          type="button"
          className="param-badge param-link"
          aria-label={`Group ${numberOf(bound)}: ${bound.name} — shared across grouped cards`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${bound.name} — shared across grouped cards`}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            setOpen((v) => !v);
          }}
        >
          {numberOf(bound)}
        </button>
      ) : (
        <button
          type="button"
          className="param-link"
          aria-label={`Group ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={groupsDisabled}
          title={groupsDisabled ? "Grouping is off for this dashboard" : `Group ${label}`}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            setOpen((v) => !v);
          }}
        >
          {/* U+FE0E pins the text presentation: the bare chain link renders
              as a colour emoji on some platforms and as a glyph on others. */}
          {"⛓︎"}
        </button>
      )}
      {rect ? (
        <MenuPanel
          className="group-menu"
          aria-label="Groups"
          x={rect.left}
          y={rect.bottom}
          portal
          anchor={anchor}
          returnFocusTo={anchor}
          onClose={() => setOpen(false)}
        >
          <GroupMenu
            // The group this control is already in is always listed, even when
            // its type no longer matches (a legacy file's `selected_date` group
            // is typed by its name, while the control infers `date`): the
            // checked row is the only way to leave.
            offered={
              bound && !offerable.some((g) => g.id === bound.id) ? [bound, ...offerable] : offerable
            }
            numberOf={numberOf}
            boundGroupId={bound?.id}
            onCreate={() => run("create a group", createGroup(card.id, param.paramName, groupType, value))}
            onJoin={(id) => run("join a group", joinGroup(id, card.id, param.paramName))}
            onLeave={() => run("leave a group", leaveGroup(card.id, param.paramName))}
          />
        </MenuPanel>
      ) : null}
    </span>
  );
}
