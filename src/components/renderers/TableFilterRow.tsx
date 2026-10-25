// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from 'react';
import type { DatasetColumn } from '../../lib/widgetData/types';
import type { ResolveContext } from "../../lib/dateExpressions";
import { resolveDateBound } from "../../lib/dateFilters";
import { declaredKind, type FilterKind, type NumberFilter, type DateFilter } from "../../lib/tableFiltering";
export { filterFnFor, filterKindFor, type FilterKind, type NumberFilter, type DateFilter } from "../../lib/tableFiltering";
/**
 * `onChange(undefined)` is how a filter is removed: table-core's
 * shouldAutoRemoveFilter drops a filter whose value is `undefined` or `""`
 * regardless of the filter function, so the controls emit exactly that when
 * they are cleared. An empty `{}` would instead keep a filter alive that
 * matches everything.
 */
export function FilterControl({
  kind,
  header,
  value,
  bounds,
  dateContext,
  onChange,
}: {
  kind: FilterKind;
  /** The column's rendered header, used for the control's accessible name. */
  header: string;
  value: unknown;
  /** A date column's first and last day in the loaded rows: the From and To
   * boxes' starting text. */
  bounds?: DateBounds;
  /** How a date expression typed into a date box is resolved (calendar, clock). */
  dateContext?: ResolveContext;
  onChange: (next: unknown) => void;
}) {
  if (kind === "none") return null;

  if (kind === "text") {
    return (
      <input
        className="filter-input"
        type="text"
        aria-label={`Filter ${header}`}
        placeholder="contains"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <select
        className="filter-input"
        aria-label={`Filter ${header}`}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">any</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (kind === "number") {
    const range = (typeof value === "object" && value !== null ? value : {}) as NumberFilter;
    const emit = (next: NumberFilter) => {
      const merged = { ...range, ...next };
      const min = Number.isFinite(merged.min) ? merged.min : undefined;
      const max = Number.isFinite(merged.max) ? merged.max : undefined;
      onChange(min === undefined && max === undefined ? undefined : { min, max });
    };
    const asNumber = (raw: string) => (raw === "" ? undefined : Number(raw));
    return (
      <span className="filter-range">
        <input
          className="filter-input"
          type="number"
          aria-label={`Minimum ${header}`}
          placeholder="min"
          value={range.min ?? ""}
          onChange={(e) => emit({ min: asNumber(e.target.value) })}
        />
        <input
          className="filter-input"
          type="number"
          aria-label={`Maximum ${header}`}
          placeholder="max"
          value={range.max ?? ""}
          onChange={(e) => emit({ max: asNumber(e.target.value) })}
        />
      </span>
    );
  }

  const range = (typeof value === "object" && value !== null ? value : {}) as DateFilter;
  const emit = (next: DateFilter) => {
    const merged = { ...range, ...next };
    const from = merged.from || undefined;
    const to = merged.to || undefined;
    onChange(from === undefined && to === undefined ? undefined : { from, to });
  };
  return (
    <span className="filter-range">
      <DateBox
        label={`From ${header}`}
        applied={range.from}
        prefill={bounds?.first ?? ""}
        dateContext={dateContext}
        onBound={(from) => emit({ from })}
      />
      <DateBox
        label={`To ${header}`}
        applied={range.to}
        prefill={bounds?.last ?? ""}
        dateContext={dateContext}
        onBound={(to) => emit({ to })}
      />
    </span>
  );
}

/** Source predicates use current input IDs, independently of report measure instances. */
export function SourceFilterPanel({columns,formulas,filters,readonly,busy=false,onChange,onRequestFormula,formulaKind,pending,error,dateContext}:{dateContext?:ResolveContext;columns:readonly DatasetColumn[];formulas:{id:string;name:string}[];filters:{id:string;value:unknown}[];readonly:boolean;busy?:boolean;onChange:(id:string,value:unknown)=>void;onRequestFormula?:(id:string)=>void;formulaKind?:FilterKind;pending?:boolean;error?:string}) {
 // D-020: typed values live in a local draft, so a save in flight can neither
 // reset the field nor drop keys. A draft is saved after a 250 ms pause, one at
 // a time and only while nothing is pending (busy), and dropped once saved.
 const [draft,setDraft]=useState(()=>new Map<string,unknown>());
 const saved=(id:string)=>filters.find(f=>f.id===id)?.value;
 const valueOf=(id:string)=>draft.has(id)?draft.get(id):saved(id);
 const edit=(id:string,value:unknown)=>setDraft(current=>new Map(current).set(id,value));
 const commit=useRef(onChange);commit.current=onChange;
 useEffect(()=>{
  const same=(a:unknown,b:unknown)=>JSON.stringify(a??'')===JSON.stringify(b??'');
  const unsaved=[...draft].filter(([id,value])=>!same(value,filters.find(f=>f.id===id)?.value));
  if(unsaved.length!==draft.size){setDraft(new Map(unsaved));return;}
  if(busy||!unsaved.length)return;
  const timer=setTimeout(()=>commit.current(...unsaved[0]),250);
  return ()=>clearTimeout(timer);
 },[draft,filters,busy]);
 const [selected,setSelected]=useState(formulas.find(f=>filters.some(filter=>filter.id===f.id))?.id??'');
 useEffect(()=>{if(selected)onRequestFormula?.(selected);},[selected,onRequestFormula]);
 const [inputKinds,setInputKinds]=useState(()=>new Map<string,FilterKind>());
 const [explicitKind,setExplicitKind]=useState<FilterKind>('none');
 const kindOf=(column:DatasetColumn):FilterKind=>declaredKind(column.dtype);
 const formula=formulas.find(f=>f.id===selected);
 const kind=formulaKind&&formulaKind!=='none'?formulaKind:explicitKind;
 return <section className="table-source-filters" aria-label="Input filters"><fieldset disabled={readonly}><legend>Input filters</legend>
 {columns.map(column=><div key={column.id}><span>{column.label}</span>{kindOf(column)==='none'?<label>Filter type for {column.label}<select value={inputKinds.get(column.id)??'none'} onChange={e=>setInputKinds(new Map(inputKinds).set(column.id,e.target.value as FilterKind))}><option value="none">Choose type</option>{['number','text','date','boolean'].map(k=><option key={k}>{k}</option>)}</select></label>:null}<FilterControl kind={kindOf(column)==='none'?inputKinds.get(column.id)??'none':kindOf(column)} header={column.label} value={valueOf(column.id)} dateContext={dateContext} onChange={value=>edit(column.id,value)}/></div>)}
 {formulas.length?<label>Source formula filter<select value={selected} onChange={e=>{setSelected(e.target.value);setExplicitKind('none');}}><option value="">Choose source formula</option>{formulas.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>:null}
 {formula?<fieldset disabled={pending}><legend>{formula.name}</legend>{pending?<p role="status">Loading formula filter…</p>:null}{(!formulaKind||formulaKind==='none')&&!pending?<><p role="status">A filter type is unavailable for this formula. Choose the intended value type; calculation errors remain visible.</p><label>Formula filter type<select value={explicitKind} onChange={e=>setExplicitKind(e.target.value as FilterKind)}><option value="none">Choose type</option>{['number','text','date','boolean'].map(k=><option key={k}>{k}</option>)}</select></label></>:null}<FilterControl kind={kind} header={formula.name} value={valueOf(selected)} dateContext={dateContext} onChange={value=>edit(selected,value)}/></fieldset>:null}
 {error?<p role="alert">{error}</p>:null}</fieldset></section>;
}

export type DateBounds = { first: string; last: string };

/** `value` is what is stored: the day itself, or an expression's own text,
 * with `day` the day that text names under the clock it was read with. */
export type DateBound = { ok: true; value: string | undefined; day?: string } | { ok: false };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date box's text as a bound: blank is no bound, YYYY-MM-DD (on the
 * calendar) is that day, anything else is refused. The one place a typed
 * date is read. v4 adds its date expressions (T-1bd, T-26w, FQ-4 ...), the
 * same grammar a date param takes. An expression is kept as its TEXT, so the
 * table resolves it again on every refresh (dateFilters.ts); a range (`/`,
 * `..`) is not one bound and is refused.
 */
export function parseDateBound(text: string, ctx: ResolveContext = {}): DateBound {
  const t = text.trim();
  if (t === "") return { ok: true, value: undefined };
  if (ISO_DAY.test(t)) {
    const [y, m, d] = t.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d));
    return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d
      ? { ok: true, value: t }
      : { ok: false };
  }
  const day = resolveDateBound(t, ctx);
  return day ? { ok: true, value: t, day } : { ok: false };
}

