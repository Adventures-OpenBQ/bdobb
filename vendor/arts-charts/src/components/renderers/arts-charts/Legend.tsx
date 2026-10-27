// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { Fragment, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Candle } from "../../../hooks/useTickCache";
import { formatClock, formatDelta, formatPrice, formatVolume } from "../../../lib/chart/formats";

/**
 * One reading in the legend: a study's value at the crosshair's bar, or a
 * performance line's. `panel` (v12.4.0) is the 1-based panel it is drawn in;
 * the row groups by it, so a reader can tell RSI's 62 in panel 2 from a
 * study overlaid on price.
 */
/**
 * `key` (2026-09-26) is the study INSTANCE the reading belongs to, so the
 * legend can join a multi-output study's lines (Bollinger, Keltner -- three
 * lines each) under one label instead of repeating the label per line. It is
 * the matched card series' id where there is one (unique per instance on a
 * card), falling back to the matched expression and then the line's own label.
 * Two lines of one study share it; two different studies never do.
 */
export type LegendStudy = { key: string; label: string; color: string; value: number | null; panel: number };
export type LegendValues = { bar: Candle | null; decimals: number; studies: LegendStudy[] };
export type LegendSink = (values: LegendValues) => void;

const EMPTY: LegendValues = { bar: null, decimals: 2, studies: [] };
const OHLC = ["open", "high", "low", "close"] as const;

/**
 * The crosshair-synced legend (spec §6): timeframe @ time, then O H L C,
 * the delta chip, Vol, and one value per study in its colour. The ticker
 * and the "values follow the crosshair" hint left the row on 2026-09-24
 * (user ruling, A5): the symbol block beside the row already names the
 * ticker, and the hint spent the row's width on a sentence.
 *
 * The renderer does not pass these as props. A crosshair move fires on
 * every pixel the pointer travels, and a prop change would re-render the
 * component that HOLDS the chart on each one -- the reason the old legend
 * was a DOM write. Instead the renderer owns a ref and this component puts
 * its own setState into it on mount; the crosshair handler calls
 * `sink.current?.(values)` and only this small component re-renders.
 * `decimals` travels with the values because the renderer knows the visible
 * price range and the legend does not.
 */
