// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { incomeEvidence, incomeRow } from '../../../test/fixtures/financialEvidence';
import weekBasedIncomeSnapshot from '../../../test/fixtures/weekBasedIncomeSnapshot.json';
import { ProviderBoundary } from '../../../test/tableProviderBoundary';
import { datasetFromBytes } from '../../localTableData';
import { intent } from '../../statementModel/testFixtures';
import { statementOwnedIds } from '../../statementModel/types';
import { createRustExecutor } from '../../tableExecution/rust/runtime';
import { appendSubset, beginSubset, commitSubset, type PendingInput } from '../../tableExecution/subsetTransfer';
import { createWorkerExecutor } from '../../tableExecution/workerClient';
import { buildIncomeSankey } from './incomeSankey';
import { incomeSankeyPeriodChoices, resolveIncomeSankeyInput } from './incomeSankeyInput';

const signal = new AbortController().signal;
const engines = [
  ['TypeScript', (id: string) => createWorkerExecutor(id, () => new ProviderBoundary('table.worker') as unknown as Worker)],
  ['compiled Rust', (id: string) => createRustExecutor(id, () => new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
const fields = ['revenue', 'cost_of_revenue', 'gross_profit', 'operating_income', 'income_before_tax', 'net_income', 'income_tax_expense'] as const;
const ids = statementOwnedIds({ id: 'income', version: '1.0.0' });

async function snapshot(change?: (s: ReturnType<typeof intent>, rows: Record<string, unknown>[], evidence: typeof incomeEvidence) => void) {
  const model = intent();
  model.bindings.periodKindFieldId = 'period_kind';
  model.bindings.fiscal = { companyFieldId: 'symbol', dateFieldId: 'period_ending', fiscalYearFieldId: 'display_year',
    periodStartFieldId: 'start', periodEndFieldId: 'end', periodKind: 'FY' };
  const rows: Record<string, unknown>[] = [{ ...incomeRow, display_year: 2029, start: '2026-01-01', end: '2026-12-31', net_income_to_common: 15 }];
  const evidence = structuredClone(incomeEvidence);
  model.bindings.mappings = fields.map(sourceFieldId => ({ sourceFieldId, lineId: ids.line(sourceFieldId) }));
  change?.(model, rows, evidence);
  const bytes = new TextEncoder().encode(JSON.stringify({ rows, chart_evidence: evidence, completeness: 'bounded' }));
  return { model, data: await datasetFromBytes('income.json', bytes, 'income', 1) };
}

async function present(make: (typeof engines)[number][1], f: Awaited<ReturnType<typeof snapshot>>, allPeriods = false) {
  const worker = make('income');
  try {
    const rev = { widgetId: 'income', input: 1, model: 1, output: 1 };
    await worker.registerInput(f.data, 1, signal);
    const view = await worker.applyModel({ table: {}, search: '', analytical: f.model }, { kind: 'none' }, rev, signal);
    const columns = view.columns.filter(column => column.measureId === ids.value);
    const data = await worker.chartData(rev, (allPeriods ? columns : columns.slice(0, 1)).map(column => column.id), signal);
    return { data, options: { version: 1, kind: 'income-sankey', periodColumn: columns[0]?.id ?? 'missing-period' } as const };
  } finally {
    worker.dispose();
  }
}

it.each(engines)('%s renamed_or_moved_line_keeps_origin', async (_, make) => {
  const fixture = await snapshot(model => {
    model.overrides.labels[ids.line('revenue')] = 'An unrelated display label';
    model.overrides.lineSection = { [ids.line('revenue')]: ids.section('Profit') };
  });
  expect(fixture.data.rows[0].values).toMatchObject({ symbol: 'HSBA.LSE', period_kind: 'FY' });
  const { data, options } = await present(make, fixture);
  expect(data.rows.find(row => row.groupPath?.[1]?.value === ids.line('revenue'))?.groupPath?.map(member => member.value))
    .toEqual([ids.section('Profit'), ids.line('revenue')]);
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({
    ok: true, issuer: 'HSBA.LSE', currency: 'USD', scale: { multiplier: 1000 },
    period: { end: '2026-06-30', kind: 'FY', fiscalYear: 2026 },
    anchors: {
      revenue: { value: 100, origin: { kind: 'reported', field: 'revenue', providerField: 'totalRevenue' } },
      net_income: { value: 20, origin: { kind: 'reported', field: 'net_income', providerField: 'netIncome' } },
    },
  });
});

function omitGrossProfit(model: ReturnType<typeof intent>, rows: Record<string, unknown>[], evidence: typeof incomeEvidence) {
  delete rows[0].gross_profit;
  model.bindings.mappings = model.bindings.mappings.filter(mapping => mapping.sourceFieldId !== 'gross_profit');
  evidence.periods[0].present_fields = evidence.periods[0].present_fields.filter(field => field !== 'gross_profit');
}

it.each(engines)('%s uses the installed calculated gross profit only with its presented inputs', async (_, make) => {
  const fixture = await snapshot(omitGrossProfit);
  const { data, options } = await present(make, fixture);
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({
    ok: true, anchors: { gross_profit: { value: 60, origin: { kind: 'calculated', formulaId: ids.formula('calculated_gross_profit') } } },
  });
  expect(incomeSankeyPeriodChoices(data)[0].issue).toBeUndefined();
  fixture.model.overrides.hiddenIds = [ids.line('cost_of_revenue')];
  const hidden = await present(make, fixture);
  expect(incomeSankeyPeriodChoices(hidden.data)[0].issue).toMatch(/gross profit/i);
  expect(resolveIncomeSankeyInput(hidden.data, hidden.options)).toMatchObject({ ok: false, refused: true });
});

it.each(engines)('%s edited_gross_profit_formula_refuses', async (_, make) => {
  const { data, options } = await present(make, await snapshot((model, rows, evidence) => {
    omitGrossProfit(model, rows, evidence);
    const original = model.template.lines.find(line => line.id === ids.line('calculated_gross_profit'))!.formula!;
    model.overrides.formulas = [{ ...original, ast: { kind: 'literal', value: 60 } }];
  }));
  expect(incomeSankeyPeriodChoices(data)[0].issue).toMatch(/gross profit/i);
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/gross profit/i) });
});

