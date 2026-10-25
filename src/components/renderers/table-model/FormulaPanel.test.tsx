// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { FormulaPanel } from '../../../test/formulaEditorAdapter';
import type { TableModelV1 } from '../../../lib/tableModel/types';
const initial:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[],measures:[{id:'average',sourceFieldId:'raw',aggregation:'mean'},{id:'total',sourceFieldId:'raw',aggregation:'sum'}],formulas:[{id:'ratio',name:'Ratio',scope:'aggregate',expression:'1',ast:{kind:'literal',value:1}}],layout:{rows:[],columns:[], values: ['ratio']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
const columns=[{id:'raw',label:'Volume',dtype:'number' as const}];
afterEach(cleanup);
function Editor({readonly=false,model:seed=initial}:{readonly?:boolean;model?:TableModelV1}){const [model,setModel]=useState(seed);return <><FormulaPanel model={model} columns={columns} readonly={readonly} selectedId="ratio" onCommitModel={next=>{setModel(next);return Promise.resolve(true);}}/><output aria-label="Saved model">{JSON.stringify(model.formulas)}</output></>;}
it('keeps the last valid formula on a cycle and requires an explicit sibling measure choice',async()=>{
 render(<Editor/>);fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'Ratio+1'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Circular');expect(screen.getByLabelText('Saved model')).toHaveTextContent('"expression":"1"');
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'Volume'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));expect(await screen.findByRole('alert')).toHaveTextContent('Volume has more than one measure; use an explicit function such as SUM(Volume)');
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average]'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('"target":"measure","id":"average"'));
});
it('preserves stable AST references when renaming a definition after its input is renamed',async()=>{
 render(<Editor model={{...initial,formulas:[{...initial.formulas[0],expression:'[Old label]+1',ast:{kind:'binary',operator:'+',left:{kind:'reference',target:'measure',id:'average'},right:{kind:'literal',value:1}}}]}}/>);
 fireEvent.change(screen.getByLabelText('Formula name'),{target:{value:'New ratio'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('New ratio'));expect(screen.getByLabelText('Saved model')).toHaveTextContent('"id":"average"');
});
it('readonly formulas cannot save',()=>{render(<Editor readonly/>);expect(screen.getByRole('button',{name:'Save formula'})).toBeDisabled();});
it('editing arithmetic preserves committed member IDs outside the currently requested facet',async()=>{
 const seed:TableModelV1={...initial,categories:[{id:'scenario',name:'Renamed Scenario',sourceFieldId:'raw',transform:'native'}],formulas:[{...initial.formulas[0],expression:'[Volume — Average][Scenario="Budget"]',ast:{kind:'member',value:{kind:'reference',target:'measure',id:'average'},selectors:[{categoryId:'scenario',memberKey:'budget-key'}]}}]};
 render(<Editor model={seed}/>);fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average][Scenario="Budget"]+1'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('"operator":"+"'));expect(screen.getByLabelText('Saved model')).toHaveTextContent('"memberKey":"budget-key"');
});
it('new Last expressions require an explicitly declared temporal category',async()=>{
 render(<Editor/>);fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'LAST(Volume)'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));expect(await screen.findByRole('alert')).toHaveTextContent('temporal');expect(screen.getByLabelText('Saved model')).toHaveTextContent('"expression":"1"');
});

it('function autocomplete inserts valid syntax with the reference inside the arguments',async()=>{
 render(<Editor/>);fireEvent.change(screen.getByLabelText('Expression'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'Insert SUM'}));fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));fireEvent.click(screen.getByRole('button',{name:'Save formula'}));await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('"function":"sum"'));expect(screen.getByLabelText('Saved model')).toHaveTextContent('"target":"field","id":"raw"');
});
it('shows saved dependency IDs and worker-resolved operators without calculating values',()=>{
 render(<FormulaPanel model={initial} columns={columns} readonly selectedId="ratio" onCommitModel={async()=>true} inspection={{definitionId:'ratio',rows:[{kind:'formula',id:'ratio',name:'Ratio',referenceIds:['average'],resolvedOperators:['mean'],referenceCount:1,truncatedReferences:false}]} as import('../../../lib/tableExecution/types').InspectionResult}/>);
 expect(screen.getByText('Saved dependencies: Volume — Average')).toBeInTheDocument();expect(screen.getByText('Resolved aggregation: mean')).toBeInTheDocument();
});
it('does not overwrite distinct stable bindings when duplicate input labels share display text',async()=>{
 const fields=[{id:'a',label:'Value',dtype:'number' as const},{id:'b',label:'Value',dtype:'number' as const}];
 const seed={...initial,measures:[],formulas:[{...initial.formulas[0],scope:'source' as const,expression:'[Value]+[Value]',ast:{kind:'binary' as const,operator:'+' as const,left:{kind:'reference' as const,target:'field' as const,id:'a'},right:{kind:'reference' as const,target:'field' as const,id:'b'}}}]};
 render(<FormulaPanel model={seed} columns={fields} readonly={false} selectedId="ratio" onCommitModel={async()=>true}/>);fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Value]+[Value]+1'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));expect(await screen.findByRole('alert')).toHaveTextContent('Ambiguous');
 expect(screen.getAllByRole('button',{name:'Insert Value'})).toHaveLength(1);
});

