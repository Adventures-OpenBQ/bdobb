// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';

/** ps RSS is per-process (KiB), not a tree-inclusive value. Never sum threads. */
export function processTreeSnapshot(stdout,rootPid){
 const all=new Map();
 for(const line of stdout.trim().split('\n')){
  if(!line.trim())continue;
  const [pid,ppid,rssKiB]=line.trim().split(/\s+/).map(Number);
  assert.ok([pid,ppid,rssKiB].every(n=>Number.isSafeInteger(n)&&n>=0),'Invalid ps sample');
  const row={pid,ppid,rssBytes:rssKiB*1024};
  if(all.has(pid))assert.deepEqual(all.get(pid),row,'Conflicting duplicate PID');
  all.set(pid,row);
 }
 if(!all.has(rootPid))return {status:'unavailable',reason:'Root PID absent from ps snapshot; no RSS observation',processes:[],treeRssBytes:null};
 const ids=new Set([rootPid]);
 let changed=true;while(changed){changed=false;for(const p of all.values())if(ids.has(p.ppid)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}
 const processes=[...ids].sort((a,b)=>a-b).map(pid=>all.get(pid));
 return {status:'measured',processes,treeRssBytes:processes.reduce((sum,p)=>sum+p.rssBytes,0)};
}
