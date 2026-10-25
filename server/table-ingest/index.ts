// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { datasetFromBytes } from '../../src/lib/localTableData';
import type { WidgetDataset } from '../../src/lib/widgetData/types';
import { validateExecutionRequest } from '../../src/lib/tableExecution/validation';

export async function ingestFile(name:string,bytes:Uint8Array,widgetId:string,inputRevision:number):Promise<WidgetDataset> {
  try {
    if (!/\.(csv|tsv|json|xls|xlsx)$/i.test(name)) throw new Error();
    return await datasetFromBytes(name,bytes,widgetId,inputRevision);
  } catch { throw new Error('Could not ingest table source'); }
}
/** Admission uses the same dataset contract as worker inputs; calculation remains native. */
export function admitDataset(dataset:WidgetDataset,maxRows:number,maxColumns:number):WidgetDataset {
  if (dataset.rows.length>maxRows || dataset.columns.length>maxColumns) throw new Error('Table source exceeds limits');
  const fields=new Set(dataset.columns.map(c=>c.id));
  for(const row of dataset.rows) {
    for(const field of Object.keys(row.values)) fields.add(field);
    if(fields.size>maxColumns) throw new Error('Table source exceeds limits');
  }
  validateExecutionRequest({kind:'registerInput',requestId:'ingest',revision:{widgetId:'ingest',input:1,model:0,output:0},inputRevision:1,input:dataset});
  return dataset;
}
