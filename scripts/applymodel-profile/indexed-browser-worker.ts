// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {createWorkerHandler} from '../../src/lib/tableExecution/table.worker';
const query=new URL(self.location.href).searchParams;
const budget=query.get('indexed')==='1'?Number(query.get('budget')??0):0;
if(!Number.isSafeInteger(budget)||budget<0)throw Error('Invalid audit budget');
(globalThis as any).__indexedBudget=budget;
const handle=createWorkerHandler(response=>self.postMessage({...response,__audit:structuredClone((globalThis as any).__auditState??{})}));
self.onmessage=event=>{(globalThis as any).__auditState={calculations:0};void handle(event.data);};
