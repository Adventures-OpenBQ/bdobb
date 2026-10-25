// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { createWorkerExecutor } from './tableExecution/workerClient';
import { createWorkerHandler } from './tableExecution/table.worker';
import type { ExecutionRequest, Revision, TableExecutor } from './tableExecution/types';
import { beginSubset, appendSubset, commitSubset } from './tableExecution/subsetTransfer';
import { fixture } from './statementModel/compileFixtures';
import { loadStatementSnapshot } from './statementExecution';

class Boundary {
  onmessage: ((event: MessageEvent) => void) | null = null;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) { void this.handler(data); }
  terminate() {}
}
const signal = () => new AbortController().signal;
const revision: Revision = { widgetId: 'template', input: 1, model: 1, output: 1 };
const worker = (id = 'template') => createWorkerExecutor(id, () => new Boundary() as unknown as Worker);
async function execute(f = fixture()) {
  const executor = worker();
  await executor.registerInput(f.source, 1, signal());
  await executor.applyModel({ table: {}, search: '', analytical: f.statement }, { kind: 'none' }, revision, signal());
  return executor;
}
async function transfer(executor: TableExecutor, rev = revision) {
  let pending;
  for await (const batch of executor.presented(rev, signal())) {
    pending ??= beginSubset(batch.transferId, rev);
    appendSubset(pending, batch);
  }
  if (!pending) throw new Error('Missing transfer');
  return commitSubset(pending);
}

it('projects a selected template Profit40 without restoring unselected lines or recalculating totals', async () => {
  const f = fixture(), executor = await execute(f);
  try {
    const data = await transfer(executor);
    const profit = data.rows.find(row => row.groupPath?.at(-1)?.value === f.ids.line('calculated_gross_profit'))!;
    const selected = { ...revision, model: 2, output: 2 };
    await executor.applyModel({ table: {}, search: '', analytical: f.statement }, { kind: 'explicit', ids: [profit.id] }, selected, signal());
    const result = await loadStatementSnapshot(executor, selected, signal());
    expect(result.statement?.sections.flatMap(section => section.items).map(item => item.field)).toEqual([f.ids.line('calculated_gross_profit')]);
    expect(result.statement?.sections.flatMap(section => section.items)[0].values).toEqual([40]);
    expect(result.statement?.headers).toEqual(['FY2025']);
    expect(result.statement?.rows).toHaveLength(1);
  } finally { executor.dispose(); }
});

it.each(['currency', 'unit'] as const)('preserves a template mixed-%s error instead of displaying Profit40', async field => {
  const f = fixture();
  f.statement.bindings.shape = 'long'; f.statement.bindings.mappings = [];
  f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
  if (field === 'currency') f.statement.bindings.currencyFieldId = field;
  else f.statement.bindings.unitFieldId = field;
  const base = f.source.rows[0].values;
  f.source.rows = [
    { id: 'revenue', values: { ...base, item: f.ids.line('revenue'), amount: 100, [field]: 'one' } },
    { id: 'cost', values: { ...base, item: f.ids.line('cost_of_revenue'), amount: 60, [field]: 'two' } },
  ];
  f.source.columns = Object.keys(f.source.rows[0].values).map(id => ({ id, label: id }));
  const executor = await execute(f);
  try {
    const result = await loadStatementSnapshot(executor, revision, signal());
    const profit = result.statement?.sections.flatMap(section => section.items).find(item => item.field === f.ids.line('calculated_gross_profit'));
    expect(profit).toBeDefined();
    expect(profit?.values[0]).not.toBe(40);
    expect(profit).toHaveProperty('errors.0.message', expect.stringMatching(/context|currency|unit/i));
    expect(result.completeness.kind).toBe('partial');
  } finally { executor.dispose(); }
});

it('retains authored order, labels, raw ratios and per-cell formats through a linked worker transfer', async () => {
  const f = fixture(), profitId = f.ids.line('calculated_gross_profit');
  const section = f.statement.template.sections.find(s => s.lineIds.includes(profitId))!;
  f.statement.overrides.labels[section.id] = 'Renamed results';
  f.statement.overrides.labels[profitId] = 'Margin';
  f.statement.overrides.lineOrder[section.id] = [profitId, ...section.lineIds.filter(id => id !== profitId)];
  const formula = f.statement.template.lines.find(line => line.id === profitId)!.formula!;
  if (formula.ast.kind !== 'binary') throw new Error('Expected binary formula');
  f.statement.overrides.formulas = [{ ...formula, format: 'percent', ast: { ...formula.ast, operator: '/' } }];
  f.source.rows[0].values.revenue = 40; f.source.rows[0].values.cost_of_revenue = 100;
  const executor = await execute(f), linked = worker('linked');
  try {
    const dataset = await transfer(executor);
    await linked.registerInput(dataset, 1, signal());
    const linkedRevision = { ...revision, widgetId: 'linked' };
    await linked.applyModel({ table: {}, search: '' }, { kind: 'none' }, linkedRevision, signal());
    const result = await loadStatementSnapshot(linked, linkedRevision, signal());
    const group = result.statement?.sections.find(s => s.name === 'Renamed results');
    expect(group?.items[0]).toMatchObject({ field: profitId, label: 'Margin', values: [0.4] });
    expect(group?.items[0]).toHaveProperty('formats.0.formatterFn', 'normalizedPercent');
    expect(result.statement?.rows.find(row => row['Line item'] === 'Margin')?.FY2025).toBe(0.4);
    const column = dataset.columns.find(column => column.measureId === f.ids.value)!;
    const chart = await linked.chartData(linkedRevision, [column.id], signal());
    expect(chart.rows.some(row => row.values[column.id] === 0.4)).toBe(true);
  } finally { executor.dispose(); linked.dispose(); }
});