function ComparisonEditor({existing=false}:{existing?:boolean}) {
 const [model,setModel]=useState<TableModelV1>({...initial,categories:[{id:'year',name:'Year',sourceFieldId:'raw',transform:'native' as const},{id:'scenario',name:'Scenario',sourceFieldId:'raw',transform:'native' as const}],formulas:existing?initial.formulas:[],layout:{...initial.layout,values:existing?initial.layout.values:[]}});
 return <><FormulaPanel model={model} columns={columns} readonly={false} selectedId={existing?'ratio':undefined} onCommitModel={async next=>{setModel(next);return true;}}/><output aria-label="Saved model">{JSON.stringify(model.formulas)}</output></>;
}
for(const existing of [false,true])it(`retains inserted selectors across facets for ${existing?'an existing':'a new'} formula saved once`,async()=>{
 render(<ComparisonEditor existing={existing}/>);
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average]'}});
 fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'year'}});fireEvent.click(await screen.findByRole('button',{name:'Insert 2026'}));
 const first=(screen.getByLabelText('Expression') as HTMLTextAreaElement).value;
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:first+' + [Volume — Average]'}});
 fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'scenario'}});fireEvent.click(await screen.findByRole('button',{name:'Insert Actual'}));fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('number'));
 expect(screen.getByLabelText('Saved model')).toHaveTextContent('"categoryId":"year"');expect(screen.getByLabelText('Saved model')).toHaveTextContent('Actual');
});
it('binds observed members independently of the displayed page and refuses an unobserved edited member',async()=>{
 render(<ComparisonEditor/>);fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'year'}});fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average]'}});fireEvent.click(await screen.findByRole('button',{name:'Insert 2026'}));
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average]'}});
 fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'scenario'}});
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average][[Year]=2026]'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('2026'));
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average][[Year]=2027]'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));expect(await screen.findByRole('alert')).toHaveTextContent('Missing member');
 expect(screen.getByLabelText('Saved model')).not.toHaveTextContent('2027');
});
it('resets inserted member proof when switching formula drafts',async()=>{
 render(<ComparisonEditor existing/>);fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'year'}});fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average]'}});fireEvent.click(await screen.findByRole('button',{name:'Insert 2026'}));
 fireEvent.click(screen.getByRole('button',{name:'New formula'}));fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'scenario'}});fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'[Volume — Average][[Year]=2027]'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));expect(await screen.findByRole('alert')).toHaveTextContent('Missing member');
 expect(screen.getByLabelText('Saved model')).not.toHaveTextContent('year-2026');
});

it('keeps an autocomplete-selected instance after its label and operator change',async()=>{
 let saved=initial;
 const commit=async(next:TableModelV1)=>{saved=next;return true;};
 const props={columns,readonly:false,selectedId:'ratio',onRequestFacet:()=>{},onCommitModel:commit};
 const view=render(<FormulaPanel {...props} model={{...initial,measures:[initial.measures[0]]}}/>);
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));
 fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(saved.formulas[0].ast).toEqual({kind:'reference',target:'measure',id:'average'}));
 view.unmount();
 const renamed={...saved,measures:[{...saved.measures[0],customLabel:'Peak volume',aggregation:'max' as const}]};
 render(<FormulaPanel {...props} model={renamed}/>);
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'Volume+1'}});
 fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(saved.formulas[0].ast).toEqual({kind:'binary',operator:'+',left:{kind:'reference',target:'measure',id:'average'},right:{kind:'literal',value:1}}));
 expect(saved.measures[0].aggregation).toBe('max');
});

for(const order of ['implicit-first','explicit-first'])it(`canonical autocomplete keeps both insertion scopes isolated: ${order}`,async()=>{
 const seed={...initial,measures:[initial.measures[0]]};render(<Editor model={seed}/>);
 const input=screen.getByLabelText('Expression') as HTMLTextAreaElement;
 fireEvent.change(input,{target:{value:''}});
 if(order==='implicit-first'){
  fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));
  fireEvent.change(input,{target:{value:input.value+' + SUM()'}});input.setSelectionRange(input.value.length-1,input.value.length-1);
  fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));
 }else{
  fireEvent.click(screen.getByRole('button',{name:'Insert SUM'}));
  fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));
  fireEvent.change(input,{target:{value:input.value+' + '}});input.setSelectionRange(input.value.length,input.value.length);
  fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));
 }
 expect(input.value).toBe(order==='implicit-first'?'Volume + SUM(Volume)':'SUM(Volume) + Volume');
 fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 const implicit={kind:'reference',target:'measure',id:'average'};const explicit={kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'raw'}]};
 await waitFor(()=>expect(JSON.parse(screen.getByLabelText('Saved model').textContent!)[0].ast).toEqual({kind:'binary',operator:'+',left:order==='implicit-first'?implicit:explicit,right:order==='implicit-first'?explicit:implicit}));
});
it('exposes typed source-scope diagnostics while retaining compatible string errors',async()=>{
 render(<ComparisonEditor/>);fireEvent.change(screen.getByLabelText('Scope'),{target:{value:'source'}});
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'Volume[Scenario=Actual]'}});
 fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'scenario'}});
 fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 expect(await screen.findByText('Category member comparisons require aggregate scope.')).toHaveAttribute('data-diagnostic-code','scope');
 expect(screen.getByLabelText('Saved model')).toHaveTextContent('[]');
});

