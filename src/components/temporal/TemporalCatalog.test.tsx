// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import type {TemporalClient} from '../../lib/temporal/client';
import {dataset} from '../../lib/temporal/fixtures';
import {TemporalCatalog} from './TemporalCatalog';
it('groups by source, marks cached data and selects a tier',async()=>{
 const client={datasets:vi.fn(async()=>({datasets:[dataset],next_cursor:null}))} as unknown as TemporalClient;
 const onSelect=vi.fn();
 render(<TemporalCatalog client={client} datasetId="" tier="silver" onSelect={onSelect}/>);
 const eod=await screen.findByRole('article',{name:'eodhd.eod'});
 expect(within(screen.getByRole('region',{name:'Source eodhd'})).getByText('eod')).toBeInTheDocument();
 expect(within(eod).getByText('Cached')).toBeInTheDocument();
 await userEvent.click(within(eod).getByRole('button',{name:'gold'}));
 expect(onSelect).toHaveBeenCalledWith('eodhd.eod','gold');
 expect(screen.queryByRole('button',{name:'Load more'})).toBeNull();
});
