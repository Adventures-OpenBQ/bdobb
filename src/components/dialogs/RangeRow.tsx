// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";

/**
 * A slider that shows every tick but saves only on release.
 *
 * Its own component purely because of that split: React maps `onChange` onto
 * the native `input` event, which fires on every pixel of a drag, so the
 * commit has to hang off a real `change` listener attached through a ref --
 * and that needs a mount-scoped effect. `onCommit` is mirrored into a ref so
 * the listener is added once and still never sees a stale closure.
 *
 * `unit` and `step` carry the two things that differ between its callers: the
 * layout sliders count pixels one at a time, the Rita open delay counts
 * milliseconds in coarser jumps. Everything else about them is identical,
 * which is why this is one component and not two.
 */
export function RangeRow({
  label,
  description,
  min,
  max,
  value,
  onCommit,
  unit = "px",
  step = 1,
}: {
  label: string;
  description?: string;
  min: number;
  max: number;
  value: number;
  onCommit: (n: number) => void;
  unit?: string;
  step?: number;
}) {
  const inputId = `range-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    // el.value, not the event's own: a range input has already sanitized it
    // against min/max by the time this fires, so what commits is a number
    // the loader's clamp would leave alone.
    const onChangeEvent = () => commitRef.current(Number(el.value));
    el.addEventListener("change", onChangeEvent);
    return () => el.removeEventListener("change", onChangeEvent);
  }, []);

  return (
    <div className="bd-row">
      <div className="bd-row-copy">
        <label htmlFor={inputId}>{label}</label>
        {description !== undefined ? <p className="bd-muted">{description}</p> : null}
      </div>
      <div className="bd-field">
        <output htmlFor={inputId} className="bd-muted">
          {draft} {unit}
        </output>
        <input
          id={inputId}
          ref={inputRef}
          type="range"
          min={min}
          max={max}
          step={step}
          value={draft}
          aria-label={label}
          onChange={(e) => setDraft(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
