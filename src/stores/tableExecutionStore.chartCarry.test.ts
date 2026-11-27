// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {backendTableSource,createTableExecutionStore} from './tableExecutionStore';
import {createWorkerExecutor} from '../lib/tableExecution/workerClient';
import {Boundary} from '../test/tableWorkerBoundary';
import {useWidgetRegistryStore} from './widgetRegistryStore';
import {card,widget} from '../test/fixtures';
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
