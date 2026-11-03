// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
vi.mock('./LocalTableRenderer',()=>({LocalTableRenderer:()=> <div>Existing execution table</div>}));
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
