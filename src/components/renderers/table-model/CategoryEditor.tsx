// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { DrawerFooterActions } from '../pivot-drawer/DrawerFooterTarget';
import type { CategoryDef, FiscalBinding, TableModelV1 } from '../../../lib/tableModel/types';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import { checkAuthoringModel } from './authoringValidation';
export function CategoryEditor({ model, columns, readonly, pending, onCommitModel }: {
    model: TableModelV1;
    columns: readonly DatasetColumn[];
    readonly: boolean;
    pending?: boolean;
    onCommitModel: (next: TableModelV1) => Promise<boolean>;
}) {
    const fresh = (): CategoryDef => ({ id: crypto.randomUUID(), name: 'New category', sourceFieldId: columns[0]?.id ?? '', transform: 'native' });
    const [draft, setDraft] = useState<CategoryDef>(model.categories[0] ?? fresh);
    const [position, setPosition] = useState<'rows' | 'columns' | 'none'>(model.layout.columns.includes(draft.id) ? 'columns' : model.layout.rows.includes(draft.id) ? 'rows' : 'none');
    const [errors, setErrors] = useState<string[]>([]);
    const fields = [...columns.map(c => ({ id: c.id, label: c.label })), ...model.formulas.filter(f => f.scope === 'source').map(f => ({ id: f.id, label: f.name }))];
    const fiscal = draft.transform === 'FY' || draft.transform === 'FQ';
    const updateBinding = (key: keyof FiscalBinding, value: string) => {
        const binding = { companyFieldId: '', ...draft.fiscalBinding, [key]: value || undefined };
        setDraft({ ...draft, fiscalBinding: binding });
    };
    const save = async () => {
        if (readonly || pending)
            return;
        if (fiscal && (!draft.fiscalBinding?.companyFieldId || (!draft.fiscalBinding.metadataKey && !draft.fiscalBinding.fiscalYearFieldId))) {
            setErrors(['Choose a company field and explicit fiscal metadata or period field mappings.']);
            return;
        }
        const layout = { ...model.layout, rows: model.layout.rows.filter(id => id !== draft.id), columns: model.layout.columns.filter(id => id !== draft.id) };
        if (position !== 'none') {
            layout[position] = model.layout[position].includes(draft.id) ? [...model.layout[position]] : [...layout[position], draft.id];
            if (layout.page?.categoryId === draft.id)
                delete layout.page;
        }
        const index = model.categories.findIndex(c => c.id === draft.id);
        const categories = index < 0 ? [...model.categories, draft] : model.categories.map(c => c.id === draft.id ? draft : c);
        const next = { ...model, categories, layout };
        const checked = checkAuthoringModel(next, columns);
        setErrors(checked.errors);
        if (checked.model && !await onCommitModel(checked.model))
            setErrors(['Could not save category. Your draft has been retained.']);
    };
    const move = (axis: 'rows' | 'columns', id: string, delta: number) => {
        if (readonly || pending) return;
        const list = [...model.layout[axis]];
        const index = list.indexOf(id);
        const target = index + delta;
        if (target < 0 || target >= list.length)
            return;
        [list[index], list[target]] = [list[target], list[index]];
        const checked = checkAuthoringModel({ ...model, layout: { ...model.layout, [axis]: list } }, columns);
        setErrors(checked.errors);
        if (checked.model) void onCommitModel(checked.model).then(saved => { if (!saved) setErrors(['Could not reorder categories. Your draft has been retained.']); });
    };
    const load = (id: string) => { const c = model.categories.find(c => c.id === id) ?? fresh(); setDraft(c); setPosition(model.layout.columns.includes(c.id) ? 'columns' : model.layout.rows.includes(c.id) ? 'rows' : 'none'); setErrors([]); };
    const original = model.categories.find(c => c.id === draft.id);
    const remove = async () => {
        if (readonly || pending || !original) return;
        const checked = checkAuthoringModel({ ...model, categories: model.categories.filter(c => c.id !== draft.id), layout: { ...model.layout, rows: model.layout.rows.filter(id => id !== draft.id), columns: model.layout.columns.filter(id => id !== draft.id) } }, columns);
        setErrors(checked.errors);
        if (checked.model) {
            if (await onCommitModel(checked.model)) load('');
            else setErrors(['Could not delete category. Your draft has been retained.']);
        }
    };
    const actions = <><button type="button" className="pivot-category-save" disabled={readonly || pending} onClick={() => void save()}>Save category</button>{original ? <button type="button" disabled={readonly || pending} onClick={() => void remove()}>Delete category</button> : null}<span className="pivot-drawer-foot-note">Saving keeps your draft if validation fails.</span></>;
    return <section aria-label="Categories" className="pivot-category-panel"><div className="pivot-category-layout"><fieldset className="pivot-category-list"><legend>Categories</legend><ul>{model.categories.map(c => <li key={c.id} data-selected={c.id === draft.id ? '' : undefined}><button type="button" aria-pressed={c.id === draft.id} title={c.name} onClick={() => load(c.id)}>{c.name}</button><span>{c.transform === 'native' ? '' : c.transform}</span></li>)}</ul><button type="button" className="pivot-category-new" disabled={readonly || pending} onClick={() => load('')}>New category</button> {(['rows', 'columns'] as const).map(axis => <div key={axis}><strong className="pivot-category-order-title">{axis === 'rows' ? 'Rows' : 'Columns'}</strong><ol>{model.layout[axis].map((id, i) => <li key={id}><span className="pivot-category-grow" title={model.categories.find(c => c.id === id)?.name ?? id}>{model.categories.find(c => c.id === id)?.name ?? id}</span><button type="button" aria-label={`Move ${axis} category ${i + 1} earlier`} disabled={readonly || pending || i === 0} onClick={() => move(axis, id, -1)}>↑</button><button type="button" aria-label={`Move ${axis} category ${i + 1} later`} disabled={readonly || pending || i === model.layout[axis].length - 1} onClick={() => move(axis, id, 1)}>↓</button></li>)}{model.layout[axis].length === 0 ? <li className="pivot-category-note">None</li> : null}</ol></div>)}</fieldset><div>
 <fieldset disabled={readonly || pending}><legend>Category definition</legend><div className="pivot-category-grid"><label>Category name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
 <label>Source field<select value={draft.sourceFieldId} onChange={e => setDraft({ ...draft, sourceFieldId: e.target.value })}>{fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
 <label>Transformation<select value={draft.legacyBucket ?? draft.transform} onChange={e => { const next = { ...draft, transform: e.target.value as CategoryDef['transform'] }; delete next.legacyBucket; if (!['FY', 'FQ'].includes(next.transform))
        delete next.fiscalBinding; setDraft(next); }}>{draft.legacyBucket ? <option value={draft.legacyBucket}>{draft.legacyBucket} (existing recipe)</option> : null}{['native', 'Y', 'Q', 'M', 'FY', 'FQ'].map(t => <option value={t} key={t}>{t === 'native' ? 'Native' : t}</option>)}</select></label> <label>Position<select value={position} onChange={e => setPosition(e.target.value as typeof position)}><option value="none">Available category</option><option value="rows">Rows</option><option value="columns">Columns</option></select></label></div>
 {fiscal ? <><p className="pivot-category-note">Use the report period date and company-specific fiscal interpretation.</p><div className="pivot-category-grid">{(['companyFieldId', 'fiscalYearFieldId', 'fiscalQuarterFieldId', 'periodStartFieldId', 'periodEndFieldId'] as const).map((key, i) => <label key={key}>{['Company field', 'Fiscal year field', 'Fiscal quarter field', 'Period start field', 'Period end field'][i]}<select value={draft.fiscalBinding?.[key] ?? ''} onChange={e => updateBinding(key, e.target.value)}><option value="">Choose field</option>{fields.map(f => <option value={f.id} key={f.id}>{f.label}</option>)}</select></label>)}
 <label>Fiscal metadata binding<input value={draft.fiscalBinding?.metadataKey ?? ''} onChange={e => updateBinding('metadataKey', e.target.value)}/></label>
 <label>Bound period kind<select value={draft.fiscalBinding?.periodKind ?? ''} onChange={e => updateBinding('periodKind', e.target.value)}><option value="">Choose period kind</option><option>FY</option><option>FQ</option></select></label></div></> : null}

 </fieldset>

 {errors.length ? <div role="alert">{errors.map((e, i) => <p key={i}>{e}</p>)}</div> : null}</div></div><DrawerFooterActions inline="pivot-category-actions">{actions}</DrawerFooterActions></section>;
}
