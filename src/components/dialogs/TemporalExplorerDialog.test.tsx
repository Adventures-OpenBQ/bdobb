// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import {coverage,dataset,description,executionId,page,queryId} from '../../lib/temporal/fixtures';
const fake=vi.hoisted(()=>({datasets:vi.fn(),describe:vi.fn(),coverage:vi.fn(),validate:vi.fn(),create:vi.fn(),revise:vi.fn(),get:vi.fn(),start:vi.fn(),status:vi.fn(),page:vi.fn()}));
vi.mock('../../lib/temporal/client',async importOriginal=>({...await importOriginal<typeof import('../../lib/temporal/client')>(),createTemporalClient:()=>fake}));
import {TemporalClientError} from '../../lib/temporal/client';
import {useBackendsStore} from '../../stores/backendsStore';
import {useDashboardStore} from '../../stores/dashboardStore';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {backend,card,widget} from '../../test/fixtures';
import {TemporalExplorerDialog} from './TemporalExplorerDialog';

const saved={schema_version:1 as const,query_id:queryId,revision:2,title:'AAPL',kind:'dataset' as const,parameters:[],request:{dataset_id:'eodhd.eod',parameters:{}},temporal:{mode:'current_corrected' as const},schema_expectation:[]};
beforeEach(()=>{
 for(const f of Object.values(fake))f.mockReset();
 fake.datasets.mockResolvedValue({datasets:[dataset],next_cursor:null});
 fake.describe.mockResolvedValue(description);
 fake.coverage.mockResolvedValue(coverage);
 fake.start.mockResolvedValue({execution_id:executionId,state:'queued'});
 fake.status.mockResolvedValue({execution_id:executionId,state:'succeeded',error:null});
 fake.page.mockResolvedValue(page);
 useBackendsStore.setState({backends:[backend()],services:{b1:'TemporalDB'}});
 useWidgetRegistryStore.setState({widgets:[widget({id:'temporaldb_query',type:'query_data'})]});
 // The explorer card 'c' lives on d1/t1; the active dashboard is that one unless a test says otherwise.
 const tab=(id:string,cards:ReturnType<typeof card>[])=>({id,name:id,cards});
 useDashboardStore.setState({dashboards:[{id:'d1',name:'D1',tabs:[tab('t1',[card({widgetId:'temporaldb_explorer'})])]},{id:'d2',name:'D2',tabs:[tab('t2',[])]}],activeId:'d1',activeTabId:'t1',
  applyCardParams:vi.fn(async()=>{}),addCardTo:vi.fn(async()=>'new-card'),bindQueryCard:vi.fn(async()=>{})});
});
const open=(params:Record<string,string>={dataset_id:'eodhd.eod',tier:'silver'},readOnly=false)=>render(<TemporalExplorerDialog card={card({widgetId:'temporaldb_explorer',params})} readOnly={readOnly} onClose={()=>{}}/>);
const pane=(name:string)=>screen.getByRole('region',{name});

it('browses the catalog by source with Load more and a search over loaded pages',async()=>{
 fake.datasets.mockResolvedValueOnce({datasets:[dataset],next_cursor:'next.page'}).mockResolvedValueOnce({datasets:[{...dataset,dataset_id:'fred.series/observations',source:'fred',accepted_cached:false,available_tiers:[]}],next_cursor:null});
 open();
 const eod=await within(pane('Catalog')).findByRole('article',{name:'eodhd.eod'});
 expect(within(eod).getByRole('button',{name:'silver'})).toHaveAttribute('aria-pressed','true');
 expect(within(eod).queryByRole('button',{name:'Add as source'})).toBeNull();
 await userEvent.click(within(pane('Catalog')).getByRole('button',{name:'Load more'}));
 expect(fake.datasets).toHaveBeenLastCalledWith({cursor:'next.page',limit:50});
 expect(await within(pane('Catalog')).findByRole('region',{name:'Source fred'})).toBeInTheDocument();
 await userEvent.type(within(pane('Catalog')).getByRole('searchbox',{name:'Search datasets'}),'fred');
 expect(within(pane('Catalog')).queryByRole('article',{name:'eodhd.eod'})).toBeNull();
});

