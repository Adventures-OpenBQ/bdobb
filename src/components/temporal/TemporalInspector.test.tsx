// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import type {Coverage,DatasetDescription} from '../../lib/temporal/catalog';
import type {TemporalClient} from '../../lib/temporal/client';
import {profileColumns} from '../../lib/temporal/explorer';
import {coverage as coverageFixture,description as describedFixture} from '../../lib/temporal/fixtures';
import {TemporalInspector} from './TemporalInspector';

const LONG='x'.repeat(41);
const description={...describedFixture,observed_schema:[...describedFixture.observed_schema,{name:'ticker_note',type:'string',nullable:true}]} as unknown as DatasetDescription;
const coverage=coverageFixture as unknown as Coverage;
// One page: raw_close has 1,001 distinct values, ticker_note leads with a 41-character string.
const rows=Array.from({length:1001},(_,i)=>({raw_close:200+i/100,effective_from:`2026-01-${String(1+i%28).padStart(2,'0')}`,ticker_note:i===0?LONG:i%2?'odd':''}));
// A profiled column: the wrapper carries aria-current and holds the select button and, when current, the facts.
const column=(name:string)=>screen.getByRole('button',{name:new RegExp(`^${name} `)}).parentElement!;
const client={describe:vi.fn(),coverage:vi.fn()} as unknown as TemporalClient&{describe:ReturnType<typeof vi.fn>;coverage:ReturnType<typeof vi.fn>};
beforeEach(()=>{client.describe.mockReset();client.coverage.mockReset().mockResolvedValue(coverage);});

it('shows the observed column and says it is not profiled before a run',()=>{
 render(<TemporalInspector client={client} datasetId="eodhd.eod" tier="silver" description={description} error=""/>);
 expect(screen.getByText('raw_close')).toBeInTheDocument();
 expect(screen.getByText('decimal128(38, 18)')).toBeInTheDocument();
 expect(screen.getByText('Not profiled. Run a saved revision to profile this page.')).toBeInTheDocument();
 expect(screen.getByText('Schema not complete')).toHaveClass('bd-badge','bd-temporal-schema-flag');
 expect(screen.queryByText('1,000+')).toBeNull();
 expect(screen.queryByText('Present')).toBeNull();
});

it('profiles the preview page without calling TemporalDB',async()=>{
 const profile=profileColumns(description.observed_schema!,rows,'partial');
 render(<TemporalInspector client={client} datasetId="eodhd.eod" tier="silver" description={description} error="" profile={profile}/>);
 expect(screen.getByText(/Not the accepted cache/)).toHaveTextContent('Exact over this preview page · 1,001 rows profiled · completeness partial. Not the accepted cache.');
 expect(screen.getByText('raw_close')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'raw_close decimal128(38, 18)'})).toBeInTheDocument();
 const close=column('raw_close');
 expect(close).toHaveAttribute('aria-current','true');
 expect(close.querySelector('button dl')).toBeNull();
 expect(close.querySelector(':scope > dl.bd-temporal-facts')).not.toBeNull();
 expect(within(close).getByText('1,000+')).toBeInTheDocument();
 expect(within(close).getByText('210')).toBeInTheDocument();
 expect(within(close).getAllByText('—')).toHaveLength(1);
 const note=column('ticker_note');
 expect(within(note).queryByText('Present')).toBeNull();
 await userEvent.click(within(note).getByRole('button'));
 expect(note).toHaveAttribute('aria-current','true');
 expect(close).not.toHaveAttribute('aria-current');
 expect(within(note).getByText('x'.repeat(40))).toBeInTheDocument();
 expect(within(note).queryByText(LONG)).toBeNull();
 expect(within(note).getAllByText('—')).toHaveLength(3);
 expect(client.describe).not.toHaveBeenCalled();
 expect(client.coverage).not.toHaveBeenCalled();
});

it('shows None for a ranged column with no present value',()=>{
 render(<TemporalInspector client={client} datasetId="eodhd.eod" tier="silver" description={description} error="" profile={profileColumns(description.observed_schema!,[{ticker_note:'a'}])}/>);
 expect(within(column('raw_close')).getAllByText('None')).toHaveLength(3);
});

it('drops a coverage page that arrives after the tier changed',async()=>{
 let resolve!:(c:Coverage)=>void;
 client.coverage.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 const view=render(<TemporalInspector client={client} datasetId="eodhd.eod" tier="silver" description={description} error=""/>);
 await userEvent.click(screen.getByRole('tab',{name:'Coverage'}));
 await userEvent.click(screen.getByRole('button',{name:'Load coverage'}));
 view.rerender(<TemporalInspector client={client} datasetId="eodhd.eod" tier="gold" description={description} error=""/>);
 resolve(coverage);
 await new Promise(r=>setTimeout(r,0));
 expect(screen.queryByText('Completeness:',{exact:false})).toBeNull();
 expect(screen.getByRole('button',{name:'Load coverage'})).toBeEnabled();
});

it('loads more with the filter that produced the first page, not the edited text box',async()=>{
 client.coverage.mockResolvedValueOnce({...coverage,next_cursor:'c2'}).mockResolvedValueOnce({...coverage,identities:[{capture_id:'page-2',request:{symbol:'AAPL.US'}}]});
 render(<TemporalInspector client={client} datasetId="eodhd.eod" tier="silver" description={description} error=""/>);
 await userEvent.click(screen.getByRole('tab',{name:'Coverage'}));
 const box=screen.getByRole('textbox',{name:'Filter value'});
 await userEvent.type(box,'AAPL.US');
 await userEvent.click(screen.getByRole('button',{name:'Load coverage'}));
 await userEvent.clear(box);await userEvent.type(box,'MSFT.US');
 await userEvent.click(await screen.findByRole('button',{name:'Load more'}));
 expect(client.coverage).toHaveBeenLastCalledWith({dataset_id:'eodhd.eod',tier:'silver',filters:{symbol:'AAPL.US'},cursor:'c2',limit:50});
});
