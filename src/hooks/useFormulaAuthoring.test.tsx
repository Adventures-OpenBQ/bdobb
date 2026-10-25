// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useFormulaAuthoring} from './useFormulaAuthoring';
import {tableExecutionStore as store,type ViewState} from '../stores/tableExecutionStore';
import {useDashboardStore as dashboards} from '../stores/dashboardStore';
import {createWorkerExecutor} from '../lib/tableExecution/workerClient';
import {Boundary} from '../test/tableWorkerBoundary';
import {input,revision} from '../lib/tableExecution/fixtures';
import type {TableModelV1} from '../lib/tableModel/types';
import type {ModelEdit} from '../stores/tableCommitCoordinator';
const model:TableModelV1={schemaVersion:1,params:{promotePage:false,filters:[]},enabled:true,categories:[{id:'c',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[{id:'m',sourceFieldId:'revenue',aggregation:'sum'}],formulas:[],layout:{rows:[],columns:[],values:['m']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
afterEach(()=>{cleanup();vi.restoreAllMocks();dashboards.setState({viewer:false});});
async function setup(){const executor=createWorkerExecutor('source',()=>new Boundary() as unknown as Worker);await executor.registerInput(input,1,new AbortController().signal);const view:ViewState={status:'failed',requested:revision,definition:{table:{},search:'',analytical:structuredClone(model)},selection:{kind:'none'},stale:false};vi.spyOn(store,'readView').mockImplementation(()=>view);vi.spyOn(store,'readExecutor').mockReturnValue(executor);dashboards.setState({viewer:false,dashboards:[]});return {executor,view};}
it('binds with invalid output and composes unrelated layout while refusing a changed target at queue execution',async()=>{const {executor,view}=await setup();let edit!:ModelEdit;const commit=vi.fn(async(e:ModelEdit)=>{edit=e;return true;});const h=renderHook(()=>useFormulaAuthoring('d','w',commit));const draft={id:'f',name:'F',scope:'aggregate' as const,expression:'Revenue[Region="A"]'};let bound;await act(async()=>{bound=await h.result.current!.bind(draft,[],new AbortController().signal);});expect(bound!.ast).toBeDefined();await h.result.current!.commit({...draft,ast:bound!.ast!},undefined,h.result.current!.contextKey);const unrelated={...model,subtotals:{grandTotal:false,groups:false},layout:{...model.layout,rows:['c']}};expect(edit.apply(unrelated)).toMatchObject({subtotals:{grandTotal:false},layout:{rows:['c']},formulas:[{id:'f'}]});expect(()=>edit.apply({...unrelated,measures:[{...model.measures[0],aggregation:'mean'}]})).toThrow('changed');expect(()=>edit.apply({...unrelated,categories:[{...model.categories[0],sourceFieldId:'team'}]})).toThrow('changed');expect(()=>edit.apply({...unrelated,formulas:[{...draft,ast:{kind:'literal',value:9}}]})).toThrow('changed');view.definition.search='changed';expect(()=>edit.apply(unrelated)).toThrow('changed');executor.dispose();});
it('refuses transplanting an AST to a changed draft, viewer authority or replacement executor',async()=>{const {executor}=await setup();const commit=vi.fn(async()=>true),h=renderHook(()=>useFormulaAuthoring('d','w',commit));const draft={id:'f',name:'F',scope:'aggregate' as const,expression:'1'};const bound=await h.result.current!.bind(draft,[],new AbortController().signal);expect(await h.result.current!.commit({...draft,name:'Changed',ast:bound.ast!},undefined,h.result.current!.contextKey)).toBe(false);dashboards.setState({viewer:true});await expect(h.result.current!.commit({...draft,ast:bound.ast!},undefined,h.result.current!.contextKey)).rejects.toThrow('changed');dashboards.setState({viewer:false});vi.spyOn(store,'readExecutor').mockReturnValue(createWorkerExecutor('source',()=>new Boundary() as unknown as Worker));await expect(h.result.current!.commit({...draft,ast:bound.ast!},undefined,h.result.current!.contextKey)).rejects.toThrow('changed');expect(commit).not.toHaveBeenCalled();executor.dispose();store.readExecutor('d','w')!.dispose();});
it('refuses an old formula binding immediately when a managed source is rebound before runtime sync',async()=>{
 const {executor}=await setup();
 const card={id:'w',widgetId:'managed',backendId:'b',params:{},layout:{x:0,y:0,w:1,h:1},managedSource:{sourceId:'old',kind:'upload' as const,version:1 as const}};
 dashboards.setState({dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card]}]}]});
 const commit=vi.fn(async()=>true),h=renderHook(()=>useFormulaAuthoring('d','w',commit));
 const draft={id:'f',name:'F',scope:'aggregate' as const,expression:'1'};
 const bound=await h.result.current!.bind(draft,[],new AbortController().signal);
 dashboards.setState({dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[{...card,managedSource:{...card.managedSource,sourceId:'new'}}]}]}]});
 await expect(h.result.current!.commit({...draft,ast:bound.ast!},undefined,h.result.current!.contextKey)).rejects.toThrow('changed');
 expect(commit).not.toHaveBeenCalled();executor.dispose();
});