/**
 * One end of a date range, as a text box. Not <input type=date>: WKWebView
 * draws an untyped segment as today's date in grey, so a half-typed date
 * looked real and filtered nothing (V3-005), and v4's date modifiers must be
 * typeable here. The box starts at the applied bound, else the column's own
 * first/last day -- which is no bound at all. Typing changes only the text;
 * Enter or leaving the box applies it.
 */
/** "T-1bd is 2026-01-06 today" for a box holding an expression; nothing for a
 * plain day, which needs no gloss. */
function todayOf(text: string, ctx: ResolveContext | undefined): string | undefined {
  const parsed = parseDateBound(text, ctx);
  return parsed.ok && parsed.day ? `${text.trim()} is ${parsed.day} today` : undefined;
}

function DateBox({
  label,
  applied,
  prefill,
  dateContext,
  onBound,
}: {
  label: string;
  applied: string | undefined;
  prefill: string;
  dateContext?: ResolveContext;
  onBound: (next: string | undefined) => void;
}) {
  const shown = applied ?? prefill;
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  // Follows a change from outside (Clear, a fresh payload) during render, so
  // the box never shows a stale bound for a frame.
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    setText(shown);
    setInvalid(false);
  }
  const apply = () => {
    const parsed = parseDateBound(text, dateContext);
    setInvalid(!parsed.ok);
    if (!parsed.ok) return;
    const value = parsed.value === prefill ? undefined : parsed.value;
    if (value !== applied) onBound(value);
  };
  return (
    <input
      className="filter-input filter-date"
      type="text"
      inputMode="numeric"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? "Use YYYY-MM-DD or a date expression such as T-1bd" : todayOf(text, dateContext)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") apply();
      }}
    />
  );
}
