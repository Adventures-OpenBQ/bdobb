// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { OverlaySeriesFact } from './overlayEvidence';

function numberLabeler(percent: boolean, digits: number) {
  const options: Intl.NumberFormatOptions = { style: percent ? 'percent' : 'decimal', maximumSignificantDigits: digits, useGrouping: false };
  const decimal = new Intl.NumberFormat('en-US', options);
  const scientific = new Intl.NumberFormat('en-US', { ...options, notation: 'scientific' });
  return (value: number) => {
    const shown = Math.abs(value) * (percent ? 100 : 1);
    return ((shown !== 0 && shown < 0.001) || shown >= 100_000 ? scientific : decimal).format(value);
  };
}

const originalPercent = numberLabeler(true, 17);

export function overlayOriginalValue(value: number, unit: OverlaySeriesFact['unit'], label: string) {
  return unit === 'yield-fraction' ? `${originalPercent(value)} (original fraction ${value})` : `${value} ${label}`;
}

/** Exact-unit tick labels for the default range and subsequent Plotly relayouts. */
export function linearAxisTicks(range: readonly [number, number], percent = false) {
  const [lo, hi] = range;
  const step = (hi - lo) / 6;
  const tickvals = [...new Set([1, 2, 3, 4, 5].map(i => lo + i * step))];
  let ticktext: string[];
  let digits = 3;
  do {
    ticktext = tickvals.map(numberLabeler(percent, digits));
    digits++;
  } while (new Set(ticktext).size < tickvals.length && digits <= 17);
  return { tickvals, ticktext, margin: Math.max(62, 30 + 7 * Math.max(...ticktext.map(label => label.length))) };
}

export function overlayAxisTicks(range: readonly [number, number], unit: OverlaySeriesFact['unit']) {
  return linearAxisTicks(range, unit === 'yield-fraction');
}
