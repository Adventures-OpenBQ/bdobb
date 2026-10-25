// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { DrawerFooterTarget } from '../pivot-drawer/DrawerFooterTarget';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import type { TableModelV1 } from '../../../lib/tableModel/types';
import type { FacetResult } from '../../../lib/tableExecution/types';
import { FacetFilterPopover } from './FacetFilterPopover';
import { PageSelector } from './PageSelector';
const initial:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[{id:'s',name:'Scenario',sourceFieldId:'scenario',transform:'native'},{id:'y',name:'Year',sourceFieldId:'date',transform:'Y'}],measures:[],formulas:[],layout:{rows:['y'],columns:[], values: [],page:{categoryId:'s',memberKeys: ['actual']}},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
const facet={categoryId:'s',members:[{key:'actual',label:'Actual',value:'Actual',count:900},{key:'budget',label:'Budget',value:'Budget',count:1200},{key:'blank',label:'(Blank)',value:null,count:20}]} as FacetResult;
afterEach(cleanup);
function Checklist({readonly=false}:{readonly?:boolean}){const [model,setModel]=useState(initial);return <><FacetFilterPopover model={model} categoryId="s" facet={facet} readonly={readonly} onCommitModel={next=>{setModel(next);return Promise.resolve(true);}}/><output aria-label="Committed">{JSON.stringify(model.checklists)}</output></>;}
it('searches full engine members and selects all independently of search, then clears',async()=>{
 render(<Checklist/>);fireEvent.change(screen.getByLabelText('Search members'),{target:{value:'Budget'}});
 expect(screen.getByText('Budget (1200)')).toBeInTheDocument();expect(screen.queryByText('Actual (900)')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Select all'}));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Apply checklist'}));});
 expect(screen.getByLabelText('Committed').textContent).toContain('actual');expect(screen.getByLabelText('Committed').textContent).toContain('blank');
 fireEvent.click(screen.getByRole('button',{name:'Clear'}));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Apply checklist'}));});
 expect(screen.getByLabelText('Committed').textContent).toContain('"memberKeys":[]');
});
it('cannot commit checklist in readonly mode',()=>{render(<Checklist readonly/>);expect(screen.getByRole('button',{name:'Apply checklist'})).toBeDisabled();});
it('replaces the single Pages category and navigates without dropping invalid member intent',async()=>{
 function Pages(){const [model,setModel]=useState(initial);return <><PageSelector model={model} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={next=>{setModel(next);return Promise.resolve(true);}}/><output>{JSON.stringify(model.layout)}</output></>;}
 render(<Pages/>);await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Next page'}));});expect(screen.getByLabelText('Page member')).toHaveValue('budget');
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Previous page'}));});expect(screen.getByLabelText('Page member')).toHaveValue('actual');
 await act(async()=>{fireEvent.change(screen.getByLabelText('Pages category'),{target:{value:'y'}});});expect(screen.getByRole('button',{name:'Next page'})).toBeDisabled();
 expect(screen.getByRole('combobox',{name:'Pages category'})).toHaveValue('y');expect(screen.getByText(/"rows":\["y"\]/)).toBeInTheDocument();
});
it('creating Pages waits for an explicit member before committing a binding',async()=>{
 function Pages(){const [model,setModel]=useState({...initial,layout:{rows:['y'],columns:[], values: []}} as TableModelV1);return <><PageSelector model={model} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={next=>{setModel(next);return Promise.resolve(true);}}/><output aria-label="Layout">{JSON.stringify(model.layout)}</output></>;}
 render(<Pages/>);await act(async()=>{fireEvent.change(screen.getByLabelText('Pages category'),{target:{value:'s'}});});expect(screen.getByLabelText('Layout')).not.toHaveTextContent('page');await act(async()=>{fireEvent.change(screen.getByLabelText('Page member'),{target:{value:'budget'}});fireEvent.click(screen.getByRole('button',{name:'Save page'}));});expect(screen.getByLabelText('Layout')).toHaveTextContent('"memberKeys":["budget"]');
});
it('Pages navigation excludes its own checklist-disallowed members despite self-excluded facet counts',()=>{
 render(<PageSelector model={{...initial,layout:{...initial.layout,page:{categoryId:'s',memberKeys: ['budget']}},checklists:[{categoryId:'s',memberKeys:['actual']}]}} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={async()=>true}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Unavailable page');expect(screen.getByRole('button',{name:'Next page'})).toBeDisabled();expect(screen.getByRole('button',{name:'Previous page'})).toBeDisabled();expect(screen.getByLabelText('Page member')).toHaveValue('budget');expect(screen.queryByRole('option',{name:'Budget (1200)'})).not.toBeInTheDocument();
});
it('owner Page value edits compose functionally with independent latest placement',async()=>{
 const edits:import('../../../stores/tableCommitCoordinator').ModelEdit[]=[];
 render(<PageSelector model={initial} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={async()=>false} onEditModel={async edit=>{edits.push(edit);return true;}}/>);
 await act(async()=>{fireEvent.change(screen.getByLabelText('Page member'),{target:{value:'budget'}});fireEvent.click(screen.getByRole('button',{name:'Save page'}));});expect(edits).toHaveLength(1);const latest={...initial,params:{...initial.params,promotePage:false},layout:{...initial.layout,columns:['y']}};
 const changed=edits[0].apply(latest);expect(changed.params.promotePage).toBe(true);expect(changed.layout.page?.memberKeys).toEqual(['budget']);expect(changed.layout.columns).toEqual(['y']);
});
it('an untouched checklist follows header commits while an unsaved checklist draft is retained',()=>{
 const {rerender}=render(<FacetFilterPopover model={initial} categoryId="s" facet={facet} readonly={false} onCommitModel={async()=>true}/>);
 const next={...initial,checklists:[{categoryId:'s',memberKeys:['actual']}]};rerender(<FacetFilterPopover model={next} categoryId="s" facet={facet} readonly={false} onCommitModel={async()=>true}/>);expect(screen.getByLabelText('Budget (1200)')).not.toBeChecked();
 fireEvent.click(screen.getByLabelText('Budget (1200)'));rerender(<FacetFilterPopover model={{...next,checklists:[{categoryId:'s',memberKeys:['blank']}]}} categoryId="s" facet={facet} readonly={false} onCommitModel={async()=>true}/>);expect(screen.getByLabelText('Actual (900)')).toBeChecked();expect(screen.getByLabelText('Budget (1200)')).toBeChecked();expect(screen.getByLabelText('(Blank) (20)')).not.toBeChecked();
});
it('a settled checklist save does not discard a newer unsaved draft',async()=>{
 let resolve!:(value:boolean)=>void;const saved=new Promise<boolean>(r=>{resolve=r;});render(<FacetFilterPopover model={initial} categoryId="s" facet={facet} readonly={false} onCommitModel={()=>saved}/>);
 fireEvent.click(screen.getByLabelText('Budget (1200)'));fireEvent.click(screen.getByRole('button',{name:'Apply checklist'}));fireEvent.click(screen.getByLabelText('Actual (900)'));await act(async()=>{resolve(true);await saved;});expect(screen.getByLabelText('Actual (900)')).not.toBeChecked();expect(screen.getByLabelText('Budget (1200)')).not.toBeChecked();expect(screen.getByLabelText('(Blank) (20)')).toBeChecked();
});

it('places checklist actions in the supplied drawer footer while preserving standalone controls',()=>{
 const target=document.createElement('div');document.body.appendChild(target);try{render(<DrawerFooterTarget value={target}><FacetFilterPopover model={initial} categoryId="s" facet={facet} readonly={false} onCommitModel={async()=>true}/></DrawerFooterTarget>);expect(within(target).getByRole('button',{name:'Apply checklist'})).toBeVisible();expect(within(target).getByRole('button',{name:'Remove checklist'})).toBeVisible();}finally{target.remove();}
});

it('groups member search and choices in the same fieldset and explains the count scope in its footer',()=>{
 render(<FacetFilterPopover model={initial} categoryId="s" facet={facet} readonly={false} onCommitModel={async()=>true}/>);const fieldset=screen.getByRole('group',{name:'Available members · Scenario'});expect(within(fieldset).getByLabelText('Search members')).toBeVisible();expect(within(fieldset).getByRole('button',{name:'Select all'})).toBeVisible();expect(within(fieldset).getByLabelText('Actual (900)')).toBeVisible();expect(screen.getByText("Counts exclude this category's own checklist.")).toBeVisible();expect(screen.queryByText('Changes apply as you go')).toBeNull();
});

it('shows every retained Page member and empty set without choosing a first member',()=>{
 const multi={...initial,layout:{...initial.layout,page:{categoryId:'s',memberKeys:['actual','budget','missing']}}};const {rerender}=render(<PageSelector model={multi} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={async()=>true}/>);expect(screen.getByLabelText('Selected Page members')).toHaveTextContent('Actual, Budget, missing');expect(screen.getByLabelText('Page member')).toHaveValue('');expect(screen.getByRole('button',{name:'Next page'})).toBeDisabled();expect(screen.getByRole('button',{name:'Previous page'})).toBeDisabled();rerender(<PageSelector model={{...multi,layout:{...multi.layout,page:{categoryId:'s',memberKeys:[]}}}} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={async()=>true}/>);expect(screen.getByLabelText('Selected Page members')).toHaveTextContent('No members');
});
it('category draft does not reinterpret Page keys and queued stale choices cannot replace a newer category',async()=>{
 const edits:import('../../../stores/tableCommitCoordinator').ModelEdit[]=[];render(<PageSelector model={initial} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={async()=>false} onEditModel={async edit=>{edits.push(edit);return true;}}/>);fireEvent.change(screen.getByLabelText('Pages category'),{target:{value:'y'}});expect(edits).toHaveLength(0);fireEvent.change(screen.getByLabelText('Pages category'),{target:{value:'s'}});await act(async()=>{fireEvent.change(screen.getByLabelText('Page member'),{target:{value:'budget'}});fireEvent.click(screen.getByRole('button',{name:'Save page'}));});const replacement={...initial,layout:{...initial.layout,page:{categoryId:'y',memberKeys:['2026']}}};expect(edits[0].apply(replacement)).toBe(replacement);
});
it('retains explicit member draft when saving fails and fences queued category removal',async()=>{
 const edits:import('../../../stores/tableCommitCoordinator').ModelEdit[]=[];render(<PageSelector model={initial} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={async()=>false} onEditModel={async edit=>{edits.push(edit);return false;}}/>);await act(async()=>{fireEvent.change(screen.getByLabelText('Page member'),{target:{value:'budget'}});fireEvent.click(screen.getByRole('button',{name:'Save page'}));});expect(screen.getByLabelText('Page member')).toHaveValue('budget');expect(screen.getByRole('alert')).toHaveTextContent('Could not save');await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Delete page'}));});const replacement={...initial,layout:{...initial.layout,page:{categoryId:'y',memberKeys:['2026']}}};expect(edits[1].apply(replacement)).toBe(replacement);
});
it('a stale failed Page save cannot poison a newer category draft',async()=>{
 let settle!:(value:boolean)=>void;const saving=new Promise<boolean>(resolve=>{settle=resolve;});render(<PageSelector model={initial} facet={facet} readonly={false} onRequestFacet={()=>{}} onCommitModel={()=>saving}/>);fireEvent.change(screen.getByLabelText('Page member'),{target:{value:'budget'}});fireEvent.click(screen.getByRole('button',{name:'Save page'}));fireEvent.change(screen.getByLabelText('Pages category'),{target:{value:'y'}});await act(async()=>{settle(false);await saving;});expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByLabelText('Pages category')).toHaveValue('y');
});