it('inspects schema and coverage, with completeness exactly as returned',async()=>{
 open();
 expect(await within(pane('Inspector')).findByText('raw_close')).toBeInTheDocument();
 expect(fake.describe).toHaveBeenCalledWith({dataset_id:'eodhd.eod',tier:'silver'},expect.any(AbortSignal));
 expect(within(pane('Inspector')).getByText('effective, provider_published, local_received, accepted, stored')).toBeInTheDocument();
 await userEvent.click(within(pane('Inspector')).getByRole('tab',{name:'Coverage'}));
 await userEvent.type(within(pane('Inspector')).getByRole('textbox',{name:'Filter value'}),'AAPL.US');
 await userEvent.click(within(pane('Inspector')).getByRole('button',{name:'Load coverage'}));
 expect(fake.coverage).toHaveBeenCalledWith({dataset_id:'eodhd.eod',tier:'silver',filters:{symbol:'AAPL.US'},limit:50});
 // The fixture's null clock basis also reads "unknown"; assert the completeness line itself.
 expect((await within(pane('Inspector')).findByText('Completeness:',{exact:false})).querySelector('strong')).toHaveTextContent('unknown');
});

it('shows that gold has no identity coverage',async()=>{
 fake.coverage.mockResolvedValue({...coverage,tier:'gold',identities:[],identity_detail:{status:'CAPABILITY_UNAVAILABLE',basis:'projected identity metadata is not indexed'}});
 open({dataset_id:'eodhd.eod',tier:'gold'});
 await userEvent.click(within(pane('Inspector')).getByRole('tab',{name:'Coverage'}));
 await userEvent.click(within(pane('Inspector')).getByRole('button',{name:'Load coverage'}));
 expect(await within(pane('Inspector')).findByText(/Gold has no identity coverage/)).toBeInTheDocument();
});

it("reports an uncached dataset's describe error with its request ID and keeps browsing",async()=>{
 fake.describe.mockRejectedValue(new TemporalClientError('CAPABILITY_UNAVAILABLE','requested cache metadata unavailable',422,executionId));
 open();
 expect(await within(pane('Inspector')).findByRole('alert')).toHaveTextContent(`requested cache metadata unavailable (request ${executionId})`);
 expect(await within(pane('Catalog')).findByRole('article',{name:'eodhd.eod'})).toBeInTheDocument();
 expect(within(pane('Builder')).getByRole('button',{name:'Validate'})).toBeEnabled();
});

it('builds, validates, saves, runs and opens a dataset query',async()=>{
 fake.validate.mockImplementation(async(definition:unknown)=>({valid:true,definition}));
 fake.create.mockResolvedValue(saved);
 open();
 const builder=pane('Builder');
 await userEvent.type(await within(builder).findByRole('textbox',{name:'Parameter symbol'}),'AAPL.US');
 await userEvent.type(within(builder).getByRole('textbox',{name:'Query title'}),'AAPL');
 await userEvent.click(within(builder).getByRole('button',{name:'Validate'}));
 expect(await within(builder).findByText(/^Valid\./)).toBeInTheDocument();
 expect(fake.validate.mock.calls[0][0]).toMatchObject({kind:'dataset',request:{dataset_id:'eodhd.eod',parameters:{symbol:'AAPL.US'}},parameters:[{name:'symbol',type:'string',required:false,default:'AAPL.US'}]});
 await userEvent.click(within(builder).getByRole('button',{name:'Save to library'}));
 expect(await within(builder).findByText('Saved AAPL as revision 2.')).toBeInTheDocument();
 await userEvent.click(within(builder).getByRole('button',{name:'Run'}));
 expect(within(await within(builder).findByRole('region',{name:'Run preview'})).getByText('Revision 2')).toBeInTheDocument();
 expect(fake.start).toHaveBeenCalledWith(expect.objectContaining({query_id:queryId,revision:2,params:{symbol:'AAPL.US'}}),expect.any(AbortSignal));
 await userEvent.click(within(builder).getByRole('button',{name:'Open as query widget'}));
 await waitFor(()=>expect(useDashboardStore.getState().bindQueryCard).toHaveBeenCalledWith('new-card',{kind:'query',queryId,revisionPolicy:'fixed',revision:2,params:{symbol:'AAPL.US'},context:{mode:'current_corrected'}}));
});

