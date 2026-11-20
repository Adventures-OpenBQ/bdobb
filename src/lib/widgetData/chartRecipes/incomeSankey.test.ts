// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from 'vitest';
import { incomeEvidence, incomeRow } from '../../../test/fixtures/financialEvidence';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { purgePlot, renderPlot } from '../../plotly';
import { intent } from '../../statementModel/testFixtures';
import { incomeStatementIds as ids } from '../../statementModel/incomeChartProof';
import { createWorkerExecutor } from '../../tableExecution/workerClient';
import type { WidgetDataset } from '../types';
import { buildIncomeFlows, type IncomeFlowGraph } from './incomeSankey';
import { resolveIncomeSankeyInput } from './incomeSankeyInput';
import { runRecipe } from './run';
import type { RecipeOptions } from './types';
import type { RecipeRequest } from './workerClient';

const context = { theme: 'light', maxDecimals: 2, today: '2026-11-19' } as const;
const revenue = 'revenue', gross = 'gross_profit', operating = 'operating_income', preTax = 'income_before_tax', net = 'net_income';

async function fixture(
  values: Partial<typeof incomeRow> = {},
  edit?: (model: ReturnType<typeof intent>, receipt: typeof incomeEvidence) => void,
) {
  const model = intent();
  model.bindings.periodKindFieldId = 'period_kind';
  model.bindings.fiscal = { companyFieldId: 'symbol', dateFieldId: 'period_ending', fiscalYearFieldId: 'fiscal_year', periodStartFieldId: 'start', periodEndFieldId: 'end', periodKind: 'FY' };
  const evidence = structuredClone(incomeEvidence);
  model.bindings.mappings = [...evidence.periods[0].present_fields, 'total_operating_expenses']
    .map(sourceFieldId => ({ sourceFieldId, lineId: ids.line(sourceFieldId) }));
  const row: Record<string, unknown> = { ...incomeRow, total_operating_expenses: 70, quote_currency: 'GBX', start: '2026-01-01', end: '2026-12-31', ...values };
  edit?.(model, evidence);
  for (const field of incomeEvidence.periods[0].present_fields) {
    if (!evidence.periods[0].present_fields.includes(field)) delete row[field];
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ rows: [row], chart_evidence: evidence, completeness: 'bounded' }));
  const source = await datasetFromBytes('income.json', bytes, 'income', 1);
  const worker = createWorkerExecutor('income', () => new ProviderBoundary('table.worker') as unknown as Worker);
  const signal = new AbortController().signal;
  const revision = { widgetId: 'income', input: 1, model: 1, output: 1 };
  try {
    await worker.registerInput(source, 1, signal);
    const view = await worker.applyModel({ table: {}, search: '', analytical: model }, { kind: 'none' }, revision, signal);
    const periodColumn = view.columns.find(column => column.measureId === ids.value)!.id;
    const dataset = await worker.chartData(revision, [periodColumn], signal);
    return { dataset, options: { version: 1, kind: 'income-sankey', periodColumn } as const };
  } finally {
    worker.dispose();
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function input({ dataset, options }: Fixture) {
  const result = resolveIncomeSankeyInput(dataset, options);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function graph(f: Fixture): IncomeFlowGraph {
  const result = buildIncomeFlows(input(f));
  if (!result.ok) throw new Error(result.message);
  for (const stage of result.stages) {
    const incoming = result.links.filter(link => link.target === stage.id).reduce((sum, link) => sum + link.value, 0);
    const outgoing = result.links.filter(link => link.source === stage.id).reduce((sum, link) => sum + link.value, 0);
    expect(incoming).toBe(outgoing);
    expect(stage.throughput).toBe(incoming);
  }
  expect(result.links.every(link => Number.isFinite(link.value) && link.value > 0)).toBe(true);
  return result;
}

function chart({ dataset, options }: Fixture, width = 390) {
  const result = runRecipe(dataset, options, { ...context, viewportWidth: width });
  if (!result.ok) throw new Error(result.message);
  return result;
}

function errorCell(f: Fixture, line: string) {
  const row = f.dataset.rows.find(row => row.groupPath?.[1]?.value === ids.line(line))!;
  row.cellErrors = { [f.options.periodColumn]: { code: 'fixture', message: 'Invalid source cell' } };
}

it('conserves the reported anchor path and uses the derived operating deduction with an ambiguous aggregate present', async () => {
  const f = await fixture();
  expect(f.dataset.rows.find(row => row.groupPath?.[1]?.value === ids.line('total_operating_expenses'))?.values[f.options.periodColumn]).toBe(70);
  const result = graph(f);
  expect(result.stages.map(stage => [stage.from, stage.to, stage.throughput])).toEqual([
    [revenue, gross, 100], [gross, operating, 60], [operating, preTax, 30], [preTax, net, 25],
  ]);
  expect(result.links.filter(link => link.kind === 'anchor').map(link => link.value)).toEqual([100, 60, 30, 25, 20]);
  expect(result.links.filter(link => link.kind !== 'anchor').map(link => [link.label, link.value])).toEqual([
    ['Cost of revenue', 40], ['Net operating deductions (derived)', 30],
    ['Net non-operating expense (derived)', 5], ['Income tax expense', 5],
  ]);
});

it('routes expense credits and signed adjustments at the corresponding junctions', async () => {
  const result = graph(await fixture({ cost_of_revenue: -20, gross_profit: 110, operating_income: 120,
    income_before_tax: 150, income_tax_expense: -10, net_income: 170 }));
  expect(result.stages.map(stage => [stage.residual, stage.throughput])).toEqual([[-10, 120], [10, 120], [30, 150], [10, 170]]);
  expect(result.links.filter(link => link.kind !== 'anchor').map(link => [link.label, link.value])).toEqual([
    ['Cost of revenue credit', 20], ['Gross profit adjustment (derived)', 10], ['Net operating credits (derived)', 10],
    ['Net non-operating income (derived)', 30], ['Income tax credit', 10], ['Tax reconciliation adjustment (derived)', 10],
  ]);
  expect(result.anchors.gross_profit.value).toBe(110);
  expect(result.anchors.income_before_tax.value).toBe(150);
});

it('leaves filtered and errored optional components unavailable with visible differences', async () => {
  const f = await fixture({}, model => { model.overrides.hiddenIds = [ids.line('cost_of_revenue')]; });
  errorCell(f, 'income_tax_expense');
  const result = graph(f);
  expect(result.links.every(link => link.kind !== 'component')).toBe(true);
  expect(result.stages.map(stage => stage.residual)).toEqual([-40, -30, -5, -5]);
  expect(chart(f).notes.join(' ')).toMatch(/cost of revenue is unavailable.*income tax expense is unavailable/i);
  expect(JSON.stringify(chart(f).figure)).toMatch(/adjustments and lines not shown/i);
});

it('retains the original zero anchors in status and omits zero-width links', async () => {
  const f = await fixture({ cost_of_revenue: 100, gross_profit: 0, operating_income: 0,
    income_before_tax: 0, income_tax_expense: 0, net_income: 0 });
  expect(graph(f).links.map(link => link.value)).toEqual([100, 100]);
  expect(chart(f).notes.join(' ')).toMatch(/gross profit.*0.*operating income.*0.*income before tax.*0.*net income.*0/i);
});

it.each([-1, NaN])('refuses a negative or nonfinite required anchor (%s)', async value => {
  const f = await fixture(value < 0 ? { net_income: value } : {});
  if (Number.isNaN(value)) errorCell(f, net);
  expect(runRecipe(f.dataset, f.options, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(/net income/i),
  });
});

it('shows the acquired fiscal period, statement currency, source scale and original values through the actual worker entry', async () => {
  const { dataset, options } = await fixture();
  const scope = { onmessage: undefined as ((event: { data: RecipeRequest }) => void) | undefined, postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  try {
    await import('./recipe.worker');
    const identity = { requestId: 17, sourceWidgetId: 'income', resultRevision: 1, outputRevision: 1 };
    scope.onmessage!({ data: structuredClone({ identity, dataset, options, context }) });
    const reply = structuredClone(scope.postMessage.mock.lastCall![0]);
    expect(reply).toMatchObject({ ...identity, result: { ok: true, figure: {
      data: [{ type: 'sankey', arrangement: 'fixed' }],
    } } });
    const { notes, figure } = reply.result;
    expect(notes.join(' ')).toMatch(/HSBA\.LSE.*FY.?2026.*2026-06-30.*USD.*1,?000/i);
    expect(JSON.stringify(figure)).toMatch(/100.*USD/);
    expect(JSON.stringify(figure)).not.toContain('GBX');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('uses typed calculated gross profit and template IDs even when the table moves or relabels the lines', async () => {
  const f = await fixture({}, (model, receipt) => {
    receipt.periods[0].present_fields = receipt.periods[0].present_fields.filter(field => field !== gross);
    model.bindings.mappings = model.bindings.mappings.filter(mapping => mapping.sourceFieldId !== gross);
    model.overrides.labels[ids.line(revenue)] = 'Unrelated <b>table label</b>';
    model.overrides.lineSection = { [ids.line(revenue)]: ids.section('Profit') };
  });
  expect(graph(f).anchors.gross_profit.origin).toMatchObject({
    kind: 'calculated', formulaId: ids.formula('calculated_gross_profit'),
  });
  expect(chart(f).notes.join(' ')).toMatch(/gross profit.*calculated/i);
  expect(JSON.stringify(chart(f))).not.toContain('Unrelated');
});

it.each([
  ['scale', (f: Fixture) => Object.assign(receiptOf(f.dataset), { scale: { status: 'unknown' } })],
  ['scale', (f: Fixture) => Object.assign(receiptOf(f.dataset).unsafe, { scale_conflict: true })],
  ['period', (f: Fixture) => Object.assign(receiptOf(f.dataset), { period_kind: 'FQ', periods: receiptOf(f.dataset).periods.map(period => ({ ...period, period_kind: 'FQ', fiscal_period: null })) })],
] as const)('refuses conflicting or unknown %s evidence', async (reason, edit) => {
  const f = await fixture();
  edit(f);
  expect(runRecipe(f.dataset, f.options satisfies RecipeOptions, context)).toMatchObject({
    ok: false, refused: true, message: expect.stringMatching(reason === 'period' ? /statement|period/i : /scale/i),
  });
});

function receiptOf(dataset: WidgetDataset) {
  return dataset.provenance.metadata!.financialEvidence as typeof incomeEvidence;
}

it('keeps a whole source unit at the waterfall cancellation boundary', async () => {
  const f = await fixture({ revenue: 4e15, gross_profit: 3e15, cost_of_revenue: 1e15 + 1,
    operating_income: 3e15, income_before_tax: 3e15, net_income: 3e15, income_tax_expense: 0 });
  const result = graph(f);
  expect(result.stages[0].residual).toBe(1);
  expect(result.links).toContainEqual(expect.objectContaining({ kind: 'residual', value: 1 }));
  expect(chart(f).notes.join(' ')).toMatch(/adjustment.*1 USD/i);
});

it('suppresses cancellation-sized noise without changing the reported anchors', async () => {
  const result = buildIncomeFlows(input(await fixture({ revenue: .3, cost_of_revenue: .1, gross_profit: .2,
    operating_income: .2, income_before_tax: .2, net_income: .2, income_tax_expense: 0 })));
  expect(result).toMatchObject({ ok: true, stages: [{ residual: 0 }, { residual: 0 }, { residual: 0 }, { residual: 0 }],
    anchors: { gross_profit: { value: .2 } } });
});

it('reconciles ordinary fractional bridge amounts at their original numeric precision', async () => {
  const result = graph(await fixture({ revenue: 100, cost_of_revenue: 22.8, gross_profit: 77.2,
    operating_income: 10.1, income_before_tax: 9.2, income_tax_expense: 2.2, net_income: 7 }));
  expect(result.stages[1].residual).toBeCloseTo(-67.1, 12);
  expect(result.anchors.operating_income.value).toBe(10.1);
});

it('uses a reversible binary display scale for large but proportionate flows', async () => {
  const f = await fixture({ revenue: 1e300, gross_profit: 6e299, cost_of_revenue: 4e299, operating_income: 3e299,
    income_before_tax: 3e299, net_income: 3e299, income_tax_expense: 0 });
  const result = buildIncomeFlows(input(f));
  if (!result.ok) throw new Error(result.message);
  expect(result.displayScale).toBeGreaterThan(1);
  for (const link of result.links) expect(link.value / result.displayScale * result.displayScale).toBe(link.value);
  expect(JSON.stringify(chart(f).figure)).toContain('1e+300');
});

it.each([
  { revenue: Number.MAX_VALUE, cost_of_revenue: -Number.MAX_VALUE },
  { revenue: 1e300, gross_profit: 1e-300, cost_of_revenue: 1e300 },
  { revenue: 1e200, gross_profit: 1e100, cost_of_revenue: 1e200 },
])('refuses overflow and indistinguishable positive flow widths', async values => {
  const f = await fixture(values);
  expect(buildIncomeFlows(input(f))).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/reconcile|display/i) });
});

it.each([390, 900])('draws finite forward links with visible ordinary branches in actual Plotly at %s px', async width => {
  const f = await fixture({ income_tax_expense: -5, net_income: 32 });
  const { figure } = chart(f, width);
  const node = document.body.appendChild(document.createElement('div'));
  node.style.width = `${width}px`;
  try {
    await renderPlot(node, figure);
    const trace = node.querySelector('.sankey')!;
    expect(trace).not.toBeNull();
    expect(trace.querySelectorAll('.sankey-link')).toHaveLength(10);
    const nodes = [...trace.querySelectorAll('.sankey-node')];
    const plotHeight = (figure.layout.height as number) - 74;
    const plotWidth = (width - 20) * ((width < 540 ? .48 : .62) - .025);
    for (const [index, el] of nodes.entries()) {
      const { node: band } = (el as Element & {
        __data__: { node: { x0: number; x1: number; y0: number; y1: number } };
      }).__data__;
      // The x-axis of Plotly's internal flow geometry is the screen's vertical axis.
      expect((band.x0 + band.x1) / 2).toBeCloseTo((index + .5) / nodes.length * plotHeight, 6);
      expect(band.y0).toBeGreaterThanOrEqual(-1e-9);
      expect(band.y1).toBeLessThanOrEqual(plotWidth + 1e-9);
      expect(el.querySelector('text')?.getAttribute('style')).not.toContain('text-shadow');
    }

    for (const el of trace.querySelectorAll<SVGPathElement>('.sankey-link')) {
      expect(el.getAttribute('d')).toMatch(/^M/);
      expect(el.getAttribute('d')).not.toMatch(/NaN|Infinity/);
      const datum = (el as SVGPathElement & { __data__: { link: { source: { x1: number }; target: { x0: number }; width: number } } }).__data__.link;
      expect(datum.width).toBeGreaterThan(0);
      expect(datum.source.x1).toBeLessThan(datum.target.x0);
    }
    expect(node.textContent).toMatch(/Income tax credit/);
    expect(node.textContent).toMatch(/Tax reconciliation adjustment/);
    const paths = [...trace.querySelectorAll('.sankey-link')];
    const adjustment = paths.find(path => (path as Element & { __data__: { link: { label: string } } }).__data__.link.label.startsWith('Tax reconciliation adjustment'))!;
    const { customdata } = (adjustment as Element & { __data__: { link: { customdata: string } } }).__data__.link;
    expect(customdata).toMatch(/Tax reconciliation adjustment.*Derived change 2 USD × 1000/i);
    expect(chart(f, width).revision).toBe(chart(f, 500).revision);
  } finally {
    purgePlot(node);
    node.remove();
  }
});
