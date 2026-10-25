// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from 'vitest';
import { clearDrawerDashboard, dispatchDrawer, getDismissOnOutside, getDrawerState, setDismissOnOutside, subscribeDrawer } from './pivotDrawerStore';
afterEach(() => { clearDrawerDashboard('a'); clearDrawerDashboard('b'); });
it('isolates dashboards, key listeners, and stable snapshots', () => {
  const a = vi.fn(), b = vi.fn(), other = vi.fn();
  const stop = subscribeDrawer('a', 'card', a), stopB = subscribeDrawer('b', 'card', b), stopOther = subscribeDrawer('a', 'other', other);
  const initial = getDrawerState('a', 'card');
  expect(getDrawerState('a', 'card')).toBe(initial);
  dispatchDrawer('a', 'card', { kind: 'close' });
  expect(a).not.toHaveBeenCalled();
  dispatchDrawer('a', 'card', { kind: 'select', section: 'pages' });
  expect(getDrawerState('a', 'card').active).toBe('pages');
  expect(getDrawerState('b', 'card')).toBe(initial);
  expect(a).toHaveBeenCalledTimes(1); expect(b).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
  const selected = getDrawerState('a', 'card');
  dispatchDrawer('a', 'card', { kind: 'select', section: 'pages' });
  expect(getDrawerState('a', 'card')).toBe(selected);
  stop(); dispatchDrawer('a', 'card', { kind: 'toggle' }); expect(a).toHaveBeenCalledTimes(1);
  stopB(); stopOther();
});
it('defaults dismissal on and toggles only its key', () => {
  const listener = vi.fn(), stop = subscribeDrawer('a', 'card', listener);
  expect(getDismissOnOutside('a', 'card')).toBe(true);
  setDismissOnOutside('a', 'card', false); setDismissOnOutside('a', 'card', false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getDismissOnOutside('b', 'card')).toBe(true);
  dispatchDrawer('a', 'card', { kind: 'toggle' });
  const open = getDrawerState('a', 'card'); dispatchDrawer('a', 'card', { kind: 'outside' }); expect(getDrawerState('a', 'card')).toBe(open);
  setDismissOnOutside('a', 'card', true); dispatchDrawer('a', 'card', { kind: 'outside' }); expect(getDrawerState('a', 'card').open).toBe(false); stop();
});
it('clears a dashboard and notifies affected listeners while preserving subscriptions and other dashboards', () => {
  dispatchDrawer('a', 'card', { kind: 'toggle' }); dispatchDrawer('b', 'card', { kind: 'toggle' }); setDismissOnOutside('a', 'other', false);
  const a = vi.fn(), other = vi.fn(), b = vi.fn();
  const stops = [subscribeDrawer('a', 'card', a), subscribeDrawer('a', 'other', other), subscribeDrawer('b', 'card', b)];
  const bState = getDrawerState('b', 'card'); clearDrawerDashboard('a');
  expect(getDrawerState('a', 'card').open).toBe(false); expect(getDismissOnOutside('a', 'other')).toBe(true);
  expect(a).toHaveBeenCalledTimes(1); expect(other).toHaveBeenCalledTimes(1); expect(b).not.toHaveBeenCalled(); expect(getDrawerState('b', 'card')).toBe(bState);
  dispatchDrawer('a', 'card', { kind: 'toggle' }); expect(a).toHaveBeenCalledTimes(2); stops.forEach(stop => stop());
});
it('keeps newer subscriptions when an older unsubscribe runs twice', () => {
  const oldStop = subscribeDrawer('a', 'card', () => {}); oldStop();
  const listener = vi.fn(), stop = subscribeDrawer('a', 'card', listener);
  oldStop(); dispatchDrawer('a', 'card', { kind: 'toggle' });
  expect(listener).toHaveBeenCalledTimes(1); stop();
});
