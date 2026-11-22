// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import type { RangePalette } from "../../lib/tableColumns";

/**
 * The gradient each palette paints across the track.
 *
 * The two differ deliberately: a row carries a day range and a 52-week range
 * side by side, and at a glance two identically coloured bars read as one
 * repeated column. Red-yellow-green for the 52-week band, blue-white-orange
 * for the day.
 */
const PALETTES: Record<RangePalette, string> = {
  week52: "rgba(239,83,80,0.55) 0%, rgba(255,193,7,0.55) 50%, rgba(38,166,154,0.55) 100%",
  day: "rgba(66,133,244,0.55) 0%, rgba(200,200,200,0.35) 50%, rgba(255,152,0,0.60) 100%",
};

// A signed meter with no explicit min/max saturates at +/-100bp, the
// prototype's AVWAP_DEV_MAX. A full-width bar therefore means "at least 100bp
// off the anchor", which is the scale a trader reads a VWAP deviation
// against -- 1% is already a meaningful anchored-VWAP move.
// ponytail: fixed default, not auto-scaled to the row's own history --
// pass min/max on the column if a symbol legitimately drifts further.
const DEFAULT_SIGNED_SCALE = 0.01;

/** Above the origin and below it. Teal and red, the candle colours. */
const SIGNED_UP = "#26a69a";
const SIGNED_DOWN = "#ef5350";

/**
 * The diverging heat an unsigned meter is filled with, given where the value
 * sits on its scale (0 at the floor, 1 at the ceiling).
 *
 * Transcribed from the prototype's `rsiColor`. Below 30 saturates to a deep
 * oversold green, above 70 to a deep overbought red, and the 30-70 neutral
 * band fades through a muted charcoal -- so a whole column can be scanned and
 * the eye jumps straight to the extremes without reading one number.
 *
 * The |t| < 0.4 deadzone is load-bearing, not a rounding convenience: without
 * it a symbol parked around 50 would drift through colour on every tick, and
 * a column that shimmers is a column nobody can scan.
 */
