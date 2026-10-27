// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { LineStyle } from "lightweight-charts";

/**
 * A line's pen (docs/custom-studies.md): the five styles lightweight-charts
 * draws, under the registry's names. The library takes no dash array, so
 * these five are the whole vocabulary; a study declares one per output on
 * its render dict, and a series may override it in `style.pen`.
 */
export const PENS = ["solid", "dotted", "dashed", "large-dashed", "sparse-dotted"] as const;
export type Pen = (typeof PENS)[number];

/**
 * How a band's fill is painted (bandFill.ts): a solid translucent shade, or
 * a hatch tiled in the shade colour. The registry declares a default per
 * banded study; a series may override it in `style.fillPattern`.
 */
export const FILL_PATTERNS = ["solid", "diagonal", "cross", "dots"] as const;
export type FillPattern = (typeof FILL_PATTERNS)[number];

const LINE_STYLES: Record<Pen, LineStyle> = {
  solid: LineStyle.Solid,
  dotted: LineStyle.Dotted,
  dashed: LineStyle.Dashed,
  "large-dashed": LineStyle.LargeDashed,
  "sparse-dotted": LineStyle.SparseDotted,
};

export const isPen = (value: unknown): value is Pen => (PENS as readonly unknown[]).includes(value);
export const isFillPattern = (value: unknown): value is FillPattern => (FILL_PATTERNS as readonly unknown[]).includes(value);

/** The library's style for a pen; an unknown or absent pen draws solid, as every line did before pens. */
export const lineStyleOf = (pen: unknown): LineStyle => (isPen(pen) ? LINE_STYLES[pen] : LineStyle.Solid);
