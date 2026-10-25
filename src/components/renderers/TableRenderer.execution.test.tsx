// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TableRenderer } from './TableRenderer';
import type { ExecutionTableView } from './TableRenderer';
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 5) }, (_, index) => ({ index, start: index * 28, end: (index + 1) * 28 })), getTotalSize: () => count * 28, measureElement: () => {}, scrollToIndex: () => {} }) }));
it('workerResultsAreNotReaggregatedByTanStack and unloaded slots are scroll loading', () => {
  const rows = [{ revenue: 90 }, { revenue: 10 }];
  const execution: ExecutionTableView = { columns: [{ field: 'revenue', header: 'Revenue', cellDataType: 'number', renderFn: [], colorRules: [], hiddenByDefault: false }], count: 3, rowIds: ['group-b', 'group-a'], slot: i => ({ rowId: ['group-b', 'group-a'][i], groupPath: [], offset: i }), requestRange: () => {}, toggle: () => {}, totals: { revenue: 40 } };
  render(<TableRenderer data={rows} execution={execution} state={{ sorting: [{ id: 'revenue', desc: false }], columnFilters: [{ id: 'revenue', value: { min: 50 } }] }} />);
  expect(screen.getAllByText(/^(90|10)$/).map(x => x.textContent)).toEqual(['90', '10']);
  expect(screen.getByText('Loading rows…')).toBeInTheDocument();
  expect(screen.getByText('40')).toBeInTheDocument();
});
it('rendering uses the activated calculated schema while a hidden-field edit is pending', () => {
  const execution: ExecutionTableView = { columns: [{ field: 'revenue', header: 'Revenue', cellDataType: 'number', renderFn: [], colorRules: [], hiddenByDefault: false }], count: 1, rowIds: ['r'], slot: () => ({ rowId: 'r', groupPath: [], offset: 0 }), requestRange: () => {}, toggle: () => {}, totals: { revenue: 40 } };
  render(<TableRenderer data={[{ revenue: 10 }]} execution={execution} state={{ hidden: ['revenue'] }} onStateChange={() => {}} />);
  expect(screen.getByText('10')).toBeInTheDocument();
  expect(screen.getByText('40')).toBeInTheDocument();
});

it('worker totals follow pinned header/body order and share measured sticky offsets', () => {
  const widths: Record<string, number> = { a: 80, b: 120, c: 90, d: 70 };
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: widths[this.getAttribute('data-field') ?? ''] ?? 0, height: 28, top: 0, left: 0, right: 0, bottom: 28, x: 0, y: 0, toJSON: () => ({}) };
  });
  try {
    const execution: ExecutionTableView = { columns: ['a', 'b', 'c', 'd'].map(field => ({ field, header: field, cellDataType: 'number', renderFn: [], colorRules: [], hiddenByDefault: false })), count: 1, rowIds: ['r'], slot: () => ({ rowId: 'r', groupPath: [], offset: 0 }), requestRange: () => {}, toggle: () => {}, totals: { a: 101, b: 202, c: 303, d: 404 } };
    const { container } = render(<TableRenderer data={[{ a: 1, b: 2, c: 3, d: 4 }]} execution={execution} state={{ pinned: { b: 'left', d: 'left', c: 'right' } }} onStateChange={() => {}} />);
    const fields = (selector: string) => [...container.querySelectorAll(selector)].map(cell => cell.getAttribute('data-field'));
    expect(fields('thead th')).toEqual(['b', 'd', 'a', 'c']);
    expect(fields('tbody td')).toEqual(fields('thead th'));
    expect(fields('tfoot td')).toEqual(fields('thead th'));
    expect([...container.querySelectorAll('tfoot td')].map(cell => cell.textContent)).toEqual(['202', '404', '101', '303']);
    const b = container.querySelector('tfoot [data-field="b"]');
    const d = container.querySelector('tfoot [data-field="d"]');
    const c = container.querySelector('tfoot [data-field="c"]');
    expect(b).toHaveClass('pin-left');
    expect(d).toHaveClass('pin-left');
    expect(c).toHaveClass('pin-right');
    expect(d).toHaveStyle({ left: '120px', width: '70px' });
    expect(b).toHaveStyle({ width: '120px' });
    expect(c).toHaveStyle({ right: '0px' });
    expect((d as HTMLElement).style.left).toBe((container.querySelector('thead [data-field="d"]') as HTMLElement).style.left);
    expect((c as HTMLElement).style.right).toBe((container.querySelector('tbody [data-field="c"]') as HTMLElement).style.right);
  } finally { measure.mockRestore(); }
});

