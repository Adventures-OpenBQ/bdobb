// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({open:vi.fn(),close:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:async()=>41234}));
vi.mock('../../lib/youtubePip',()=>({desktopVideoPipAvailable:()=>true,openYoutubePip:native.open,closeYoutubePip:native.close,youtubePipIsOpen:async()=>false}));
import {YouTubeRenderer} from './YouTubeRenderer';
beforeEach(()=>{native.open.mockReset().mockResolvedValue(true);native.close.mockReset().mockResolvedValue(undefined);});
it('keeps Live TV inline with no pop-out button even for an older saved floating preference',async()=>{
 render(<YouTubeRenderer data="uYyhswnZkSw" cardId="live-tv" inlineOnly settings={{display:'pip',autoplay:true,muted:true}}/>);
 expect(await screen.findByTitle('YouTube video')).toHaveAttribute('src','http://127.0.0.1:41234/yt?id=uYyhswnZkSw&autoplay=1&muted=1');
 expect(screen.queryByRole('button',{name:/Picture in Picture|Return video to card/i})).toBeNull();
 expect(native.open).not.toHaveBeenCalled();
});
it('waits for a previously saved Live TV pop-out to close before rendering inline playback',async()=>{
 let done!:()=>void;native.close.mockImplementation(()=>new Promise<void>(r=>{done=r;}));
 render(<YouTubeRenderer data="uYyhswnZkSw" cardId="live-tv" inlineOnly/>);
 await waitFor(()=>expect(native.close).toHaveBeenCalledWith('live-tv'));
 expect(screen.queryByTitle('YouTube video')).toBeNull();
 await act(async()=>done());expect(await screen.findByTitle('YouTube video')).toBeInTheDocument();
});
it('reports failure to retire the old pop-out instead of starting a second Live TV player',async()=>{
 native.close.mockRejectedValue(new Error('window still playing'));
 render(<YouTubeRenderer data="uYyhswnZkSw" cardId="live-tv" inlineOnly/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('window still playing');
 expect(screen.queryByTitle('YouTube video')).toBeNull();expect(native.open).not.toHaveBeenCalled();
});

it('mutes from row zero while configuration is closed and persists the audio preference',async()=>{
 const host=document.createElement('span');document.body.appendChild(host);const save=vi.fn(async()=>{});
 const view=render(<YouTubeRenderer data="uYyhswnZkSw" cardId="live-tv" inlineOnly rowZeroHost={host} onSettingsChange={save}/>);
 try {
  await screen.findByTitle('YouTube video');
  const mute=screen.getByRole('button',{name:'Mute'});expect(host).toContainElement(mute);
  expect(screen.queryByRole('checkbox',{name:'Start muted'})).toBeNull();
  await userEvent.click(mute);
  await waitFor(()=>expect(screen.getByTitle('YouTube video')).toHaveAttribute('src','http://127.0.0.1:41234/yt?id=uYyhswnZkSw&autoplay=0&muted=1'));
  expect(save).toHaveBeenCalledWith({display:'inline',autoplay:false,muted:true});
  expect(screen.getByRole('button',{name:'Unmute'})).toBeInTheDocument();
 } finally {view.unmount();host.remove();}
});
