// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Explicit test-only in-process worker helper adapter. Production has no synchronous fallback.
import {useMemo,type ComponentProps} from 'react';
import {FormulaPanel as WorkerFormulaPanel} from '../components/renderers/table-model/FormulaPanel';
import {bindObservedFormula,observedMemberPage} from '../lib/tableExecution/formulaAuthoring';
import {input,revision} from '../lib/tableExecution/fixtures';
import {categoryAuthoringRecipe} from '../lib/tableModel/categoryAuthoringRecipe';
import {checkAuthoringModel} from '../components/renderers/table-model/authoringValidation';
import type {FormulaAuthoring} from '../hooks/useFormulaAuthoring';
type AdapterProps=ComponentProps<typeof WorkerFormulaPanel>&{onCommitModel:(next:import('../lib/tableModel/types').TableModelV1)=>Promise<boolean>};
export function FormulaPanel(props:AdapterProps){
 const {model,columns,onCommitModel}=props;
 const authoring=useMemo<FormulaAuthoring>(()=>{const dataset={...structuredClone(input),columns:[...columns],rows:[2026,'Actual'].map((raw,i)=>({id:String(i),values:{raw}}))},definition={table:{},search:'',analytical:model};return {contextKey:JSON.stringify(model),bind:async(draft,bindings)=>({kind:'bindFormula',requestId:'test',revision,completeness:{kind:'complete',warnings:[]},diagnostics:[],...bindObservedFormula(dataset,{definition,draft,bindings})}),members:async(categoryId,offset,search)=>({kind:'memberDomain',requestId:'test',revision,completeness:{kind:'complete',warnings:[]},diagnostics:[],...observedMemberPage(dataset,{definition,categoryId,categoryRecipe:categoryAuthoringRecipe(model,categoryId),offset,limit:100,search})}),commit:async(formula,original)=>{const next={...model,formulas:formula?(original?model.formulas.map(f=>f.id===original.id?formula:f):[...model.formulas,formula]):model.formulas.filter(f=>f.id!==original?.id),layout:formula?model.layout:{...model.layout,values:model.layout.values.filter(id=>id!==original?.id)}};const checked=checkAuthoringModel(next,columns);if(!checked.model)throw new Error(checked.errors.join(' '));return onCommitModel(checked.model);}};},[model,columns,onCommitModel]);
 return <WorkerFormulaPanel {...props} authoring={authoring}/>;
}
