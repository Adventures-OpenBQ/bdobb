// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { instantWire, previewChartExpression, previewInstant, resolveRange, type ChartRange, type ChartWindow } from "../../../lib/chart/rangeExpr";
import { getHost, type RelativeContext } from "../../../host";
import type { ExchangeCalendar } from "../../../lib/tradingCalendar";

/**
 * Custom… (spec §4.3): From and To in the shared expression grammar, with
 * the resolved instants shown live -- "re-evaluated at every refresh" is what
 * storing the expression rather than the dates buys (user, 2026-09-26: the
 * line used to say "every open", which is not when the window is recomputed).
 */
/**
 * One end's reading, directly beneath its own field.
 *
 * `aria-describedby` rather than a bare sibling: a screen reader announcing
 * "From, now-1d" and stopping has told the user nothing about what that
 * means, which is the whole point of the line.
 *
 * In `fixed` mode the field already shows the resolved instant itself, so a
 * line repeating it underneath would be noise -- the combined line below
 * says where the window came from instead.
 */
function EndPreview({ id, end, text, fixed }: {
  id: string; end: "from" | "to"; text: string | null; fixed: boolean;
}) {
  if (fixed) return null;
  return (
    <p
      id={`${id}-preview`}
      data-testid={`range-preview-${end}`}
      className={text === null ? "chart-popover-field-error" : "chart-popover-field-preview"}
    >
      {text ?? "not a date"}
    </p>
  );
}

