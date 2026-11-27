// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {compileStatement} from './compile';
import {fixture} from './compileFixtures';
it('makes unedited built-in labels readable without changing template identity or bindings',()=>{
 const f=fixture(),before=structuredClone(f.statement);
 const compiled=compileStatement(f.statement,f.source.columns),labels=compiled.execution.memberLabels![f.ids.item];
 expect(labels[JSON.stringify(['string',f.ids.line('revenue')])]).toBe('Revenue');
 expect(labels[JSON.stringify(['string',f.ids.line('cost_of_revenue')])]).toBe('Cost of Revenue');
 expect(labels[JSON.stringify(['string',f.ids.line('ebitda')])]).toBe('EBITDA');
 expect(f.statement).toEqual(before);expect(compiled.templateIdentity).toEqual({id:'income',version:'1.0.0'});
});
it('prefers provider display titles for defaults while keeping authored and overridden labels',()=>{
 const f=fixture();f.source.columns.find(c=>c.id==='revenue')!.label='Revenue from Contracts';
 const label=()=>compileStatement(f.statement,f.source.columns).execution.memberLabels![f.ids.item][JSON.stringify(['string',f.ids.line('revenue')])];
 expect(label()).toBe('Revenue from Contracts');
 f.statement.overrides.labels[f.ids.line('revenue')]='Sales';expect(label()).toBe('Sales');
 delete f.statement.overrides.labels[f.ids.line('revenue')];f.statement.template=structuredClone(f.statement.template);
 f.statement.template.lines.find(line=>line.id===f.ids.line('revenue'))!.label='Authored sales';expect(label()).toBe('Authored sales');
});
