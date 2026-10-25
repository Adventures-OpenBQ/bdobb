// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CategoryEditor } from './CategoryEditor';
import { ResultFilterPanel } from './ResultFilterPanel';
import type { TableModelV1 } from '../../../lib/tableModel/types';
const model:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[{id:'year',name:'Year',sourceFieldId:'date',transform:'Y'},{id:'quarter',name:'Quarter',sourceFieldId:'date',transform:'Q'}],measures:[{id:'revenue',sourceFieldId:'value',aggregation:'mean'}],formulas:[],layout:{rows:['year','quarter'],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
const columns=[{id:'date',label:'Report date',dtype:'date' as const},{id:'value',label:'Revenue',dtype:'number' as const},{id:'company',label:'Company'}];
afterEach(cleanup);
it('edits repeated temporal category labels and moves stable IDs between axes',async()=>{
 function Editor(){const [value,setValue]=useState(model);return <><CategoryEditor model={value} columns={columns} readonly={false} onCommitModel={next=>{setValue(next);return Promise.resolve(true);}}/><output>{JSON.stringify(value.categories)} {JSON.stringify(value.layout)}</output></>;}
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'Quarter'}));fireEvent.change(screen.getByLabelText('Category name'),{target:{value:'Period'}});fireEvent.change(screen.getByLabelText('Position'),{target:{value:'columns'}});fireEvent.click(screen.getByRole('button',{name:'Save category'}));
 await waitFor(()=>expect(screen.getByText(/"id":"quarter","name":"Period"/)).toBeInTheDocument());expect(screen.getByText(/"rows":\["year"\],"columns":\["quarter"\]/)).toBeInTheDocument();
});
it('requires explicit fiscal mappings rather than guessing a company calendar',async()=>{
 render(<CategoryEditor model={model} columns={columns} readonly={false} onCommitModel={async()=>true}/>);fireEvent.change(screen.getByLabelText('Transformation'),{target:{value:'FY'}});fireEvent.click(screen.getByRole('button',{name:'Save category'}));expect(await screen.findByRole('alert')).toHaveTextContent('company');expect(screen.getByLabelText('Company field')).toBeInTheDocument();
});
it('result filters bind the chosen category level and measure instance',async()=>{
 function Filter(){const [value,setValue]=useState(model);return <><ResultFilterPanel model={value} columns={columns} readonly={false} onCommitModel={next=>{setValue(next);return Promise.resolve(true);}}/><output>{JSON.stringify(value.resultFilters)}</output></>;}
 render(<Filter/>);fireEvent.change(screen.getByLabelText('Filter level'),{target:{value:'quarter'}});fireEvent.change(screen.getByLabelText('Comparison value'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'Add result filter'}));await waitFor(()=>expect(screen.getByText(/"categoryId":"quarter"/)).toBeInTheDocument());expect(screen.getByText(/"kind":"measure","id":"revenue"/)).toBeInTheDocument();
});
it('renaming a category preserves its existing axis order',async()=>{
 function Editor(){const [value,setValue]=useState(model);return <><CategoryEditor model={value} columns={columns} readonly={false} onCommitModel={next=>{setValue(next);return Promise.resolve(true);}}/><output aria-label="Layout">{JSON.stringify(value.layout)}</output></>;}
 render(<Editor/>);fireEvent.change(screen.getByLabelText('Category name'),{target:{value:'Calendar year'}});fireEvent.click(screen.getByRole('button',{name:'Save category'}));await waitFor(()=>expect(screen.getByLabelText('Layout')).toHaveTextContent('"rows":["year","quarter"]'));
});

