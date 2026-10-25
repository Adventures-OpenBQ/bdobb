// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { FilterPlacement } from './FilterPlacement';
import { migratePivot } from '../../../lib/tableModel/migration';
import { promote,setFilterKeys } from '../../../lib/tableModel/pivotParams';
import type { ModelEdit } from '../../../stores/tableCommitCoordinator';
const categoryId='category:["Sector","native"]';
it('promotes and edits placement functionally, preserving latest values and independent metadata',async()=>{
 const model=setFilterKeys(migratePivot({enabled:true,grouping:['Sector'],split:[]}),categoryId,['["string","Tech"]']);const edit=vi.fn(async(_:ModelEdit)=>true);
 const {rerender}=render(<FilterPlacement model={model} categoryId={categoryId} readonly={false} onEditModel={edit}/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Parameters row'}));});const promoted=edit.mock.calls[0][0].apply({...model,params:{...model.params,promotePage:false}});
 expect(promoted.params.filters[0]).toMatchObject({categoryId,label:'Sector',multiSelect:true});expect(promoted.params.promotePage).toBe(false);expect(promoted.checklists).toEqual(model.checklists);
 rerender(<FilterPlacement model={promoted} categoryId={categoryId} readonly={false} onEditModel={edit}/>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Single-select'}));});const latest=promote(setFilterKeys(promoted,categoryId,['["string","Energy"]']),categoryId,{...promoted.params.filters[0],label:'Latest'});
 const changed=edit.mock.calls[1][0].apply(latest);expect(changed.params.filters[0]).toMatchObject({label:'Latest',multiSelect:false});expect(changed.checklists).toEqual(latest.checklists);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'In this panel'}));});expect(edit.mock.calls[2][0].apply(latest).checklists).toEqual(latest.checklists);
});
it('does not coalesce independent queued label and selection-mode edits',async()=>{
 const model=promote(migratePivot({enabled:true,grouping:['Sector'],split:[]}),categoryId,{id:'p',label:'Sector',multiSelect:true});const edit=vi.fn(async(_:ModelEdit)=>true);
 render(<FilterPlacement model={model} categoryId={categoryId} readonly={false} onEditModel={edit}/>);fireEvent.change(screen.getByLabelText('Parameter label'),{target:{value:'Industry'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save parameter label'}));});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Single-select'}));});
 expect(edit.mock.calls[0][0].replaceKey).not.toBe(edit.mock.calls[1][0].replaceKey);const next=edit.mock.calls[1][0].apply(edit.mock.calls[0][0].apply(model));expect(next.params.filters[0]).toMatchObject({label:'Industry',multiSelect:false});
});
it('keeps an unsaved label draft when an independent mode edit succeeds',async()=>{
 const model=promote(migratePivot({enabled:true,grouping:['Sector'],split:[]}),categoryId,{id:'p',label:'Sector',multiSelect:true});render(<FilterPlacement model={model} categoryId={categoryId} readonly={false} onEditModel={async()=>true}/>);
 fireEvent.change(screen.getByLabelText('Parameter label'),{target:{value:'Unsaved industry'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Single-select'}));});expect(screen.getByLabelText('Parameter label')).toHaveValue('Unsaved industry');
});