it("opens the query widget on the explorer card's own dashboard and tab, not the active one",async()=>{
 useDashboardStore.setState({activeId:'d2',activeTabId:'t2'});
 const builder=await savedDataset();
 await userEvent.click(within(builder).getByRole('button',{name:'Run'}));
 await within(builder).findByRole('region',{name:'Run preview'});
 await userEvent.click(within(builder).getByRole('button',{name:'Open as query widget'}));
 await waitFor(()=>expect(useDashboardStore.getState().bindQueryCard).toHaveBeenCalledWith('new-card',expect.objectContaining({queryId,revision:2})));
 expect(useDashboardStore.getState().addCardTo).toHaveBeenCalledWith('d1','t1',expect.objectContaining({id:'temporaldb_query'}));
});

it('builds SQL over catalog sources, checks $names, and takes the schema from the first Run',async()=>{
 fake.create.mockResolvedValue({...saved,kind:'sql'});
 open();
 const builder=pane('Builder');
 await userEvent.click(within(builder).getByRole('radio',{name:'SQL'}));
 await userEvent.click(within(await within(pane('Catalog')).findByRole('article',{name:'eodhd.eod'})).getByRole('button',{name:'Add as source'}));
 expect(within(builder).getByRole('textbox',{name:'Alias for eodhd.eod'})).toHaveValue('eod');
 await userEvent.type(within(builder).getByRole('textbox',{name:'Query title'}),'Closes');
 fireEvent.change(within(builder).getByRole('textbox',{name:'SQL'}),{target:{value:'SELECT raw_close FROM eod WHERE raw_close > $floor'}});
 expect(within(builder).getByLabelText('Generated definition')).toHaveTextContent('Declare $floor');
 await userEvent.click(within(builder).getByRole('button',{name:'Add parameter'}));
 await userEvent.type(within(builder).getByRole('textbox',{name:'Parameter 1 name'}),'floor');
 await userEvent.selectOptions(within(builder).getByRole('combobox',{name:'Parameter 1 type'}),'number');
 await userEvent.type(within(builder).getByRole('textbox',{name:'Parameter floor'}),'1');
 expect(within(builder).getByLabelText('Generated definition')).toHaveTextContent('"max_rows": 10000');
 await userEvent.click(within(builder).getByRole('button',{name:'Save to library'}));
 await waitFor(()=>expect(fake.create).toHaveBeenCalled());
 expect(fake.create.mock.calls[0][0]).toMatchObject({kind:'sql',request:{sql:'SELECT raw_close FROM eod WHERE raw_close > $floor',sources:{eod:'eodhd.eod'},bindings:{},max_rows:10000,timeout_seconds:30},parameters:[{name:'floor',type:'number',default:1}],schema_expectation:[]});
 await userEvent.click(await within(builder).findByRole('button',{name:'Run'}));
 expect(await within(builder).findByText('Schema expectation: Revenue integer',{exact:false})).toBeInTheDocument();
});

it('read-only browses and validates but cannot save, run or open, and writes nothing',async()=>{
 open(undefined,true);
 await within(pane('Catalog')).findByRole('article',{name:'eodhd.eod'});
 for(const name of ['Save to library','Run','Open as query widget'])expect(within(pane('Builder')).getByRole('button',{name})).toBeDisabled();
 expect(within(pane('Builder')).getByRole('button',{name:'Validate'})).toBeEnabled();
 // Well past the 400ms debounce, which may restart as the panes load.
 await new Promise(r=>setTimeout(r,1200));
 expect(useDashboardStore.getState().applyCardParams).not.toHaveBeenCalled();
});

it('persists the selection and the builder draft on the card',async()=>{
 open();
 await userEvent.click(within(await within(pane('Catalog')).findByRole('article',{name:'eodhd.eod'})).getByRole('button',{name:'gold'}));
 await waitFor(()=>expect(useDashboardStore.getState().applyCardParams).toHaveBeenLastCalledWith('c',{cardParams:{dataset_id:'eodhd.eod',tier:'gold',draft:expect.any(String)},groupEdits:[]}),{timeout:2000});
});

const savedDataset=async()=>{
 fake.create.mockResolvedValue(saved);
 open();
 const builder=pane('Builder');
 await userEvent.type(await within(builder).findByRole('textbox',{name:'Parameter symbol'}),'AAPL.US');
 await userEvent.type(within(builder).getByRole('textbox',{name:'Query title'}),'AAPL');
 await userEvent.click(within(builder).getByRole('button',{name:'Save to library'}));
 await within(builder).findByText('Saved AAPL as revision 2.');
 return builder;
};

