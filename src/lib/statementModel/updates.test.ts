// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { fixture } from './compileFixtures';
import { resetStatementOverrides } from './overrides';
import { previewStatementUpdate } from './updates';
import { validateStatementIntent } from './validation';
import { compileStatement } from './compile';
import type { StatementTemplate } from './types';
const future = (template: StatementTemplate) => JSON.parse(JSON.stringify(template).replaceAll('/1.0.0/', '/2.0.0/').replace('"version":"1.0.0"', '"version":"2.0.0"')) as StatementTemplate;
describe('local Statement changes', () => {
 it('resets local changes while preserving bindings and Page membership', () => {
  const { statement, ids } = fixture(); statement.overrides.labels[ids.line('revenue')] = 'Sales'; statement.overrides.hiddenIds = [ids.line('revenue')];
  statement.page = { categoryId:ids.company, memberKeys:['ACME','OTHER'] };
  const reset = resetStatementOverrides(statement);
  expect(reset.bindings).toEqual(statement.bindings); expect(reset.page).toEqual(statement.page);
  expect(reset.overrides).toEqual({labels:{},lineOrder:{},hiddenIds:[],formulas:[]});
 });
 it('maps all stable semantic references across version prefixes without consulting display labels', () => {
  const { statement, ids } = fixture(); const next = future(statement.template);
  statement.overrides.labels[ids.line('revenue')] = 'Sales';
  statement.page = {categoryId:ids.company, memberKeys:['ACME','OTHER']};
  statement.checklists = [{categoryId:ids.item, memberKeys:[ids.line('revenue')]}];
  statement.resultFilters = [{id:'filter',categoryId:ids.item,target:{kind:'measure',id:ids.value},predicate:'gt',value:0}];
  const formula = structuredClone(statement.template.lines.find((line: StatementTemplate['lines'][number])=>line.formula)!.formula!);
  formula.ast = {kind:'binary',operator:'+',left:{kind:'unary',operator:'-',operand:{kind:'member',value:{kind:'reference',target:'measure',id:ids.value},selectors:[{categoryId:ids.item,memberKey:ids.line('revenue')},{categoryId:ids.company,memberKey:'ACME'}]}},right:{kind:'literal',value:1}};
  statement.overrides.formulas = [formula];
  next.lines.find(l=>l.id.endsWith('/line/revenue'))!.label = 'Unrelated';
  const preview = previewStatementUpdate(statement,next);
  expect(preview.conflicts).toEqual([]); expect(validateStatementIntent(preview.next).diagnostics).toEqual([]);
  expect(preview.next.page).toEqual({categoryId:ids.company.replace('/1.0.0/','/2.0.0/'),memberKeys:['ACME','OTHER']});
  expect(preview.next.bindings.mappings[0].lineId).toContain('/2.0.0/');
  expect(preview.next.overrides.labels).toHaveProperty(ids.line('revenue').replace('/1.0.0/','/2.0.0/'),'Sales');
  const updated = (id:string) => id.replace('/1.0.0/','/2.0.0/');
  expect(preview.next.checklists).toEqual([{categoryId:updated(ids.item),memberKeys:[updated(ids.line('revenue'))]}]);
  expect(preview.next.resultFilters).toEqual([{id:'filter',categoryId:updated(ids.item),target:{kind:'measure',id:updated(ids.value)},predicate:'gt',value:0}]);
  expect(preview.next.overrides.formulas).toEqual([{...formula,id:updated(formula.id),ast:{kind:'binary',operator:'+',left:{kind:'unary',operator:'-',operand:{kind:'member',value:{kind:'reference',target:'measure',id:updated(ids.value)},selectors:[{categoryId:updated(ids.item),memberKey:updated(ids.line('revenue'))},{categoryId:updated(ids.company),memberKey:'ACME'}]}},right:{kind:'literal',value:1}}}]);
  expect(statement.template.version).toBe('1.0.0');
 });
 it('retains removed overridden lines visibly and refuses unresolved execution and validation', () => {
  const { statement, source, ids } = fixture(); const next = future(statement.template);
  const removed = ids.line('revenue'); statement.overrides.labels[removed] = 'Sales';
  next.lines = next.lines.filter(l=>!l.id.endsWith('/line/revenue'));
  next.sections.forEach(s=>s.lineIds = s.lineIds.filter(id=>!id.endsWith('/line/revenue')));
  // Remove formulas referencing the removed line to keep the proposed snapshot valid.
  next.lines.forEach(l=>{if(l.formula){l.formula.ast={kind:'literal',value:1};l.formula.expression='1';}});
  const preview = previewStatementUpdate(statement,next);
  expect(preview.conflicts.some(c=>c.id===removed)).toBe(true);
  expect(preview.next.overrides.labels[removed]).toBe('Sales');
  expect(validateStatementIntent(preview.next).value).toBeUndefined();
  expect(()=>compileStatement(preview.next,source.columns)).toThrow();
 });
});

it('retains detached semantic before and after defaults, mappings and order even without conflicts',()=>{
 const {statement}=fixture();const next=future(statement.template);
 next.lines[0].label='Sales';next.lines[0].policy='stock';next.lines[0].format='integer';
 const formula=next.lines.find(l=>l.formula)!.formula!;formula.expression='42';formula.ast={kind:'literal',value:42};
 next.sections.reverse();next.sections[0].lineIds.reverse();
 const old=structuredClone(statement);const preview=previewStatementUpdate(statement,next);
 expect(preview.conflicts).toEqual([]);
 expect(preview.changes).toEqual(expect.arrayContaining([
  expect.objectContaining({field:'label',before:'revenue',after:'Sales'}),
  expect.objectContaining({field:'policy',before:'flow',after:'stock'}),
  expect.objectContaining({field:'format',before:undefined,after:'integer'}),
  expect.objectContaining({field:'formula',after:expect.objectContaining({expression:'42'})}),
  expect.objectContaining({field:'sectionOrder'}),
  expect.objectContaining({field:'mappings'}),
 ]));
 const comparison=structuredClone(preview.changes);preview.next.template.lines[0].label='Later edit';next.lines[0].label='External edit';
 expect(preview.changes).toEqual(comparison);expect(statement).toEqual(old);
});