it('shows selectable categories and retains the draft when guarded deletion has dependencies',async()=>{
 const dependent={...model,checklists:[{categoryId:'year',memberKeys:[]}]};
 let committed=false;
 render(<CategoryEditor model={dependent} columns={columns} readonly={false} onCommitModel={async()=>{committed=true;return true;}}/>);
 expect(screen.getByRole('button',{name:'Year'})).toHaveAttribute('aria-pressed','true');
 fireEvent.change(screen.getByLabelText('Category name'),{target:{value:'Draft year'}});
 fireEvent.click(screen.getByRole('button',{name:'Delete category'}));
 expect(await screen.findByRole('alert')).toBeInTheDocument();
 expect(committed).toBe(false);expect(screen.getByLabelText('Category name')).toHaveValue('Draft year');
});
it('removes only its own axis assignment on a valid delete and creates a fresh draft',async()=>{
 function Editor(){const [value,setValue]=useState(model);return <><CategoryEditor model={value} columns={columns} readonly={false} onCommitModel={async next=>{setValue(next);return true;}}/><output aria-label="Saved model">{JSON.stringify(value)}</output></>;}
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'Delete category'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('"rows":["quarter"]'));
 expect(screen.getByLabelText('Category name')).toHaveValue('New category');expect(screen.queryByRole('button',{name:'Delete category'})).not.toBeInTheDocument();
});
it('keeps footer actions outside the definition and blocks readonly mutation',()=>{
 render(<CategoryEditor model={model} columns={columns} readonly onCommitModel={async()=>true}/>);
 const save=screen.getByRole('button',{name:'Save category'});expect(save.closest('fieldset')).toBeNull();expect(save).toBeDisabled();expect(screen.getByRole('button',{name:'Delete category'})).toBeDisabled();expect(screen.getByRole('button',{name:'New category'})).toBeDisabled();
});
it('retains edits after save failure and emits stable order moves',async()=>{
 const commits:TableModelV1[]=[];
 render(<CategoryEditor model={model} columns={columns} readonly={false} onCommitModel={async next=>{commits.push(next);return false;}}/>);
 fireEvent.change(screen.getByLabelText('Category name'),{target:{value:'Unsaved year'}});fireEvent.click(screen.getByRole('button',{name:'Save category'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('draft has been retained');expect(screen.getByLabelText('Category name')).toHaveValue('Unsaved year');
 fireEvent.click(screen.getByRole('button',{name:'Move rows category 2 earlier'}));expect(commits[1].layout.rows).toEqual(['quarter','year']);
});
it('rejects deleting Page and result-filter dependencies without cascading them',async()=>{
 const dependent={...model,layout:{...model.layout,rows:['quarter'],page:{categoryId:'year',memberKeys: ['2024']}},resultFilters:[{id:'filter',categoryId:'year',target:{kind:'measure' as const,id:'revenue'},predicate:'gt' as const,value:1}]};
 let calls=0;
 render(<CategoryEditor model={dependent} columns={columns} readonly={false} onCommitModel={async()=>{calls++;return true;}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Delete category'}));expect(await screen.findByRole('alert')).toBeInTheDocument();expect(calls).toBe(0);
});

it('pending actions retain the draft and never commit',()=>{
 let calls=0;render(<CategoryEditor model={model} columns={columns} readonly={false} pending onCommitModel={async()=>{calls++;return true;}}/>);
 for(const name of ['Save category','Delete category','New category','Move rows category 2 earlier']){const button=screen.getByRole('button',{name});expect(button).toBeDisabled();fireEvent.click(button);}
 expect(calls).toBe(0);expect(screen.getByLabelText('Category name')).toHaveValue('Year');
});
it('deletion failure preserves selection and edited definition',async()=>{
 render(<CategoryEditor model={model} columns={columns} readonly={false} onCommitModel={async()=>false}/>);fireEvent.change(screen.getByLabelText('Category name'),{target:{value:'Retained'}});fireEvent.click(screen.getByRole('button',{name:'Delete category'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete category');expect(screen.getByLabelText('Category name')).toHaveValue('Retained');expect(screen.getByRole('button',{name:'Year'})).toHaveAttribute('aria-pressed','true');
});

it('keeps full long axis names available while order actions still use stable IDs',async()=>{
 const name='Long authored category name for consolidated quarterly reporting across companies';
 const named={...model,categories:model.categories.map(c=>c.id==='year'?{...c,name}:c)};let saved:TableModelV1|undefined;
 render(<CategoryEditor model={named} columns={columns} readonly={false} onCommitModel={async next=>{saved=next;return true;}}/>);
 expect(screen.getByRole('button',{name})).toHaveAttribute('title',name);expect(screen.getAllByTitle(name).some(el=>el.tagName==='SPAN')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Move rows category 1 later'}));await waitFor(()=>expect(saved?.layout.rows).toEqual(['quarter','year']));expect(saved?.categories.find(c=>c.id==='year')?.name).toBe(name);
});
it('D-014: offers M as a transformation and saves it as a first-class transform',async()=>{
 const commit=vi.fn(async(_next:TableModelV1)=>true);render(<CategoryEditor model={model} columns={columns} readonly={false} onCommitModel={commit}/>);
 fireEvent.click(screen.getByRole('button',{name:'Quarter'}));fireEvent.change(screen.getByLabelText('Transformation'),{target:{value:'M'}});fireEvent.click(screen.getByRole('button',{name:'Save category'}));
 await waitFor(()=>expect(commit).toHaveBeenCalled());expect(commit.mock.calls[0][0].categories.find(c=>c.id==='quarter')).toEqual({id:'quarter',name:'Quarter',sourceFieldId:'date',transform:'M'});
});
