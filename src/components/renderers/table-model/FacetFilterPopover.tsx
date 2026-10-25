// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { DrawerFooterActions } from '../pivot-drawer/DrawerFooterTarget';
import { useState } from 'react';
import { setFilterKeys } from '../../../lib/tableModel/pivotParams';
import type { ModelEdit } from '../../../stores/tableCommitCoordinator';
import type { FacetResult } from '../../../lib/tableExecution/types';
import type { TableModelV1 } from '../../../lib/tableModel/types';
export function FacetFilterPopover({ model, categoryId, facet, readonly, pending, error, onCommitModel, onEditModel }: {
    model: TableModelV1;
    categoryId: string;
    facet?: FacetResult;
    readonly: boolean;
    pending?: boolean;
    error?: string;
    onEditModel?: (edit:ModelEdit)=>Promise<boolean>;
    onCommitModel: (next: TableModelV1) => Promise<boolean>;
}) {
    const members = facet?.categoryId === categoryId ? facet.members : undefined;
    const committed = model.checklists.find(c => c.categoryId === categoryId);
    const [keys, setKeys] = useState<string[] | undefined>();
    const [search, setSearch] = useState('');
    const [saveError,setSaveError]=useState('');
    const publish=async(memberKeys:string[]|null)=>{const draft=keys;const ok=onEditModel?await onEditModel({apply:current=>setFilterKeys(current,categoryId,memberKeys),replaceKey:`checklist:${categoryId}`}):await onCommitModel(setFilterKeys(model,categoryId,memberKeys));setSaveError(ok?'':'Could not save checklist. Your edits have been retained.');if(ok)setKeys(current=>current===draft?undefined:current);};
    const selected = keys ?? committed?.memberKeys ?? members?.map(m => m.key) ?? [];
    const actions=<div className="pivot-filter-actions"><button type="button" className="pivot-filter-apply" disabled={readonly||pending||!members} onClick={() => void publish(selected)}>Apply checklist</button>
   <button type="button" disabled={readonly||pending||!members} onClick={() => void publish(null)}>Remove checklist</button><span className="pivot-filter-count-note">Counts exclude this category's own checklist.</span></div>;
    return <section className="pivot-filter-members" aria-label="Category checklist">
  {pending ? <p role="status">Loading members…</p> : null}{error ? <p role="alert">{error}</p> : null}
  <fieldset disabled={readonly || pending || !members}><legend>Available members · {model.categories.find(c=>c.id===categoryId)?.name}</legend><div className="pivot-filter-member-tools"><label>Search members<input value={search} onChange={e => setSearch(e.target.value)}/></label>
   <button type="button" onClick={() => setKeys(members!.map(m => m.key))}>Select all</button><button type="button" onClick={() => setKeys([])}>Clear</button>
   </div><div className="pivot-filter-checks">{members?.filter(m => m.label.toLowerCase().includes(search.toLowerCase())).map(m => <label key={m.key}><input type="checkbox" checked={selected.includes(m.key)} onChange={e => setKeys(e.target.checked ? [...selected, m.key] : selected.filter(k => k !== m.key))}/>{m.label || '(Blank)'} ({m.count})</label>)}
   </div>{selected.filter(k => !members?.some(m => m.key === k)).length ? <p role="alert">Some selected members are unavailable. Their selection is retained.</p> : null}

  </fieldset>
 <DrawerFooterActions>{actions}</DrawerFooterActions>{saveError?<p role="alert">{saveError}</p>:null}</section>;
}
