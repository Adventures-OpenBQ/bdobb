// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {definition} from './fixtures';
import {LAYOUT_KEY,layoutFromTable,savedLayout,tableDefinitionFromLayout,withLayout} from './presentation';
const model={version:1,rows:['Region'],columns:[],values:[{field:'Revenue',agg:'sum'}]};
it('saves only the pivot model and column order, never widths, sorting or filters',()=>{
 const layout=layoutFromTable({table:{columnOrder:['Region','Revenue'],widths:{Region:200},sorting:[{id:'Revenue',desc:true}]},search:'acme',analytical:model});
 expect(layout).toEqual({analytical:model,columnOrder:['Region','Revenue']});
 expect(layoutFromTable({table:{},search:''})).toBeNull();
 const next=withLayout({...definition,presentation:{format:'table'}},layout!);
 expect(next.presentation).toEqual({format:'table',[LAYOUT_KEY]:layout});
 expect(savedLayout(next)).toEqual(layout);
 expect(tableDefinitionFromLayout(layout!)).toEqual({table:{columnOrder:['Region','Revenue']},search:'',analytical:model});
});
it('ignores a malformed saved layout instead of applying it',()=>{
 expect(savedLayout({presentation:{[LAYOUT_KEY]:{analytical:'x'}}})).toBeNull();
 expect(savedLayout({presentation:{[LAYOUT_KEY]:{analytical:model,columnOrder:[1]}}})).toBeNull();
 expect(savedLayout({presentation:null})).toBeNull();
});
