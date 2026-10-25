// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { createWorkerExecutor } from './tableExecution/workerClient';
import { createWorkerHandler } from './tableExecution/table.worker';
import type { ExecutionRequest } from './tableExecution/types';
import type { WidgetDataset } from './widgetData/types';
import { loadStatementSnapshot } from './statementExecution';
class Boundary {
  onmessage: ((e: MessageEvent) => void) | null = null;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) { void this.handler(data); }
  terminate() {}
}
const revision = { widgetId: 'statement', input: 1, model: 1, output: 1 };
const rows = [
  { fiscal_year: 2026, fiscal_period: 'Q3', revenue: 30, net_cash_from_operating_activities: 12, capital_expenditure: -5 },
  { fiscal_year: 2026, fiscal_period: 'TTM', revenue: 90, net_cash_from_operating_activities: 33, capital_expenditure: -18 },
];
async function execute(selection: { kind: 'none' } | { kind: 'explicit'; ids: string[] } = { kind: 'none' }) {
  const executor = createWorkerExecutor('statement', () => new Boundary() as unknown as Worker);
  const dataset: WidgetDataset = {
    rows: rows.map((values, i) => ({ id: `r${i}`, values })),
    columns: Object.keys(rows[0]).map(id => ({ id, label: id, dtype: id === 'fiscal_period' ? 'text' as const : 'number' as const })),
    resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 'statement' },
    completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false },
  };
  const signal = new AbortController().signal;
  await executor.registerInput(dataset, 1, signal);
  await executor.applyModel({ table: {}, search: '' }, selection, revision, signal);
  return executor;
}
it('projects complete worker-delivered periods without summing or relabeling provider cash flow', async () => {
  const executor = await execute();
  try {
    const snapshot = await loadStatementSnapshot(executor, revision, new AbortController().signal);
    expect(snapshot.statement?.headers).toEqual(['FY2026-Q3', 'FY2026-TTM']);
    expect(snapshot.statement?.statement).toBe('cash');
    expect(snapshot.statement?.sections.flatMap(s => s.items).find(i => i.field === 'capital_expenditure')?.values).toEqual([-5, -18]);
    expect(snapshot.revision).toEqual(revision);
    expect(snapshot.completeness.kind).toBe('complete');
  } finally { executor.dispose(); }
});
it('uses the worker selection rather than an unfiltered main-thread copy', async () => {
  const executor = await execute({ kind: 'explicit', ids: ['r1'] });
  try {
    const snapshot = await loadStatementSnapshot(executor, revision, new AbortController().signal);
    expect(snapshot.statement?.headers).toEqual(['FY2026-TTM']);
    expect(snapshot.statement?.sections.flatMap(s => s.items).find(i => i.field === 'capital_expenditure')?.values).toEqual([-18]);
  } finally { executor.dispose(); }
});
it('does not publish a statement after cancellation', async () => {
  const executor = await execute();
  try {
    const controller = new AbortController(); controller.abort();
    await expect(loadStatementSnapshot(executor, revision, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  } finally { executor.dispose(); }
});

it('retains generic linked financial-cell formats and errors from the worker transfer', async () => {
  const executor = createWorkerExecutor('statement', () => new Boundary() as unknown as Worker);
  const values = { fiscal_year: 2026, fiscal_period: 'FY', revenue: 0.4, net_income: 40 };
  const dataset: WidgetDataset = { rows: [{ id: 'r0', values, cellFormats: { revenue: { formatterFn: 'normalizedPercent' } },
    cellErrors: { net_income: { code: 'scope', message: 'Upstream calculation refused this value' } } }],
    columns: Object.keys(values).map(id => ({ id, label: id })), resultRevision: 1, outputRevision: 1,
    provenance: { sourceWidgetId: 'statement' }, completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false } };
  const signal = new AbortController().signal;
  try {
    await executor.registerInput(dataset, 1, signal);
    await executor.applyModel({ table: {}, search: '' }, { kind: 'none' }, revision, signal);
    const snapshot = await loadStatementSnapshot(executor, revision, signal);
    const items = snapshot.statement?.sections.flatMap(section => section.items);
    expect(items?.find(item => item.field === 'revenue')).toHaveProperty('formats.0.formatterFn', 'normalizedPercent');
    expect(items?.find(item => item.field === 'net_income')).toHaveProperty('errors.0.message', 'Upstream calculation refused this value');
    expect(snapshot.statement?.rows.find(row => row['Line item'] === 'Net Income')?.FY2026).toBe('#ERROR: Upstream calculation refused this value');
  } finally { executor.dispose(); }
});
