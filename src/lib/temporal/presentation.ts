// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {TableDefinition} from '../tableExecution/types';
import {finiteJson,isRecord,type QueryDefinition} from './contracts';

/**
 * A table layout saved with a shared query (v11 design review, "Save pivot
 * with query"). It rides in `QueryDefinition.presentation`, which TemporalDB
 * stores but never executes, hashes or replays, so a layout change is a new
 * definition revision and never a different result.
 *
 * Only the analytical model (pivot rows, columns, values) and the data-column
 * order are shared. Widths, sorting, filters, pins and the search box stay the
 * viewer's own. A model that no longer fits the query's columns is NOT
 * dropped: the table's existing repair flow shows it for review.
 */
export const LAYOUT_KEY='bdobb_table_v1';
export type SavedLayout={analytical:unknown;columnOrder?:string[]};

export function layoutFromTable(definition:TableDefinition|undefined):SavedLayout|null{
 if(!definition||definition.analytical===undefined||definition.analytical===null)return null;
 const order=definition.table?.columnOrder;
 return {analytical:structuredClone(definition.analytical),...(order?.length?{columnOrder:[...order]}:{})};
}

export function savedLayout(query:Pick<QueryDefinition,'presentation'>):SavedLayout|null{
 const v=query.presentation?.[LAYOUT_KEY];
 if(!isRecord(v)||!isRecord(v.analytical)||!finiteJson(v))return null;
 if(v.columnOrder!==undefined&&!(Array.isArray(v.columnOrder)&&v.columnOrder.every(x=>typeof x==='string')))return null;
 return structuredClone(v) as SavedLayout;
}

export function tableDefinitionFromLayout(layout:SavedLayout):TableDefinition{
 return {table:layout.columnOrder?{columnOrder:[...layout.columnOrder]}:{},search:'',analytical:structuredClone(layout.analytical)};
}

/** The definition's next revision with the layout written into presentation. */
export function withLayout(query:QueryDefinition,layout:SavedLayout):QueryDefinition{
 return {...structuredClone(query),presentation:{...(query.presentation??{}),[LAYOUT_KEY]:structuredClone(layout)}};
}
