// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import type Reference from '../../../src/test/fixtures/sec-statements/reference.json';
const reference = JSON.parse(readFileSync(new URL('../../../src/test/fixtures/sec-statements/reference.json',import.meta.url),'utf8')) as typeof Reference;
import type {StatementIntent} from '../../../src/lib/statementModel/types';
import type { Dashboard } from '../../../src/lib/types';
import { dashboardLayout } from './dashboard';

export function buildSecDashboard(): {dashboard: Dashboard; files: Record<string,string>} {
 const dashboard = structuredClone(dashboardLayout) as unknown as Dashboard;
 const cards = dashboard.tabs[0].cards;
 const definition = structuredClone(reference.companies.NVDA.definition);
 const analytical = definition.analytical as unknown as StatementIntent;
 // Exercise a renamed pinned USD line and changed available series in the effective fixture.
 analytical.overrides.labels[analytical.template.lines[0].id as keyof typeof analytical.overrides.labels] = 'Revenue (USD)' as never;
 analytical.overrides.hiddenIds = [analytical.template.lines.find(l=>l.label==='Financing cash flow')!.id];
 cards.find(c=>c.id==='statement')!.tableDefinition = definition as unknown as NonNullable<typeof cards[number]['tableDefinition']>;
 const labels = analytical.template.lines.filter(l=>l.unit==='USD'&&!analytical.overrides.hiddenIds.includes(l.id)).map(l=>analytical.overrides.labels[l.id as keyof typeof analytical.overrides.labels] ?? l.label);
 const usd = cards.find(c=>c.id==='usd-lines')!;
 (usd.tableDefinition!.analytical as {checklists:{memberKeys:string[]}[]}).checklists[0].memberKeys = labels.map(label=>JSON.stringify(['string',label]));
 const rows = Object.values(reference.companies).flatMap(c=>c.dataset.rows);
 const columns = ['sec_source_row_id',...reference.companies.NVDA.dataset.columns.map(c=>c.id)];
 const csv = (v: unknown) => '"'+String(v??'').replaceAll('"','""')+'"';
 const file = '00000000-0000-0000-0000-000000000001.csv';
 const contents = [columns.map(csv).join(','),...rows.map(row=>columns.map(key=>csv(key==='sec_source_row_id'?row.id:row.values[key as keyof typeof row.values])).join(','))].join('\n');
 // Sibling reads the original fact hub, with exact company/line/period scope.
 cards.push({id:'raw',widgetId:'local_table',backendId:'builtin',title:'Original Revenue FY2024 facts',params:{},linkedSource:{kind:'widget',sourceWidgetId:'facts'},layout:{x:0,y:35,w:40,h:8},tableDefinition:{table:{columnFilters:[{id:'item',value:analytical.template.lines[0].id},{id:'report_start',value:{from:'2023-01-30',to:'2023-01-30'}},{id:'report_end',value:{from:'2024-01-28',to:'2024-01-28'}}]},search:''}});
 return {dashboard,files:{['files/'+file]:contents}};
}
