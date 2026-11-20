// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17 });
const scientificTick = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 6, notation: 'scientific' });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 17, notation: 'scientific' });

export function returnPercent(value: number): string {
  const magnitude = Math.abs(value);
  return (magnitude >= 1e4 || (magnitude > 0 && magnitude < 1e-6) ? scientificPercent : percent).format(value);
}


export type ReturnAxisScaling = { origin: number; scale: number };

export function scaledReturnTicks([low, high]: readonly [number, number], { origin, scale }: ReturnAxisScaling) {
  const values = new Map<number, number>();
  for (let i = 1; i <= 5; i++) {
    const coordinate = low + (high - low) * (i / 6);
    const value = coordinate * scale + origin;
    if (Number.isFinite(value) && !values.has(value)) values.set(value, coordinate);
  }
  const originals = [...values.keys()];
  const compact = originals.map(value => value ? scientificTick.format(value) : '0%');
  const ticktext = new Set(compact).size === originals.length ? compact : originals.map(returnPercent);
  return { tickvals: [...values.values()], ticktext };
}
