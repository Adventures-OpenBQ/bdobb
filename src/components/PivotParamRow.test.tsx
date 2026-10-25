// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { tableExecutionStore } from '../stores/tableExecutionStore';
import { PivotParamControl, PivotParamRow } from './PivotParamRow';
import { migratePivot } from '../lib/tableModel/migration';
import { paramRow, promote, setFilterKeys } from '../lib/tableModel/pivotParams';
import type { ModelEdit } from '../stores/tableCommitCoordinator';
const cat='category:["Sector","native"]';
const model=()=>promote(setFilterKeys(migratePivot({enabled:true,grouping:['Sector'],split:[]}),cat,['["string","Tech"]','["string","Energy"]']),cat,{id:'sector-param',label:'Sector',multiSelect:false});
const members=[{key:'["string","Tech"]',label:'Tech',value:'Tech',count:1},{key:'["string","Energy"]',label:'Energy',value:'Energy',count:1}];
it('shows saved multi values in single mode and edits only after explicit owner selection',async()=>{
 const raw=model();const edit=vi.fn(async (_:ModelEdit)=>true);
 render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={edit}/>);
 expect(screen.getByRole('button',{name:/Sector: Tech, Energy/})).toBeInTheDocument();expect(edit).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:/Sector:/}));fireEvent.click(screen.getByLabelText('Tech'));
 expect(edit).toHaveBeenCalledTimes(1);const next=edit.mock.calls[0][0].apply({...raw,params:{...raw.params,promotePage:false}});
 expect(next.checklists).toEqual([{categoryId:cat,memberKeys:['["string","Tech"]']}]);expect(next.params.promotePage).toBe(false);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('preserves unknown selected keys and distinguishes All from explicit empty; viewer remains disabled',async()=>{
 const raw=promote(setFilterKeys(model(),cat,['["string","TSLA"]']),cat,{id:'sector-param',label:'Sector',multiSelect:true});const edit=vi.fn(async (_:ModelEdit)=>true);
 const {rerender}=render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={edit}/>);
 fireEvent.click(screen.getByRole('button',{name:/TSLA/}));expect(screen.getByText(/TSLA.*unavailable/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'All'}));expect(edit.mock.calls[0][0].apply(raw).checklists).toEqual([]);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:/TSLA/}));fireEvent.click(screen.getByRole('button',{name:'Clear'}));expect(edit.mock.calls[1][0].apply(raw).checklists).toEqual([{categoryId:cat,memberKeys:[]}]);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());rerender(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly onEditModel={edit}/>);
 expect(screen.getByRole('button',{name:/TSLA/})).toBeDisabled();
});
it('does not fabricate options before a revision-fenced facet arrives',()=>{
 const raw=model();render(<PivotParamControl param={paramRow(raw)[0]} readonly={false} onEditModel={vi.fn()}/>);
 expect(screen.getByRole('button',{name:/Sector:/})).toBeDisabled();expect(within(document.body).queryByRole('checkbox')).toBeNull();
});
it('retains the selected draft and exposes save failure instead of closing the popup',async()=>{
 const raw=promote(model(),cat,{id:'sector-param',label:'Sector',multiSelect:true});render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={async()=>false}/>);
 fireEvent.click(screen.getByRole('button',{name:/Sector:/}));fireEvent.click(screen.getByLabelText('Energy'));fireEvent.click(screen.getByRole('button',{name:'Apply'}));await screen.findAllByRole('alert');expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByLabelText('Tech')).toBeChecked();expect(screen.getByLabelText('Energy')).not.toBeChecked();
 fireEvent.keyDown(screen.getByLabelText('Tech'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('button',{name:/Sector:/})).toHaveFocus();
});

it('orders Page, ordinary widget controls and promoted filters without creating a coordinator owner',()=>{
 const raw=model();raw.layout={rows:[],columns:[],values:[],page:{categoryId:cat,memberKeys: ['["string","Tech"]']}};
 const view={status:'pending' as const,requested:{widgetId:'header-only',input:0,model:0,output:0},definition:{table:{},search:'',analytical:raw},selection:{kind:'none' as const},stale:false};
 const spy=vi.spyOn(tableExecutionStore,'readView').mockReturnValue(view);
 try {const {container}=render(<PivotParamRow dashboardId="header-only" widgetId="header-only" raw={raw} viewer={false} ordinary={<span className="param-field" data-ordinary="">Symbol</span>}/>);expect(Array.from(container.querySelector('.card-params')!.children).map(el=>el.getAttribute('data-pivot-param')??'ordinary')).toEqual(['pivot:page','ordinary',`pivot:filter:${cat}`]);expect(screen.getByRole('button',{name:'Sector: Tech'})).toBeDisabled();}finally{spy.mockRestore();}
});

