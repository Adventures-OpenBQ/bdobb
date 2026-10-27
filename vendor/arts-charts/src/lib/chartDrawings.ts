// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { ChartDrawing, ChartPoint, GannSlopes } from "./types";

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const GANN_DEGREES = [30, 45, 60];

/** Price per second. The unit every recorded slope is in. */
export function slopeBetween(a: ChartPoint, b: ChartPoint): number {
  return (b.value - a.value) / (b.time - a.time);
}

export function rayEnd(a: ChartPoint, slope: number, at: number): ChartPoint {
  return { time: at, value: a.value + slope * (at - a.time) };
}

/** Swing start is 100%, swing end is 0% — the retracement runs back toward the start. */
export function fibPrices(a: ChartPoint, b: ChartPoint): { level: number; price: number }[] {
  return FIB_LEVELS.map((level) => ({
    level, price: b.value + (a.value - b.value) * level,
  }));
}

/**
 * Screen degrees to data slopes.
 *
 * A chart "degree" is scale-dependent — the same 45° line is a different
 * price move at every zoom. So the angle is measured on screen at draw time
 * and converted here, once, into price per second. The recorded slope then
 * reproduces the identical fan after any rescale, which is the whole point.
 */
export function gannSlopes(
  sign: 1 | -1, pricePerPixel: number, secondsPerPixel: number,
): GannSlopes {
  const ratio = pricePerPixel / secondsPerPixel;
  const at = (deg: number) => sign * Math.tan((deg * Math.PI) / 180) * ratio;
  // Built as a literal tuple, not a .map: a fan is always three lines, and
  // the type says so.
  return [at(GANN_DEGREES[0]), at(GANN_DEGREES[1]), at(GANN_DEGREES[2])];
}

/** Every line a drawing renders as, each a pair of endpoints. */
export function pointsOf(drawing: ChartDrawing, at: number): ChartPoint[][] {
  switch (drawing.kind) {
    case "segment":
      return [[drawing.a, drawing.b]];
    case "ray": {
      // `at` can precede the anchor -- a user anchors on a bar, then scrolls
      // back in time. Flooring at `a.time + 1` always draws at least a
      // one-second line forward from the anchor, instead of running
      // backwards past it or collapsing to a zero-length segment.
      const far = Math.max(at, drawing.a.time + 1);
      return [[drawing.a, rayEnd(drawing.a, drawing.slope, far)]];
    }
    case "gann": {
      // Same floor as "ray", and for the same reason.
      const far = Math.max(at, drawing.a.time + 1);
      return drawing.slopes.map((slope) => [drawing.a, rayEnd(drawing.a, slope, far)]);
    }
    case "fib": {
      const from = Math.min(drawing.a.time, drawing.b.time);
      const far = Math.max(at, drawing.b.time);
      return fibPrices(drawing.a, drawing.b).map(({ price }) =>
        [{ time: from, value: price }, { time: far, value: price }]);
    }
  }
}

function distanceToSegment(
  point: ChartPoint, a: ChartPoint, b: ChartPoint,
  scale: { price: number; time: number },
): number {
  // Into screen units first: a price unit and a second are not comparable,
  // and comparing them raw makes a flat line look infinitely far away on a
  // chart whose price range is small.
  const px = point.time / scale.time;
  const py = point.value / scale.price;
  const ax = a.time / scale.time;
  const ay = a.value / scale.price;
  const bx = b.time / scale.time;
  const by = b.value / scale.price;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const nx = ax + t * dx;
  const ny = ay + t * dy;
  return Math.hypot(px - nx, py - ny);
}

/** Screen distance from `point` to the nearest line this drawing renders. */
export function distanceTo(
  drawing: ChartDrawing, point: ChartPoint, at: number,
  scale: { price: number; time: number },
): number {
  return Math.min(...pointsOf(drawing, at).map(([a, b]) =>
    distanceToSegment(point, a, b, scale)));
}
