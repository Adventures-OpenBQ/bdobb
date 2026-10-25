// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ArrangePanel } from './ArrangePanel';
import type { TableModelV1 } from '../../../lib/tableModel/types';
const model:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[{id:'company',name:'Company',sourceFieldId:'name',transform:'native'},{id:'year',name:'Year',sourceFieldId:'date',transform:'Y'}],measures:[{id:'revenue',sourceFieldId:'revenue',aggregation:'sum'}],formulas:[{id:'margin',name:'Margin',scope:'aggregate',expression:'1',ast:{kind:'literal',value:1}}],layout:{rows:['company'],columns:[], values: ['margin']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
it('shows actual four lists and formulas, and moves a category with its stable identity',()=>{
 const commit=vi.fn(async (_next:TableModelV1)=>true);render(<ArrangePanel model={model} columns={[]} readonly={false} onCommitModel={commit}/>);
 for(const label of ['Available','Row Groups','Column Groups','Data Columns'])expect(screen.getByRole('heading',{name:new RegExp(label)})).toBeVisible();
 expect(screen.getByRole('button',{name:'Margin'})).toHaveAttribute('data-kind','formula');
 fireEvent.click(screen.getByRole('button',{name:'Year'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Row Groups'}));
 expect(commit).toHaveBeenCalledWith(expect.objectContaining({layout:{rows:['company','year'],columns:[], values: ['margin']}}));
});
it('offers source formulas as available pills and creates a separate measure without losing the formula identity',()=>{
 const source={...model,formulas:[...model.formulas,{id:'twice',name:'Twice revenue',scope:'source' as const,expression:'1',ast:{kind:'literal' as const,value:1}}]};const commit=vi.fn(async (_next:TableModelV1)=>true);
 render(<ArrangePanel model={source} columns={[]} readonly={false} onCommitModel={commit}/>);
 fireEvent.click(screen.getByRole('button',{name:'Twice revenue'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Data Columns'}));
 expect(commit.mock.calls[0][0].measures.at(-1)).toMatchObject({sourceFieldId:'twice'});expect(commit.mock.calls[0][0].formulas).toEqual(source.formulas);
});
it('offers guarded independent aggregation and removal actions for each stable measure instance',()=>{
 const commit=vi.fn(async (_next:TableModelV1)=>true);render(<ArrangePanel model={{...model,categories:model.categories.map(c=>({...c,transform:'native'}))}} columns={[{id:'revenue',label:'Revenue',dtype:'number'}]} readonly={false} onCommitModel={commit}/>);
 fireEvent.click(screen.getByRole('button',{name:'Revenue — Total'}));fireEvent.click(screen.getByRole('menuitem',{name:'Aggregation'}));
 expect(screen.queryByRole('menuitemcheckbox',{name:'First'})).toBeNull();
 fireEvent.click(screen.getByRole('menuitemcheckbox',{name:'Average'}));
 expect(commit).toHaveBeenCalledWith(expect.objectContaining({measures:[{id:'revenue',sourceFieldId:'revenue',aggregation:'mean'}]}));
 fireEvent.click(screen.getByRole('button',{name:'Revenue — Total'}));fireEvent.click(screen.getByRole('menuitem',{name:'Remove from Data Columns'}));
 expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({measures:[]}));
});
it('moves aggregate formula placement by keyboard without deleting its definition and exposes a named badge',()=>{
 const available={...model,layout:{...model.layout,values:[]}};const commit=vi.fn(async (_next:TableModelV1)=>true);
 render(<ArrangePanel model={available} columns={[]} readonly={false} onCommitModel={commit}/>);
 expect(screen.getByRole('img',{name:'Aggregate formula'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Margin'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Data Columns'}));
 expect(commit.mock.calls[0][0].layout.values).toContain('margin');expect(commit.mock.calls[0][0].formulas).toEqual(model.formulas);
});
it('aggregate drag and keyboard reorder mixed values with full title and Available removal',()=>{
 const raw={...model,layout:{...model.layout,values:['revenue','margin']}};const commit=vi.fn(async (_next:TableModelV1)=>true);const {rerender}=render(<ArrangePanel model={raw} columns={[]} readonly={false} onCommitModel={commit}/>);
 const margin=screen.getByRole('button',{name:'Margin'});expect(margin).toHaveAttribute('title','Margin');expect(margin).toHaveAttribute('draggable','true');
 fireEvent.keyDown(margin,{key:'ArrowUp',altKey:true});expect(commit.mock.calls[0][0].layout.values).toEqual(['margin','revenue']);
 const transfer={types:['application/x-bdobb-report-pill'],getData:()=>JSON.stringify({id:'margin',kind:'formula'})};
 fireEvent.drop(screen.getByRole('button',{name:'revenue — Total'}),{dataTransfer:transfer});expect(commit.mock.calls[1][0].layout.values).toEqual(['margin','revenue']);
 rerender(<ArrangePanel model={commit.mock.calls[1][0]} columns={[]} readonly={false} onCommitModel={commit}/>);
 fireEvent.click(screen.getByRole('button',{name:'Margin'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Available'}));expect(commit.mock.calls[2][0].layout.values).toEqual(['revenue']);expect(commit.mock.calls[2][0].formulas).toEqual(raw.formulas);
});
it('dropping a Data pill on itself preserves placement without saving',()=>{
 const commit=vi.fn(async (_next:TableModelV1)=>true);render(<ArrangePanel model={{...model,layout:{...model.layout,values:['revenue','margin']}}} columns={[]} readonly={false} onCommitModel={commit}/>);
 const transfer={types:['application/x-bdobb-report-pill'],getData:()=>JSON.stringify({id:'margin',kind:'formula'})};
 fireEvent.drop(screen.getByRole('button',{name:'Margin'}),{dataTransfer:transfer});expect(commit).not.toHaveBeenCalled();
});
it('aggregate placement removal deletes one authored occurrence without cleaning unknown intent',()=>{
 const raw={...model,layout:{...model.layout,values:['margin','unknown','margin']}};const commit=vi.fn(async (_next:TableModelV1)=>true);
 render(<ArrangePanel model={raw} columns={[]} readonly={false} onCommitModel={commit}/>);
 fireEvent.click(screen.getByRole('button',{name:'Margin'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Available'}));
 expect(commit.mock.calls[0][0].layout.values).toEqual(['unknown','margin']);
});
it('D-014: labels an M category pill Month',()=>{
 render(<ArrangePanel model={{...model,categories:[...model.categories,{id:'month',name:'Period',sourceFieldId:'date',transform:'M'}]}} columns={[]} readonly={false} onCommitModel={async()=>true}/>);
 expect(screen.getByRole('button',{name:'Period'})).toHaveTextContent('PeriodMonth');
});
it('adds a new measure with no aggregation, whatever the field kind',()=>{
 const commit=vi.fn(async (_next:TableModelV1)=>true);
 render(<ArrangePanel model={model} columns={[{id:'amount',label:'Amount',dtype:'number'},{id:'name',label:'Name',dtype:'text'}]} readonly={false} onCommitModel={commit}/>);
 fireEvent.click(screen.getByRole('button',{name:'Amount'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Data Columns'}));
 expect(commit.mock.calls[0][0].measures.at(-1)).toEqual({id:expect.any(String),sourceFieldId:'amount'});
 fireEvent.click(screen.getByRole('button',{name:'Name'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move to Data Columns'}));
 expect(commit.mock.calls[1][0].measures.at(-1)).toEqual({id:expect.any(String),sourceFieldId:'name'});
});
it('names aggregations the same in the submenu as on the pill tag: Unique count (#24)',()=>{
 render(<ArrangePanel model={model} columns={[{id:'revenue',label:'Revenue',dtype:'number'}]} readonly={false} onCommitModel={vi.fn(async()=>true)}/>);
 fireEvent.click(screen.getByRole('button',{name:'Revenue — Total'}));fireEvent.click(screen.getByRole('menuitem',{name:'Aggregation'}));
 expect(screen.getByRole('menuitemcheckbox',{name:'Unique count'})).toBeInTheDocument();
 expect(screen.queryByRole('menuitemcheckbox',{name:'UniqueCount'})).toBeNull();
});
