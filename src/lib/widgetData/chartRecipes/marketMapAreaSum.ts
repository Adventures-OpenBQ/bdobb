// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Round the sum of finite nonnegative binary64 areas once, as the source's math.fsum does. */
export function sumMarketMapAreas(areas: readonly number[]): number {
  const bits = new DataView(new ArrayBuffer(8));
  const leadingBit = 1n << 52n;
  let units = 0n;
  for (const area of areas) {
    if (!Number.isFinite(area) || area < 0) return NaN;
    if (area === 0) continue;
    bits.setFloat64(0, area);
    const encoded = bits.getBigUint64(0);
    const exponent = encoded >> 52n;
    const fraction = encoded & (leadingBit - 1n);
    // Every binary64 value is an integer multiple of the minimum subnormal, 2^-1074.
    units += exponent === 0n ? fraction : (leadingBit + fraction) << (exponent - 1n);
  }
  const discarded = units.toString(2).length - 53;
  if (discarded <= 0) return Number(units) * Number.MIN_VALUE;
  const shift = BigInt(discarded);
  let significand = units >> shift;
  const remainder = units - (significand << shift);
  const half = 1n << (shift - 1n);
  if (remainder > half || (remainder === half && (significand & 1n) === 1n)) significand += 1n;
  return Number(significand) * 2 ** (discarded - 1074);
}