function heatColor(fraction: number): string {
  const t = fraction * 2 - 1;
  const a = Math.abs(t);
  if (a < 0.4) return `rgba(80,90,102,${0.35 + a * 0.4})`;
  const k = (a - 0.4) / 0.6;
  const alpha = 0.55 + k * 0.35;
  return t > 0
    ? `rgba(${Math.round(200 + k * 55)},${Math.round(80 - k * 60)},${Math.round(70 - k * 50)},${alpha})`
    : `rgba(${Math.round(60 - k * 20)},${Math.round(170 + k * 40)},${Math.round(120 - k * 40)},${alpha})`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One row's range bar, in one of two modes.
 *
 * **Band** (`low`/`high`/`value`/`palette`, v10's shipped contract, still
 * every existing caller): a marker on a gradient track showing where `value`
 * sits inside a per-row band -- day range, 52-week range.
 *
 * **Meter** (`min`/`max`/`guides`/`signed`): a filled bar against a scale
 * fixed by the column, not by other row fields -- RSI's 0-100, or a signed
 * deviation filled from the centre. Selected by whether any meter prop was
 * passed, not by whether `low`/`high` are present: a row genuinely missing
 * both band ends (no snapshot yet) must still take the band path and render
 * nothing, not silently become an unscaled meter.
 *
 * Drawn in CSS rather than with a charting library either way, which is what
 * makes it cheap enough to put sixty of on screen under a 4Hz tick flush.
 */
export function RangeBar({
  low,
  high,
  value,
  palette = "week52",
  min,
  max,
  guides,
  signed,
  bands,
}: {
  low?: unknown;
  high?: unknown;
  value: unknown;
  palette?: RangePalette;
  min?: number;
  max?: number;
  guides?: number[];
  signed?: boolean;
  bands?: [number, number];
}) {
  const isMeter = min !== undefined || max !== undefined || guides !== undefined || signed === true;

  if (!isMeter) {
    const lo = num(low);
    const hi = num(high);
    const at = num(value);
    // A zero-width range would divide by zero, and a bar whose ends are equal
    // is not a shorter bar -- it is an undrawable one.
    if (lo === null || hi === null || at === null || hi <= lo) return null;

    // Clamped, not dropped: a price that has printed outside a stale 52-week
    // band still belongs at the end of the bar rather than off it.
    const fraction = Math.max(0, Math.min(1, (at - lo) / (hi - lo)));

    return (
      <span className="cell-range">
        <span className="cell-range-track" style={{ background: `linear-gradient(90deg,${PALETTES[palette]})` }} />
        {/* The track is inset 4px each side, so the marker is placed against
            the TRACK's width, not the cell's -- otherwise f=0 and f=1 sit a few
            pixels outside the ends they are meant to mark. */}
        <span
          className="cell-range-marker"
          style={{ left: `calc(4px + (100% - 8px) * ${fraction})` }}
        />
      </span>
    );
  }

  // A null value renders nothing: an empty bar sitting at the floor is a
  // value of zero, and zero is a real, different fact from not knowing.
  const at = num(value);
  if (at === null) return null;

  // `min` is honoured even in signed mode -- an asymmetric scale like
  // {signed: true, min: -10, max: 5} is a real thing to ask for, and
  // silently substituting -max would render a floor nobody declared.
  const lo = signed === true ? (min ?? -(max ?? DEFAULT_SIGNED_SCALE)) : (min ?? 0);
  const hi = signed === true ? (max ?? DEFAULT_SIGNED_SCALE) : (max ?? 100);
  const clamped = Math.max(lo, Math.min(hi, at));
  const valuePercent = ((clamped - lo) / (hi - lo)) * 100;
  // Unsigned fills from the floor (0%); signed fills from the centre (50%),
  // growing left for a negative value and right for a positive one.
  //
  // Bands (RSI's 30/70) change the unsigned origin: the fill grows OUTWARD
  // from the band the value has crossed, and only once it has crossed it --
  // 15 fills from 30 down to 15, 85 from 70 up to 85, and anything between
  // the bands draws no bar at all. The neutral middle is the uninteresting
  // case, so it is the quiet one: a column of these reads as blank until
  // something is stretched, and then the bar's length IS how stretched.
  const band = signed === true ? undefined : bands;
  const pct = (v: number) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100;
  const zone = band === undefined ? undefined
    : at < band[0] ? "under" : at > band[1] ? "over" : "inside";
  const originPercent = signed === true ? 50
    : band === undefined ? 0
    : zone === "under" ? pct(band[0]) : zone === "over" ? pct(band[1]) : valuePercent;
  // The reading's box spans the bands themselves when there are any (RSI's
  // 30-70), and the whole track when there are not.
  const boxFrom = band === undefined ? 0 : pct(band[0]);
  const boxTo = band === undefined ? 100 : pct(band[1]);
  const fillLeft = Math.min(originPercent, valuePercent);
  const fillWidth = Math.abs(valuePercent - originPercent);

  return (
    <span className={signed === true ? "cell-meter" : "cell-meter cell-meter--heat"}>
      <span className="cell-meter-track" />
      {/* Every offset below is measured against the TRACK, which is inset 4px
          each side -- not against the cell. Positioning in bare percentages
          (as this did) puts the fill's ends a few pixels outside the track it
          is meant to fill and pulls each guide inside the value it marks, so
          the bar reads as lopsided and the ticks do not line up with the
          numbers they stand for. Band mode above has always done it this way;
          meter mode did not. */}
      <span
        className="cell-meter-fill"
        role="meter"
        // The ARIA meter contract requires valuenow inside [valuemin,
        // valuemax] -- an out-of-scale value (a crypto row 8% off its
        // anchored VWAP on the +/-100bp default scale) is drawn pinned at the
        // edge, so it must also be ANNOUNCED there, not as a number outside
        // its own declared range. valuetext carries the true, unclamped
        // value so a screen reader still reports the real deviation instead
        // of the pinned one.
        aria-valuenow={clamped}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuetext={String(at)}
        data-origin={signed === true ? "center" : "floor"}
        // Signed reads as DIRECTION, so it takes the candle colours; unsigned
        // reads as INTENSITY on a fixed scale, so it takes the heat.
        style={{
          left: `calc(4px + (100% - 8px) * ${fillLeft / 100})`,
          width: `calc((100% - 8px) * ${fillWidth / 100})`,
          background: signed === true
            ? (at >= 0 ? SIGNED_UP : SIGNED_DOWN)
            : heatColor(valuePercent / 100),
        }}
      />
      {/* AFTER the fill, so a guide below the current value still reads. With
          the guides first, an RSI of 32 buried its own 30 tick under the fill
          -- and the 30/70 ticks are the whole point of the scale. */}
      {(guides ?? []).map((g) => (
        <span
          key={g}
          className="cell-meter-guide"
          data-testid="range-guide"
          style={{
            left: `calc(4px + (100% - 8px) * ${(Math.max(lo, Math.min(hi, g)) - lo) / (hi - lo)})`,
          }}
        />
      ))}
      {/* The reading, in a neutral box laid over the 30-70 stretch of the
          bar, AFTER the fill and guides so nothing paints over it. The box
          is the neutral zone made visible: the only colour in the whole
          meter is the fill growing outward past 30 or 70, so a column of
          these is quiet until something is stretched. It replaced two
          earlier placements the user rejected on 2026-09-14 -- shadowed text
          over a grey track (hard to read) and the number beside the bar.
          Rounded, because the column is ~100px wide and the decimal buys
          nothing at a glance; aria-valuetext above carries the exact value.
          Signed meters carry no reading: the magnitude IS the bar. Without
          bands the box covers the whole track and is drawn transparent, the
          old centred label. */}
      {signed !== true && (
        <span
          className="cell-meter-box"
          data-band={band === undefined ? "none" : "range"}
          style={{
            left: `calc(4px + (100% - 8px) * ${boxFrom / 100})`,
            width: `calc((100% - 8px) * ${(boxTo - boxFrom) / 100})`,
          }}
        >
          {Math.round(at)}
        </span>
      )}
    </span>
  );
}
