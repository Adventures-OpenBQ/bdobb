// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { CardView } from "../lib/types";

export type ViewMode = { value: CardView | undefined; label: string };

/**
 * One dropdown over the card's single `view` field, rather than independent
 * toggles — the field is single-valued, so independent toggles could express
 * states it cannot hold. A native select, styled as a header action: it costs
 * one control's width however many modes a card offers.
 *
 * The first mode always carries `value: undefined`, meaning "the card's
 * default rendering". Selecting it CLEARS `view` rather than writing a
 * literal, so a dashboard file gains no key it does not need — and so a
 * markdown or pdf card never ends up persisted as `view: "table"`. The
 * option value for it is "", the only string no CardView uses.
 *
 * `current` can name a mode the list does not offer — a transposed card whose
 * data came back empty, or a persisted `view: "chart"` whose rows lost their
 * time column. A controlled select whose value matches no option silently
 * displays option 0, so the card would claim "Table" while showing something
 * else, and choosing Table would fire no change event at all: the view could
 * never be cleared. One extra disabled option for that value keeps the display
 * honest and makes Table a real change.
 */
export function ViewToggle({
  modes,
  current,
  onSelect,
}: {
  modes: ViewMode[];
  current: CardView | undefined;
  onSelect: (v: CardView | undefined) => void;
}) {
  const unlisted = current !== undefined && !modes.some((m) => m.value === current);
  return (
    <select
      className="card-action view-select"
      aria-label="View"
      value={current ?? ""}
      onChange={(e) => onSelect(e.target.value === "" ? undefined : (e.target.value as CardView))}
    >
      {modes.map((m) => (
        <option key={m.label} value={m.value ?? ""}>
          {m.label}
        </option>
      ))}
      {unlisted ? (
        <option value={current} disabled>
          {current[0].toUpperCase() + current.slice(1)}
        </option>
      ) : null}
    </select>
  );
}
