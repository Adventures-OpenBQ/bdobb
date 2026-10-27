// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { ChartCardState } from "../types";

/**
 * The owned facets of the Parameters transaction (spec 2026-09-24, D3), as
 * data, plus the pure fold Cancel writes. No React and no chart, so
 * rowFacets.test.ts pins it without a DOM.
 *
 * `series` is deliberately NOT in GENERIC_CHART_FACETS: it is written through
 * onPatch for BOTH ordinary palette edits and a macro pick, and the recorder's
 * generic onPatch path ignores it so a palette add survives Cancel (D2). It is
 * recorded only at the macro corner (D4), where WidgetCard captures the
 * pre-macro list explicitly. foldRecording still restores it, because it folds
 * every key present in the recording rather than a hardcoded facet list.
 */
export const GENERIC_CHART_FACETS = ["interval", "range", "session", "adjusted", "railHidden"] as const;

/**
 * The parameters the field line owns (spec 2026-09-24, D3): `panels` (always
 * present, hidden by chartOmit) and the declared parameters the row shows,
 * today `macro` and `source`. `symbol` is NOT here -- it lives on the symbol
 * block, not the row, so a symbol edit is never part of this transaction.
 * Sub-projects C/D/F extend this list as the row grows new controls.
 */
export const OWNED_PARAMS = ["panels", "macro", "source"] as const;

/** Whether a chart-facet key is one the generic onPatch record path captures. */
export function isGenericChartFacet(key: string): boolean {
  return (GENERIC_CHART_FACETS as readonly string[]).includes(key);
}

/** Whether a parameter key is one the row owns (D3). `symbol` is not owned. */
export function isOwnedParam(key: string): boolean {
  return (OWNED_PARAMS as readonly string[]).includes(key);
}

/**
 * What the row changed: each owned facet the row touched, mapped to its
 * PREVIOUS value, recorded once (the first time that key changed). A chart
 * facet or parameter present as a key was recorded; a value of `undefined`
 * means the facet was absent when the row opened.
 */
export type RowRecording = {
  chart: Partial<ChartCardState>;
  params: Record<string, string | undefined>;
  /**
   * Group values the row MOVED (spec 2026-09-25, F7): a groupId mapped to its
   * PREVIOUS value, recorded once. A bound interval/range chip writes the group
   * rather than the card, so the card's own facet never changes and the generic
   * chart-facet recording above cannot see the edit; Cancel restores the group
   * from here instead. `undefined` means the group's value was not captured
   * (a group that did not exist), which folds to no edit.
   */
  groups: Record<string, string | undefined>;
};

export function emptyRecording(): RowRecording {
  return { chart: {}, params: {}, groups: {} };
}

/**
 * Fold a recording into the two edits Cancel writes (spec 2026-09-24,
 * Cancelling): a chart-facet patch that goes through the chart's own
 * merge-per-facet patch, and a parameter edit that goes through splitParamEdit
 * and the store's atomic card-and-groups action so a group-bound parameter
 * moves its group back with it.
 *
 * An absent parameter restores to the widget's DECLARED DEFAULT rather than a
 * deletion: splitParamEdit builds cardParams from {...card.params} and can only
 * SET keys, so it has no delete path; the declared default produces the same
 * effective value (spec, Mechanisms). `declaredDefault(name)` supplies it.
 *
 * `empty` is true when nothing was recorded -- Cancel then issues no writes,
 * and the indicator stays quiet (D9).
 */
export function foldRecording(
  rec: RowRecording,
  declaredDefault: (param: string) => string,
): { chart: Partial<ChartCardState> | null; params: Record<string, string>; groupEdits: Array<{ groupId: string; value: string }>; empty: boolean } {
  const chartKeys = Object.keys(rec.chart);
  const chart = chartKeys.length > 0 ? ({ ...rec.chart } as Partial<ChartCardState>) : null;

  const params: Record<string, string> = {};
  for (const key of Object.keys(rec.params)) {
    const prev = rec.params[key];
    params[key] = prev ?? declaredDefault(key);
  }

  // A group the row moved is restored to its captured previous value (F7),
  // through the same atomic card-and-groups action an ordinary group edit uses,
  // so every member moves back. A groupId whose previous value was never
  // captured folds to no edit.
  const groupEdits: Array<{ groupId: string; value: string }> = [];
  for (const groupId of Object.keys(rec.groups)) {
    const prev = rec.groups[groupId];
    if (prev !== undefined) groupEdits.push({ groupId, value: prev });
  }

  const empty = chartKeys.length === 0 && Object.keys(params).length === 0 && groupEdits.length === 0;
  return { chart, params, groupEdits, empty };
}