it('keeps newer unsaved popup choices through older Apply success and revision facet refresh',async()=>{
 const raw=promote(model(),cat,{id:'sector-param',label:'Sector',multiSelect:true});let resolve!:(value:boolean)=>void;const pendingSave=new Promise<boolean>(r=>{resolve=r;});
 const edit=vi.fn((_edit:ModelEdit)=>pendingSave);const {rerender}=render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={edit}/>);
 fireEvent.click(screen.getByRole('button',{name:/Sector:/}));fireEvent.click(screen.getByLabelText('Energy'));fireEvent.click(screen.getByRole('button',{name:'Apply'}));fireEvent.click(screen.getByLabelText('Tech'));
 await act(async()=>{resolve(true);await pendingSave;});expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByLabelText('Tech')).not.toBeChecked();expect(screen.getByLabelText('Energy')).not.toBeChecked();
 const published=edit.mock.calls[0][0].apply(raw);rerender(<PivotParamControl param={paramRow(published)[0]} pending readonly={false} onEditModel={edit}/>);expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByRole('button',{name:'Apply'})).toBeDisabled();
 rerender(<PivotParamControl param={paramRow(published)[0]} members={members} readonly={false} onEditModel={edit}/>);expect(screen.getByLabelText('Tech')).not.toBeChecked();expect(screen.getByLabelText('Energy')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'Apply'}));expect(edit.mock.calls[1][0].apply(published).checklists).toEqual([{categoryId:cat,memberKeys:[]}]);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('a queued Page category replacement or demotion refuses a choice from the old header facet',()=>{
 const raw=model();raw.layout={rows:[],columns:[],values:[],page:{categoryId:cat,memberKeys: [members[0].key]}};const queue:ModelEdit[]=[];
 render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={edit=>{queue.push(edit);return new Promise(()=>{});}}/>);fireEvent.click(screen.getByRole('button',{name:'Sector: Tech'}));fireEvent.click(screen.getByLabelText('Tech'));fireEvent.click(screen.getByLabelText('Energy'));fireEvent.click(screen.getByRole('button',{name:'Apply'}));
 const replacement={...raw,layout:{...raw.layout,page:{categoryId:'replacement-category',memberKeys: ['replacement-key']}}};expect(queue[0].apply(replacement)).toBe(replacement);
 const demoted={...raw,params:{...raw.params,promotePage:false}};expect(queue[0].apply(demoted)).toBe(demoted);
 const latest={...raw,params:{...raw.params,filters:[]}};expect(queue[0].apply(latest).layout.page).toEqual({categoryId:cat,memberKeys:[members[1].key]});
});
it('opening All and applying an untouched draft retains semantic All instead of freezing current facet members',async()=>{const raw=promote(setFilterKeys(model(),cat,null),cat,{id:'sector-param',label:'Sector',multiSelect:true});const edit=vi.fn(async(_edit:ModelEdit)=>true);render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={edit}/>);fireEvent.click(screen.getByRole('button',{name:'Sector: All'}));fireEvent.click(screen.getByRole('button',{name:'Apply'}));expect(edit.mock.calls[0][0].apply(raw).checklists).toEqual([]);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());});
it('viewer recovery All stays available after facet load failure without fabricating options',async()=>{const publish=vi.fn(async(_value:string[]|null)=>true);render(<PivotParamControl param={paramRow(model())[0]} readonly={false} error="Could not load" onEditModel={vi.fn()} onPublish={publish}/>);fireEvent.click(screen.getByRole('button',{name:'Use All Sector values'}));await waitFor(()=>expect(publish).toHaveBeenCalledWith(null));expect(screen.queryByRole('checkbox')).toBeNull();});
it('reset closes the discarded session draft and supersedes an older Apply completion',async()=>{let resolve!:(saved:boolean)=>void;const published=new Promise<boolean>(r=>resolve=r);const param={...paramRow(model())[0],multiSelect:true};const reset=vi.fn(async()=>true);render(<PivotParamControl param={param} members={members} readonly={false} session onReset={reset} onPublish={()=>published} onEditModel={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/Sector:/}));fireEvent.click(screen.getByRole('button',{name:'Apply'}));fireEvent.click(screen.getByRole('button',{name:'Reset Sector session value'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());await act(async()=>{resolve(false);await published;});expect(reset).toHaveBeenCalledOnce();expect(screen.queryByRole('alert')).toBeNull();});
it('owner Page popup applies the complete set and distinguishes None from All',async()=>{
 const raw=model();raw.layout={rows:[],columns:[],values:[],page:{categoryId:cat,memberKeys:[members[0].key]}};const edits:ModelEdit[]=[];
 render(<PivotParamControl param={paramRow(raw)[0]} members={members} readonly={false} onEditModel={async edit=>{edits.push(edit);return true;}}/>);fireEvent.click(screen.getByRole('button',{name:'Sector: Tech'}));fireEvent.click(screen.getByLabelText('Energy'));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Apply'})));expect(edits[0].apply(raw).layout.page?.memberKeys).toEqual(members.map(m=>m.key));fireEvent.click(screen.getByRole('button',{name:'Sector: Tech'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'None'})));expect(edits[1].apply(raw).layout.page).toEqual({categoryId:cat,memberKeys:[]});fireEvent.click(screen.getByRole('button',{name:'Sector: Tech'}));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'All'})));expect(edits[2].apply(raw).layout.page).toBeUndefined();
});
