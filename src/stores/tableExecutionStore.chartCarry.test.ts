// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {backendTableSource,createTableExecutionStore} from './tableExecutionStore';
import {createWorkerExecutor} from '../lib/tableExecution/workerClient';
import {Boundary} from '../test/tableWorkerBoundary';
import {useWidgetRegistryStore} from './widgetRegistryStore';
import {card,widget} from '../test/fixtures';
it.each(['rows','snapshot'] as const)('rejects an oversized backend %s payload before dataset materialization',async shape=>{
 const source=card({id:`oversized-${shape}`,widgetId:'oversized-table'});
 const values=Object.fromEntries(Array.from({length:2001},(_,i)=>[`field${i}`,i]));
 const rows=Array.from({length:1000},()=>values);
 const store=createTableExecutionStore({source:backendTableSource});
 useWidgetRegistryStore.setState({widgets:[widget({id:'oversized-table',type:'table'})]});
 store.setBackendRows('oversized-dashboard',source.id,shape==='rows'?rows:{rows,completeness:'partial'});
 const outcome=await backendTableSource(source).acquire(new AbortController().signal)
  .then(()=> 'accepted oversized input',error=>error.message);
 expect(outcome).toBe('This table is too large for the table engine');
});

it('rejects a late rows-and-receipt handover owned by an obsolete authenticated question',async()=>{
 const source=card({id:'question-source',widgetId:'question-table',params:{symbol:'AAPL'}});
 useWidgetRegistryStore.setState({widgets:[widget({id:'question-table',type:'table',table:{columns:[{field:'price'}]}})]});
 const store=createTableExecutionStore({source:backendTableSource,executor:id=>createWorkerExecutor(id,()=>new Boundary() as unknown as Worker)});
 const first=store.observeBackendQuestion(source.id,'original-private-question');
 store.syncDashboard({id:'question-dashboard',name:'Q',tabs:[{id:'tab',name:'T',cards:[source]}]});
 store.setBackendRows('question-dashboard',source.id,[{price:10}],undefined,first);
 await store.settled('question-dashboard');
 expect(store.readView('question-dashboard',source.id).active).toBeDefined();
 const second=store.observeBackendQuestion(source.id,'replacement-private-question');
 expect(store.readView('question-dashboard',source.id).active).toBeUndefined();
 store.setBackendRows('question-dashboard',source.id,[{price:99}],undefined,first);
 expect(store.readView('question-dashboard',source.id).active).toBeUndefined();
 store.setBackendRows('question-dashboard',source.id,[{price:20}],undefined,second);
 await store.settled('question-dashboard');
 const current=store.readView('question-dashboard',source.id);
 const output=await store.readExecutor('question-dashboard',source.id)!.chartData(current.active!,['price'],new AbortController().signal);
 expect(output.rows.map(row=>row.values.price)).toEqual([20]);
 store.disposeDashboard('question-dashboard');
});
