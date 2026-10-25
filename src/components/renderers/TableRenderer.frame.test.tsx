// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TableRenderer, type ExecutionTableView } from './TableRenderer';
import { LABEL_FIELD } from '../../lib/pivotTable';
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 28, end: (index + 1) * 28 })), getTotalSize: () => count * 28, measureElement: () => {}, scrollToIndex: () => {} }) }));
const column=(field:string)=>({field,header:field===LABEL_FIELD?'Company › Year':field,cellDataType:'number' as const,renderFn:[],colorRules:[],hiddenByDefault:false});
const view=(fields=[LABEL_FIELD,'revenue','margin']):ExecutionTableView=>({columns:fields.map(column),count:1,rowIds:['r'],slot:()=>({rowId:'r',groupPath:[],offset:0}),requestRange:()=>{},toggle:()=>{},totals:{[LABEL_FIELD]:'Grand total',revenue:90},selection:{selection:{kind:'none'},selectedCount:0,eligibleCount:1,checked:false,indeterminate:false,rows:[]}});
it('pins only the combined two-category label by identity, with measured selection gutter shared by body and totals',()=>{
 const measure=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const width=this.hasAttribute('data-selection-gutter')?42:this.getAttribute('data-field')===LABEL_FIELD?137:80;return {width,height:28,left:0,right:width,top:0,bottom:28,x:0,y:0,toJSON:()=>({})};});
 try{
 const {container,rerender}=render(<TableRenderer data={[{[LABEL_FIELD]:'ACME › 2026',revenue:90}]} execution={view(['revenue',LABEL_FIELD,'margin'])} state={{pinned:{[LABEL_FIELD]:'right'}}}/>);
 for(const section of ['thead','tbody','tfoot']){const label=[...container.querySelectorAll(`${section} [data-field]`)].find(c=>c.getAttribute('data-field')===LABEL_FIELD);expect(label).toHaveClass('pin-left');expect(label).toHaveStyle({left:'42px'});expect(container.querySelector(`${section} [data-field="revenue"]`)).not.toHaveClass('pin-left');expect(container.querySelector(`${section} .selection-cell`)).toHaveClass('pin-left');}
 rerender(<TableRenderer data={[{revenue:90}]} execution={view(['revenue','margin'])}/>);expect(container.querySelector('thead [data-field="revenue"]')).not.toHaveClass('pin-left');
 }finally{measure.mockRestore();}
});
it('renders worker body and total diagnostics with warning text and full accessible message',()=>{
 const error={code:'missing-member',message:'The requested member does not exist.'};const execution={...view(),rowErrors:new Map([["r",{revenue:error}]]),totalErrors:{revenue:error}};
 const {container}=render(<TableRenderer data={[{[LABEL_FIELD]:'ACME',revenue:'#ERROR'}]} execution={execution}/>);
 expect(screen.getAllByRole('img', { name: `Error: ${error.message}` })).toHaveLength(2);for(const section of ['tbody','tfoot']){const cell=container.querySelector(`${section} [data-field="revenue"]`);expect(cell).toHaveClass('cell-error');expect(cell).toHaveTextContent('⚠ #ERROR');expect(cell).toHaveAttribute('title',`${error.code}: ${error.message}`);}
});
it('counts measured offscreen visible leaves and removes the cue at the right boundary',()=>{
 const measure=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const field=this.getAttribute('data-field');const left=field==='revenue'?100:field==='margin'?200:0;const width=100;return {width,height:28,left,right:left+width,top:0,bottom:28,x:left,y:0,toJSON:()=>({})};});
 try{const {container,rerender}=render(<TableRenderer data={[{revenue:90}]} execution={{...view(['revenue','margin']),selection:undefined}}/>);const scroll=container.querySelector('.table-scroll')!;Object.defineProperties(scroll,{clientWidth:{value:150},scrollWidth:{value:300}});fireEvent.scroll(scroll);expect(scroll).toHaveAttribute('data-overflow-right');expect(screen.getByRole('button',{name:'+2 columns →'})).toBeVisible();rerender(<TableRenderer data={[{revenue:90}]} execution={{...view(['revenue']),selection:undefined}}/>);expect(screen.getByRole('button',{name:'+1 column →'})).toBeVisible();Object.defineProperty(scroll,'scrollLeft',{value:150,writable:true});fireEvent.scroll(scroll);expect(scroll).not.toHaveAttribute('data-overflow-right');expect(screen.queryByRole('button',{name:/columns? →/})).toBeNull();}finally{measure.mockRestore();}
});
it('sums measured pinned widths after the gutter exactly once and retains ordinary explicit pins',()=>{
 const measure=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const width=this.hasAttribute('data-selection-gutter')?41:this.getAttribute('data-field')===LABEL_FIELD?133:89;return {width,height:28,left:0,right:width,top:0,bottom:28,x:0,y:0,toJSON:()=>({})};});
 try{const {container}=render(<TableRenderer data={[{[LABEL_FIELD]:'ACME',revenue:90}]} execution={view()} state={{pinned:{revenue:'left'}}}/>);for(const section of ['thead','tbody','tfoot'])expect(container.querySelector(`${section} [data-field="revenue"]`)).toHaveStyle({left:'174px'});}finally{measure.mockRestore();}
});
it('does not offer ineffective pin actions for the forced report label',()=>{
 render(<TableRenderer data={[{[LABEL_FIELD]:'ACME',revenue:90}]} execution={view()}/>);fireEvent.contextMenu(screen.getByRole('columnheader',{name:'Company › Year'}));expect(screen.queryByRole('menuitem',{name:'Pin right'})).toBeNull();expect(screen.queryByRole('menuitem',{name:'Unpin'})).toBeNull();
});