it('profiles the Run page in the inspector and clears it when the mode changes',async()=>{
 const builder=await savedDataset();
 expect(within(pane('Inspector')).getByText('Not profiled. Run a saved revision to profile this page.')).toBeInTheDocument();
 await userEvent.click(within(builder).getByRole('button',{name:'Run'}));
 expect(await within(builder).findByText('Column profile of this page is in the inspector.')).toBeInTheDocument();
 expect(within(pane('Inspector')).getByText(/Not the accepted cache/)).toHaveTextContent('Exact over this preview page · 1 rows profiled · completeness complete. Not the accepted cache.');
 expect(within(pane('Inspector')).getByRole('button',{name:'Revenue int64'}).parentElement).toHaveAttribute('aria-current','true');
 expect(fake.describe).toHaveBeenCalledTimes(1);
 await userEvent.click(within(builder).getByRole('radio',{name:'SQL'}));
 expect(within(pane('Inspector')).getByText('Not profiled. Run a saved revision to profile this page.')).toBeInTheDocument();
});

it('keeps a title typed while Save is in flight',async()=>{
 let resolve!:(q:typeof saved)=>void;
 fake.create.mockReturnValue(new Promise(r=>{resolve=r;}));
 open();
 const builder=pane('Builder');
 const title=await within(builder).findByRole('textbox',{name:'Query title'});
 await userEvent.type(title,'AAPL');
 await userEvent.click(within(builder).getByRole('button',{name:'Save to library'}));
 await userEvent.type(title,' daily');
 resolve(saved);
 await within(builder).findByText('Saved AAPL as revision 2.');
 expect(title).toHaveValue('AAPL daily');
 expect(within(builder).getByRole('button',{name:'Run'})).toBeEnabled();
});

it('keeps SQL typed while a SQL Run is in flight',async()=>{
 let resolve!:(p:typeof page)=>void;
 fake.page.mockReturnValue(new Promise(r=>{resolve=r;}));
 open({dataset_id:'eodhd.eod',tier:'silver',draft:JSON.stringify({mode:'sql',title:'Closes',description:'',context:{mode:'current_corrected'},params:[],sources:{eod:'eodhd.eod'},sql:'SELECT 1',maxRows:10000,timeoutSeconds:30,columns:[],queryId,revision:2})});
 const builder=pane('Builder');
 await userEvent.click(within(builder).getByRole('button',{name:'Run'}));
 await waitFor(()=>expect(fake.page).toHaveBeenCalled());
 fireEvent.change(within(builder).getByRole('textbox',{name:'SQL'}),{target:{value:'SELECT 2'}});
 resolve(page);
 expect(await within(builder).findByText('Schema expectation: Revenue integer',{exact:false})).toBeInTheDocument();
 expect(within(builder).getByRole('textbox',{name:'SQL'})).toHaveValue('SELECT 2');
});

it("passes the execution's own unknown completeness through to the profile note",async()=>{
 fake.page.mockResolvedValue({...page,receipt:{...page.receipt,completeness:'unknown'}});
 const builder=await savedDataset();
 await userEvent.click(within(builder).getByRole('button',{name:'Run'}));
 expect(await within(pane('Inspector')).findByText(/Not the accepted cache/)).toHaveTextContent('completeness unknown.');
});

it('drops a Run that answers after the selection changed: no preview, no profile',async()=>{
 let resolve!:(p:typeof page)=>void;
 const builder=await savedDataset();
 fake.page.mockReturnValue(new Promise(r=>{resolve=r;}));
 await userEvent.click(within(builder).getByRole('button',{name:'Run'}));
 await waitFor(()=>expect(fake.page).toHaveBeenCalled());
 await userEvent.click(within(within(pane('Catalog')).getByRole('article',{name:'eodhd.eod'})).getByRole('button',{name:'gold'}));
 resolve(page);
 await waitFor(()=>expect(within(builder).getByRole('button',{name:'Run'})).toBeEnabled());
 expect(within(builder).queryByRole('region',{name:'Run preview'})).toBeNull();
 expect(within(builder).queryByText('Column profile of this page is in the inspector.')).toBeNull();
 expect(within(pane('Inspector')).queryByText(/Not the accepted cache/)).toBeNull();
});
