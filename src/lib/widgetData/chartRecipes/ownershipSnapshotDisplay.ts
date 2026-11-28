// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { OwnershipSnapshotDetails } from './ownershipSnapshot';

type Measure = Extract<OwnershipSnapshotDetails, { view: 'bars' }>['measures'][number];

/** Read JS numbers in their shortest round-trip decimal representation. */
export function ownershipDecimalParts(value: number) {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = (whole + fraction).replace(/^0+(?=\d)/, '');
  return { digits, power: Number(exponent) - fraction.length };
}

function fractionPercent(fraction: number): string {
  if (fraction === 0) return '0%';
  const { digits, power } = ownershipDecimalParts(fraction);
  const point = digits.length + power + 2;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}%`;
  if (point >= digits.length) return `${digits.padEnd(point, '0')}%`;
  return `${digits.slice(0, point)}.${digits.slice(point)}%`;
}

export function ownershipMeasureText({ label, status, reported, unit, asOf, basis }: Measure) {
  const value = reported === null ? status === 'unbound' ? 'Binding unselected' : 'Unavailable'
    : (unit === 'percent-points' ? `${reported}%` : fractionPercent(reported)) + ` (reported ${reported} ${unit})`;
  return [label, value, `As of ${asOf ?? 'unknown'}`, basis ? 'Shares outstanding basis' : 'Basis unknown'];
}
