// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DrawerFooterActions } from '../pivot-drawer/DrawerFooterTarget';
import { tokenFor, memberToken } from '../../../lib/tableModel/formulaTokens';
import { parseFormula, type SyntaxAst, type FormulaDiagnostic } from '../../../lib/tableModel/formulaSyntax';
import { bindFormula } from '../../../lib/tableModel/formulaBinding';
import { compileAnalyticalModel } from '../../../lib/tableModel/calculate';
import type { TableModelV1, FormulaDef } from '../../../lib/tableModel/types';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import type { InspectionRequest, InspectionResult, MemberDomainResult, ScopedFormulaBinding } from '../../../lib/tableExecution/types';
import { rememberFormulaBindings } from '../../../lib/tableModel/formulaProvenance';
import type {FormulaAuthoring} from '../../../hooks/useFormulaAuthoring';
const draftOf=(formula:FormulaDef):Omit<FormulaDef,'ast'>=>({id:formula.id,name:formula.name,scope:formula.scope,expression:formula.expression,...(formula.format===undefined?{}:{format:formula.format})});
/** Probe the insertion point using the same grammar that binds saved expressions. */
function insertionScope(text: string, start: number, end: number, scope: FormulaDef['scope']): FormulaDef['scope'] {
    if (text.length > 16384) return scope;
    let marker = '__inserted_formula_reference__';
    while (text.includes(marker)) marker += '_';
    const parsed = parseFormula(text.slice(0, start) + marker + text.slice(end)).ast;
    const visit = (ast: SyntaxAst, context: FormulaDef['scope']): FormulaDef['scope'] | undefined => {
        if (ast.kind === 'name') return ast.name === marker ? context : undefined;
        if (ast.kind === 'call') return ast.args.map(arg => visit(arg, ast.function === 'IF' ? context : 'source')).find(Boolean);
        if (ast.kind === 'binary') return visit(ast.left, context) ?? visit(ast.right, context);
        if (ast.kind === 'unary') return visit(ast.operand, context);
        if (ast.kind === 'member') return visit(ast.value, context);
    };
    return parsed ? visit(parsed, scope) ?? scope : scope;
}
export function FormulaPanel({ model, columns, readonly, selectedId, pending, inspection, onRequestInspection, authoring }: {
    authoring?: FormulaAuthoring;
    model: TableModelV1;
    columns: readonly DatasetColumn[];
    readonly: boolean;
    selectedId?: string;
    pending?: boolean;
    inspection?: InspectionResult;
    onRequestInspection?: (request: InspectionRequest) => void;
}) {
    const [id, setId] = useState(selectedId ?? model.formulas[0]?.id ?? crypto.randomUUID());
    useEffect(() => { if (model.formulas.some(f => f.id === id))
        onRequestInspection?.({ collection: 'definitions', definitionId: id, offset: 0, limit: 1 }); }, [id, model.formulas, onRequestInspection]);
    const details = inspection?.definitionId === id && inspection.rows[0]?.kind === 'formula' ? inspection.rows[0] : undefined;
    const original = model.formulas.find(f => f.id === id);
    const loadedTarget=useRef(original?structuredClone(original):undefined),loadedDraftId=useRef(id);
    const [draft, setDraft] = useState<Omit<FormulaDef, 'ast'>>(original ? draftOf(original) : { id, name: 'New formula', scope: 'aggregate', expression: '' });
    const [bindings, setBindings] = useState(() => rememberFormulaBindings(original));
    const [busy,setBusy]=useState(false);
    const [memberPage,setMemberPage]=useState<MemberDomainResult>();
    const [memberPending,setMemberPending]=useState(false);
    const [memberError,setMemberError]=useState<string>();
    const [pageOffsets,setPageOffsets]=useState([0]);
    const offset=pageOffsets[pageOffsets.length-1];
    const generation=useRef({value:0}), bindingRequest=useRef<AbortController|undefined>(undefined);
    const memberRequest=useRef<AbortController|undefined>(undefined);
    const invalidate=()=>{generation.current.value++;bindingRequest.current?.abort();setBusy(false);setErrors([]);};
    const context=useRef(authoring?.contextKey);
    context.current=authoring?.contextKey;
    useEffect(()=>{invalidate();setPageOffsets([0]);const version=generation.current;return()=>{version.value++;bindingRequest.current?.abort();};},[authoring?.contextKey,readonly]);
    const [errors, setErrors] = useState<string[]>([]);
    const [diagnostics, setDiagnostics] = useState<FormulaDiagnostic[]>([]);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const expression = useRef<HTMLTextAreaElement>(null);
    const caret = useRef<number | undefined>(undefined);
    useLayoutEffect(() => { if (caret.current !== undefined) {
        expression.current?.setSelectionRange(caret.current, caret.current);
        caret.current = undefined;
    } }, [draft.expression]);
    useEffect(()=>{memberRequest.current?.abort();setMemberPage(undefined);setMemberError(undefined);if(!category||!authoring){setMemberPending(false);return;}const controller=new AbortController();memberRequest.current=controller;setMemberPending(true);void authoring.members(category,offset,search,controller.signal).then(page=>{if(!controller.signal.aborted)setMemberPage(page);}).catch(error=>{if(!controller.signal.aborted)setMemberError(error instanceof Error?error.message:'Could not load observed members.');}).finally(()=>{if(!controller.signal.aborted)setMemberPending(false);});return()=>controller.abort();},[category,offset,search,authoring]);
    const changeDraft=(next:Omit<FormulaDef,'ast'>)=>{invalidate();setDraft(next);};
    const compiled = useMemo(() => compileAnalyticalModel(model, { columns }), [model, columns]);
    const candidates = [...compiled.symbols.fields, ...compiled.symbols.measures, ...compiled.symbols.formulas].map(symbol => {
        try { return { label: symbol.name, token: tokenFor(symbol, compiled.symbols) }; }
        catch (error) { return { label: symbol.name, error: (error as Error).message }; }
    });
    const references = candidates.filter((candidate, index) => candidates.findIndex(other => candidate.token ? other.token === candidate.token : other.label === candidate.label) === index);
    const insertReference = (text: string) => {
        const start = expression.current?.selectionStart ?? draft.expression.length;
        const end = expression.current?.selectionEnd ?? start;
        const scope = insertionScope(draft.expression, start, end, draft.scope);
        const parsed = parseFormula(text);
        const bound = parsed.ast && bindFormula(parsed.ast, compiled.symbols, scope);
        if (bound?.ast) {
            const inserted = rememberFormulaBindings({id: draft.id, name: draft.name, expression: text, scope, ast: bound.ast});
            setBindings(new Map([...bindings, ...inserted]));
        }
        insert(text);
    };
    const insert = (text: string, position?: number) => { const node = expression.current; const start = node?.selectionStart ?? draft.expression.length; const end = node?.selectionEnd ?? start; caret.current = start + (position ?? text.length); changeDraft({ ...draft, expression: draft.expression.slice(0, start) + text + draft.expression.slice(end) }); node?.focus(); };
    const load = (nextId: string) => { invalidate();const formula = model.formulas.find(f => f.id === nextId); loadedTarget.current=formula?structuredClone(formula):undefined; const fresh = nextId || crypto.randomUUID(); loadedDraftId.current=fresh; setId(fresh); setDraft(formula ? draftOf(formula) : { id: fresh, name: 'New formula', scope: 'aggregate', expression: '' }); setBindings(rememberFormulaBindings(formula));setDiagnostics([]); };
    const save = async () => { if (readonly || pending || busy || !authoring) return;
        if(JSON.stringify(original)!==JSON.stringify(loadedTarget.current)){setErrors(['This formula changed while your draft was open. Reload the formula to review its latest definition.']);return;}
        const expected=loadedTarget.current;
        const controller=new AbortController();bindingRequest.current?.abort();bindingRequest.current=controller;const version=generation.current.value,key=authoring.contextKey;setBusy(true);setErrors([]);
        const live=()=>!controller.signal.aborted&&generation.current.value===version&&context.current===key;
        try { const chosen:ScopedFormulaBinding[]=[...bindings].map(([key,reference])=>{const split=key.indexOf('\0');return {scope:(split<0?draft.scope:key.slice(0,split)) as FormulaDef['scope'],name:split<0?key:key.slice(split+1),reference};});
            const bound=await authoring.bind(draft,chosen,controller.signal);if(!live())return;
            setDiagnostics(bound.bindingDiagnostics);if(!bound.ast||bound.truncated||bound.bindingDiagnostics.length){setErrors([...bound.bindingDiagnostics.map(d=>d.message),...(bound.truncated?['Binding diagnostics are incomplete. Refine the draft before saving.']:[])]);return;}
            const published={...draft,ast:bound.ast};
            if(await authoring.commit(published,expected,key)){if(loadedTarget.current===expected&&loadedDraftId.current===published.id)loadedTarget.current=published;}else if(live())setErrors(['Could not save formula. Your draft has been retained.']);
        } catch(error){if(live())setErrors([error instanceof Error?error.message:'Could not bind formula.']);}finally{if(live())setBusy(false);}
    };
    const remove = async () => { if(readonly||pending||busy||!original||!authoring)return;
        if(JSON.stringify(original)!==JSON.stringify(loadedTarget.current)){setErrors(['This formula changed while your draft was open. Reload the formula to review its latest definition.']);return;}
        const expected=loadedTarget.current;
        const version=generation.current.value,key=authoring.contextKey;setBusy(true);const live=()=>generation.current.value===version&&context.current===key;
        try {if(await authoring.commit(undefined,expected,key)){if(live())load('');}else if(live())setErrors(['Could not delete formula. Your draft has been retained.']);}
        catch(error){if(live())setErrors([error instanceof Error?error.message:'Could not delete formula.']);}finally{if(live())setBusy(false);}
    };
    const actions = <><button type="button" className="pivot-formula-save" disabled={readonly || pending || busy || !authoring} onClick={() => void save()}>Save formula</button>
        {original ? <button type="button" disabled={readonly || pending || busy || !authoring} onClick={() => void remove()}>Delete formula</button> : null}
        <span className="pivot-drawer-foot-note">Limits: 16 KiB, 1,024 nodes, depth 64. Last valid formula is kept on error.</span></>;
    return <section aria-label="Formulas" className="pivot-formula-panel"><div className="pivot-formula-layout">
    <fieldset className="pivot-formula-list"><legend>Formulas</legend><ul>{model.formulas.map(f => <li key={f.id} data-selected={f.id === id ? '' : undefined}><button type="button" aria-pressed={f.id === id} title={f.name} onClick={() => load(f.id)}>{f.name}</button><span>{f.scope === 'source' ? 'Source row' : 'Aggregate'}</span></li>)}</ul>
    <button type="button" className="pivot-formula-new" disabled={readonly || pending} onClick={() => load('')}>New formula</button>
    {original && details ? <><p className="pivot-formula-note">Saved dependencies: {details.referenceIds.map(id => compiled.symbols.measures.find(m => m.id === id)?.name ?? compiled.symbols.formulas.find(f => f.id === id)?.name ?? compiled.symbols.fields.find(f => f.id === id)?.name ?? compiled.symbols.categories.find(c => c.id === id)?.name ?? 'Unavailable definition').join(', ') || 'None'}{details.truncatedReferences ? ' (More references in Inspect model)' : ''}</p><p className="pivot-formula-note">Resolved aggregation: {details.resolvedOperators.join(', ') || 'None'}</p></> : null}
    </fieldset><div><fieldset disabled={readonly || pending}><legend>Formula definition</legend><div className="pivot-formula-grid"><label>Formula name<input value={draft.name} onChange={e => changeDraft({ ...draft, name: e.target.value })}/></label>
 <label>Scope<select value={draft.scope} onChange={e => changeDraft({ ...draft, scope: e.target.value as FormulaDef['scope'] })}><option value="source">Source row</option><option value="aggregate">Aggregate</option></select></label>
 <label>Format<input value={draft.format ?? ''} placeholder="e.g. 0.0%" onChange={e => changeDraft({ ...draft, format: e.target.value || undefined })}/></label></div>
 <p className="pivot-formula-note">Examples: <code>Revenue - Cost</code> (source row) · <code>SUM(Profit) / SUM(Revenue)</code> (group/total) · <code>Revenue[Scenario=Actual] - Revenue[Scenario=Budget]</code>. Use [brackets] for names with spaces.</p>
 <label>Expression<textarea spellCheck={false} ref={expression} value={draft.expression} onChange={e => { changeDraft({ ...draft, expression: e.target.value }); }}/></label>
 <div className="pivot-formula-grid">
 <label>Find references<input value={search} onChange={e => {setSearch(e.target.value);setPageOffsets([0]);}}/></label>
 <label>Comparison category<select value={category} onChange={e => { invalidate();setCategory(e.target.value);setPageOffsets([0]); }}><option value="">Choose category</option>{model.categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.transform})</option>)}</select></label>