it.each(engines)('%s common_net_income_is_not_net_income', async (_, make) => {
  const { data, options } = await present(make, await snapshot(model => {
    model.bindings.mappings.find(mapping => mapping.lineId === ids.line('net_income'))!.sourceFieldId = 'net_income_to_common';
  }));
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/net income/i) });
});

it.each(engines)('%s limited_periods_not_truncated_lines', async (_, make) => {
  const { data, options } = await present(make, await snapshot());
  expect(data.rows.find(row => row.groupPath?.[1]?.value === ids.line('revenue'))?.groupPath?.[0]?.value).toBe(ids.section('Income'));
  expect(data.completeness.kind).toBe('bounded');
  expect(incomeSankeyPeriodChoices(data)).toEqual([{ columnId: options.periodColumn, end: '2026-06-30', kind: 'FY', fiscalYear: 2026, fiscalPeriod: 'FY' }]);
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({ ok: true, period: { end: '2026-06-30' } });
  const truncated = await present(make, await snapshot((_model, _rows, evidence) => {
    evidence.periods[0].record_coverage = 'unknown';
    Object.assign(evidence, { diagnostics: ['unknown_record_coverage'] });
  }));
  expect(resolveIncomeSankeyInput(truncated.data, truncated.options)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/whole|complete/i) });
});

it.each(engines)('%s leaves filtered optional lines unavailable without recovering hidden amounts', async (_, make) => {
  const { data, options } = await present(make, await snapshot(model => {
    model.checklists = [{ categoryId: ids.item, memberKeys: fields.filter(field => field !== 'cost_of_revenue' && field !== 'income_tax_expense').map(ids.line) }];
  }));
  const result = resolveIncomeSankeyInput(data, options);
  expect(result).toMatchObject({ ok: true, components: {}, notes: [expect.stringMatching(/cost of revenue/i), expect.stringMatching(/income tax expense/i)] });
  expect(incomeSankeyPeriodChoices(data)[0].issue).toBeUndefined();
  if (result.ok) expect(result.components).toEqual({});
});

it.each(engines)('%s rejects a required anchor hidden from a fully acquired period', async (_, make) => {
  const { data, options } = await present(make, await snapshot(model => {
    model.overrides.hiddenIds = [ids.line('gross_profit')];
  }));
  expect(incomeSankeyPeriodChoices(data)[0].issue).toMatch(/gross profit/i);
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/gross profit/i) });
});

it.each(engines)('%s refuses currency or scale supplied by a format or edited card', async (_, make) => {
  const { data, options } = await present(make, await snapshot());
  const unscaled = { ...data, provenance: { ...data.provenance,
    metadata: { ...data.provenance.metadata, financialEvidence: { ...incomeEvidence, scale: { status: 'unknown' } } } } };
  expect(resolveIncomeSankeyInput(unscaled, options)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/scale/i) });
  expect(resolveIncomeSankeyInput(data, { ...options, ...{ reportingCurrency: 'GBP', scale: 1 } }))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/unsupported/i) });
  expect(resolveIncomeSankeyInput({ ...data, provenance: { ...data.provenance, metadata: { financialEvidence: incomeEvidence } } }, options))
    .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/income statement/i) });
});

it.each(engines)('%s orders period defaults by actual ends and refuses a bucket containing two reports', async (_, make) => {
  const fixture = await snapshot((_model, rows, evidence) => {
    Object.assign(evidence, { requested_limit: 2, raw_count: 2, normalized_count: 2, delivered_count: 2 });
    const older = '2025-06-30';
    rows.push({ ...rows[0], period_ending: older, fiscal_year: 2025, start: '2025-01-01', end: '2025-12-31', display_year: 2030 });
    evidence.periods.push({ ...evidence.periods[0], period_end: older, fiscal_year: 2025 });
  });
  let all = await present(make, fixture, true);
  expect(incomeSankeyPeriodChoices(all.data).map(period => [period.end, period.columnId.includes('FY2029')]))
    .toEqual([['2026-06-30', true], ['2025-06-30', false]]);
  fixture.data.rows[1].values.display_year = 2029;
  all = await present(make, fixture, true);
  expect(incomeSankeyPeriodChoices(all.data)).toEqual([]);
  expect(resolveIncomeSankeyInput(all.data, all.options)).toMatchObject({ ok: false, refused: true });
});

