// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach, describe, expect, it, vi} from 'vitest';
const {platform} = vi.hoisted(() => ({platform:{native:true}}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>platform.native,invoke:vi.fn()}));
import {parseYoutubePlayback, youtubePlayback, youtubePlaybackUrl} from './youtubePlayback';
import {desktopVideoPipAvailable,youtubePipLabel} from './youtubePip';
afterEach(()=>{vi.unstubAllEnvs();platform.native=true;});
describe('YouTube playback preferences',()=>{
  it('preserves legacy manual, audible inline playback by default',()=>{
    expect(youtubePlayback(undefined)).toEqual({display:'inline',autoplay:false,muted:false});
  });
  it('reads saved desktop display and boolean preferences',()=>{
    const saved={display:'pip',autoplay:true,muted:true};
    expect(parseYoutubePlayback(saved)).toEqual(saved);
    expect(youtubePlayback(saved)).toEqual(saved);
  });
  it.each([null,[],{display:'external',autoplay:true,muted:false},{display:{toString:null},autoplay:false,muted:false},{display:'pip',autoplay:'true',muted:false},{display:'pip',autoplay:true,muted:false,url:'https://evil.example'}])('refuses malformed playback state %j',value=>{
    expect(parseYoutubePlayback(value)).toBeNull();
    expect(youtubePlayback(value)).toEqual({display:'inline',autoplay:false,muted:false});
  });
  it('builds only a validated YouTube loopback URL with bounded flags',()=>{
    expect(youtubePlaybackUrl('https://youtu.be/uYyhswnZkSw',41234,{display:'pip',autoplay:true,muted:false})).toBe('http://127.0.0.1:41234/yt?id=uYyhswnZkSw&autoplay=1&muted=0');
    expect(youtubePlaybackUrl('https://evil.example/watch?v=uYyhswnZkSw',41234,{display:'inline',autoplay:false,muted:false})).toBeNull();
    expect(youtubePlaybackUrl('uYyhswnZkSw',0,{display:'inline',autoplay:false,muted:false})).toBeNull();
  });
  it.each([['darwin',true],['windows',true],['ios',false],['linux',false]])('native capability %s is %s',(os,expected)=>{
    vi.stubEnv('TAURI_ENV_PLATFORM',os);expect(desktopVideoPipAvailable()).toBe(expected);
  });
  it('never promises native PiP in a browser build',()=>{vi.stubEnv('TAURI_ENV_PLATFORM','windows');platform.native=false;expect(desktopVideoPipAvailable()).toBe(false);});
  it('bounds the owned window identity',()=>{
    expect(youtubePipLabel('abcd-1234')).toBe('youtube-pip-abcd-1234');
    for(const id of ['', '../main','x'.repeat(101)])expect(()=>youtubePipLabel(id)).toThrow();
  });
});