it('offers canonical duplicate-measure calls while still accepting existing display aliases',async()=>{
 render(<Editor/>);
 expect(screen.queryByRole('button',{name:'Insert Volume — Average'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/· Source|· Measure/})).not.toBeInTheDocument();
 const input=screen.getByLabelText('Expression') as HTMLTextAreaElement;fireEvent.change(input,{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'Insert MEAN(Volume)'}));expect(input.value).toBe('MEAN(Volume)');
 fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(JSON.parse(screen.getByLabelText('Saved model').textContent!)[0].ast).toEqual({kind:'call',function:'mean',args:[{kind:'reference',target:'field',id:'raw'}]}));
});
it('keeps insertion probes bounded and distinct from a user reference with the probe spelling',async()=>{
 const seed={...initial,measures:[initial.measures[0]],formulas:[...initial.formulas,{id:'probe',name:'__inserted_formula_reference__',scope:'aggregate' as const,expression:'1',ast:{kind:'literal' as const,value:1}}]};
 render(<Editor model={seed}/>);const input=screen.getByLabelText('Expression') as HTMLTextAreaElement;
 fireEvent.change(input,{target:{value:'__inserted_formula_reference__ + SUM()'}});input.setSelectionRange(input.value.length-1,input.value.length-1);
 fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('"target":"field","id":"raw"'));
 fireEvent.change(input,{target:{value:'x'.repeat(16385)}});input.setSelectionRange(input.value.length,input.value.length);fireEvent.click(screen.getByRole('button',{name:'Insert Volume'}));fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('16 KiB');
});
it('serializes canonical member tokens while keeping observed type and proof',async()=>{
 render(<ComparisonEditor/>);const input=screen.getByLabelText('Expression') as HTMLTextAreaElement;
 fireEvent.change(input,{target:{value:'[Volume — Average]'}});fireEvent.change(screen.getByLabelText('Comparison category'),{target:{value:'scenario'}});fireEvent.click(await screen.findByRole('button',{name:'Insert Actual'}));
 expect(input.value).toBe('[Volume — Average][Scenario=Actual]');fireEvent.click(screen.getByRole('button',{name:'Save formula'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('Actual'));
});

it('offers selectable formulas, compact canonical pills and examples',()=>{
 render(<Editor/>);expect(screen.getByRole('button',{name:'Ratio'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('button',{name:'New formula'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Insert SUM'})).toHaveTextContent(/^SUM$/);
 expect(screen.getByText(/Examples:/)).toBeVisible();
});
it('deletes only an unreferenced saved formula through a validated commit',async()=>{
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'Delete formula'}));
 await waitFor(()=>expect(screen.getByLabelText('Saved model')).toHaveTextContent('[]'));
 expect(screen.queryByRole('button',{name:'Delete formula'})).toBeNull();
});
it('refuses deleting a referenced formula and preserves its edited draft',async()=>{
 render(<Editor model={{...initial,formulas:[...initial.formulas,{id:'dependent',name:'Dependent',scope:'aggregate',expression:'Ratio+1',ast:{kind:'binary',operator:'+',left:{kind:'reference',target:'formula',id:'ratio'},right:{kind:'literal',value:1}}}]}}/>);
 fireEvent.change(screen.getByLabelText('Formula name'),{target:{value:'Retained draft'}});fireEvent.click(screen.getByRole('button',{name:'Delete formula'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(/Missing/);expect(screen.getByLabelText('Formula name')).toHaveValue('Retained draft');
 expect(screen.getByLabelText('Saved model')).toHaveTextContent('dependent');
});
it('retains drafts on failed deletion and guards pending footer actions',async()=>{
 const props={model:initial,columns,readonly:false,onCommitModel:async()=>false,onRequestFacet:()=>{}};
 const view=render(<FormulaPanel {...props}/>);fireEvent.change(screen.getByLabelText('Formula name'),{target:{value:'Retained'}});
 fireEvent.click(screen.getByRole('button',{name:'Delete formula'}));expect(await screen.findByRole('alert')).toHaveTextContent('Your draft has been retained');
 expect(screen.getByLabelText('Formula name')).toHaveValue('Retained');view.rerender(<FormulaPanel {...props} pending/>);
 expect(screen.getByRole('button',{name:'Save formula'})).toBeDisabled();expect(screen.getByRole('button',{name:'Delete formula'})).toBeDisabled();
 view.rerender(<FormulaPanel {...props} readonly/>);expect(screen.getByRole('button',{name:'Delete formula'})).toBeDisabled();
});