export function RangePopover({ range, calendar = null, window = {}, fixed = false, onApply, onClose }: {
  range?: ChartRange;
  /**
   * v12.3.0 (slice 4): the card's exchange calendar when the symbol has one,
   * so a literal date is that exchange's midnight and `T-1bd` counts its
   * holidays -- the SAME calendar the study anchors resolve on (the final
   * review's I1). None (crypto, forex, unclassified) means the viewer's zone
   * and no calendar production at all: `T-1bd`, `session_open` and `@open`
   * are refused here rather than answered off a stand-in table.
   */
  calendar?: ExchangeCalendar | null;
  /**
   * v12.4.0 (T9): the widget's own start/end instants -- the same
   * `anchorWindow` the renderer already builds for a panel's `xs`/`xe` and a
   * performance anchor -- so `S` and `E` preview here on the same window
   * they resolve on everywhere else on the card, rather than always
   * refusing for want of one.
   */
  window?: ChartWindow;
  /**
   * v12.4.0 (T9): true once the card's `start`/`end` PARAMETERS fix the
   * window (spec, Widget properties) -- the chips already read Custom then,
   * and this popover has nothing left to apply: both fields show the
   * effective window read-only instead of an editable expression.
   */
  fixed?: boolean;
  onApply: (range: ChartRange) => void;
  onClose: () => void;
}) {
  const { DatetimePicker } = getHost().components;
  const [typedFrom, setFrom] = useState(range?.from ?? "now-1d");
  const [typedTo, setTo] = useState(range?.to ?? "now");
  const id = useId();
  // v5's expression is `range | atom`, and its preset catalogue is written as ranges
  // (`today - 7d .. today`, `Q-3 .. Q0`): a range typed or pasted into From IS both
  // ends. `..` only -- the grammar's other separator, `/`, is not read here, so an
  // end is never split on something that merely looks like a path. While From holds
  // a range To shows its second half read-only; nothing of the user's own To is lost.
  const dots = typedFrom.indexOf("..");
  const halves = dots === -1 ? null : [typedFrom.slice(0, dots).trim(), typedFrom.slice(dots + 2).trim()];
  const spreading = halves !== null && halves[0] !== "" && halves[1] !== "";
  const from = spreading ? halves[0] : typedFrom;
  const to = spreading ? halves[1] : typedTo;
  // Per end, so each field can print its own reading underneath. Pairing them
  // into one line made a typo in From blank the reading under a good To.
  const fromPreview = useMemo(() => previewInstant(from, new Date(), calendar, window), [from, calendar, window]);
  const toPreview = useMemo(() => previewInstant(to, new Date(), calendar, window), [to, calendar, window]);
  // Two different questions, and Apply owes its answer to the second one:
  // `previewRange` only asks whether each end resolves, while `resolveRange`
  // -- what the zoom itself runs -- also refuses a reversed pair. Gating on
  // the preview let "now" to "now-1d" through to a setVisibleRange that
  // silently did nothing. The live line still comes from the preview, so a
  // reversed pair is shown resolved and refused by the error line below.
  const resolved = useMemo(() => resolveRange({ from, to }, new Date(), calendar, window), [from, to, calendar, window]);
  const apply = () => { if (resolved !== null) { onApply({ from, to }); onClose(); } };
  const onKey = (event: React.KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); apply(); } };
  // Read-only mode shows the effective window itself -- what the card's own
  // start/end resolve to -- rather than the expression that produced it:
  // there is nothing left to edit, so an expression here would only invite
  // a paste that Apply, itself gone in this mode, could never run.
  const displayFrom = fixed ? (window.start?.toISOString() ?? "") : typedFrom;
  const displayTo = fixed ? (window.end?.toISOString() ?? "") : to;
  // J closeout (2026-09-26, point 4; user: "Custom range dropdown has a display
  // bug"): the range box is a centred, dimmed MODAL <dialog> now, not an anchored
  // .chart-popover. The anchored version opened flush to its button mid-toolbar
  // and its left edge clipped over the card's legend and toolbar -- the bug the
  // user's screenshot showed. This follows exactly what the INTERVAL Custom… box
  // was converted to (IntervalPopover / J item 4): the app's shared
  // .modal-backdrop / .modal shell driven by showModal(), so the two Custom…
  // boxes now behave identically. Escape fires the native `cancel`, routed
  // through onClose so React's `rangeOpen` unmounts this rather than the element
  // closing behind React's back (the LayoutEditor pattern). The visible <h2> is
  // the dialog's aria-labelledby target.
  /**
   * The v5 picker's context, answering in the CHART's vocabulary: the same
   * `previewExpression("datetime", …)` call the reading under each field
   * already makes, so the picker's Relative tab and the dialog's own line can
   * never disagree about what an expression means here.
   *
   * `presets: []` with neither write: the dashboard's saved relative presets
   * live on the store, and this dialog is inside ArtsChartsRenderer, which is
   * prop-driven and never reads it. The tab then offers no saved chips and no
   * "Save as preset" -- everything else about it is the control a v5 datetime
   * parameter gets. Thread `presets` from WidgetCard if they are wanted here.
   */
  const relative: RelativeContext = useMemo(
    () => ({ preview: (expr) => previewChartExpression(expr, new Date(), calendar, window), presets: [] }),
    [calendar, window],
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  // `[]` deps: showModal() throws on an already-open dialog, and the fields
  // re-render this on every keystroke.
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const titleId = `${id}-title`;
  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <div className="modal chart-range-dialog">
      <h2 id={titleId}>Custom range</h2>
      <label htmlFor={`${id}-from`}>From</label>
      {/* The expression stays a text box and the v5 picker sits beside it (user,
          2026-09-26: "do the rangepopover picker"; "the grammar is supposed to be
          consistent"). The picker is the SAME `DatetimePicker` a v5 `datetime`
          parameter renders -- trigger, segmented field and calendar on its
          Absolute tab, the anchor-and-offset editor on its Relative tab -- over
          the same resolver, so the chart stops being the one place in the app
          where a date expression is typed blind.
          Two `datetime` ends, not a `date_range`: the v5 range control is dates
          only (v5.2.0 period-pickers design) and this window is to the second.
          The box is kept rather than replaced because it is the only thing a
          pasted RANGE (`today-7d .. today`) can be dropped into, which is the
          split below and has no v5 equivalent. */}
      <span className="chart-range-field">
        <input
          id={`${id}-from`} value={displayFrom} readOnly={fixed}
          aria-describedby={fixed ? undefined : `${id}-from-preview`}
          onChange={(e) => setFrom(e.target.value)} onKeyDown={onKey} spellCheck={false}
        />
        {fixed ? null : (
          <DatetimePicker
            label="Pick From" granularity="minute"
            value={instantWire(from, new Date(), calendar, window)}
            stored={typedFrom}
            onChange={setFrom}
            relative={relative}
          />
        )}
      </span>
      <EndPreview id={`${id}-from`} end="from" text={fromPreview} fixed={fixed} />
      <label htmlFor={`${id}-to`}>To</label>
      <span className="chart-range-field">
        <input
          id={`${id}-to`} value={displayTo} readOnly={fixed || spreading}
          aria-describedby={fixed ? undefined : `${id}-to-preview`}
          onChange={(e) => setTo(e.target.value)} onKeyDown={onKey} spellCheck={false}
        />
        {/* No picker while From holds a whole range: To is that range's second
            half and read-only, so a control that wrote to it would be writing
            into a field the user cannot edit either. */}
        {fixed || spreading ? null : (
          <DatetimePicker
            label="Pick To" granularity="minute"
            value={instantWire(to, new Date(), calendar, window)}
            stored={typedTo}
            onChange={setTo}
            relative={relative}
          />
        )}
      </span>
      <EndPreview id={`${id}-to`} end="to" text={toPreview} fixed={fixed} />
      {/* What is left for the combined line: only what is true of the PAIR.
          Each end's own reading is already under its own field, so a reversed
          range is the one thing this can still say that they cannot. */}
      {fixed
        ? <p className="chart-popover-preview">set by the card's start/end</p>
        : resolved === null
          ? <p className="chart-popover-error">
              {fromPreview !== null && toPreview !== null
                ? "From must come before To."
                : "Not a date: each end is an expression (now-5d, T-1mo, session_open, Q-1) or an ISO date; From also takes a range (today-7d .. today)."}
            </p>
          : <p className="chart-popover-preview">Re-evaluated at every refresh.</p>}
      <div className="chart-popover-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        {fixed ? null : <button type="button" disabled={resolved === null} onClick={apply}>Apply</button>}
      </div>
      </div>
    </dialog>
  );
}
