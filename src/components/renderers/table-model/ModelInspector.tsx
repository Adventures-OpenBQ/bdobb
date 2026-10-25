// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { InspectionCounts, InspectionRequest, InspectionResult } from '../../../lib/tableExecution/types';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import type { FormulaAst, TableModelV1 } from '../../../lib/tableModel/types';
import { statementSnapshot } from '../../../lib/statementModel/persistence';
import { compileStatement } from '../../../lib/statementModel/compile';
import type { StatementIntent } from '../../../lib/statementModel/types';
import { checkAuthoringModel } from './authoringValidation';
function checkCanonicalAuthoring(raw:unknown,columns:readonly DatasetColumn[]) {
 if(raw&&typeof raw==='object'&&'kind' in raw&&raw.kind==='statement') {
  try {const model=statementSnapshot(raw);const compiled=compileStatement(model,columns);return {model,compiled,errors:[] as string[]};}
  catch(error) {return {model:undefined,compiled:undefined,errors:[error instanceof Error?error.message:'Invalid Statement schema.']};}
 }
 return checkAuthoringModel(raw,columns);
}
export function ModelInspector({ raw, columns, readonly, pending, error, page, counts, onRequestInspection, onCommitModel, onShowFormula, linkedGroups }: {
    linkedGroups?:ReactNode;
    raw?: unknown;
    columns: readonly DatasetColumn[];
    readonly: boolean;
    pending: boolean;
    error?: string;
    page?: InspectionResult;
    counts?: InspectionCounts;
    onRequestInspection: (request: InspectionRequest) => void;
    onCommitModel: (next: TableModelV1 | StatementIntent) => Promise<boolean>;
    onShowFormula: (id: string) => void;
}) {
    const checked = useMemo(() => raw === undefined ? undefined : checkCanonicalAuthoring(raw, columns), [raw, columns]);
    const savedText = useMemo(() => { try { return raw === undefined ? '' : JSON.stringify(raw, null, 2); } catch { return ''; } }, [raw]);
    const draftGeneration=useRef(0),sourceText=useRef(savedText);if(sourceText.current!==savedText){sourceText.current=savedText;draftGeneration.current++;}
    const [draft, setDraft] = useState({ source: savedText, text: savedText });
    // Closing inspection retains edits, but a different committed definition owns a new draft.
    const repair = draft.source === savedText ? draft.text : savedText;
    const setRepair = (text: string) => {draftGeneration.current++;setErrors([]);setDraft({ source: savedText, text });};
    const [errors, setErrors] = useState<string[]>([]);
    const [showGroups,setShowGroups]=useState(false);
    const [activeCollection,setCollection]=useState(page?.collection??'definitions');
    const currentPage=page?.collection===activeCollection&&!pending?page:undefined;
    const [detail, setDetail] = useState<string>();
    const fullReferences = (id: string) => {
        const formula = checked?.compiled?.model.formulas.find(f => f.id === id);
        const refs = new Set<string>();
        const walk = (ast: FormulaAst) => { switch (ast.kind) {
            case 'reference':
                refs.add(`${ast.target}: ${ast.id}`);
                break;
            case 'binary':
                walk(ast.left);
                walk(ast.right);
                break;
            case 'unary':
                walk(ast.operand);
                break;
            case 'call':
                ast.args.forEach(walk);
                break;
            case 'member':
                walk(ast.value);
                ast.selectors.forEach(s => refs.add(`category: ${s.categoryId}; member: ${s.memberKey}`));
                break;
        } };
        if (formula)
            walk(formula.ast);
        return [...refs];
    };
    const save = async () => { if (readonly || pending)
        return; const generation=draftGeneration.current;try {
        const next = checkCanonicalAuthoring(JSON.parse(repair), columns);
        setErrors(next.errors);
        if (next.model && !await onCommitModel(next.model)&&draftGeneration.current===generation)
            setErrors(['Could not save repaired model. Your draft has been retained.']);
    }
    catch {
        if(draftGeneration.current===generation)setErrors(['Enter a valid JSON model. The original definition is retained.']);
    } };
    return <div className="table-model-inspection pivot-inspector-panel"><div className="pivot-panel-row" role="group" aria-label="Inspection collections">
 {(['definitions', 'warnings', 'periodBounds'] as const).map(collection => <button type="button" key={collection} aria-pressed={!showGroups&&activeCollection===collection} onClick={() => {setCollection(collection);setShowGroups(false);onRequestInspection({ collection, offset: 0, limit: 20 });}}>{collection === 'periodBounds' ? 'Company period bounds' : collection === 'definitions' ? 'Definitions' : 'Warnings'} ({counts?.[collection] ?? 0})</button>)}
 {linkedGroups?<button type="button" aria-pressed={showGroups} onClick={()=>setShowGroups(true)}>Linked groups</button>:null}
 </div>{showGroups?linkedGroups:null}
 {pending&&!showGroups ? <p role="status">Loading inspection…</p> : null}{error ? <p role="alert">{error}</p> : null}
 {checked?.errors.length ? <div role="alert">{checked.errors.map((e, i) => <p key={i}>{e}</p>)}</div> : null}
 {currentPage&&!showGroups ? <><p role="status">Showing {currentPage.rows.length ? currentPage.offset + 1 : 0}–{currentPage.offset + currentPage.rows.length} of {currentPage.total}</p>
 <ul className="pivot-panel-list">{currentPage.rows.map((row, i) => <li key={i}>{row.kind === 'warning' ? <>{row.message} ({row.periodCount} company periods)</> : row.kind==='groupMember'?<>{row.label}</>:row.kind === 'periodBounds' ? <>{row.companyKey}: {row.start}–{row.end}; {row.source}; {row.period}; {row.context}</> : <>{row.name} ({row.id}) · References: {row.referenceIds.join(', ') || 'None'}{row.truncatedReferences ? ` (${row.referenceIds.length} of ${row.referenceCount})` : ''} · Resolved operators: {row.resolvedOperators.join(', ') || 'None'}{row.kind === 'formula' ? <><button type="button" onClick={() => setDetail(row.id)}>All references for {row.name}</button><button type="button" onClick={() => onShowFormula(row.id)}>Show formula {row.name}</button></> : null}</>}</li>)}</ul>
 <button type="button" disabled={pending || currentPage.offset === 0} onClick={() => onRequestInspection({ collection: currentPage.collection, limit: currentPage.limit, offset: Math.max(0, currentPage.offset - currentPage.limit) })}>Previous inspection page</button>
 <button type="button" disabled={pending || currentPage.nextOffset === undefined} onClick={() => onRequestInspection({ collection: currentPage.collection, limit: currentPage.limit, offset: currentPage.nextOffset! })}>Next inspection page</button></> : null}
 {detail ? <section aria-label="All formula references"><p>{fullReferences(detail).join(', ') || 'None'}</p><button type="button" onClick={() => setDetail(undefined)}>Close references</button></section> : null}
 <details className="pivot-inspector-repair"><summary>Advanced repair</summary><p>Review the complete saved definition. Invalid changes keep the original model.</p><label>Model repair draft<textarea value={repair} readOnly={readonly} onChange={e => setRepair(e.target.value)}/></label><button type="button" disabled={readonly || pending} onClick={() => void save()}>Save repaired model</button>{errors.length ? <div role="alert">{errors.map((e, i) => <p key={i}>{e}</p>)}</div> : null}</details>
 </div>;
}
