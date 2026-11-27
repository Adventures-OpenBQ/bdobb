// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>41234),isTauri:()=>true}));
import {YouTubeRenderer} from './YouTubeRenderer';
afterEach(()=>vi.unstubAllEnvs());
it('offers a single native Picture in Picture owner for a desktop YouTube card',async()=>{
 vi.stubEnv('TAURI_ENV_PLATFORM','darwin');
 render(<YouTubeRenderer data="https://youtu.be/uYyhswnZkSw" cardId="native-carry" onSettingsChange={async()=>{}}/>);
 await screen.findByTitle('YouTube video');
 expect(screen.getByRole('button',{name:'Picture in Picture'})).toBeEnabled();
});
