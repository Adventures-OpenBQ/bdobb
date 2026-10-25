// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {DrawerFooterActions} from './pivot-drawer/DrawerFooterTarget';

import { useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { TableModelV1 } from '../../lib/tableModel/types';
import type { InspectionResult,InspectionRequest } from '../../lib/tableExecution/types';
import type { DatasetColumn } from '../../lib/widgetData/types';
import { measureEligibility } from './table-model/measureEligibility';
import { resolveMeasures } from '../../lib/tableModel/measureMigration';
import { AGGREGATION_NAMES, duplicateMeasure, measureLabel, updateMeasureAggregation } from '../../lib/tableModel/measures';
import { movedWithin } from "../../lib/dragDrop";
import {
  PERIODICITY_LABEL,
  coarserBuckets,
  detectPeriodicity,
  straddles,
  type CoarseBucket,
  type Periodicity,
} from "../../lib/periodicity";
import {
  activeLists,
  aggregationOf,
  bucketOf,
  clearedPivot,
  dataFieldsOf,
  legalAggregations,
  moveField,
  setAggregation,
  setBucket,
  type PivotList,
  type PivotPatch,
} from "../../lib/pivotConfig";
import { suggestionFor, suggestionNote } from "../../lib/pivotSuggestion";
import type { FieldKind } from "../../lib/pivotTable";
import type { Row, TableColumn } from "../../lib/tableColumns";
import type { AggName, Bucket, PivotConfig } from "../../lib/types";
import { RowContextMenu, type MenuItem } from "../RowContextMenu";

/**
 * The dataTransfer type a dragged pill carries. Its own type, so a pill cannot
 * land on a dashboard, a tab or a column header, and nothing dragged from
 * those can land in a list.
 */
export const PIVOT_DRAG_TYPE = "application/x-bdobb-pivot-field";

const LIST_TITLE: Record<PivotList, string> = {
  grouping: "Row Groups",
  split: "Column Groups",
  data: "Data Columns",
};
const LIST_HINT: Record<PivotList, string> = {
  grouping: "Top = outermost row group",
  split: "Top = outermost header",
  data: "Top = first displayed value",
};
const LISTS: PivotList[] = ["grouping", "split", "data"];

const AGG_LABEL: Record<AggName, string> = {
  sum: "Sum",
  min: "Min",
  max: "Max",
  mean: "Mean",
  median: "Median",
  count: "Count",
  uniqueCount: "Unique count",
  first: "First",
  last: "Last",
};

const BUCKET_LABEL: Record<CoarseBucket, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

/**
 * Why a weekly roll-up carries a ⚠. Only a month "holds 4 or 5 weeks"; for a
 * quarter and a year the plain fact is that a week does not end where they do.
 */
const straddleNote = (bucket: Bucket): string =>
  bucket === "month"
    ? "Weekly rows are assigned to the month containing their date; months hold 4 or 5 weeks."
    : `Weekly rows are assigned to the ${bucket} containing their date; weeks do not end where it does.`;

/** Where a drop at `clientY` lands among a list's pills, not counting the dragged one. */
function indexAt(container: HTMLElement, clientY: number, dragged: string | null): number {
  const pills = [...container.querySelectorAll<HTMLElement>("[data-pivot-field]")].filter(
    (p) => p.dataset.pivotField !== dragged,
  );
  for (let i = 0; i < pills.length; i += 1) {
    const rect = pills[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return pills.length;
}

export function PivotPanel({
  columns,
  order,
  hidden,
  kinds,
  rows,
  config,
  onChange,
  onClose,
  sourcePeriodicity,
  capabilities,
}: {
  capabilities?: import("../../lib/tableExecution/types").ProviderCapabilities;
  columns: TableColumn[];
  /** The card's column order — every field, grouped ones included. */
  order: string[];
  hidden: string[];
  kinds: ReadonlyMap<string, FieldKind>;
  /** The source rows, for reading each date column's periodicity. */
  rows: Row[];
  /** Worker inspection supplies complete-input hints without exposing input rows. */
  sourcePeriodicity?: ReadonlyMap<string, Periodicity>;
  /** The EFFECTIVE config: the card's, else the widget's preset, else empty. */
  config: PivotConfig;
  onChange: (patch: PivotPatch) => void;
  onClose?: () => void;
}) {
  const byField = useMemo(() => new Map(columns.map((c) => [c.field, c])), [columns]);
  const known = useMemo(() => new Set(byField.keys()), [byField]);
  const { grouping, split } = activeLists(config, known);
  const fields: Record<PivotList, string[]> = {
    grouping,
    split,
    data: config.measures?.map(m => m.id) ?? dataFieldsOf(order, { ...config, grouping, split }),
  };
  const measures = resolveMeasures(config, columns.map(c => ({ id: c.field, label: c.header })), order);
  const instance = (id: string) => config.measures?.find(m => m.id === id);
  const source = (id: string) => instance(id)?.sourceFieldId ?? id;
  const operator = (id: string) => config.measures !== undefined ? instance(id)?.aggregation : aggregationOf(config, id);
  const aggregate = (id: string, fn: AggName | null) => config.measures !== undefined
    ? { pivot: { ...config, measures: updateMeasureAggregation(measures, id, fn ?? undefined) } }
    : setAggregation(config, id, fn);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<{ field: string; list: PivotList } | null>(null);
  useLayoutEffect(() => {
    const focus = focusAfterMove.current;
    if (focus === null) return;
    const target = [...(panelRef.current?.querySelectorAll<HTMLElement>("[data-pivot-field]") ?? [])]
      .find((pill) => pill.dataset.pivotField === focus.field && pill.dataset.pivotList === focus.list);
    if (target) {
      target.focus();
      focusAfterMove.current = null;
    }
  }, [grouping, split, fields.data]);

  const periodicity = useMemo(
    () => sourcePeriodicity ??
      new Map<string, Periodicity>(
        columns
          .filter((c) => kinds.get(c.field) === "date")
          .map((c) => [
            c.field,
            detectPeriodicity(rows.map((r) => (Object.hasOwn(r, c.field) ? r[c.field] : undefined))),
          ]),
      ),
    [columns, kinds, rows, sourcePeriodicity],
  );
  const hasDate = periodicity.size > 0;
  // A field's aggregation and bucket are read through pivotConfig's
  // `aggregationOf` / `bucketOf` -- the engine's one reading rule, by computed
  // key only through Object.hasOwn -- never by a lookup of the panel's own.
  const straddling = (field: string) => {
    const native = periodicity.get(field);
    return native !== undefined && straddles(native, bucketOf(config, field));
  };
  const anyStraddle = [...grouping, ...split].some(straddling);
  /** The provider's suggestion for a data column under THIS arrangement, or why there is none. */
  const suggestion = (field: string) => suggestionFor({ field, columns, kinds, periodicity, config });
  // A hidden Data Columns field never renders under a split -- the engine
  // drops hidden columns entirely -- so it must not be counted as waiting.
  const waiting =
    split.length > 0
      ? fields.data.filter((f) => !hidden.includes(f) && operator(f) === undefined).length
      : 0;

  /**
   * The dragged field, held here as well as on the event: dataTransfer's DATA
   * is not readable during dragover, which is where the drop has to be allowed
   * -- the same reason the column headers keep a ref.
   */
  const dragged = useRef<string | null>(null);
  const draggedList = useRef<PivotList>("data");
  /**
   * Where a drop would land. It carries the dragged field too, so that render
   * reads STATE and never the ref above -- a ref read during render is both a
   * lint error and a value React may not have re-rendered for.
   */
  const [insert, setInsert] = useState<{ list: PivotList; index: number; field: string } | null>(null);
  const [menuAt, setMenuAt] = useState<{
    field: string;
    list: PivotList;
    x: number;
    y: number;
    trigger: HTMLElement;
  } | null>(null);

  const ours = (e: DragEvent) =>
    dragged.current !== null && Array.from(e.dataTransfer.types).includes(PIVOT_DRAG_TYPE);

  /** A drop that would leave the pill exactly where it is writes nothing. */
  function place(field: string, to: PivotList, index: number, from: PivotList) {
    if(capabilities && (to === "split" && !capabilities.features.includes("splits") || to === "grouping" && !capabilities.features.includes("grouping"))) return;
    // `index` counts positions with the pill taken out, and taking a pill out
    // moves nothing that sits before it -- so its own index means "here".
    // This is why the panel takes `movedWithin` from dragDrop.ts but not
    // `moveBefore`: that one moves a member to an index of the ORIGINAL order,
    // while every index here -- `indexAt`'s, the menu's up/down -- is already
    // measured with the pill taken out, which is what `moveField` expects.
    if (from === to && fields[to].indexOf(field) === index) return;
    focusAfterMove.current = { field, list: to };
    if (config.measures !== undefined) {
      const measure = from === "data" ? instance(field) : undefined;
      if (measure && to === 'data') {
        const rest = measures.filter(m => m.id !== field);
        rest.splice(Math.max(0, Math.min(index, rest.length)), 0, measure);
        onChange({ pivot: { ...config, measures: rest } });
      } else if (measure) {
        const next = moveField(config, order, measure.sourceFieldId, to, index);
        focusAfterMove.current = { field: measure.sourceFieldId, list: to };
        onChange({ ...next, pivot: { ...next.pivot, measures: measures.filter(m => m.id !== field) } });
      } else if (to === 'data') {
        const next = moveField(config, order, field, to, index);
        const rest = [...measures];
        const fn = aggregationOf(config, field);
        const id = crypto.randomUUID();
        focusAfterMove.current = { field: id, list: to };
        rest.splice(Math.max(0, Math.min(index, rest.length)), 0, { id, sourceFieldId: field, ...(fn === undefined ? {} : { aggregation: fn }) });
        onChange({ pivot: { ...next.pivot, measures: rest } });
      } else onChange(moveField(config, order, field, to, index));
    } else onChange(moveField(config, order, field, to, index));
  }

  function pillText(field: string, list: PivotList): string {
    const binding = list === "data" ? source(field) : field;
    const header = byField.get(binding)?.header ?? binding;
    const measure = list === "data" ? instance(field) : undefined;
    if (measure) return `${measureLabel(measure, header, measures)}${measure.aggregation === "sum" && anyStraddle ? " ⚠" : ""}`;
    if (list !== "data") {
      const native = periodicity.get(field);
      if (native === undefined) return header;
      const bucket = bucketOf(config, field);
      const label = bucket === "native" ? PERIODICITY_LABEL[native] : BUCKET_LABEL[bucket];
      return `${header} · ${label}${straddling(field) ? " ⚠" : ""}`;
    }
    const fn = operator(field);
    if (fn !== undefined) return `${header} · ${AGG_LABEL[fn]}${fn === "sum" && anyStraddle ? " ⚠" : ""}`;
    // A provider suggestion reads as a question -- "Cash · Last?" -- until it
    // is chosen: shown, never applied. It shows even with Row Groups only,
    // where the pill is otherwise quiet, because it costs the user nothing to
    // ignore and saves them a menu when they want it.
    const s = suggestion(field);
    if (s.kind === "suggested") return `${header} · ${AGG_LABEL[s.fn]}?`;
    // Quiet with Row Groups only -- the real rows are on screen. Under a split
    // an unaggregated column is a column of blanks, and says so.
    return split.length > 0 ? `${header} · Choose` : header;
  }

  function pillTitle(field: string, list: PivotList): string | undefined {
    if (list !== "data" && straddling(field)) return straddleNote(bucketOf(config, field));
    if (list === "data" && operator(field) === "sum" && anyStraddle) {
      return "A sum over weekly rows rolled up to a calendar period is approximate.";
    }
    if (list === "data" && operator(field) === undefined) {
      const s = suggestion(source(field));
      if (s.kind === "suggested") {
        return `The provider suggests ${AGG_LABEL[s.fn]} for this column (ruleset ${byField.get(source(field))?.hint?.ruleset ?? "?"}); pick it from the menu.`;
      }
      const note = suggestionNote(s, (f) => byField.get(f)?.header ?? f);
      if (note !== null) return note;
    }
    return hidden.includes(field) ? "Hidden column" : undefined;
  }

  function menuItems(field: string, list: PivotList): MenuItem[] {
    const at = fields[list].indexOf(field);
    const items: MenuItem[] = LISTS.map((to) => ({
      label: `Move to ${LIST_TITLE[to]}`,
      disabled: to === list || !!capabilities && (to === "split" && !capabilities.features.includes("splits") || to === "grouping" && !capabilities.features.includes("grouping")),
      onSelect: () => place(field, to, Number.MAX_SAFE_INTEGER, list),
    }));
    items.push(
      // `index` counts positions with the pill taken out, so one place down is at + 1.
      { label: "Move up", separatorBefore: true, disabled: at <= 0, onSelect: () => place(field, list, at - 1, list) },
      { label: "Move down", disabled: at === fields[list].length - 1, onSelect: () => place(field, list, at + 1, list) },
    );
    if (list === "data") {
      const current = operator(field);
      const s = suggestion(source(field));
      if(!capabilities) items.push({ label: "Duplicate", onSelect: () => onChange({ pivot: { ...config, measures: duplicateMeasure(measures, field, crypto.randomUUID()) } }) });
      if (config.measures !== undefined) items.push({ label: "Remove", onSelect: () => onChange({ pivot: { ...config, measures: measures.filter(m => m.id !== field) } }) });
      // One click for the common case: the provider's rule, applied exactly
      // as picking it from the submenu would. Offered only while nothing is
      // chosen; once an operator is set the submenu is the place to change it.
      if (s.kind === "suggested" && current === undefined && (!capabilities || capabilities.aggregations.includes(s.fn))) {
        items.push({
          label: `Use suggested ${AGG_LABEL[s.fn]}`,
          separatorBefore: true,
          onSelect: () => onChange(aggregate(field, s.fn)),
        });
      }
      items.push({
        label: "Aggregation",
        separatorBefore: true,
        submenu: [
          { label: "None", checked: current === undefined, onSelect: () => onChange(aggregate(field, null)) },
          // `true` for hasDate is deliberate, not a shortcut: this panel
          // always lists First/Last, even with no date column, so it can
          // disable them itself below with a "Needs a date column" reason —
          // passing the real hasDate would instead omit them outright, and
          // the reason would never render.
          ...legalAggregations(kinds.get(source(field)) ?? "none", true).filter(fn=>!capabilities||capabilities.aggregations.includes(fn)).map((fn): MenuItem => {
            const needsDate = (fn === "first" || fn === "last") && !hasDate;
            return {
              label: s.kind === "suggested" && s.fn === fn ? `${AGG_LABEL[fn]} · suggested` : AGG_LABEL[fn],
              checked: current === fn,
              disabled: needsDate,
              title: needsDate ? "Needs a date column" : undefined,
              onSelect: () => onChange(aggregate(field, fn)),
            };
          }),
        ],
      });
    } else {
      const native = periodicity.get(field);
      if (native !== undefined && !capabilities) {
        const current = bucketOf(config, field);
        items.push({
          label: "Bucket",
          separatorBefore: true,
          submenu: [
            { label: PERIODICITY_LABEL[native], checked: current === "native", onSelect: () => onChange(setBucket(config, field, "native")) },
            ...coarserBuckets(native).map((bucket): MenuItem => ({
              label: `${BUCKET_LABEL[bucket]}${straddles(native, bucket) ? " ⚠" : ""}`,
              checked: current === bucket,
              title: straddles(native, bucket) ? straddleNote(bucket) : undefined,
              onSelect: () => onChange(setBucket(config, field, bucket)),
            })),
          ],
        });
      }
    }
    return items;
  }

  function renderList(list: PivotList) {
    const shown = fields[list];
    // The indicator's index counts pills with the dragged one taken out.
    let seen = 0;
    return (
      <section key={list} className="pivot-column">
        <h3>{LIST_TITLE[list]} <span>{shown.length}</span></h3>
        <p className="pivot-hint">{LIST_HINT[list]}</p>
        <div
          role="list"
          aria-label={LIST_TITLE[list]}
          className={insert?.list === list ? "pivot-list pivot-list-over" : "pivot-list"}
          onDragOver={(e) => {
            if (!ours(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const field = dragged.current;
            if (field === null) return;
            const index = indexAt(e.currentTarget, e.clientY, draggedList.current === list ? field : null);
            setInsert((prev) => (prev?.list === list && prev.index === index ? prev : { list, index, field }));
          }}
          onDragLeave={(e) => {
            // dragleave also fires when the pointer crosses onto a pill inside.
            if (!movedWithin(e.relatedTarget, e.currentTarget)) setInsert(null);
          }}
          onDrop={(e) => {
            if (!ours(e)) return;
            e.preventDefault();
            const field = dragged.current;
            dragged.current = null;
            setInsert(null);
            if (field !== null) place(field, list, indexAt(e.currentTarget, e.clientY, draggedList.current === list ? field : null), draggedList.current);
          }}
        >
          {shown.length === 0 && insert?.list !== list ? (
            <p className="pivot-empty" aria-hidden="true">
              Drop a column here
            </p>
          ) : null}
          {shown.map((field) => {
            const isDragged = field === insert?.field;
            const showInsert = insert?.list === list && !isDragged && insert.index === seen;
            if (!isDragged) seen += 1;
            const text = pillText(field, list);
            const warn = text.endsWith("⚠") || text.endsWith("· Choose");
            return (
              <div key={field} role="listitem">
                {showInsert ? <div className="pivot-insert" aria-hidden="true" /> : null}
                {/* A div with role=button, not a <button>: Firefox will not
                    start a native drag from a button. Focusable and keyed the
                    way the table's header cells are, for the same reason --
                    the menu is the only path a keyboard or a touch has. */}
                <div
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-haspopup="menu"
                  aria-expanded={menuAt?.field === field && menuAt.list === list}
                  aria-label={text}
                  data-pivot-field={field}
                  data-pivot-list={list}
                  title={pillTitle(field, list)}
                  className={[
                    "pivot-pill",
                    warn ? "pivot-pill-warn" : null,
                    hidden.includes(field) ? "pivot-pill-hidden" : null,
                  ]
                    .filter((c): c is string => c !== null)
                    .join(" ")}
                  onDragStart={(e) => {
                    dragged.current = field;
                    draggedList.current = list;
                    e.dataTransfer.setData(PIVOT_DRAG_TYPE, field);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    // Escape, or a drop outside: no drop event came, nothing changed.
                    dragged.current = null;
                    setInsert(null);
                  }}
                  onClick={(e) => {
                    // A toggle: the menu is given this pill as its `anchor`, so
                    // the press does not dismiss it there, and the click that
                    // follows closes it here instead of opening it again.
                    const at = { field, list, x: e.clientX, y: e.clientY, trigger: e.currentTarget };
                    setMenuAt((open) => (open?.field === field && open.list === list ? null : at));
                  }}
                  onKeyDown={(e) => {
                    const opens =
                      e.key === "Enter" || e.key === " " || e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
                    if (!opens) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenuAt({ field, list, x: rect.left, y: rect.bottom, trigger: e.currentTarget });
                  }}
                >
                  {/* The grip is CSS (.pivot-pill::before), not a text node --
                      but CSS generated content still counts toward the
                      element's accessible name in Chromium, so without an
                      explicit aria-label a screen reader would read the grip
                      glyph before every pill ("⠿ Sector"). aria-label={text}
                      makes the name exactly the pill's label regardless of
                      what the CSS renders. */}
                  {text}
                </div>
              </div>
            );
          })}
          {insert?.list === list && insert.index >= seen ? (
            <div className="pivot-insert" aria-hidden="true" />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="pivot-panel" ref={panelRef}>
      <div className="pivot-panel-heading">
        <div><strong>Arrange this table</strong><p className="pivot-hint">Drag fields between lists, or select a field for move and aggregation options.</p></div>
        {onClose ? <button type="button" className="card-action" onClick={onClose}>Close</button> : null}
      </div>
      <div className="pivot-columns">{LISTS.filter(list=>!capabilities || list!=="split" || capabilities.features.includes("splits")).map(renderList)}</div>
      <div className="pivot-footer">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ pivot: { ...config, enabled: e.target.checked } })}
          />{" "}
          Pivot on
        </label>
        <span className="pivot-scope-note">{capabilities?"Grouping and aggregation run on the server.":"Only the returned rows are arranged. No implicit sums."}</span>
        <button type="button" className="card-action" onClick={() => onChange(config.measures === undefined ? clearedPivot() : { pivot: { ...config, enabled: false, grouping: [], split: [] } })}>
          Clear groups
        </button>
        {waiting > 0 ? (
          <span className="pivot-note pivot-pill-warn">
            {`${waiting} data column${waiting === 1 ? "" : "s"} need${waiting === 1 ? "s" : ""} an aggregation`}
          </span>
        ) : null}
      </div>
      {menuAt ? (
        <RowContextMenu
          x={menuAt.x}
          y={menuAt.y}
          portal
          returnFocusTo={menuAt.trigger}
          anchor={menuAt.trigger}
          items={menuItems(menuAt.field, menuAt.list)}
          onClose={() => setMenuAt(null)}
        />
      ) : null}
    </div>
  );
}

/** What the table is grouped by, in one line, while the panel is closed. */
export function PivotStrip({
  categoryMetadata,
  columns,
  config,
  kinds,
  onEdit,
}: {
  columns: TableColumn[];
  categoryMetadata?: ReadonlyMap<string, import("../../lib/tableModel/categories").CategoryMetadata>;
  config: PivotConfig;
  /** So a date field in a group list can name its bucket ("date · Year"). Optional: absent shows names only. */
  kinds?: ReadonlyMap<string, FieldKind>;
  onEdit?: () => void;
}) {
  const known = new Set(columns.map((c) => c.field));
  const { grouping, split } = activeLists(config, known);
  const header = (field: string) => {
    const category = categoryMetadata?.get(field);
    if (category) {
      const transform = category.transform !== "native" ? category.transform : category.bucket !== "native" ? BUCKET_LABEL[category.bucket] : undefined;
      return transform ? `${category.name} · ${transform}` : category.name;
    }
    const base = columns.find((c) => c.field === field)?.header ?? field;
    // A date field shows the bucket it is grouped at beside its name, unless
    // that is the data's own periodicity (native), which adds nothing to read.
    if (kinds?.get(field) === "date") {
      const bucket = bucketOf(config, field);
      if (bucket !== "native") return `${base} · ${BUCKET_LABEL[bucket]}`;
    }
    return base;
  };
  const parts = [grouping.map(header).join(" › "), split.map(header).join(" › ")].filter((p) => p !== "");
  return (
    <div className="pivot-strip">
      <span><span className="pivot-active-label">Pivot on · </span>{parts.join(" × ")}</span>
      {onEdit ? (
        <button type="button" className="card-action" aria-label="Edit pivot" onClick={onEdit}>
          Edit
        </button>
      ) : null}
    </div>
  );
}

/** Canonical analytical measures; the legacy configuration is only used before activation. */
export function MeasuresPanel({model,columns,readonly,pending,onCommitModel,sourceInspection,onRequestSourceInspection}:{model:TableModelV1;columns:readonly DatasetColumn[];readonly:boolean;pending?:boolean;onCommitModel:(next:TableModelV1)=>Promise<boolean>;sourceInspection?:InspectionResult;onRequestSourceInspection?:(request:InspectionRequest)=>void}) {
 const [source,setSource]=useState(columns[0]?.id??'');
 const [error,setError]=useState('');
 const sources=[...columns.map(c=>({id:c.id,label:c.label})),...model.formulas.filter(f=>f.scope==='source').map(f=>({id:f.id,label:f.name}))];
 const {chronology}=measureEligibility({model,columns,sourceFieldId:source,sourceInspection});
 const blocked=readonly||pending;
 const commit=async(next:TableModelV1)=>{if(blocked)return;setError('');if(!await onCommitModel(next))setError('Could not save report layout. Try again.');};
 const grand=<label className="pivot-measure-grand"><input type="checkbox" checked={model.subtotals.grandTotal} disabled={blocked} onChange={e=>void commit({...model,subtotals:{...model.subtotals,grandTotal:e.target.checked}})}/>Show grand total</label>;
 return <section className="table-model-authoring pivot-measure-panel" aria-label="Measures">
 <fieldset disabled={blocked}><legend>Add a measure</legend><div className="pivot-panel-row">
 <label>Measure source<select value={source} onChange={e=>setSource(e.target.value)}>{sources.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
 <button type="button" className="pivot-panel-primary" disabled={!sources.some(s=>s.id===source)} onClick={()=>void commit({...model,measures:[...model.measures,{id:crypto.randomUUID(),sourceFieldId:source}]})}>Add measure</button></div></fieldset>
 <div className="pivot-measure-list">{model.measures.map((m,index)=>{
  const sourceLabel=sources.find(s=>s.id===m.sourceFieldId)?.label??m.sourceFieldId;
  const label=measureLabel(m,sourceLabel,model.measures);
  const {operators}=measureEligibility({model,columns,sourceFieldId:m.sourceFieldId,sourceInspection});
  return <div key={m.id} className="report-measure pivot-measure-card"><div className="pivot-measure-title"><strong title={label}>{label}</strong><span title={sourceLabel}>from {sourceLabel}</span>{!m.aggregation?<span className="pivot-panel-warning" role="status">Choose an aggregation for this measure.</span>:null}</div>
   <label>Label for measure {index+1}<input disabled={blocked} placeholder={label} defaultValue={m.customLabel??''} key={`${m.id}:${m.customLabel??''}`} onBlur={e=>{const value=e.target.value;if(value===(m.customLabel??''))return;const changed={...m};if(value)changed.customLabel=value;else delete changed.customLabel;void commit({...model,measures:model.measures.map(item=>item.id===m.id?changed:item)});}}/></label>
   <label>Aggregation for {label}<select disabled={blocked} value={m.aggregation??''} onChange={e=>void commit({...model,measures:updateMeasureAggregation(model.measures,m.id,e.target.value as AggName||undefined)})}><option value="">Choose aggregation</option>{m.aggregation&&!operators.includes(m.aggregation)?<option value={m.aggregation}>{m.aggregation} (review binding)</option>:null}{operators.map(op=><option value={op} key={op}>{AGGREGATION_NAMES[op]}</option>)}</select></label>
   <div className="pivot-panel-row"><button type="button" disabled={blocked} onClick={()=>void commit({...model,measures:duplicateMeasure(model.measures,m.id,crypto.randomUUID())})}>Duplicate {label}</button>
   <button type="button" disabled={blocked} onClick={()=>void commit({...model,measures:model.measures.filter(item=>item.id!==m.id),layout:{...model.layout,values:model.layout.values.filter(id=>id!==m.id)}})}>Remove {label}</button>
   {model.formulas.some(f=>f.id===m.sourceFieldId&&f.scope==='source')?<button type="button" disabled={pending} onClick={()=>onRequestSourceInspection?.({collection:'definitions',definitionId:m.sourceFieldId,offset:0,limit:1})}>Inspect source type for {label}</button>:null}</div>
  </div>;
 })}</div>
 {!model.measures.length?<p className="pivot-panel-note">No measures yet.</p>:null}
 <p className="pivot-panel-note">Arrange controls column order.</p>
 {!chronology?<p className="pivot-panel-note">First and Last require one declared report-period date category and an unambiguous company mapping.</p>:null}
 <DrawerFooterActions>{grand}</DrawerFooterActions>{error?<p role="alert">{error}</p>:null}</section>;
}
