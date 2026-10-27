// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

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
 */
export function GroupMenu({ offered, numberOf, boundGroupId, onCreate, onJoin, onLeave }: Props) {
  return (
    <div role="menu" aria-label="Groups" className="group-menu">
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
    </div>
  );
}
