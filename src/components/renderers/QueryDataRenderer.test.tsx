// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
vi.mock('./LocalTableRenderer',()=>({LocalTableRenderer:()=> <div>Existing execution table</div>}));
vi.mock('../dialogs/QueryLibraryDialog',()=>({QueryLibraryDialog:({onFeed}:{onFeed?:()=>void})=><div>{onFeed?'feed offered':'feed withheld'}</div>}));
import {fireEvent} from '@testing-library/react';
import {QueryDataRenderer} from './QueryDataRenderer';
import {card} from '../../test/fixtures';
import {fixed} from '../../lib/temporal/fixtures';
it('offers the shared library for an unbound source and preserves invalid intent for repair',()=>{
 const {rerender}=render(<QueryDataRenderer dashboardId="d" card={card()} filterRow={false}/>);expect(screen.getByRole('button',{name:'Open query library'})).toBeVisible();
 rerender(<QueryDataRenderer dashboardId="d" card={{...card(),queryBinding:{...fixed,revision:0}}} filterRow={false}/>);expect(screen.getByRole('alert')).toHaveTextContent(/binding/i);
});
it('uses the existing table renderer for a valid persisted binding',()=>{
 render(<QueryDataRenderer dashboardId="d" card={{...card(),queryBinding:fixed}} filterRow={false}/>);expect(screen.getByText('Existing execution table')).toBeVisible();
});
it('offers feeding a group from the library on a dashboard card but not in the docks',()=>{
 const {unmount}=render(<QueryDataRenderer dashboardId="d" card={card()} filterRow={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Open query library'}));expect(screen.getByText('feed offered')).toBeVisible();unmount();
 render(<QueryDataRenderer dashboardId="docks" card={card()} filterRow={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Open query library'}));expect(screen.getByText('feed withheld')).toBeVisible();
});
