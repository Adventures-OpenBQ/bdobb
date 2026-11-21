// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { asRecord } from '../../isRecord';

export function isChartSourceRecord(value: unknown): value is Record<string, unknown> {
  const obj = asRecord(value);
  return !!obj && [null, Object.prototype].includes(Object.getPrototypeOf(obj)) && Reflect.ownKeys(obj).every(key => {
    const d = Object.getOwnPropertyDescriptor(obj, key);
    return typeof key === 'string' && d?.enumerable && 'value' in d;
  });
}
export function isChartSourceArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d?.enumerable || !('value' in d)) return false;
  }
  return true;
}

export const exact = <K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> =>
  isChartSourceRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
