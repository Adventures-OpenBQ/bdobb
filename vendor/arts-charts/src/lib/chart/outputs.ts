// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Which of a study's OUTPUT lines are drawn (spec 2026-09-27, per-output
 * visibility; owner: "for series that return bands is there an option to only
 * display the actual level and not all three?").
 *
 * One study is one or more outputs -- `bbands` is `bb_mid`, `bb_up`, `bb_lo`;
 * `macd` is `macd`, `macd_signal`, `macd_hist` -- each its own column and its
 * own drawn line. The keys are the registry's, shared by both sides: they key
 * an indicator's `render` dict on the backend and `CatalogEntry.colors` here.
 */

/** An output's own name, before the params the socket suffixes onto a column. */
export function outputKey(column: string): string {
  return column.split("|")[0] ?? column;
}

/** The output keys an entry declares, in the registry's own order. */
export function entryOutputs(entry: { colors: Record<string, string | null> }): readonly string[] {
  return Object.keys(entry.colors);
}

/**
 * A list of output names, or undefined for anything that is not one.
 *
 * An EMPTY list reads as undefined -- "draw them all" -- deliberately: a
 * hand-edited card or macro that hid every output would otherwise compute a
 * study and draw nothing, which looks exactly like a broken feed. The picker
 * refuses the last untick for the same reason.
 *
 * `render` arrives from the socket as an opaque dict, so it is read leniently:
 * a non-array, or an array of anything but strings, is no instruction at all.
 */
function names(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === "string");
  return list.length === 0 ? undefined : list;
}

/**
 * Is this output drawn?
 *
 * The CARD's own list wins over the macro's, the same way `card.color`
 * already outranks `line.render.color` for the same line. A macro states a
 * default for the study; the picker states this card's decision about it.
 *
 * The macro's list arrives inside every output's `render` dict, because
 * live-grid builds each output's render as `{**render, **style}` -- a
 * macro's per-series style merged over the registry's defaults, into every
 * output of that indicator. The list is therefore identical on all of them,
 * which is exactly what lets one key express a per-output choice.
 */
export function outputShown(
  column: string,
  card: readonly string[] | undefined,
  render: unknown,
): boolean {
  // `render` is the whole dict, so the list is its `outputs` KEY -- reading the
  // dict itself as the list is the mistake the tests caught first time.
  const fromRender = typeof render === "object" && render !== null
    ? (render as { outputs?: unknown }).outputs
    : undefined;
  const list = names(card) ?? names(fromRender);
  return list === undefined || list.includes(outputKey(column));
}
