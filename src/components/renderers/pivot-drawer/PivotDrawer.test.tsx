// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormulaPanel } from '../../../test/formulaEditorAdapter';
import { PivotDrawer, type SectionSpec } from './PivotDrawer';
import { DRAWER_SECTIONS } from './drawerState';
import { clearDrawerDashboard, dispatchDrawer, getDrawerState } from '../../../stores/pivotDrawerStore';
const sections: SectionSpec[] = DRAWER_SECTIONS.map(id => ({ id, label: id, hint: `${id} hint`, render: () => <input aria-label={`${id} draft`} defaultValue="initial"/> }));
const split = {mode:'split',cramped:false,orientation:'vertical',short:false} as const;
afterEach(()=>act(()=>clearDrawerDashboard('shell-test')));
function mount(layout = split as {mode:'split'|'fill';cramped:boolean;orientation:'vertical'|'horizontal';short:boolean}) {
 render(<><button className="pivot-toggle" data-dashboard="shell-test" data-widget="card">Pivot</button><PivotDrawer dashboardId="shell-test" widgetId="card" sections={sections} layout={layout}/><div data-pivot-table="card" data-dashboard="shell-test" tabIndex={-1}>table</div></>);
 act(()=>dispatchDrawer('shell-test','card',{kind:'toggle'}));
}
describe('drawer shell',()=>{
 it('exposes one selected roving tab and keyboard axis navigation',()=>{
  mount(); const list=screen.getByRole('tablist'); expect(list).toHaveAttribute('aria-orientation','vertical');
  const tabs=screen.getAllByRole('tab');expect(tabs).toHaveLength(9);for(const tab of tabs)expect(document.getElementById(tab.getAttribute('aria-controls')!)).not.toBeNull();expect(tabs[0]).toHaveAttribute('tabindex','0');
  fireEvent.keyDown(tabs[0],{key:'ArrowDown'});expect(tabs[1]).toHaveFocus();expect(tabs[1]).toHaveAttribute('aria-selected','true');
  fireEvent.keyDown(tabs[1],{key:'End'});expect(tabs[8]).toHaveFocus();
  fireEvent.keyDown(tabs[8],{key:'Home'});expect(tabs[0]).toHaveFocus();expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby',tabs[0].id);
 });
 it('focuses the selected tab when opened from the toolbar',()=>{mount();expect(screen.getByRole('tab',{name:'arrange'})).toHaveFocus();});
 it('retains editor drafts across section switches and close/reopen',()=>{
  mount();fireEvent.change(screen.getByLabelText('arrange draft'),{target:{value:'retained'}});
  fireEvent.click(screen.getByRole('tab',{name:'categories'}));expect(screen.getByRole('button',{name:'Done'})).toBeVisible();
  fireEvent.click(screen.getByRole('tab',{name:'arrange'}));expect(screen.getByLabelText('arrange draft')).toHaveValue('retained');
  fireEvent.click(screen.getByRole('button',{name:'Done'}));act(()=>dispatchDrawer('shell-test','card',{kind:'toggle'}));expect(screen.getByLabelText('arrange draft')).toHaveValue('retained');
 });
 it('returns to Arrange on Escape, then restores toolbar focus',()=>{
  mount();fireEvent.click(screen.getByRole('tab',{name:'formulas'}));fireEvent.keyDown(screen.getByRole('tabpanel'),{key:'Escape'});
  expect(getDrawerState('shell-test','card').active).toBe('arrange');fireEvent.keyDown(screen.getByRole('tabpanel'),{key:'Escape'});
  expect(getDrawerState('shell-test','card').open).toBe(false);expect(screen.getByRole('button',{name:'Pivot'})).toHaveFocus();
 });
 it('honors nested Escape consumption and narrow presence attributes',()=>{
  mount({...split,orientation:'horizontal',short:true,mode:'fill'});
  const input=screen.getByLabelText('arrange draft');input.addEventListener('keydown',e=>e.preventDefault());fireEvent.keyDown(input,{key:'Escape'});
  expect(getDrawerState('shell-test','card').open).toBe(true);expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation','horizontal');
  expect(document.querySelector('.pivot-drawer')).toHaveAttribute('data-short','');
  expect(document.querySelector('[data-open="false"]')).toBeNull();
 });
});
it('restores toolbar focus when Show table has no mounted table target',()=>{
 render(<><button className="pivot-toggle" data-dashboard="shell-test" data-widget="card">Pivot</button><PivotDrawer dashboardId="shell-test" widgetId="card" sections={sections} layout={split}/></>);
 act(()=>dispatchDrawer('shell-test','card',{kind:'toggle'}));act(()=>dispatchDrawer('shell-test','card',{kind:'showTable'}));expect(screen.getByRole('button',{name:'Pivot'})).toHaveFocus();
});
it('provides Done and Close in every section and preserves drafts when switching orientation',()=>{
 const view=render(<PivotDrawer dashboardId="shell-test" widgetId="card" sections={sections} layout={split}/>);
 for(const section of DRAWER_SECTIONS){act(()=>dispatchDrawer('shell-test','card',{kind:'select',section}));expect(screen.getByRole('button',{name:'Close pivot drawer'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Done'}));expect(getDrawerState('shell-test','card').open).toBe(false);}
 act(()=>dispatchDrawer('shell-test','card',{kind:'select',section:'categories'}));fireEvent.change(screen.getByLabelText('categories draft'),{target:{value:'across resize'}});
 view.rerender(<PivotDrawer dashboardId="shell-test" widgetId="card" sections={sections} layout={{...split,orientation:'horizontal'}}/>);expect(screen.getByLabelText('categories draft')).toHaveValue('across resize');
 fireEvent.keyDown(screen.getByRole('tab',{name:'categories'}),{key:'ArrowRight'});expect(screen.getByRole('tab',{name:'measures'})).toHaveFocus();
});

it('returns through Back to Arrange and retains the visited draft',()=>{
 mount();fireEvent.click(screen.getByRole('tab',{name:'formulas'}));fireEvent.change(screen.getByLabelText('formulas draft'),{target:{value:'retained'}});
 fireEvent.click(screen.getByRole('button',{name:'Back to Arrange'}));expect(screen.getByRole('tab',{name:'arrange'})).toHaveFocus();
 fireEvent.click(screen.getByRole('tab',{name:'formulas'}));expect(screen.getByLabelText('formulas draft')).toHaveValue('retained');
});

it('keeps Formula actions in its own footer with retained drafts and caret focus',async()=>{
 const commit=vi.fn(async()=>false);const model={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[],measures:[],formulas:[],layout:{rows:[],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 render(<PivotDrawer dashboardId="shell-test" widgetId="card" layout={split} sections={sections.map(s=>s.id==='formulas'?{...s,render:()=> <FormulaPanel model={model} columns={[]} readonly={false} onCommitModel={commit}/>}:s)}/>);
 act(()=>dispatchDrawer('shell-test','card',{kind:'select',section:'formulas'}));
 const panel=screen.getByRole('tabpanel');const save=within(panel).getByRole('button',{name:'Save formula'});expect(save.closest('.pivot-drawer-foot')).not.toBeNull();
 fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'1'}});fireEvent.click(save);expect(await screen.findByRole('alert')).toHaveTextContent('Your draft has been retained');
 fireEvent.click(screen.getByRole('button',{name:'Back to Arrange'}));expect(screen.queryByRole('button',{name:'Save formula'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'formulas'}));expect(screen.getByLabelText('Expression')).toHaveValue('1');
 fireEvent.click(screen.getByRole('button',{name:'Insert SUM'}));await waitFor(()=>expect(screen.getByLabelText('Expression')).toHaveFocus());
 fireEvent.keyDown(screen.getByLabelText('Expression'),{key:'Escape'});expect(screen.getByRole('tab',{name:'arrange'})).toHaveFocus();
});

it('pins Arrange first and shares one Saved tab between saved definitions and the Statement template',()=>{
 const shared:SectionSpec[]=DRAWER_SECTIONS.map(id=>({id,label:id==='inspect'?'Saved':id,hint:`${id} hint`,render:()=><input aria-label={`${id} draft`} defaultValue="initial"/>,...(id==='inspect'?{subLabel:'Model'}:id==='statement'?{tabOf:'inspect' as const,subLabel:'Statement template'}:{})}));
 render(<PivotDrawer dashboardId="shell-test" widgetId="card" sections={shared} layout={split}/>);act(()=>dispatchDrawer('shell-test','card',{kind:'toggle'}));
 const tabs=screen.getAllByRole('tab');expect(tabs.map(t=>t.getAttribute('aria-label'))).toEqual(['arrange','categories','measures','pages','formulas','checklists','resultFilters','Saved']);
 expect(tabs[0]).toHaveAttribute('aria-selected','true');
 fireEvent.click(screen.getByRole('tab',{name:'Saved'}));expect(getDrawerState('shell-test','card').active).toBe('inspect');
 const views=screen.getByRole('group',{name:'Saved views'});fireEvent.click(within(views).getByRole('button',{name:'Statement template'}));
 expect(getDrawerState('shell-test','card').active).toBe('statement');expect(screen.getByRole('tab',{name:'Saved'})).toHaveAttribute('aria-selected','true');
 expect(screen.getByRole('tabpanel',{name:'Saved'})).toContainElement(screen.getByLabelText('statement draft'));
 // Re-clicking the shared tab keeps the current view rather than jumping back to Model.
 fireEvent.click(screen.getByRole('tab',{name:'Saved'}));expect(getDrawerState('shell-test','card').active).toBe('statement');
 fireEvent.keyDown(screen.getByRole('tab',{name:'Saved'}),{key:'Home'});expect(screen.getByRole('tab',{name:'arrange'})).toHaveFocus();
});
