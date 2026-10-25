// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { logError } from "../lib/logger";
import { compatibleGroups, groupFor, paramGroupType } from "../lib/paramGroups";
import { relabel } from "../lib/periods";
import { groupValueLabel } from "../lib/statementFiscal";
import type { DashboardCard, ParamGroup, WidgetParam } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { MenuPanel } from "./RowContextMenu";

type Props = {
  card: DashboardCard;
  param: Pick<WidgetParam, "paramName" | "type" | "groupType" | "label">;
  groups: ParamGroup[] | undefined;
  groupsDisabled: boolean;
  /** The control's current display value; a new group starts from it. */
  value: string;
  /**
   * This control's resolved year-end month, for a quarter / fiscal-year
   * param. A new group stores the December label (paramGroups.ts), so the
   * value shown under, say, September has to be relabelled on the way in.
   */
  fiscalYearEnd?: number;
};

/**
 * The join/leave affordance beside one control. A chain-link while the param
 * is local; the group's number once it is bound, so a sighted user sees which
 * controls move together and a screen reader hears that an edit is shared.
 *
 * Owns the menu's open state and the store calls, and nothing else: what a
 * control shows and when it commits is ParamControls' business.
 */
export function GroupLink({ card, param, groups, groupsDisabled, value, fiscalYearEnd }: Props) {
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
      <button
        type="button"
        className={bound ? "param-badge param-link" : "param-link"}
        aria-label={bound ? `Group ${numberOf(bound)}: ${bound.name} — shared across grouped cards` : `Group ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!bound && groupsDisabled}
        title={
          bound
            ? `${bound.name} — shared across grouped cards`
            : groupsDisabled
              ? "Grouping is off for this dashboard"
              : `Group ${label}`
        }
        onClick={(e) => {
          setAnchor(e.currentTarget);
          setOpen((v) => !v);
        }}
      >
        {/* U+FE0E pins the text presentation: the bare chain link renders
            as a colour emoji on some platforms and as a glyph on others. */}
        {bound ? numberOf(bound) : "⛓︎"}
      </button>
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
          {/* Checkbox rows, not radios: a param is in one group or none, and
              the row that is checked is the one to uncheck to leave — a radio
              group has no "none" to return to. The MenuPanel supplies the menu
              itself (focus, arrow keys, Escape) and is portalled into <body>,
              `position: fixed` under the trigger, so the card's
              `overflow: hidden` cannot cut it off. Every caller is a card,
              never a `showModal()` dialog, whose inert <body> would make the
              portal unclickable. */}
          <div className="group-menu-title">Groups</div>
          {/* aria-label pins the accessible name to "New group" independent of
              the "+" glyph, the same reason the checkbox rows below name
              themselves explicitly. */}
          <button
            type="button"
            role="menuitem"
            aria-label="New group"
            // `fiscalYearEnd` is set only for a quarter / fiscal_year param
            // (useFiscalYearEnd builds its map for those types alone), so any
            // other param relabels 12 → 12, which is the identity.
            // v5.4.0: the map now covers date types too; relabel passes a date value through unchanged.
            onClick={() =>
              run("create a group", createGroup(card.id, param.paramName, groupType, relabel(value, fiscalYearEnd ?? 12, 12)))
            }
          >
            {"+ New group"}
          </button>
          {/* The group this control is already in is always listed, even when
              its type no longer matches (a legacy file's `selected_date` group
              is typed by its name, while the control infers `date`): the
              checked row is the only way to leave. */}
          {(bound && !offerable.some((g) => g.id === bound.id) ? [bound, ...offerable] : offerable).map((g) => {
            const checked = g.id === bound?.id;
            return (
              <button
                key={g.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                // Named explicitly so the number, name and value read as one
                // phrase whatever the badge markup does to the text content.
                aria-label={`${numberOf(g)} ${g.name} · ${groupValueLabel(g)}`}
                // Leaving is the mirror of New group: the group holds the
                // December label, and leaving keeps what this control was
                // showing under its own year end. relabel passes an expression
                // such as `T-1q` through untouched.
                onClick={() =>
                  checked
                    ? run("leave a group", leaveGroup(card.id, param.paramName, bound && relabel(bound.value, 12, fiscalYearEnd ?? 12)))
                    : run("join a group", joinGroup(g.id, card.id, param.paramName))
                }
              >
                <span className="param-badge">{numberOf(g)}</span> {`${g.name} · ${groupValueLabel(g)}`}
              </button>
            );
          })}
        </MenuPanel>
      ) : null}
    </span>
  );
}
