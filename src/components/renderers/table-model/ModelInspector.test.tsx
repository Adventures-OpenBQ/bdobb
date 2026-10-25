// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { InspectionResult } from '../../../lib/tableExecution/types';
import { ModelInspector } from './ModelInspector';
const raw={schemaVersion:2,unknown:'retain'};
afterEach(cleanup);
it('retains invalid raw definitions and rejects future-version repairs with accessible diagnostics',async()=>{
 render(<ModelInspector raw={raw} columns={[]} readonly={false} pending={false} counts={{definitions:0,warnings:1,periodBounds:1}} onRequestInspection={()=>{}} onCommitModel={async()=>true} onShowFormula={()=>{}}/>);
 expect(screen.getByRole('alert')).toHaveTextContent('schema');fireEvent.click(screen.getByText('Advanced repair'));expect(screen.getByLabelText('Model repair draft')).toHaveValue(JSON.stringify(raw,null,2));fireEvent.click(screen.getByRole('button',{name:'Save repaired model'}));expect((await screen.findAllByRole('alert')).at(-1)).toHaveTextContent('schema');expect(screen.getByLabelText('Model repair draft')).toHaveValue(JSON.stringify(raw,null,2));
});
it('shows company bounds with fiscal interpretation and bounded navigation',async()=>{
 const page={collection:'periodBounds',offset:0,limit:20,total:21,nextOffset:20,rows:[{kind:'periodBounds',companyKey:'ACME',start:'2026-01-01',end:'2026-12-31',source:'Provider',period:'FY',context:'Fiscal periods do not align across companies.'}]} as InspectionResult;
 render(<ModelInspector columns={[]} readonly pending={false} page={page} counts={{definitions:0,warnings:1,periodBounds:21}} onRequestInspection={()=>{}} onCommitModel={async()=>true} onShowFormula={()=>{}}/>);
 expect(screen.getByText(/ACME.*2026-01-01.*Provider.*FY/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Next inspection page'})).toBeEnabled();
 fireEvent.click(screen.getByText('Advanced repair'));await waitFor(()=>expect(screen.getByRole('button',{name:'Save repaired model'})).toBeDisabled());
});
it('rejects a repaired category bound to unavailable incoming data',()=>{
 const bad={schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,categories:[{id:'category',name:'Category',sourceFieldId:'missing',transform:'native'}],measures:[],formulas:[],layout:{rows:['category'],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 render(<ModelInspector raw={bad} columns={[]} readonly={false} pending={false} onRequestInspection={()=>{}} onCommitModel={async()=>true} onShowFormula={()=>{}}/>);expect(screen.getByRole('alert')).toHaveTextContent('missing');
});
it('offers Linked groups as a separate inspection collection rather than mixing proof into definition pages',()=>{render(<ModelInspector raw={undefined} columns={[]} readonly pending={false} onRequestInspection={()=>{}} onCommitModel={async()=>false} onShowFormula={()=>{}} linkedGroups={<p>Bound group proof</p>}/>);expect(screen.queryByText('Bound group proof')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Linked groups'}));expect(screen.getByText('Bound group proof')).toBeVisible();});
it('dispatches Statement repair through canonical intent instead of V1 fallback',async()=>{
 const {fixture}=await import('../../../lib/statementModel/compileFixtures');const {statement,source}=fixture();let saved:unknown;
 render(<ModelInspector raw={statement} columns={source.columns} readonly={false} pending={false} onRequestInspection={()=>{}} onCommitModel={async model=>{saved=model;return true;}} onShowFormula={()=>{}}/>);
 fireEvent.click(screen.getByText('Advanced repair'));fireEvent.click(screen.getByRole('button',{name:'Save repaired model'}));
 await waitFor(()=>expect(saved).toEqual(statement));
});
