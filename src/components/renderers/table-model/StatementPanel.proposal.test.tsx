// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { StatementPanel, type StatementPanelProps } from './StatementPanel';
import { proposeStatement } from '../../../lib/statementModel/autoBind';
import { statementFixture } from '../../../lib/statementModel/fixtures/load';
import { correctStatementRows, inferYearEnds } from '../../../lib/statementFiscal';
import { stampStatementRows } from '../../../lib/statementSource';
import { createWorkerHandler } from '../../../lib/tableExecution/table.worker';
import { input, revision } from '../../../lib/tableExecution/fixtures';
import type { DefinitionPreview, ExecutionResponse } from '../../../lib/tableExecution/types';
import type { StatementIntent } from '../../../lib/statementModel/types';
import type { Row } from '../../../lib/tableColumns';
import type { WidgetDataset } from '../../../lib/widgetData/types';
afterEach(cleanup);

/** Libre Terminal's annual income rows for these symbols, as a statement card hands them to its table. */
function cardRows(...symbols: string[]): Row[] {
 const merged=symbols.flatMap(s=>stampStatementRows(statementFixture(`libre/${s.toLowerCase()}-yfinance-income-annual`).rows,s,'annual'));
 return correctStatementRows(merged,'annual',inferYearEnds(merged,'annual',symbols),symbols,false,true).rows;
}
const dataset=(rows:Row[]):WidgetDataset=>({...input,columns:[...new Set(rows.flatMap(r=>Object.keys(r)))].map(id=>({id,label:id})),rows:rows.map((values,i)=>({id:`r${i}`,values}))}) as WidgetDataset;
async function preview(candidate:StatementIntent,source:WidgetDataset) {
 const responses:ExecutionResponse[]=[];const handler=createWorkerHandler(r=>responses.push(r));
 await handler({kind:'registerInput',requestId:'i',revision,input:source,inputRevision:revision.input});
 await handler({kind:'previewDefinition',requestId:'p',revision,definition:{table:{},search:'',analytical:candidate}});
 const result=responses.at(-1);if(result?.kind!=='previewDefinition')throw new Error('Preview refused');return result as DefinitionPreview;
}
function props(source:WidgetDataset,extra:Partial<StatementPanelProps>={}):StatementPanelProps{return {raw:undefined,columns:source.columns,readonly:false,contextKey:'current',onPreview:candidate=>preview(candidate,source),onCommit:async()=>false,...extra};}

it('opens a new Statement already bound to a Libre statement card, and it previews and saves untouched',async()=>{
 const source=dataset(cardRows('WMT'));
 let saved:StatementIntent|undefined;
 render(<StatementPanel {...props(source,{onCommit:async candidate=>{saved=candidate;return true;}})}/>);
 expect(screen.getByText('income · 1.1.0')).toBeVisible();
 expect(screen.getByLabelText('Proposal')).toHaveTextContent(/\d+ columns are lines of this statement\. Not mapped: tax_rate_for_calcs\./);
 expect(screen.getByRole('combobox',{name:'Company'})).toHaveValue('symbol');
 expect(screen.getByRole('combobox',{name:'Fiscal year'})).toHaveValue('fiscal_year');
 expect(screen.getByRole('combobox',{name:'Source total_revenue'})).toHaveValue('total_revenue');
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled(),{timeout:90000});
 fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));
 await waitFor(()=>expect(saved).toBeDefined());
 expect(saved!.template.version).toBe('1.1.0');
 expect(saved!.bindings.mappings.some(m=>m.sourceFieldId==='total_revenue')).toBe(true);
 expect(Object.hasOwn(saved!,'layout')).toBe(false);
},180000);

it('saves companies side by side when that layout is chosen',async()=>{
 const source=dataset(cardRows('AAPL','WMT'));
 let saved:StatementIntent|undefined;
 render(<StatementPanel {...props(source,{onCommit:async candidate=>{saved=candidate;return true;}})}/>);
 fireEvent.change(screen.getByRole('combobox',{name:'Layout'}),{target:{value:'lines-by-company'}});
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeEnabled(),{timeout:90000});
 fireEvent.click(screen.getByRole('button',{name:'Apply Statement model'}));
 await waitFor(()=>expect(saved).toBeDefined());
 expect(saved!.layout).toBe('lines-by-company');
 expect(saved!.page).toBeUndefined();
},180000);

it('says why it proposes nothing for a table that is not a bound statement, and leaves hand authoring as it was',()=>{
 const asReported=dataset(statementFixture('libre/wmt-yfinance-income-annual').rows);
 render(<StatementPanel {...props(asReported)}/>);
 expect(screen.getByText('income · 1.0.0')).toBeVisible();
 expect(screen.getByLabelText('Proposal')).toHaveTextContent(/^Not proposed: The rows carry no fiscal year to bind/);
 expect(screen.queryByRole('button',{name:'Propose from columns'})).toBeNull();
});

it('offers no proposal over a saved Statement',()=>{
 const source=dataset(cardRows('WMT'));
 const saved=proposeStatement(source.columns,cardRows('WMT'));
 if(!('intent' in saved))throw new Error(saved.reason);
 render(<StatementPanel {...props(source,{raw:saved.intent})}/>);
 expect(screen.queryByLabelText('Proposal')).toBeNull();
 expect(screen.queryByRole('button',{name:'Propose from columns'})).toBeNull();
},180000);
