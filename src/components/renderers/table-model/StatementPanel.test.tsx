// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { StatementPanel, type StatementPanelProps } from './StatementPanel';
import { fixture } from '../../../lib/statementModel/compileFixtures';
import { createWorkerHandler } from '../../../lib/tableExecution/table.worker';
import { revision } from '../../../lib/tableExecution/fixtures';
import type { DefinitionPreview, ExecutionResponse } from '../../../lib/tableExecution/types';
import type { StatementIntent, StatementTemplate } from '../../../lib/statementModel/types';
afterEach(cleanup);
const {source,statement}=fixture();
async function preview(candidate:StatementIntent, input=source) {
 const responses:ExecutionResponse[]=[];const handler=createWorkerHandler(r=>responses.push(r));
 await handler({kind:'registerInput',requestId:'i',revision,input,inputRevision:revision.input});
 await handler({kind:'previewDefinition',requestId:'p',revision,definition:{table:{},search:'',analytical:candidate}});
 const result=responses.at(-1);if(result?.kind!=='previewDefinition')throw new Error('Preview refused');return result as DefinitionPreview;
}
function props(extra:Partial<StatementPanelProps>={}):StatementPanelProps{return {raw:statement,columns:source.columns,readonly:false,contextKey:'current',onPreview:candidate=>preview(candidate),onCommit:async()=>false,...extra};}
it('applyRequiresBindingsAndShowsMissingNotZero',async()=>{
 render(<StatementPanel {...props({raw:undefined})}/>);
 expect(screen.getByText(/Missing facts are never zero/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(/binding|field/i);
 expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeDisabled();
});
it('overrideLabelsOrderFormulaVisibility',async()=>{
 let saved:StatementIntent|undefined;
 render(<StatementPanel {...props({onCommit:async candidate=>{saved=candidate;return true;}})}/>);
 fireEvent.change(screen.getByLabelText('Label revenue'),{target:{value:'Sales'}});
 fireEvent.click(screen.getByLabelText('Visible revenue'));
 fireEvent.click(screen.getByRole('button',{name:'Move revenue down'}));
 const formula=structuredClone(statement.template.lines.find((line:typeof statement.template.lines[number])=>line.formula)!.formula!);formula.expression='42';formula.ast={kind:'literal',value:42};
 fireEvent.click(screen.getByText('Stable identity and formula'));
 fireEvent.change(screen.getByLabelText('Formula Calculated gross profit'),{target:{value:JSON.stringify(formula)}});
 fireEvent.click(screen.getByRole('button',{name:'Use formula override'}));
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));
 await waitFor(()=>expect(saved).toBeDefined());
 expect(saved!.bindings).toEqual(statement.bindings);expect(Object.values(saved!.overrides.labels)).toContain('Sales');
 expect(saved!.overrides.hiddenIds).toContain(statement.template.lines[0].id);
 expect(saved!.template).toEqual(statement.template);expect(saved!.overrides.formulas[0].ast).toEqual({kind:'literal',value:42});
});
it('coldInvalidSnapshotRemainsRepairable',()=>{
 render(<StatementPanel {...props({raw:{schemaVersion:99,kind:'statement',template:{id:'unknown'}}})}/>);
 expect(screen.getByRole('alert')).toHaveTextContent(/Inspect/);
 expect(screen.queryByRole('button',{name:'Apply Statement model'})).toBeNull();
});
it('sourceFieldDisappearsWithoutRawFallback',async()=>{
 render(<StatementPanel {...props({columns:source.columns.filter(c=>c.id!=='revenue')})}/>);
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('revenue');
 expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeDisabled();
});
it('explicitUpdateRequiresConflictResolution',async()=>{
 const local=structuredClone(statement);const removed=local.template.lines[0].id;local.overrides.labels[removed]='Sales';
 const future=JSON.parse(JSON.stringify(local.template).replaceAll('/1.0.0/','/2.0.0/').replace('"version":"1.0.0"','"version":"2.0.0"')) as StatementTemplate;
 future.lines=future.lines.filter(l=>!l.id.endsWith('/line/revenue'));future.sections.forEach(section=>{section.lineIds=section.lineIds.filter(id=>!id.endsWith('/line/revenue'));});future.lines.forEach(line=>{if(line.formula){line.formula.expression='1';line.formula.ast={kind:'literal',value:1};}});
 render(<StatementPanel {...props({raw:local})}/>);
 fireEvent.click(screen.getByText('Explicit template update'));
 expect(screen.getByText(/Bundled catalog: 1.0.0/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Supplied template snapshot'),{target:{value:JSON.stringify(future)}});
 fireEvent.click(screen.getByRole('button',{name:'Preview template update'}));
 expect(screen.getByRole('alert')).toHaveTextContent('Resolve every update conflict');
 expect(screen.getByRole('button',{name:'Calculate preview'})).toBeDisabled();
 const resolved=JSON.parse((screen.getByLabelText('Resolved update intent') as HTMLTextAreaElement).value) as StatementIntent;
 delete resolved.overrides.labels[removed];resolved.bindings.mappings=resolved.bindings.mappings.filter(m=>m.lineId!==removed);
 fireEvent.change(screen.getByLabelText('Resolved update intent'),{target:{value:JSON.stringify(resolved)}});
 fireEvent.click(screen.getByRole('button',{name:'Validate conflict resolution'}));
 expect(screen.getByRole('button',{name:'Calculate preview'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeDisabled();
});
it('failedSaveAndCancelledPreviewRetainDraft',async()=>{
 render(<StatementPanel {...props()}/>);
 fireEvent.change(screen.getByLabelText('Label revenue'),{target:{value:'Retained'}});
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));
 expect(await screen.findByRole('alert')).toHaveTextContent(/retained/);
 fireEvent.click(screen.getByRole('button',{name:'Cancel preview'}));
 expect(screen.getByLabelText('Label revenue')).toHaveValue('Retained');
 fireEvent.click(screen.getByRole('button',{name:'Reset all overrides'}));
 expect(screen.getByLabelText('Label revenue')).toHaveValue('revenue');
 expect(screen.getByLabelText('Source revenue')).toHaveValue('revenue');
});
it('resets the line owned formula and editor before preview and save',async()=>{
 let saved:StatementIntent|undefined;render(<StatementPanel {...props({onCommit:async candidate=>{saved=candidate;return true;}})}/>);
 const formula=structuredClone(statement.template.lines.find((line:typeof statement.template.lines[number])=>line.formula)!.formula!);formula.expression='42';formula.ast={kind:'literal',value:42};
 fireEvent.click(screen.getByText('Stable identity and formula'));fireEvent.change(screen.getByLabelText('Formula Calculated gross profit'),{target:{value:JSON.stringify(formula)}});fireEvent.click(screen.getByRole('button',{name:'Use formula override'}));
 const editor=screen.getByLabelText('Formula Calculated gross profit');fireEvent.click(editor.closest('.statement-line')!.querySelector('button:not([aria-label])')!);
 expect(JSON.parse((screen.getByLabelText('Formula Calculated gross profit') as HTMLTextAreaElement).value).ast).not.toEqual(formula.ast);
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));await waitFor(()=>expect(saved).toBeDefined());
 expect(saved!.overrides.formulas).toEqual([]);expect(saved!.bindings).toEqual(statement.bindings);expect(saved!.template).toEqual(statement.template);
});
it('company choices belong to their binding while same binding paging retains all selected keys',async()=>{
 const {createWorkerHandler}=await import('../../../lib/tableExecution/table.worker');const {categoryAuthoringRecipe}=await import('../../../lib/tableModel/categoryAuthoringRecipe');
 const responses:ExecutionResponse[]=[];const handler=createWorkerHandler(r=>responses.push(r));await handler({kind:'registerInput',requestId:'i',revision,input:{...source,rows:[...source.rows,{...source.rows[0],id:'b',values:{...source.rows[0].values,symbol:'BETA'}}]},inputRevision:revision.input});
 const companies:NonNullable<StatementPanelProps['onCompanies']>=async(field,offset)=>{
  const model={schemaVersion:1 as const,enabled:true,params:{promotePage:false,filters:[]},categories:[{id:'company',name:'Company',sourceFieldId:field,transform:'native' as const}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
  await handler({kind:'memberDomain',requestId:'m',revision,definition:{table:{},search:'',analytical:model},categoryId:'company',categoryRecipe:categoryAuthoringRecipe(model,'company'),offset,limit:1});return responses.at(-1) as import('../../../lib/tableExecution/types').MemberDomainResult;
 };
 render(<StatementPanel {...props({onCompanies:companies})}/>);fireEvent.click(screen.getByRole('button',{name:'Load company members'}));fireEvent.click(await screen.findByLabelText('ACME'));fireEvent.click(screen.getByRole('button',{name:'More companies'}));fireEvent.click(await screen.findByLabelText('BETA'));
 expect(screen.getByText('2 selected')).toBeVisible();fireEvent.change(screen.getByLabelText('Company'),{target:{value:'period'}});
 expect(screen.queryByLabelText('BETA')).toBeNull();expect(screen.queryByLabelText('ACME')).toBeNull();
});

it('previews nonconflicting default formula and policy changes before durable adoption',async()=>{
 let saved:StatementIntent|undefined;
 const future=JSON.parse(JSON.stringify(statement.template).replaceAll('/1.0.0/','/2.0.0/').replace('"version":"1.0.0"','"version":"2.0.0"')) as StatementTemplate;
 future.lines[0].policy='stock';const formula=future.lines.find(l=>l.formula)!.formula!;formula.expression='42';formula.ast={kind:'literal',value:42};
 render(<StatementPanel {...props({onCommit:async candidate=>{saved=candidate;return true;}})}/>);
 fireEvent.click(screen.getByText('Explicit template update'));
 fireEvent.change(screen.getByLabelText('Supplied template snapshot'),{target:{value:JSON.stringify(future)}});
 fireEvent.click(screen.getByRole('button',{name:'Preview template update'}));
 const comparison=screen.getByRole('region',{name:'Template changes'});
 expect(comparison).toHaveTextContent('Before');expect(comparison).toHaveTextContent('After');
 expect(comparison).toHaveTextContent('flow');expect(comparison).toHaveTextContent('stock');expect(comparison).toHaveTextContent('42');
 expect(saved).toBeUndefined();expect(statement.template.version).toBe('1.0.0');
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));await waitFor(()=>expect(saved?.template.version).toBe('2.0.0'));
});
it('edits section visibility and explains inherited hiding without clearing line overrides',async()=>{
 let saved:StatementIntent|undefined;const section=statement.template.sections[0];
 render(<StatementPanel {...props({onCommit:async candidate=>{saved=candidate;return true;}})}/>);
 fireEvent.click(screen.getByLabelText(`Visible section ${section.label}`));
 expect(screen.getByLabelText('Visible revenue')).not.toBeChecked();expect(screen.getByLabelText('Visible revenue')).toBeDisabled();
 expect(screen.getAllByText('Hidden by section').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));await waitFor(()=>expect(saved?.overrides.hiddenIds).toContain(section.id));
});

