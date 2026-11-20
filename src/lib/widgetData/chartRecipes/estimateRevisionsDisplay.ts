// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export type EstimateRevisionChange = {
  fromVintage: string;
  absolute: number | null;
  percent: number | null;
  absoluteUnavailable?: 'out-of-range';
  percentUnavailable?: 'nonpositive-baseline' | 'out-of-range';
};

const ordinaryPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumSignificantDigits: 15, signDisplay: 'exceptZero', useGrouping: false });
const scientificPercent = new Intl.NumberFormat('en-US', { style: 'percent', notation: 'scientific', maximumSignificantDigits: 15, signDisplay: 'exceptZero' });

export function estimateChangeText(change: EstimateRevisionChange, unit: string) {
  const absolute = change.absolute;
  const signedAbsolute = absolute === null ? 'unavailable (outside numeric range)' : `${absolute > 0 ? '+' : ''}${absolute} ${unit}`;
  const percent = change.percent;
  const signedPercent = percent === null
    ? change.percentUnavailable === 'nonpositive-baseline' ? 'unavailable (earlier estimate is zero or negative)' : 'unavailable (outside numeric range)'
    : `${(Math.abs(percent) >= 1000 ? scientificPercent : ordinaryPercent).format(percent)} (fraction ${percent})`;
  return { signedAbsolute, signedPercent };
}
