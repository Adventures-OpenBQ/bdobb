// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export type PeriodCell = {
  key: number;
  text: string;
  ariaLabel: string;
  selected: boolean;
  /** Greyed: a neighbour of the page shown, one click away rather than a page turn. */
  outside?: boolean;
  /** v5.4.0: not pickable at all — a quarter range's end before its start. */
  disabled?: boolean;
  pick: () => void;
};

/**
 * The `◀ heading ▶` header and the grid of cell buttons the quarter and
 * fiscal-year popovers share. Each picker supplies its heading, its step and
 * its cells; a cell's `pick` commits and closes.
 */
export function PeriodGrid({
  heading,
  prevLabel,
  nextLabel,
  onStep,
  gridClass,
  cells,
}: {
  heading: string;
  prevLabel: string;
  nextLabel: string;
  onStep: (dir: -1 | 1) => void;
  gridClass: string;
  cells: PeriodCell[];
}) {
  return (
    <>
      <div className="picker-header">
        <button type="button" aria-label={prevLabel} onClick={() => onStep(-1)}>
          ◀
        </button>
        <span className="picker-heading">{heading}</span>
        <button type="button" aria-label={nextLabel} onClick={() => onStep(1)}>
          ▶
        </button>
      </div>
      <div className={`picker-grid ${gridClass}`}>
        {cells.map((c) => (
          <button
            key={c.key}
            type="button"
            className={c.outside ? "picker-outside" : undefined}
            aria-label={c.ariaLabel}
            aria-pressed={c.selected}
            data-selected={c.selected || undefined}
            onClick={c.pick}
            disabled={c.disabled}
          >
            {c.text}
          </button>
        ))}
      </div>
    </>
  );
}
