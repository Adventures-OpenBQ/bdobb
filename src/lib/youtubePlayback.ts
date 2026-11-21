// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {isRecord} from './isRecord';
import {youtubeEmbedUrl} from './youtube';

/** Reserved Live TV selection and response; neither is a URL to fetch. */
export const PIP_GRAB_CHANNEL = 'picture-in-picture';
export const PIP_GRAB_MARKER = 'bdobb:picture-in-picture';

/** Client preferences only: never add these to a data provider's parameters. */
export type YoutubePlayback = {display:'inline'|'pip';autoplay:boolean;muted:boolean};
export const DEFAULT_YOUTUBE_PLAYBACK:Readonly<YoutubePlayback>={display:'inline',autoplay:false,muted:false};
export function parseYoutubePlayback(value:unknown):YoutubePlayback|null {
  if(!isRecord(value)||Object.keys(value).some(k=>!['display','autoplay','muted'].includes(k))||
    (value.display!=='inline'&&value.display!=='pip')||typeof value.autoplay!=='boolean'||typeof value.muted!=='boolean')return null;
  return {display:value.display as YoutubePlayback['display'],autoplay:value.autoplay,muted:value.muted};
}
export const youtubePlayback=(value:unknown):YoutubePlayback=>parseYoutubePlayback(value)??{...DEFAULT_YOUTUBE_PLAYBACK};
export function youtubePlaybackUrl(input:string,port:number,prefs:YoutubePlayback):string|null {
  if(!Number.isInteger(port)||port<1||port>65535)return null;
  const base=youtubeEmbedUrl(input,port);return base===null?null:`${base}&autoplay=${prefs.autoplay?1:0}&muted=${prefs.muted?1:0}`;
}
