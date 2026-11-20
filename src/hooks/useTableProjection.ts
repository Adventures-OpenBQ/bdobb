// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useMemo} from "react";
import {getCoreRowModel,getFilteredRowModel,getSortedRowModel,useReactTable,type ColumnDef,type SortingFn,type SortingState} from "@tanstack/react-table";
import {tableColumns,tableRows,type Row,type TableColumn} from "../lib/tableColumns";
import type {TableCardState,TableSpec} from "../lib/types";
import type {SurfaceDataset} from "../lib/linkedSurface";
import {filterFnFor,filterKindFor,type FilterKind} from "../components/renderers/TableFilterRow";
const NO_ROWS: Row[]=[];
const NO_SORTING: NonNullable<TableCardState["sorting"]>=[];
const NO_FILTERS: NonNullable<TableCardState["columnFilters"]>=[];

const TEXT_ORDER = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * Every column's sort, stated rather than left to table-core's `auto`, which
 * sniffs a column's type from its rows AFTER the first ten
 * (`flatRows.slice(10)`) and so hands a short table `basic` -- a bare `>`,
 * under which null compares like 0 and lands in the middle of a signed
 * column (change %, say).
 *
 * Missing -- null or undefined -- sorts last in BOTH directions, which is why
 * the direction is an input: table-core flips a sortingFn's answer for a
 * descending sort, so this pre-flips it. The column's `sortUndefined: false`
 * sends undefined here too; table-core's own `"last"` covers undefined but
 * not null, and folding null into undefined in the accessor would change
 * what an `eq: null` colour rule matches.
 *
 * `numeric` is the column's filter kind -- cellDataType when the spec gives
 * one, otherwise the type of its first value. A stray non-number in a numeric
 * column falls back to the text order rather than comparing as NaN.
 */
function sortingFnFor(numeric: boolean, desc: boolean): SortingFn<Row> {
  return (a, b, id) => {
    const x = a.getValue(id);
    const y = b.getValue(id);
    const xMissing = x === null || x === undefined;
    const yMissing = y === null || y === undefined;
    if (xMissing || yMissing) {
      if (xMissing && yMissing) return 0;
      return xMissing !== desc ? 1 : -1;
    }
    if (numeric && typeof x === "number" && typeof y === "number") return x - y;
    return TEXT_ORDER.compare(String(x), String(y));
  };
}


/** The same accessor/filter/comparator drives the visible table and linked publication. */
export function projectionColumn(column: TableColumn, kind: FilterKind, sorting: SortingState): ColumnDef<Row> {
  return {
    id:column.field,
    accessorFn:(row:Row)=>{
      const value=Object.hasOwn(row,column.field)?row[column.field]:undefined;
      const field=column.hoverCard?.cellField;
      if(field!==undefined && typeof value==="object" && value!==null){
        const record=value as Record<string,unknown>;
        return Object.hasOwn(record,field)?record[field]:undefined;
      }
      return value;
    },
    filterFn:filterFnFor(kind),enableColumnFilter:kind!=="none",
    sortingFn:sortingFnFor(kind==="number",sorting.some(s=>s.id===column.field && s.desc)),sortUndefined:false,
  };
}

/** Headless and unvirtualized, so source view switches cannot change the linked scope. */
export function useTableProjection(data: unknown, spec: TableSpec|undefined, state:TableCardState|undefined, enabled:boolean): SurfaceDataset {
  const rows=useMemo(()=>enabled?(tableRows(data)??NO_ROWS):NO_ROWS,[data,enabled]);
  const columns=useMemo(()=>tableColumns(rows,spec),[rows,spec]);
  const sorting=enabled?(state?.sorting??NO_SORTING):NO_SORTING;
  const columnFilters=enabled?(state?.columnFilters??NO_FILTERS):NO_FILTERS;
  const definitions=useMemo(()=>columns.map(c=>projectionColumn(c,filterKindFor(c,rows),sorting)),[columns,rows,sorting]);
  const table=useReactTable({data:rows,columns:definitions,state:{sorting,columnFilters},getCoreRowModel:getCoreRowModel(),getFilteredRowModel:getFilteredRowModel(),getSortedRowModel:getSortedRowModel()});
  const projected=table.getRowModel().rows;
  return useMemo(()=>{
    const published:SurfaceDataset["columns"]=columns.map(c=>({id:c.field,label:c.header,dtype:filterKindFor(c,rows),chartDataType:spec?.columns.find(h=>h.field===c.field)?.chartDataType}));
    // OmitNone responses can omit a whole tenor. Its declared schema still
    // exists: keep that axis as missing values rather than inventing zeroes
    // or hiding a valid surface. Visible table columns remain unchanged.
    if(enabled)for(const hint of spec?.columns??[]){
      if((hint.chartDataType==="series" || hint.chartDataType==="category") && !published.some(c=>c.id===hint.field)){
        published.push({id:hint.field,label:hint.headerName??hint.field,dtype:hint.cellDataType==="number"?"number":undefined,chartDataType:hint.chartDataType});
      }
    }
    // Preserve schema order for expiry axes, including wholly absent tenors.
    const rank=new Map((spec?.columns??[]).map((c,i)=>[c.field,i]));
    published.sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
    return {rows:projected.map(row=>Object.fromEntries(columns.map(c=>[c.field,row.getValue(c.field)]))),columns:published};
  },[projected,columns,rows,spec,enabled]);
}
