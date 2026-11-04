// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {expect,it} from 'vitest';
import {buildSecDashboard} from '../../e2e/fixtures/sec-statements/fixtureBuilder';
import type {StatementIntent} from '../lib/statementModel/types';
it('regenerates all and only visible USD labels from the effective SEC template',()=>{
 const built=buildSecDashboard(), cards=built.dashboard.tabs[0].cards;
 const statement=cards.find(card=>card.id==='statement')!.tableDefinition!.analytical as StatementIntent;
 const selected=cards.find(card=>card.id==='usd-lines')!.tableDefinition!.analytical as {checklists:{memberKeys:string[]}[]};
 const allowed=selected.checklists[0].memberKeys.map(key=>JSON.parse(key)[1]);
 expect(allowed).toEqual(statement.template.lines.filter(line=>line.unit==='USD'&&!statement.overrides.hiddenIds.includes(line.id)).map(line=>statement.overrides.labels[line.id]??line.label));
 expect(allowed).toHaveLength(13);expect(allowed).toContain('Revenue (USD)');expect(allowed).not.toContain('Revenue');expect(allowed).not.toContain('Financing cash flow');expect(allowed).not.toContain('Diluted EPS');
 expect(Object.values(built.files)[0].split('\n')).toHaveLength(99);
 expect(Object.values(built.files)[0].split('\n')[0]).toContain('sec_source_row_id');
 const second=buildSecDashboard();expect(second).toEqual(built);expect(second.dashboard).not.toBe(built.dashboard);
});
