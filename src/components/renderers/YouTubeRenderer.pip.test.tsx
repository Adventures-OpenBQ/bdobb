// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useState} from 'react';
import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {calls,capability}=vi.hoisted(()=>({calls:{open:vi.fn(),close:vi.fn(),isOpen:vi.fn(),port:41234 as number|null},capability:{native:true}}));
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(async()=>calls.port)}));
vi.mock('../../lib/youtubePip',()=>({desktopVideoPipAvailable:()=>capability.native,openYoutubePip:calls.open,closeYoutubePip:calls.close,youtubePipIsOpen:calls.isOpen}));
import {YouTubeRenderer} from './YouTubeRenderer';
const URL='https://youtu.be/uYyhswnZkSw';
beforeEach(()=>{calls.port=41234;capability.native=true;calls.open.mockReset().mockResolvedValue(undefined);calls.close.mockReset().mockResolvedValue(undefined);calls.isOpen.mockReset().mockResolvedValue(true);});
afterEach(()=>{vi.useRealTimers();});
it('moves a card into its own native PiP player and returns without two players',async()=>{
  const save=vi.fn(async()=>{});
  render(<YouTubeRenderer data={URL} cardId="tv-1" onSettingsChange={save}/>);
  await screen.findByTitle('YouTube video');
  await userEvent.click(screen.getByRole('button',{name:'Picture in Picture'}));
  await waitFor(()=>expect(calls.open).toHaveBeenCalledWith('tv-1','uYyhswnZkSw',{display:'pip',autoplay:false,muted:false},true));
  expect(screen.queryByTitle('YouTube video')).toBeNull();
  expect(save).toHaveBeenCalledWith({display:'pip',autoplay:false,muted:false});
  await userEvent.click(screen.getByRole('button',{name:'Return video to card'}));
  await screen.findByTitle('YouTube video');
  expect(calls.close).toHaveBeenCalledWith('tv-1');
  expect(save).toHaveBeenLastCalledWith({display:'inline',autoplay:false,muted:false});
});
it('forces inline playback on iPad while retaining saved desktop preferences',async()=>{
  capability.native=false;
  const save=vi.fn(async()=>{});
  render(<YouTubeRenderer data={URL} cardId="tv-2" settings={{display:'pip',autoplay:true,muted:true}} onSettingsChange={save}/>);
  const frame=await screen.findByTitle('YouTube video');
  expect(frame).toHaveAttribute('src','http://127.0.0.1:41234/yt?id=uYyhswnZkSw&autoplay=1&muted=1');
  expect(screen.queryByRole('button',{name:'Picture in Picture'})).toBeNull();
  expect(calls.open).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it('renders saved playback configuration only in the Parameters host',async()=>{
  const host=document.createElement('div');document.body.appendChild(host);const save=vi.fn(async()=>{});
  const view=render(<YouTubeRenderer data={URL} cardId="tv-3" controlsHost={host} onSettingsChange={save}/>);
  try {
    await screen.findByTitle('YouTube video');
    expect(host).toContainElement(screen.getByRole('checkbox',{name:'Start muted'}));
    await userEvent.click(screen.getByRole('checkbox',{name:'Start muted'}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith({display:'inline',autoplay:false,muted:true}));
  } finally {view.unmount();host.remove();}
});
it('closes the owned player on invalid source and on navigation unmount',async()=>{
  const {rerender,unmount}=render(<YouTubeRenderer data={URL} cardId="tv-4" settings={{display:'pip',autoplay:true,muted:true}}/>);
  await waitFor(()=>expect(calls.open).toHaveBeenCalled());
  expect(screen.queryByTitle('YouTube video')).toBeNull();
  calls.close.mockClear();
  rerender(<YouTubeRenderer data="https://evil.example/" cardId="tv-4" settings={{display:'pip',autoplay:true,muted:true}}/>);
  await waitFor(()=>expect(calls.close).toHaveBeenCalledWith('tv-4'));
  expect(screen.queryByTitle('YouTube video')).toBeNull();
  unmount();
});
it('does not mount an inline frame until the previous native player finishes closing',async()=>{
  let finish:()=>void=()=>{};
  render(<YouTubeRenderer data={URL} cardId="tv-5" settings={{display:'pip',autoplay:false,muted:false}}/>);
  await screen.findByRole('button',{name:'Return video to card'});
  calls.close.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  await userEvent.click(screen.getByRole('button',{name:'Return video to card'}));
  expect(screen.queryByTitle('YouTube video')).toBeNull();
  await act(async()=>finish());
  await screen.findByTitle('YouTube video');
});
it('keeps the existing inline player when saving a PiP preference fails',async()=>{
 const save=vi.fn(async()=>{throw Error('disk full');});
 render(<YouTubeRenderer data={URL} cardId="tv-save" onSettingsChange={save}/>);
 await screen.findByTitle('YouTube video');
 await userEvent.click(screen.getByRole('button',{name:'Picture in Picture'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
 expect(screen.getByTitle('YouTube video')).toBeInTheDocument();expect(calls.open).not.toHaveBeenCalled();
});
it('closes a playing native window when its card unmounts',async()=>{
 const view=render(<YouTubeRenderer data={URL} cardId="tv-remove" settings={{display:'pip',muted:false,autoplay:false}}/>);
 await waitFor(()=>expect(calls.open).toHaveBeenCalled());calls.close.mockClear();view.unmount();
 expect(calls.close).toHaveBeenCalledWith('tv-remove');
});
it('changes the floating source instead of mounting another inline player',async()=>{
 const prefs={display:'pip' as const,muted:true,autoplay:true};
 const view=render(<YouTubeRenderer data={URL} cardId="tv-source" settings={prefs}/>);
 await waitFor(()=>expect(calls.open).toHaveBeenCalled());
 view.rerender(<YouTubeRenderer data="https://youtu.be/5qap5aO4i9A" cardId="tv-source" settings={prefs}/>);
 await waitFor(()=>expect(calls.open).toHaveBeenLastCalledWith('tv-source','5qap5aO4i9A',prefs,false));
 expect(screen.queryByTitle('YouTube video')).toBeNull();
});
it('never opens a native window in a viewer even with a saved desktop preference',async()=>{
 render(<YouTubeRenderer data={URL} cardId="tv-viewer" viewer settings={{display:'pip',muted:true,autoplay:true}}/>);
 await screen.findByTitle('YouTube video');expect(calls.open).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:'Picture in Picture'})).toBeNull();
});
it('returns inline and saves the choice when the native title-bar close is used',async()=>{
 calls.isOpen.mockResolvedValue(false);const save=vi.fn(async()=>{});
 render(<YouTubeRenderer data={URL} cardId="tv-native-close" settings={{display:'pip',autoplay:false,muted:true}} onSettingsChange={save}/>);
 await screen.findByTitle('YouTube video',{}, {timeout:3000});
 expect(save).toHaveBeenCalledWith({display:'inline',autoplay:false,muted:true});
});

it('honors the playback preferences on the direct fallback when the local wrapper cannot bind',async()=>{
 calls.port=null;capability.native=false;
 render(<YouTubeRenderer data={URL} cardId="tv-fallback" settings={{display:'inline',autoplay:true,muted:true}}/>);
 expect(await screen.findByTitle('YouTube video')).toHaveAttribute('src','https://www.youtube.com/embed/uYyhswnZkSw?autoplay=1&mute=1&playsinline=1');
});

it('preserves the requested focus when the store echoes its saved setting before the save promise resolves',async()=>{
 function WithStoreEcho(){
  const [settings,setSettings]=useState<{display:'inline'|'pip';autoplay:boolean;muted:boolean}>({display:'inline',autoplay:false,muted:false});
  return <YouTubeRenderer data={URL} cardId="tv-store-echo" settings={settings} onSettingsChange={async next=>{setSettings(next);await new Promise(r=>setTimeout(r,30));}}/>;
 }
 render(<WithStoreEcho/>);await screen.findByTitle('YouTube video');
 await userEvent.click(screen.getByRole('button',{name:'Picture in Picture'}));
 await waitFor(()=>expect(calls.open).toHaveBeenCalledWith('tv-store-echo','uYyhswnZkSw',{display:'pip',autoplay:false,muted:false},true));
});
it('reports the selected source as unavailable when its channel is off-air',()=>{
 render(<YouTubeRenderer data="" cardId="off-air"/>);
 expect(screen.getByText('No video is currently available for the selected source.')).toBeInTheDocument();
 expect(screen.queryByTitle('YouTube video')).toBeNull();
});
