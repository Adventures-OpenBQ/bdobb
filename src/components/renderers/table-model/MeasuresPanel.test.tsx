// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup,render,screen,fireEvent,within } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { MeasuresPanel } from '../PivotPanel';
import { ArrangePanel } from '../pivot-drawer/ArrangePanel';
import type { TableModelV1 } from '../../../lib/tableModel/types';
import type { InspectionResult } from '../../../lib/tableExecution/types';
afterEach(cleanup);
it('requires worker source type metadata rather than guessing numeric operators for source formulas',()=>{
 const model:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[],measures:[{id:'measure',sourceFieldId:'source-formula'}],formulas:[{id:'source-formula',name:'Computed',scope:'source',expression:'1',ast:{kind:'literal',value:1}}],layout:{rows:[],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const props={model,columns:[],readonly:false,onCommitModel:async()=>true};
 const {rerender}=render(<MeasuresPanel {...props}/>);expect(screen.queryByRole('option',{name:'Total'})).not.toBeInTheDocument();
 rerender(<MeasuresPanel {...props} sourceInspection={{definitionId:'source-formula',rows:[{kind:'formula',id:'source-formula',scope:'source',sourceFilterKind:'number'}]} as InspectionResult}/>);expect(screen.getByRole('option',{name:'Total'})).toBeInTheDocument();
});

const parityModel:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[],measures:[{id:'measure',sourceFieldId:'computed'}],formulas:[{id:'computed',name:'Computed',scope:'source',expression:'1',ast:{kind:'literal',value:1}}],layout:{rows:[],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
it.each([
 ['missing',undefined,false],
 ['mismatched',{definitionId:'other',rows:[{kind:'formula',sourceFilterKind:'number'}]},false],
 ['wrong row kind',{definitionId:'computed',rows:[{kind:'measure',sourceFilterKind:'number'}]},false],
 ['all-error',{definitionId:'computed',rows:[{kind:'formula',sourceFilterKind:'none'}]},false],
 ['numeric',{definitionId:'computed',rows:[{kind:'formula',sourceFilterKind:'number'}]},true],
] as const)('keeps real Arrange/Measures numeric eligibility in parity for %s metadata',(_name,inspection,total)=>{
 const props={model:parityModel,columns:[],readonly:false,onCommitModel:async()=>true,sourceInspection:inspection as InspectionResult|undefined};
 render(<><MeasuresPanel {...props}/><ArrangePanel {...props}/></>);
 const measures=within(screen.getByRole('region',{name:'Measures'}));
 expect(Boolean(measures.queryByRole('option',{name:'Total'}))).toBe(total);
 const pill=screen.getAllByRole('button',{name:'Computed'}).find(button=>button.getAttribute('data-kind')==='measure')!;
 fireEvent.click(pill);fireEvent.click(screen.getByRole('menuitem',{name:'Aggregation'}));
 expect(Boolean(screen.queryByRole('menuitemcheckbox',{name:'Total'}))).toBe(total);
});
it('preserves the existing different fallback for unknown inspected formula metadata with a same-ID raw column',()=>{
 const props={model:{...parityModel,formulas:[]},columns:[{id:'computed',label:'Raw computed',dtype:'number' as const}],readonly:false,onCommitModel:async()=>true,sourceInspection:{definitionId:'computed',rows:[{kind:'formula'}]} as InspectionResult};
 render(<><MeasuresPanel {...props}/><ArrangePanel {...props}/></>);
 expect(within(screen.getByRole('region',{name:'Measures'})).getByRole('option',{name:'Total'})).toBeVisible();
 const pill=screen.getAllByRole('button',{name:'Raw computed'}).find(button=>button.getAttribute('data-kind')==='measure')!;
 fireEvent.click(pill);fireEvent.click(screen.getByRole('menuitem',{name:'Aggregation'}));
 expect(screen.queryByRole('menuitemcheckbox',{name:'Total'})).not.toBeInTheDocument();
});
it('leaves Data column ordering to Arrange and removes only the deleted measure placement',()=>{
 const model={...parityModel,layout:{...parityModel.layout,values:['measure']}};
 let saved:TableModelV1|undefined;render(<MeasuresPanel model={model} columns={[]} readonly={false} onCommitModel={async next=>{saved=next;return true;}}/>);
 expect(screen.queryAllByRole('button',{name:/Move measure/})).toEqual([]);
 fireEvent.click(screen.getByRole('button',{name:'Remove Computed'}));
 expect(saved?.layout.values).toEqual([]);
});
it('Add measure adds a number field with no aggregation',async()=>{
 const model:TableModelV1={...parityModel,measures:[],formulas:[]};
 const commits:TableModelV1[]=[];
 render(<MeasuresPanel model={model} columns={[{id:'amount',label:'Amount',dtype:'number'}]} readonly={false} onCommitModel={async next=>{commits.push(next);return true;}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add measure'}));
 expect(commits[0].measures).toEqual([{id:expect.any(String),sourceFieldId:'amount'}]);
});
