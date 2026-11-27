// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach, expect, it, vi} from 'vitest';
import {primaryShortcut, windowsShortcuts} from './platformShortcuts';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
it.each([
  ['Win32', '', true, false, true],
  ['Win32', '', false, true, false],
  ['MacIntel', '', false, true, true],
  ['MacIntel', '', true, false, false],
  ['MacIntel', 'windows', true, false, true],
  ['MacIntel', 'ios', false, true, true],
] as const)('dispatches the primary modifier for %s (%s)', (platform, native, ctrlKey, metaKey, accepted) => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  vi.stubEnv('TAURI_ENV_PLATFORM', native);
  expect(primaryShortcut(new KeyboardEvent('keydown', {ctrlKey,metaKey}))).toBe(accepted);
});
it.each(['Win32','MacIntel'])('does not claim a combined Control+Meta shortcut on %s', platform => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  expect(windowsShortcuts()).toBe(platform === 'Win32');
  expect(primaryShortcut(new KeyboardEvent('keydown', {ctrlKey:true,metaKey:true}))).toBe(false);
});
