// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ParamGroup } from "../lib/types";

type Props = {
  /** Every group of the control's type, in dashboard order. */
  offered: ParamGroup[];
  /** The 1-based dashboard position of each offered group, keyed by id — the badge number. */
  numberOf: (group: ParamGroup) => number;
  boundGroupId: string | undefined;
  onCreate: () => void;
  onJoin: (groupId: string) => void;
  onLeave: () => void;
};

/**
 * The list under a control's chain-link. Purely presentational: the parent
 * decides what is offered and owns the store calls, so the menu tests as
 * markup and the link tests as behaviour.
 *
 * Checkbox rows, not radios: a param is in one group or none, and the row
 * that is checked is the one to uncheck to leave — a radio group has no
 * "none" to return to.
 *
 * The rows only: GroupLink renders them inside a MenuPanel, which supplies
 * the menu itself — the first item taking focus when the menu opens,
 * ArrowDown/ArrowUp moving between items, wrapping, and focus back on the
 * trigger on Escape. The panel is portalled into <body>, `position: fixed`
 * under the trigger: in the card's tree the card's `overflow: hidden` cut the
 * menu off at the card's edge, so on a short card the groups past the first
 * row or two could not be reached. Every caller is a card, never a
 * `showModal()` dialog, whose inert <body> would make the portal unclickable.
 */
export function GroupMenu({ offered, numberOf, boundGroupId, onCreate, onJoin, onLeave }: Props) {
  return (
    <>
      <div className="group-menu-title">Groups</div>
      {/* aria-label pins the accessible name to "New group" independent of
          the "+" glyph, the same reason the checkbox rows below name
          themselves explicitly. */}
      <button type="button" role="menuitem" aria-label="New group" onClick={onCreate}>
        {"+ New group"}
      </button>
      {offered.map((g) => {
        const checked = g.id === boundGroupId;
        return (
          <button
            key={g.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            // Named explicitly so the number, name and value read as one
            // phrase whatever the badge markup does to the text content.
            aria-label={`${numberOf(g)} ${g.name} · ${g.value}`}
            onClick={() => (checked ? onLeave() : onJoin(g.id))}
          >
            <span className="param-badge">{numberOf(g)}</span> {`${g.name} · ${g.value}`}
          </button>
        );
      })}
    </>
  );
}
