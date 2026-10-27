// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { intervalLabel, parseIntervalDuration } from "../../../lib/chart/intervalLabel";

/**
 * Custom… for the interval (spec 2026-09-25, G8/G9), built on the same shape
 * as RangePopover: one field, the resolved duration shown live beneath it,
 * and a refusal line that disables Apply. The field speaks the app's date
 * grammar (`90min`, `4h`, `2d` -- `min` is minutes, `m` is months), and Apply
 * writes the WIRE string the backend expects (`90m`), so nothing downstream
 * learns a second grammar (G6).
 *
 * It prefills from the current interval's grammar label (intervalLabel), so
 * opening the box on a `5m` chip shows `5min` and applying unchanged is a
 * round-trip, not a surprise edit.
 */
export function IntervalPopover({ interval, onApply, onClose }: {
  interval: string;
  onApply: (wire: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(() => intervalLabel(interval));
  const id = useId();
  const parsed = useMemo(() => parseIntervalDuration(typed), [typed]);
  const valid = !("error" in parsed);
  const apply = () => { if (valid) { onApply(parsed.wire); onClose(); } };
  const onKey = (event: React.KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); apply(); } };
  // The reference's result-card dialog (spec 2026-09-25, J12): a title + prose,
  // a labelled expression field, a computed-interval card, a help line, example
  // chips and a resolution-context disclosure.
  //
  // J closeout (2026-09-26, item 4; whole dialog audit finding #1): this is now
  // a real centred, dimmed MODAL, not an anchored popover. The reference CSS
  // declares `#interval-dialog` as an actual <dialog>, so the reference is a
  // modal by construction. It uses the app's shared `.modal-backdrop` / `.modal`
  // idiom with showModal(), following LayoutEditor.tsx rather than inventing a
  // second mechanism; ChartControls dropped the <Popover> host that used to wrap
  // this and now mounts it directly while `intervalOpen`. The visible <h2>
  // (added by Task 7) is the dialog's aria-labelledby target, so the title names
  // the dialog instead of a Popover's aria-label repeating it.
  //
  // A free bonus (item 4): while this modal is open the toolbar's own `1h`
  // button (and any other example chip that shares an interval chip's name) goes
  // inert, so the `1h` example chip and the toolbar `1h` are no longer exposed
  // at the same time -- the accessible-name collision that existed while the
  // anchored popover left the toolbar live. (Native inertness; jsdom does not
  // model it, so no unit test observes it, but it holds in every real browser.)
  const dialogRef = useRef<HTMLDialogElement>(null);
  // `[]` deps: showModal() throws if called on an already-open dialog, and the
  // field re-renders this on every keystroke.
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const titleId = `${id}-title`;
  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby={titleId}
      // Escape fires the native `cancel` on a modal <dialog>; route it through
      // onClose so React's `intervalOpen` unmounts this, rather than the element
      // closing behind React's back (the LayoutEditor pattern).
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <div className="modal chart-interval-dialog">
      <h2 id={titleId} className="chart-interval-title">Custom interval</h2>
      <p className="chart-interval-prose">Enter a duration in your date language. The elapsed time becomes the chart interval.</p>
      <label className="chart-interval-label" htmlFor={`${id}-iv`}>Interval expression</label>
      <input
        id={`${id}-iv`} className="chart-interval-input" value={typed}
        aria-describedby={`${id}-preview ${id}-help`}
        aria-invalid={valid ? undefined : "true"}
        onChange={(e) => setTyped(e.target.value)} onKeyDown={onKey} spellCheck={false}
      />
      {/* Single-duration examples only (spec 2026-09-25, J12): the reference's
          two-endpoint chips (now-90min/now, T@open/T@close) and its sum form
          (1h+30min) belong to the start/end expression G5 refuses -- "an
          interval is a length, not a range" -- and the parser rejects both a
          `/`..`..` range and a multi-offset sum, so shipping them as chips
          would only fill the field with something Use interval then disables.
          A surfaced conflict (spec J, conflict 1), not shipped here. */}
      <div className="chart-interval-examples">
        {["2min", "1h", "4h", "2d"].map((ex) => (
          <button key={ex} type="button" onClick={() => setTyped(ex)}>{ex}</button>
        ))}
      </div>
      <p id={`${id}-help`} className="chart-interval-help">min = minutes; m / mo = months. A single duration; 1w and 1mo (or 1M) are the weekly and monthly bars, served by the provider, not bucketed.</p>
      {/* The live reading, in the reference's card: the resolved duration when
          it is one, the parser's own refusal otherwise. The refusal text is the
          parser's verbatim -- `5m` reads as five MONTHS and names the `5min`
          spelling the user likely meant, so the box never substitutes wording
          that could hide a month/minute mix-up. The preview element carries the
          field's aria hook and the test's testid in BOTH states so neither
          moves; only the class and text change. */}
      <div className="chart-interval-result">
        <span className="chart-interval-result-label">Computed interval</span>
        <strong
          id={`${id}-preview`}
          data-testid="interval-preview"
          className={valid ? "chart-interval-result-value" : "chart-popover-field-error"}
        >
          {valid ? parsed.label : parsed.error}
        </strong>
        {valid && <code className="chart-interval-result-wire">{parsed.wire}</code>}
      </div>
      <details className="chart-interval-context">
        <summary>Resolution context &amp; preview limits</summary>
        <p>The interval is sent to the backend as its wire value ({valid ? parsed.wire : "—"}). A duration the tick store cannot bucket is served from the provider or refused; the chart keeps its last bars if the backend declines it.</p>
      </details>
      <div className="chart-popover-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" disabled={!valid} onClick={apply}>Use interval</button>
      </div>
      </div>
    </dialog>
  );
}
