// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';

/** Private versioned contract; unknown actions are rejected before spawning. */
export function performanceActions(kind){
 assert.ok(['ticks','statement','bulk'].includes(kind));
 return {version:'performance-trace/1',actions:kind==='ticks'?[
  ...[['1s','Q'],['1m','Q'],['1s','Q'],['1s','24EQ'],['1s','Q'],['1s','Q']].map(([granularity,venue])=>({kind:'apply',granularity,venue})),
  {kind:'sort',direction:'descending'},
  {kind:'linkedRead',consumers:['table','chart','selection','facets','inspection','export','errors']},
  {kind:'empty-clear',cycles:5},
 ]:[{kind:'apply'},{kind:'apply'},{kind:'linkedRead',consumers:['table','chart','selection','facets','inspection','export','errors']},{kind:'empty-clear',cycles:5}]}.actions;
}
export function validatePerformanceActions(actions,kind){assert.deepEqual(actions,{version:'performance-trace/1',actions:performanceActions(kind)},'Unsupported performance action contract');}

export {processTreeSnapshot} from './process-tree.mjs';
