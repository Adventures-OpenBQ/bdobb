// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
vi.mock('../dialogs/TemporalExplorerDialog',()=>({TemporalExplorerDialog:({readOnly}:{readOnly:boolean})=><p>Explorer dialog {readOnly?'read-only':'editable'}</p>}));
import {emptyDraft} from '../../lib/temporal/explorer';
import {useBackendsStore} from '../../stores/backendsStore';
import {backend,card} from '../../test/fixtures';
import {TemporalExplorerRenderer} from './TemporalExplorerRenderer';
it('shows the connection, selection and draft, and opens the explorer even read-only',async()=>{
 useBackendsStore.setState({backends:[backend({name:'Temporal'})]});
 render(<TemporalExplorerRenderer card={card({params:{dataset_id:'eodhd.eod',tier:'silver',draft:JSON.stringify({...emptyDraft(),title:'AAPL',revision:2})}})} readOnly/>);
 expect(screen.getByText('Temporal')).toBeInTheDocument();
 expect(screen.getByText('eodhd.eod')).toBeInTheDocument();
 expect(screen.getByText('AAPL · revision 2')).toBeInTheDocument();
 await userEvent.click(screen.getByRole('button',{name:'Open explorer'}));
 expect(screen.getByText('Explorer dialog read-only')).toBeInTheDocument();
});
it('shows a card whose stored draft is malformed as a fresh draft instead of throwing',()=>{
 useBackendsStore.setState({backends:[backend({name:'Temporal'})]});
 render(<TemporalExplorerRenderer card={card({params:{dataset_id:'eodhd.eod',tier:'silver',draft:JSON.stringify({...emptyDraft(),title:{text:'AAPL'},params:{}})}})} readOnly/>);
 expect(screen.getByText('eodhd.eod')).toBeInTheDocument();
 expect(screen.queryByText('Draft')).toBeNull();
});
