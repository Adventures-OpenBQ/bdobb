// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { nextMultiplesWidth, recipePlotHeight } from './viewport';

it('only changes worker width when the selected panels change their column count', () => {
  expect(nextMultiplesWidth(900, 600, 1)).toBe(900);
  expect(nextMultiplesWidth(900, 1200, 2)).toBe(900);
  expect(nextMultiplesWidth(900, 639.5, 2)).toBe(639.5);
  expect(nextMultiplesWidth(900, NaN, 3)).toBe(900);
  expect(nextMultiplesWidth(900, 0, 3)).toBe(900);
  expect(nextMultiplesWidth(900, 20_000, 3)).toBe(10_000);
});

it('opts only supported tall recipes into finite positive pixel heights', () => {
  const figure = { data: [], layout: { height: 720 } };
  expect(recipePlotHeight('etf-exposure', figure)).toBe(720);
  expect(recipePlotHeight('small-multiples', figure)).toBe(720);
  expect(recipePlotHeight('etf-pareto', figure)).toBeUndefined();
  expect(recipePlotHeight('return-distribution', figure)).toBeUndefined();
  for (const height of [undefined, -2, 0, '280', NaN, Infinity])
    expect(recipePlotHeight('small-multiples', { data: [], layout: { height } })).toBeUndefined();
});
