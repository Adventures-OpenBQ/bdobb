// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { measureEligibility } from './measureEligibility';
import type { TableModelV1 } from '../../../lib/tableModel/types';
import type { InspectionResult } from '../../../lib/tableExecution/types';
const model:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[],measures:[],formulas:[],layout:{rows:[],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
const inspection=(definitionId:string,sourceFilterKind?:'number'|'none')=>({definitionId,rows:[{kind:'formula',id:definitionId,scope:'source',sourceFilterKind}]} as InspectionResult);
it('accepts numeric operators only from the requested worker formula definition',()=>{
 const props={model,columns:[],sourceFieldId:'computed'};
 expect(measureEligibility(props).operators).toEqual(['count','uniqueCount']);
 expect(measureEligibility({...props,sourceInspection:inspection('other','number')}).operators).toEqual(['count','uniqueCount']);
 expect(measureEligibility({...props,sourceInspection:inspection('computed','none')}).operators).toEqual(['count','uniqueCount']);
 expect(measureEligibility({...props,sourceInspection:{definitionId:'computed',rows:[{kind:'measure',id:'computed'}]} as InspectionResult}).operators).toEqual(['count','uniqueCount']);
 expect(measureEligibility({...props,sourceInspection:inspection('computed','number')}).operators).toEqual(['sum','mean','median','min','max','count','uniqueCount']);
});
it('preserves both surface fallbacks for unknown formula metadata colliding with a raw numeric column',()=>{
 const props={model,columns:[{id:'computed',label:'Raw computed',dtype:'number' as const}],sourceFieldId:'computed',sourceInspection:inspection('computed')};
 expect(measureEligibility(props).operators).toEqual(['sum','mean','median','min','max','count','uniqueCount']);
 expect(measureEligibility({...props,fallbackKind:'none'}).operators).toEqual(['count','uniqueCount']);
});
it.each(['date','dateString','boolean','text'] as const)('keeps %s inputs comparable but does not invent arithmetic or chronology',dtype=>{
 expect(measureEligibility({model,columns:[{id:'input',label:'Input',dtype}],sourceFieldId:'input'})).toEqual({chronology:false,operators:['min','max','count','uniqueCount']});
});
it('requires one distinct declared temporal source and at most one fiscal company source',()=>{
 const temporal={id:'year',name:'Year',sourceFieldId:'date',transform:'Y' as const};
 const props={model,columns:[],sourceFieldId:'computed'};
 const declared={...model,categories:[temporal,{...temporal,id:'quarter',transform:'Q' as const}]};
 expect(measureEligibility({...props,model:declared})).toEqual({chronology:true,operators:['first','last','count','uniqueCount']});
 expect(measureEligibility({...props,model:{...model,categories:[{...temporal,transform:'native'}]}}).chronology).toBe(false);
 expect(measureEligibility({...props,model:{...declared,categories:[...declared.categories,{...temporal,id:'other-date',sourceFieldId:'other'}]}}).chronology).toBe(false);
 const binding={companyFieldId:'company-a',dateFieldId:'date'};
 const company={...temporal,fiscalBinding:binding};
 expect(measureEligibility({...props,model:{...model,categories:[company,{...company,id:'quarter'}]}}).chronology).toBe(true);
 expect(measureEligibility({...props,model:{...model,categories:[company,{...company,id:'quarter',fiscalBinding:{...binding,companyFieldId:'company-b'}}]}}).chronology).toBe(false);
 expect(measureEligibility({...props,model:{...model,categories:[{...temporal,transform:'native',legacyBucket:'month'}]}}).chronology).toBe(true);
});