it.each(engines)('%s retains acquired FQ and actual end without adopting a display quarter label', async (_, make) => {
  const fixture = await snapshot((model, rows, evidence) => {
    model.periodKind = 'FQ';
    Object.assign(model.bindings.fiscal, { periodKind: 'FQ', fiscalQuarterFieldId: 'display_quarter' });
    Object.assign(rows[0], { display_quarter: 3, start: '2026-04-01', end: '2026-06-30', fiscal_period: null });
    Object.assign(evidence, { period_kind: 'FQ' });
    Object.assign(evidence.periods[0], { period_kind: 'FQ', fiscal_period: null });
  });
  const { data, options } = await present(make, fixture);
  expect(resolveIncomeSankeyInput(data, options)).toMatchObject({
    ok: true, period: { kind: 'FQ', end: '2026-06-30', fiscalPeriod: null },
  });
});

it.each(engines)('%s refuses missing or conflicting compiler-bound issuer identity', async (_, make) => {
  for (const wrong of ['OTHER.US', null]) {
    const fixture = await snapshot();
    fixture.data.rows[0].values.symbol = wrong;
    const { data, options } = await present(make, fixture);
    expect(resolveIncomeSankeyInput(data, options)).toMatchObject({ ok: false, refused: true });
  }
});

it.each([
  { symbol: 'OTHER.US' }, { period_kind: 'FQ' }, { reporting_currency: 'GBP' },
  { scale_multiplier: 1 }, { net_income: null },
])('refuses snapshot rows that contradict the acquired statement facts %o', async conflict => {
  await expect(snapshot((_model, rows) => Object.assign(rows[0], conflict))).rejects.toThrow('Could not parse local table');
});

it.each(engines)('%s preserves compiler-proven income through a linked table that hides an optional line', async (_, make) => {
  const root = make('income'), child = make('linked');
  const { data, model } = await snapshot();
  try {
    const revision = { widgetId: 'income', input: 1, model: 1, output: 1 };
    await root.registerInput(data, 1, signal);
    await root.applyModel({ table: {}, search: '', analytical: model }, { kind: 'none' }, revision, signal);
    let transfer: PendingInput | undefined;
    for await (const batch of root.presented(revision, signal)) {
      transfer ??= beginSubset(batch.transferId, revision);
      appendSubset(transfer, batch);
    }
    const linked = commitSubset(transfer!);
    const childRevision = { ...revision, widgetId: 'linked' };
    const cost = linked.rows.find(row => row.groupPath?.[1]?.value === ids.line('cost_of_revenue'))!;
    await child.registerInput(linked, 1, signal);
    const shown = await child.applyModel({ table: {}, search: '' }, { kind: 'allMatching', excludedIds: [cost.id] }, childRevision, signal);
    const periodColumn = shown.columns.find(column => column.measureId === ids.value)!.id;
    const chart = await child.chartData(childRevision, [periodColumn], signal);
    const result = resolveIncomeSankeyInput(chart, { version: 1, kind: 'income-sankey', periodColumn });
    expect(result).toMatchObject({ ok: true, period: { end: '2026-06-30' }, anchors: { revenue: { value: 100 } } });
    if (result.ok) expect(result.components.cost_of_revenue).toBeUndefined();

    const derivedRevision = { ...childRevision, model: 2, output: 2 };
    await child.applyModel({ search: '', table: { pivot: { enabled: true, grouping: [periodColumn], split: [] } } },
      { kind: 'none' }, derivedRevision, signal);
    const derived = await child.chartData(derivedRevision, [], signal);
    expect(derived.provenance.metadata).toHaveProperty('financialEvidence');
    expect(derived.provenance.metadata).not.toHaveProperty('incomeChartProof');
  } finally {
    root.dispose();
    child.dispose();
  }
});

it.each(engines)('%s labels the week-based snapshot by its acquired kind and actual end', async (_, make) => {
  const fixture = await snapshot((model, rows, evidence) => {
    const record = weekBasedIncomeSnapshot.rows[0];
    model.periodKind = 'FQ';
    Object.assign(model.bindings.fiscal, { periodKind: 'FQ', fiscalQuarterFieldId: 'display_quarter' });
    rows[0] = { ...record, display_year: 2025, display_quarter: 4, start: '2024-11-03', end: record.period_ending };
    Object.assign(evidence, weekBasedIncomeSnapshot.chart_evidence);
  });
  const { data, options } = await present(make, fixture);
  expect(buildIncomeSankey(data, options, { theme: 'light', maxDecimals: 2, today: '2026-11-19' }))
    .toMatchObject({ ok: true, figure: { layout: { title: { text: 'HSBA.LSE · Income Sankey<br>FQ · 2025-02-01 · USD × 1000' } } } });
});