it('keeps metadata fiscal bindings when switching FQ and back to FY',async()=>{
 const candidate=structuredClone(statement);
 candidate.bindings.fiscal={companyFieldId:'symbol',dateFieldId:'date',metadataKey:'provider'};
 const metadataSource=structuredClone(source);
 metadataSource.provenance.metadata={fiscalContext:{metadata:{provider:{ACME:{source:'fixture',periods:[{kind:'FY',year:2025,start:'2025-01-01',end:'2025-12-31',source:'fixture'},{kind:'FQ',year:2025,quarter:4,start:'2025-10-01',end:'2025-12-31',source:'fixture'}]}}}}};
 let received:StatementIntent|undefined;
 render(<StatementPanel {...props({raw:candidate,onPreview:async next=>{
  received=next;
  const input=structuredClone(metadataSource);
  input.rows[0].values.period=next.periodKind;
  const result=await preview(next,input);
  expect(result.rows.some(row=>Object.values(row.values).includes(40))).toBe(true);
  return result;
 }})}/>);
 for(const kind of ['FQ','FY']){
  fireEvent.change(screen.getByLabelText('Fiscal period'),{target:{value:kind}});
  fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled());
  expect(received?.bindings.fiscal).toEqual(candidate.bindings.fiscal);
  expect(received?.periodKind).toBe(kind);
 }
});

it('updates fiscal kind when explicit bounds were mapped without an initial kind',async()=>{
 const candidate=structuredClone(statement);
 delete candidate.bindings.fiscal.periodKind;
 candidate.bindings.fiscal.fiscalQuarterFieldId='quarter';
 let received:StatementIntent|undefined;
 render(<StatementPanel {...props({raw:candidate,columns:[...source.columns,{id:'quarter',label:'Quarter'}],onPreview:async next=>{received=next;return preview(statement);}})}/>);
 fireEvent.change(screen.getByLabelText('Fiscal period'),{target:{value:'FQ'}});
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 await waitFor(()=>expect(received).toBeDefined());
 expect(received?.bindings.fiscal.periodKind).toBe('FQ');
});