it('grand totals stay beneath the scrolling body and mirror horizontal scrolling', () => {
 const execution:ExecutionTableView={columns:[{field:'x',header:'X',cellDataType:'number',renderFn:[],colorRules:[],hiddenByDefault:false}],count:1,rowIds:['r'],slot:()=>({rowId:'r',groupPath:[],offset:0}),requestRange:()=>{},toggle:()=>{},totals:{x:5}};
 const {container}=render(<TableRenderer data={[{x:1}]} execution={execution} />);
 const scroll=container.querySelector('.table-scroll')! as HTMLElement;
 expect(scroll.querySelector('tfoot')).toBeNull();
 const footer=container.querySelector('.table-total-scroll')! as HTMLElement;
 expect(footer).not.toBeNull();
 scroll.scrollLeft=135;scroll.dispatchEvent(new Event('scroll',{bubbles:true}));
 expect(footer.scrollLeft).toBe(135);
});
it('footer column bindings named like prototypes use declared width fallback',()=>{
 const execution:ExecutionTableView={columns:[{field:'constructor',header:'Constructor',cellDataType:'number',renderFn:[],colorRules:[],hiddenByDefault:false}],count:1,rowIds:['r'],slot:()=>({rowId:'r',groupPath:[],offset:0}),requestRange:()=>{},toggle:()=>{},totals:{constructor:5}};
 const {container}=render(<TableRenderer data={[{constructor:1}]} execution={execution} />);
 expect(container.querySelector('tfoot [data-field="constructor"]')).toHaveStyle({width:'150px'});
});
it('bounds visible total context and retains the complete Page set in accessible detail',()=>{
 const label='Grand total · Scenario: '+Array.from({length:30},(_,i)=>`Selected member ${i}`).join(', ');
 const execution:ExecutionTableView={columns:[],count:0,rowIds:[],slot:()=>({groupPath:[],offset:0}),requestRange:()=>{},toggle:()=>{},totals:{},totalLabel:label};
 const {container}=render(<TableRenderer data={[]} execution={execution}/>);const context=container.querySelector('.table-total-context')!;expect(context.textContent!.length).toBeLessThanOrEqual(161);expect(context).toHaveAttribute('title',label);expect(container.querySelector('tfoot')).toHaveAttribute('aria-label',label);
});

it.each(['typescript','rust'] as const)('%s activated store output retains renderer schema, row order and totals',async engine=>{
 const {createTableExecutionStore}=await import('../../stores/tableExecutionStore');
 const {ProviderBoundary}=await import('../../test/tableProviderBoundary');
 const {input}=await import('../../lib/tableExecution/fixtures');
 vi.stubGlobal('Worker',ProviderBoundary);
 const store=createTableExecutionStore({engine,source:()=>({acquire:async()=>({kind:'dataset',dataset:input})})});
 try{
  store.syncDashboard({id:'renderer',name:'R',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'f'},layout:{x:0,y:0,w:1,h:1},table:{sorting:[{id:'revenue',desc:true}],columnFilters:[{id:'revenue',value:{min:15}}]}}]}]});
  store.ensureTable('renderer','w');await store.settled('renderer');
  const view=store.readView('renderer','w'),executor=store.readExecutor('renderer','w')!,signal=new AbortController().signal;
  expect(view.status).toBe('ready');const block=await executor.rows(view.active!,{groupPath:[],offset:0,limit:10},signal),totals=await executor.totals(view.active!,signal);
  expect(block.rows.map(row=>row.values.revenue)).toEqual([90,20]);
  const execution:ExecutionTableView={columns:view.ready!.columns.map(c=>({field:c.id,header:c.label,cellDataType:c.dtype,renderFn:[],colorRules:[],hiddenByDefault:false})),count:view.ready!.topLevelCount,rowIds:block.rows.map(row=>row.id),slot:i=>({rowId:block.rows[i]?.id,groupPath:[],offset:i}),requestRange:()=>{},toggle:()=>{},totals:totals.values};
  const {container}=render(<TableRenderer data={block.rows.map(row=>row.values)} execution={execution} state={{sorting:[{id:'revenue',desc:false}]}}/>);
  expect([...container.querySelectorAll('tbody [data-field="revenue"]')].map(cell=>cell.textContent)).toEqual(['90','20']);
 }finally{store.disposeDashboard('renderer');vi.unstubAllGlobals();}
});
