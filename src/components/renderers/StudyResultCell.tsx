// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {RangeBar} from './RangeBar';
import {isRecord} from '../../lib/isRecord';
export function StudyResultCell({value}:{value:unknown}){
 if(!isRecord(value)||value.status===undefined)return <span>Loading study…</span>;
 if(value.status==='error')return <span title={typeof value.error_code==='string'?value.error_code:undefined}>Study unavailable{typeof value.error_code==='string'?` (${value.error_code})`:''}</span>;
 if(value.status==='warming_up')return <span>Warming up</span>;
 const points=Array.isArray(value.points)?value.points.filter(isRecord):[];
 const finite=points.map(point=>point.value).filter((point):point is number=>typeof point==='number'&&Number.isFinite(point));
 const low=Math.min(...finite),high=Math.max(...finite);
 const paths:string[]=[];let segment='';
 points.forEach((point,index)=>{if(typeof point.value!=='number'||!Number.isFinite(point.value)){if(segment)paths.push(segment);segment='';return;}const x=2+index/Math.max(1,points.length-1)*96,y=22-(point.value-low)/(high-low||1)*20;segment+=`${segment?' L':'M'}${x.toFixed(2)},${y.toFixed(2)}`;});
 if(segment)paths.push(segment);
 const title=[typeof value.as_of==='string'?`As of ${value.as_of}`:'',typeof value.revision==='string'?`Revision ${value.revision}`:''].filter(Boolean).join('; ');
 return <span className="study-result-cell" title={title||undefined}>
  {value.presentation!=='sparkline'?(value.study==='rsi'&&value.output==='rsi'&&typeof value.latest==='number'?<RangeBar value={value.latest} min={0} max={100} guides={[30,70]} bands={[30,70]}/>:<span>{typeof value.latest==='number'?value.latest.toLocaleString(undefined,{maximumFractionDigits:2}):'—'}</span>):null}
  {value.presentation!=='latest'&&finite.length>0?<svg viewBox="0 0 100 26" width="100" height="26" role="img" aria-label={`${String(value.study)} ${String(value.output)} trend`}>{paths.map((path,index)=>path.includes(" L")?<path key={index} d={path} fill="none" stroke="currentColor" strokeWidth="1.5"/>:<circle key={index} cx={Number(path.slice(1).split(",")[0])} cy={Number(path.slice(1).split(",")[1])} r="1.5" fill="currentColor"/>)}</svg>:null}
  {value.presentation==='sparkline'&&finite.length===0?<span>No study points</span>:null}
 </span>;
}