export function Legend({
  interval, intervalSeconds, sink, timeZone, studyValues = true,
}: {
  interval: string;
  intervalSeconds: number;
  sink: MutableRefObject<LegendSink | null>;
  /**
   * "Display study values" (user, 2026-09-27): false drops the crosshair
   * READOUT line -- the one that changes as the pointer moves -- and keeps the
   * OHLC row above it. A flag rather than unmounting Legend, because Legend
   * owns the crosshair sink both rows are fed through.
   */
  studyValues?: boolean;
  /** The clock's zone; none means the viewer's, which is what the axis shows. */
  timeZone?: string;
}) {
  const [values, setValues] = useState<LegendValues>(EMPTY);
  useEffect(() => {
    sink.current = setValues;
    return () => { sink.current = null; };
  }, [sink]);

  const { bar, decimals, studies } = values;
  /**
   * The row's SHAPE is held constant while the crosshair moves (user report
   * 2026-09-25: "the chart jitters at the top").
   *
   * `.chart-legend` is `flex-wrap: wrap`, so the row's height is however many
   * lines its content needs. The content used to vanish entirely between bars:
   * off a bar the sink sends `bar: null` and an empty `studies`, so the row
   * collapsed to the single interval span, and over a bar it grew back to
   * O/H/L/C + delta + Vol + every study. One line became two and back on every
   * crosshair move, and `.chart-top` is a grid whose row height follows this
   * content -- so the plot underneath was shoved up and down. That is the
   * jitter.
   *
   * So the spans are always rendered, with an em-dash where there is no
   * reading -- the same dash a warm-up gap already shows. The study LABELS
   * only ever arrive with a reading, so the last non-empty set is kept as the
   * row's shape and redrawn with empty values; a ref rather than state because
   * it is a cache of what was already rendered, not an input that should
   * itself cause a render.
   */
  const shape = useRef<LegendStudy[]>([]);
  /**
   * The widest string each study's value has shown, in characters, keyed by
   * panel+label+position. It only ever GROWS.
   *
   * Why per-study rather than one global slot: a single `min-width` has to fit
   * the widest value on the card, so `RSI 32.89` (5 chars) sat in a box sized
   * for `83,926.63` (9) and left five characters of dead space after it. The
   * user read that as a wrap gap, twice -- between RSI and MACD, and before
   * each `/` in a band (2026-09-26). A per-study slot is tight for small
   * studies and wide only where the data is wide.
   *
   * Why it only grows: shrinking it when a narrower value arrives is precisely
   * the re-wrapping this mechanism exists to stop. It widens once when a study
   * crosses a magnitude (999.99 -> 1000.00) and then holds, which is a real
   * one-off reflow rather than per-crosshair-move jitter.
   */
  const widest = useRef<Map<string, number>>(new Map());
  /**
   * The same only-grows rule for the OHLCV READINGS' slots (2026-09-30, user:
   * "why is the crosshair value line so padded that it wraps"). They used to
   * carry fixed CSS min-widths sized for a six-figure BTC price -- 13ch per
   * OHLC slot, 22ch for the delta -- so a three-figure stock like MSFT
   * ("O 507.21", 8ch) sat in boxes half empty and the row wrapped between the
   * symbol block and the price. Each slot is now sized from the widest text it
   * has shown on THIS card, half a character above it, and never shrinks: the
   * no-jitter guarantee those fixed widths bought (see styles.css) holds,
   * because a narrower value, or the dash off a bar, keeps the width. The four
   * OHLC readings share one slot so their columns stay aligned.
   */
  const slots = useRef<Map<string, number>>(new Map());
  const slotWidth = (slot: string, text: string) => {
    const ch = Math.max(slots.current.get(slot) ?? 0, text.length + 0.5);
    slots.current.set(slot, ch);
    return { minWidth: `${ch}ch` };
  };
  if (studies.length > 0) shape.current = studies;
  const readings: LegendStudy[] = studies.length > 0
    ? studies
    : shape.current.map((study) => ({ ...study, value: null }));
  // The readings grouped by study INSTANCE (2026-09-26, user: "if a series has
  // three values like bollinger and Keltner display the three values together
  // instead of repeating the study description"). A multi-output study draws
  // several lines that all carry the same `key`; the renderer hands them over
  // in panel-then-series order, so one instance's lines are consecutive and a
  // running compare on `key` collects them. Panel labels (`P<n>`) were dropped
  // by user ruling 2026-09-24 (A4) as redundant with the series strip's chips.
  // Grouping was by panel until this; the change is what turns three
  // "BBANDS(20, 2)" rows into one "BBANDS(20, 2) v / v / v".
  const groups: { key: string; entries: LegendStudy[] }[] = [];
  for (const study of readings) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === study.key) last.entries.push(study);
    else groups.push({ key: study.key, entries: [study] });
  }
  const delta = bar === null ? null
    : formatDelta(bar.close - bar.open, bar.open === 0 ? 0 : ((bar.close - bar.open) / bar.open) * 100, decimals);
  // Each reading's text, computed once so the slot is sized from exactly what
  // it shows (label, space and value -- the whole span's content).
  const when = `${interval}${bar === null ? "" : ` @ ${formatClock(bar.time, intervalSeconds, timeZone)}`}`;
  const prices = OHLC.map((key) => (bar === null ? "—" : formatPrice(bar[key], decimals)));
  const ohlcWidth = slotWidth("ohlc", `O ${prices.reduce((a, b) => (b.length > a.length ? b : a))}`);
  const deltaText = delta === null ? "—" : delta.text;
  const volume = bar === null ? "—" : formatVolume(bar.volume);
  return (
    // Two stacked rows (user report 2026-09-25, "study values should be their
    // own line between the OHLCV labels and the Series pills"): the OHLCV
    // readings on the first, the study values on the second. `.chart-legend`
    // is a column so each row wraps INSIDE itself and neither ever runs into
    // the other. The studies row is omitted -- not merely emptied -- when the
    // card carries no studies, so it takes no height; adding a study is a user
    // action that may add the line, which is fine (it is not crosshair motion,
    // the thing `shape` exists to keep still).
    <div className="chart-legend" data-testid="chart-legend">
      <div className="chart-legend-readings">
        <span className="chart-legend-value chart-legend-when" style={slotWidth("when", when)}>{when}</span>
        {/* Always rendered, dashed when there is no bar under the crosshair: the
            row must not change line count as the pointer moves (see `shape`). */}
        {OHLC.map((key, i) => (
          <span key={key} className="chart-legend-value chart-legend-ohlc" style={ohlcWidth}>
            <span className="chart-legend-label">{key[0].toUpperCase()}</span>{" "}
            {prices[i]}
          </span>
        ))}
        <span className="chart-legend-value chart-delta" data-direction={delta === null ? "flat" : delta.direction} style={slotWidth("delta", deltaText)}>{deltaText}</span>
        <span className="chart-legend-value chart-legend-volume" style={slotWidth("volume", `Vol ${volume}`)}>
          <span className="chart-legend-label">Vol</span>{" "}
          {volume}
        </span>
      </div>
      {groups.length === 0 || !studyValues ? null : (
        <div className="chart-legend-studies">
          {groups.map((group, g) => (
            // One study instance: its label ONCE, then its value(s). A
            // single-output study reads "SMA(200) 336.91"; a three-output band
            // reads "BBANDS(20, 2) 338.63 / 338.29 / 337.96", each value in its
            // own line colour (the only thing tying a number to its line) with
            // the separators neutral. Index in the key because a label can
            // repeat across two instances of the same study on one card.
            <span key={`${group.key}-${g}`} className="chart-legend-value chart-legend-group">
              <span className="chart-legend-label">{group.entries[0].label}</span>{" "}
              {group.entries.map((study, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="chart-legend-sep"> / </span>}
                  {/* A null is a warm-up gap or an undefined value, shown as a
                      dash rather than a zero -- the same reading the plot gives
                      it by leaving the point out. A band with no bar under the
                      crosshair therefore reads "— / — / —", which also keeps
                      the group's width (three fixed slots) constant. */}
                  {(() => {
                    const shown = study.value === null ? "—" : formatPrice(study.value, decimals);
                    // Keyed by the group KEY plus position, not the label alone: one card
                    // can carry the same study on two panels, and a multi-output study
                    // repeats its label across its own outputs.
                    const slot = `${group.key}:${study.label}:${i}`;
                    const ch = Math.max(widest.current.get(slot) ?? 0, shown.length);
                    widest.current.set(slot, ch);
                    return (
                      <span className="chart-legend-num" style={{ color: study.color, minWidth: `${ch}ch` }}>{shown}</span>
                    );
                  })()}
                </Fragment>
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
