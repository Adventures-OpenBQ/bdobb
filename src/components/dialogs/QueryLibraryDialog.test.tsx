// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import type {QueryDefinition} from '../../lib/temporal/contracts';
import {queryId} from '../../lib/temporal/fixtures';
import {backend} from '../../test/fixtures';
import {useBackendsStore} from '../../stores/backendsStore';
import {useSharedQueryLibraryStore} from '../../stores/sharedQueryLibraryStore';
const fake=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('../../lib/temporal/client',()=>({createTemporalClient:()=>fake}));
import {QueryLibraryDialog} from './QueryLibraryDialog';
beforeEach(()=>{fake.list.mockReset();useSharedQueryLibraryStore.getState().clear();useBackendsStore.setState({backends:[backend()],services:{b1:'TemporalDB'}});});
it.each([
 {nullable:true,required:false,default:null,expected:{flag:null}},
 {nullable:false,required:false,expected:{}},
 {nullable:false,required:true,default:false,expected:{flag:false}},
 {nullable:false,required:true,default:true,expected:{flag:true}},
])('preserves a saved boolean parameter when opening a widget: %j',async({expected,...spec})=>{
 const definition:QueryDefinition={schema_version:1,query_id:queryId,revision:1,title:'Boolean query',kind:'sql',parameters:[{name:'flag',type:'boolean',...spec}],request:{sql:'SELECT :flag',sources:{},bindings:{}},temporal:{mode:'current_corrected'},schema_expectation:[]};
 fake.list.mockResolvedValue([definition]);const bind=vi.fn().mockResolvedValue(undefined);
 render(<QueryLibraryDialog backendId="b1" onClose={()=>{}} onBind={bind}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Select Boolean query'}));
 await userEvent.click(screen.getByRole('button',{name:'Open as table widget'}));
 await waitFor(()=>expect(bind).toHaveBeenCalledWith(expect.objectContaining({params:expected}),undefined));
});