</div>
 <div aria-label="Formula autocomplete" className="pivot-formula-chips">{references.filter(r => r.label.toLowerCase().includes(search.toLowerCase()) || r.token?.toLowerCase().includes(search.toLowerCase())).map((r, i) => <button type="button" className="pivot-formula-chip" aria-label={`Insert ${r.token ?? r.label}`} title={r.token ?? r.label} key={i} onClick={() => {
        if (!r.token) { setErrors([r.error!]); return; }
        insertReference(r.token);
    }}>{r.token ?? r.label}</button>)}
 {['SUM', 'MEAN', 'MEDIAN', 'MIN', 'MAX', 'FIRST', 'LAST', 'COUNT', 'UNIQUECOUNT', 'IF'].filter(f => f.toLowerCase().includes(search.toLowerCase())).map(f => <button type="button" className="pivot-formula-chip pivot-formula-function" aria-label={`Insert ${f}`} key={f} onClick={() => insert(f === 'IF' ? 'IF(, , )' : `${f}()`, f.length + 1)}>{f}</button>)}</div>
 {category ? <section aria-label="Observed comparison members"><p className="pivot-formula-note">Members of {model.categories.find(c=>c.id===category)?.name} · acquired input</p><p className="pivot-formula-note">Observed identities bind independently of the current view. Eligibility counts reflect authored source filters and checklists; Page, group and viewer selections still govern execution.</p>
 {memberPending?<p role="status">Loading observed members…</p>:null}{memberError?<p role="alert">{memberError}</p>:null}
 {memberPage?<><p role="status">Showing {memberPage.total?memberPage.offset+1:0}–{memberPage.offset+memberPage.scanned} of {memberPage.total} observed members{search?' matching search':''}{memberPage.omittedCount?` · ${memberPage.omittedCount} identities omitted`:''}{!memberPage.classificationComplete?` · Partial classification (${memberPage.categoryErrorCount} errors)`:''}</p>
 <div className="pivot-formula-chips">{memberPage.rows.map(m=><button type="button" className="pivot-formula-chip" key={m.key} title={`${JSON.stringify(m.value)} · observed ${m.observedCount} · authored eligible ${m.eligibleCount}`} aria-label={`Insert ${m.label||'(Blank)'}`} onClick={()=>{const name=model.categories.find(c=>c.id===category)?.name;if(!name)return;if(model.categories.filter(c=>c.name===name).length!==1){setErrors(['Ambiguous category name.']);return;}try{insert(memberToken({name},{value:m.value}));}catch(error){setErrors([(error as Error).message]);}}}>{m.label||'(Blank)'}{m.labelTruncated?'…':''}{!m.eligibleCount?' · authored excluded':''}</button>)}</div>
 <div className="pivot-formula-member-pager"><button type="button" disabled={memberPending||!offset} onClick={()=>setPageOffsets(pageOffsets.slice(0,-1))}>Previous members</button><button type="button" disabled={memberPending||memberPage.nextOffset===undefined} onClick={()=>setPageOffsets([...pageOffsets,memberPage.nextOffset!])}>Next members</button></div>
 {memberPage.authoringWarnings.map((w,i)=><p className="pivot-formula-note" key={i}>{w.message}</p>)}{memberPage.authoringWarningsTruncated?<p>More source warnings are available in Inspect model.</p>:null}</>:null}</section>:null}
 {busy?<p role="status">Binding or saving formula…</p>:null}{!authoring?<p role="status">Worker formula authoring is unavailable for this source.</p>:null}
 </fieldset>{errors.length ? <div role="alert">{errors.map((error, i) => <p key={i} data-diagnostic-code={diagnostics.find(diagnostic => diagnostic.message === error)?.code}>{error}</p>)}</div> : null}
 </div></div><DrawerFooterActions inline="pivot-formula-actions">{actions}</DrawerFooterActions>
 </section>;
}
