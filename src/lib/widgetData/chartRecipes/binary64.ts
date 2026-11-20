// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export const doubleUnitExponent = -1074; // Every finite binary64 value is a multiple of 2**-1074.
const hiddenSignificandBit = 1n << 52n;

/** Read a finite IEEE 754 double as an exact integer in units of Number.MIN_VALUE. */
export function scaledInteger(value: number, view: DataView): bigint {
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & (hiddenSignificandBit - 1n);
  const magnitude = exponent === 0 ? fraction : (hiddenSignificandBit | fraction) << BigInt(exponent - 1);
  return value < 0 ? -magnitude : magnitude;
}

/** Round an exact ratio with a positive denominator to the nearest binary64 value. */
export function roundedRatio(numerator: bigint, denominator: bigint, scaleExponent = 0): number {
  if (numerator === 0n) return 0;
  const sign = numerator < 0n ? -1 : 1;
  let magnitude = numerator < 0n ? -numerator : numerator;
  const difference = magnitude.toString(2).length - denominator.toString(2).length;
  const alignedNumerator = magnitude << BigInt(Math.max(0, -difference));
  const alignedDenominator = denominator << BigInt(Math.max(0, difference));
  const exponent = scaleExponent + difference - (alignedNumerator < alignedDenominator ? 1 : 0);
  if (exponent > 1023) return sign * Infinity;
  if (exponent < doubleUnitExponent - 1) return 0;

  // Round only after scaling the ratio into the binary64 significand or subnormal unit.
  const place = Math.max(doubleUnitExponent, exponent - 52);
  const shift = scaleExponent - place;
  magnitude <<= BigInt(Math.max(0, shift));
  const divisor = denominator << BigInt(Math.max(0, -shift));
  const units = magnitude / divisor;
  const doubledRemainder = 2n * (magnitude % divisor);
  const roundUp = doubledRemainder > divisor || (doubledRemainder === divisor && units % 2n !== 0n);
  return sign * Number(roundUp ? units + 1n : units) * 2 ** place;
}
