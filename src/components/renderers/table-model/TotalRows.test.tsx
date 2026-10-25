// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TotalRows } from './TotalRows';
it('renders independent nonselectable totals with readable errors and scope labels', () => {
 const {container}=render(<table><TotalRows columns={[{id:'revenue',label:'Revenue',style:{left:0,width:100},pin:'left'},{id:'margin',label:'Margin'}]} values={{revenue:10,margin:'#ERROR'}} cellErrors={{margin:{code:'division-by-zero',message:'Cannot divide by zero.'}}} format={v=>String(v??'')} label="Grand total · Page Actual" selectionGutter /></table>);
 expect(screen.getByRole('rowgroup',{name:'Grand total · Page Actual'})).toBeInTheDocument();
 expect(screen.getByRole('img', { name: 'Error: Cannot divide by zero.' })).toHaveTextContent('⚠ #ERROR');
 expect(container.querySelector('[data-field="margin"]')).toHaveClass('cell-error');
 expect(container.querySelectorAll('input,button')).toHaveLength(0);
 expect(container.querySelector('[data-field="revenue"]')).toHaveClass('pin-left');
 expect(container.querySelector('[data-field="revenue"]')).toHaveStyle({width:'100px',left:'0px'});
});
it('distinguishes empty totals from zero',()=>{
 const {rerender}=render(<table><TotalRows columns={[{id:'x',label:'X'}]} values={{x:0}} format={String} empty /></table>);
 expect(screen.getByText('No eligible data')).toBeInTheDocument();
 rerender(<table><TotalRows columns={[{id:'x',label:'X'}]} values={{x:0}} format={String} /></table>);
 expect(screen.getByText('0')).toBeInTheDocument();
});
it('shows the empty state even without a delivered output column',()=>{
 render(<table><TotalRows columns={[]} values={{}} format={String} empty /></table>);
 expect(screen.getByText('No eligible data')).toBeInTheDocument();
});

it('retains the full diagnostic as a tooltip and accessible name when a narrow total cell is clipped', () => {
 const message='Choose an aggregation for this measure before calculating report totals.';
 render(<table><TotalRows columns={[{id:'narrow',label:'Revenue',style:{width:40}}]} values={{narrow:'#ERROR'}} cellErrors={{narrow:{code:'missing-aggregation',message}}} format={String}/></table>);
 const cell=screen.getByRole('cell',{name:`Revenue total: missing-aggregation: ${message}`});
 expect(cell).toHaveAttribute('title',`missing-aggregation: ${message}`);
});
