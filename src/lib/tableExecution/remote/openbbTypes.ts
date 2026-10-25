// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {DatasetColumn} from '../../widgetData/types';
import type {RemoteTransportConfig} from './transport';
/** Explicitly supported operators, not the upstream model's merely accepted fields. */
export type OpenbbAggregation='sum'|'min'|'max'|'mean'|'count';
export interface OpenbbSsrmConfig extends RemoteTransportConfig {
 /** Fixed saved widget endpoint relative to baseUrl. Never read from a row/request. */
 endpoint:string;
 /** Already resolved via wireParams by the backend factory. Empty strings are omitted. */
 params?:Record<string,string>;
 inputRevision:number;
 columns?:readonly DatasetColumn[];
 pageSize?:number;
 maxRowBlockRows?:number;
 maxColumns?:number;
 maxGroupPaths?:number;
 capabilities?:{
  sorting?:boolean;
  filtering?:readonly ('text'|'number')[];
  grouping?:boolean;
  aggregations?:readonly OpenbbAggregation[];
  /** Optional provider extension. The official example does NOT implement pivoting. */
  pivot?:{columns:readonly DatasetColumn[]};
 };
}
export type OpenbbColumn={id:string;field:string;aggFunc?:string};
/** POST body used by the official ssrm_mode /data-ssrm handler. */
export interface OpenbbSsrmRequest {
 startRow:number;
 endRow:number;
 sortModel:{colId:string;sort:'asc'|'desc'}[];
 filterModel:Record<string,unknown>;
 rowGroupCols:OpenbbColumn[];
 groupKeys:string[];
 valueCols:OpenbbColumn[];
 pivotCols:OpenbbColumn[];
 pivotMode:boolean;
}
