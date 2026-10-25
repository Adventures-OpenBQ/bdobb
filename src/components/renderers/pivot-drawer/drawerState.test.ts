// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { DRAWER_SECTIONS, INITIAL_DRAWER_STATE, drawerReducer, type DrawerAction, type DrawerState } from './drawerState';
const reduce = (s: DrawerState, a: DrawerAction, dismissOnOutside = true) => drawerReducer(s, a, { dismissOnOutside });
describe('drawerReducer', () => {
  it.each(['arrange', 'statement', 'categories', 'measures', 'pages', 'formulas', 'checklists', 'resultFilters', 'inspect'] as const)('reopens Arrange after toggling %s closed', active => {
    const s: DrawerState = Object.freeze({ open: true, active, returnFocus: null });
    const closed = reduce(s, { kind: 'toggle' });
    expect(closed).toEqual({ open: false, active, returnFocus: 'toolbar' });
    expect(reduce(closed, { kind: 'toggle' })).toEqual({ open: true, active: 'arrange', returnFocus: null });
    expect(s).toEqual({ open: true, active, returnFocus: null });
  });
  it('exports the fixed section order and closed initial state', () => {
    expect(DRAWER_SECTIONS).toEqual(['arrange', 'categories', 'measures', 'pages', 'formulas', 'checklists', 'resultFilters', 'inspect', 'statement']);
    expect(INITIAL_DRAWER_STATE).toEqual({ open: false, active: 'arrange', returnFocus: null });
  });
  it.each(DRAWER_SECTIONS)('select opens %s and Escape returns through Arrange', section => {
    const selected = reduce(INITIAL_DRAWER_STATE, { kind: 'select', section });
    expect(selected).toEqual({ open: true, active: section, returnFocus: null });
    const escaped = reduce(selected, { kind: 'escape' });
    if (section !== 'arrange') {
      expect(escaped).toEqual({ open: true, active: 'arrange', returnFocus: null });
      expect(reduce(escaped, { kind: 'escape' })).toEqual({ open: false, active: 'arrange', returnFocus: 'toolbar' });
    } else expect(escaped.open).toBe(false);
  });
  it.each(['close', 'done', 'toggle', 'escape'] as const)('%s returns focus to toolbar', kind => {
    expect(reduce({ open: true, active: 'arrange', returnFocus: null }, { kind }).returnFocus).toBe('toolbar');
  });
  it.each(['outside', 'showTable'] as const)('%s returns focus to table', kind => {
    expect(reduce({ open: true, active: 'inspect', returnFocus: null }, { kind })).toEqual({ open: false, active: 'inspect', returnFocus: 'table' });
  });
  it('ignores disabled outside and closed dismissals without focus events', () => {
    const open: DrawerState = { open: true, active: 'pages', returnFocus: null };
    expect(reduce(open, { kind: 'outside' }, false)).toBe(open);
    for (const kind of ['close', 'done', 'escape', 'outside', 'showTable'] as const) expect(reduce(INITIAL_DRAWER_STATE, { kind })).toBe(INITIAL_DRAWER_STATE);
  });
});
