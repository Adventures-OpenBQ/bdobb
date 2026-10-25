// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { clampSplitPct, drawerLayout } from './drawerLayout';
const base = { bodyH: 260, bodyW: 560, headH: 40, rowH: 30, active: 'arrange' as const, splitPct: 0.5 };
it('keeps exactly three table rows and fills just below the boundary', () => {
  expect(drawerLayout(base)).toEqual({ mode: 'split', cramped: false, orientation: 'vertical', short: true });
  expect(drawerLayout({ ...base, bodyH: 259.99 })).toMatchObject({ mode: 'fill', cramped: true });
});
it('uses the 560 width boundary and fills every non-Arrange section', () => {
  expect(drawerLayout({ ...base, bodyW: 559 }).orientation).toBe('horizontal');
  for (const active of ['categories', 'measures', 'pages', 'formulas', 'checklists', 'resultFilters', 'inspect'] as const) expect(drawerLayout({ ...base, active }).mode).toBe('fill');
});
it('measures short against actual drawer height in split and fill', () => {
  expect(drawerLayout({ ...base, bodyH: 598 }).short).toBe(true);
  expect(drawerLayout({ ...base, bodyH: 600 }).short).toBe(false);
  expect(drawerLayout({ ...base, active: 'pages', bodyH: 299 }).short).toBe(true);
  expect(drawerLayout({ ...base, active: 'pages', bodyH: 300 }).short).toBe(false);
});
it('normalizes unavailable dimensions to safe fill and short', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    expect(drawerLayout({ ...base, bodyH: value })).toMatchObject({ mode: 'fill', short: true });
    expect(drawerLayout({ ...base, bodyW: value })).toMatchObject({ mode: 'fill', short: true, orientation: 'horizontal' });
  }
  expect(drawerLayout({ ...base, headH: -1, rowH: NaN })).toEqual(drawerLayout({ ...base, headH: 0, rowH: 0 }));
});
it('defaults nonfinite split to .4 and clamps finite split to the CSS 18–92% contract', () => {
  for (const splitPct of [NaN, Infinity, -Infinity]) expect(drawerLayout({ ...base, splitPct })).toEqual(drawerLayout({ ...base, splitPct: .4 }));
  expect(drawerLayout({ ...base, splitPct: -2 })).toEqual(drawerLayout({ ...base, splitPct: .18 }));
  expect(drawerLayout({ ...base, splitPct: 2 })).toEqual(drawerLayout({ ...base, splitPct: .92 }));
});

it('exports the shared CSS split clamp at both exact boundaries', () => {
  for (const value of [-1, .179, .18]) expect(clampSplitPct(value)).toBe(.18);
  for (const value of [.92, .921, 2]) expect(clampSplitPct(value)).toBe(.92);
  expect(clampSplitPct(.5)).toBe(.5);
  for (const value of [NaN, Infinity, -Infinity]) expect(clampSplitPct(value)).toBe(.4);
});
