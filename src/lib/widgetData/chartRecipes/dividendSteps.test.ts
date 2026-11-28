// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { clippedDividendEvidence, dividendEvidence, dividendRow, emptyDividendEvidence } from '../../../test/fixtures/financialEvidence';
import { datasetFromBytes, datasetFromRows } from '../../localTableData';
import { purgePlot, renderPlot } from '../../plotly';
import type { Row } from '../../tableColumns';
import type { WidgetDataset } from '../types';
import { backendFinancialResponse, financialProjectionProvenance, parseFinancialEvidence, type DividendFinancialEvidence } from './financialEvidence';
import { runRecipe } from './run';
import type { RecipeOptions, RecipeResult } from './types';

const context = { theme: 'light', maxDecimals: 2, today: '2026-05-10' } as const;
const options = { kind: 'dividend-steps', version: 1, instrument: 'SHEL.LSE',
  fields: { date: 'ex_dividend_date', amount: 'amount', currency: 'currency', frequency: 'frequency' } } satisfies RecipeOptions;
const first = '2026-01-01', second = '2026-02-12', third = '2026-05-10', fourth = '2026-06-30';
const clipped = parseFinancialEvidence(clippedDividendEvidence);
if (clipped?.kind !== 'dividends') throw new Error('Invalid clipped receipt fixture');

function event(ex_dividend_date: string, amount: number | null, values: Row = {}) {
  return { ...dividendRow, ex_dividend_date, amount, ...values };
}

function snapshot(rows: Row[], overrides: Partial<DividendFinancialEvidence> = {}) {
  const financialEvidence = parseFinancialEvidence({
    ...dividendEvidence, raw_count: rows.length, normalized_count: rows.length, delivered_count: rows.length,
    event_dates: [...new Set(rows.map(row => row.ex_dividend_date))], ...overrides,
  });
  if (!financialEvidence) throw new Error('Invalid fixture receipt');
  const result = datasetFromRows(rows, 'dividends', 1, 'localFile', undefined, [], { completeness: 'bounded', financialEvidence });
  expect(result.provenance.metadata?.financialEvidence).toEqual(financialEvidence);
  return result;
}

function filter(dataset: WidgetDataset, keep: string[]) {
  const rows = dataset.rows.filter(row => keep.includes(row.values.ex_dividend_date as string));
  return { ...dataset, rows, provenance: financialProjectionProvenance(dataset.provenance, rows, dataset.columns) };
}

function chart(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function history(dataset: WidgetDataset) {
  return chart(runRecipe(dataset, options, context));
}

function trace(mode: 'lines' | 'markers', x: (string | null)[], y: (number | null)[]) {
  return expect.objectContaining({ type: 'scatter', mode, x, y,
    ...(mode === 'lines' ? { line: expect.objectContaining({ shape: 'hv' }), connectgaps: false } : {}),
  });
}

describe('dividend steps', () => {
  it('holds through a missing event boundary and resumes from the next presented event', () => {
    const acquired = snapshot([event(third, 2), event(second, 99), event(first, 1)]);
    const result = history(filter(acquired, [first, third]));
    expect(result.figure.data).toEqual([
      trace('lines', [first, second], [1, 1]),
      trace('markers', [first, third], [1, 2]),
    ]);
    expect(result.notes.join(' ')).toMatch(/1 filtered or omitted/i);
    expect(JSON.stringify(result)).not.toContain('99');
  });

  it('held_level_ends_at_trailing_omission', () => {
    const acquired = snapshot([event(first, 1), event(second, 99)]);
    expect(history(filter(acquired, [first])).figure.data).toEqual([
      trace('lines', [first, second], [1, 1]),
      trace('markers', [first], [1]),
    ]);
  });

  it('inserts an explicit break between step runs', () => {
    const dayAfterGap = '2026-03-15';
    const acquired = snapshot([event(first, 1), event(second, 99), event(dayAfterGap, 3), event(third, 2)]);
    expect(history(filter(acquired, [first, dayAfterGap, third])).figure.data).toEqual([
      trace('lines', [first, second, null, dayAfterGap, third], [1, 1, null, 3, 2]),
      trace('markers', [first, dayAfterGap, third], [1, 3, 2]),
    ]);
  });

  it.each([null, -1, Infinity, NaN])('terminates the level at a presented invalid amount %s', badAmount => {
    const acquired = snapshot([event(first, 1), event(second, 99), event(third, 0)]);
    acquired.rows[1].values.amount = badAmount;
    const result = history(acquired);
    expect(result.figure.data).toEqual([
      trace('lines', [first, second], [1, 1]),
      trace('markers', [first, third], [1, 0]),
    ]);
    expect(result.notes.join(' ')).toMatch(/1 invalid amount/i);
  });

  it('keeps pre-normalization invalid dates as gaps without needing an unadjusted amount', () => {
    const acquired = snapshot([event(third, 0), event(first, 1)], {
      raw_count: 3, event_dates: [third, second, first], invalid_amount_dates: [second], diagnostics: ['invalid_amount'],
    });
    const result = history(filter(acquired, [first, third]));
    expect(result.figure.data).toEqual([
      trace('lines', [first, second], [1, 1]),
      trace('markers', [first, third], [1, 0]),
    ]);
    expect(result.notes.join(' ')).toMatch(/1 invalid amount, 0 filtered or omitted/i);
  });

  it('uses clean adjusted amounts, treats zero as real, and uses GBP payment currency with a GBX listing', () => {
    const acquired = snapshot([
      event(third, 0, { unadjusted_amount: 3, frequency: null, quote_currency: 'GBX' }),
      event(first, .2, { unadjusted_amount: .8, quote_currency: 'GBX' }),
      event(second, .25, { frequency: '<other>' }),
    ]);
    const result = history(acquired);
    expect(result.figure.data).toEqual([
      trace('lines', [first, second, third], [.2, .25, 0]),
      trace('markers', [first, second, third], [.2, .25, 0]),
    ]);
    const lineAndHover = JSON.stringify(result.figure);
    expect(lineAndHover).toContain('Special');
    expect(lineAndHover).toContain('Unknown');
    expect(lineAndHover).toContain('&lt;other&gt;');
    expect(lineAndHover).toContain('GBP');
    expect(lineAndHover).not.toMatch(/GBX|0\.8/);
    expect(result.notes.join(' ')).toMatch(/2026-01-01.*2026-06-30.*inclusive/i);
    expect(result.notes.join(' ')).toMatch(/observed.*2026-01-01.*2026-05-10/i);
    expect(result.notes.join(' ')).toContain('2026-11-19T16:00:00Z');
    expect(result.notes.join(' ')).toMatch(/distribution types.*special.*unknown/i);
  });

  it('does not extend into the future or start before the first valid payment', () => {
    const acquired = snapshot([event(fourth, 12), event(third, 0), event(second, .2)], {
      raw_count: 4, event_dates: [first, second, third, fourth], invalid_amount_dates: [first], diagnostics: ['invalid_amount'],
    });
    const result = history(acquired);
    expect(result.figure.data).toEqual([
      trace('lines', [second, third], [.2, 0]),
      trace('markers', [second, third], [.2, 0]),
    ]);
    expect(result.notes.join(' ')).toMatch(/1 scheduled\/future/i);
  });

  it('shows a single marker without inventing a step interval', () => {
    const result = history(snapshot([event(second, .2)]));
    expect(result.figure.data).toEqual([trace('markers', [second], [.2])]);
    expect(result.notes.join(' ')).toMatch(/no step interval/i);
  });

  it.each(['verified', 'unknown'] as const)('uses %s typed coverage from a matched HTTP acquisition', status => {
    const endpoint = '/api/v1/eodhd/equity/fundamental/dividends';
    const parameters = { chart_source: 'true', symbol: 'SHEL.LSE', start_date: first, end_date: fourth };
    const url = new URL(`https://example.test${endpoint}?${new URLSearchParams(parameters)}`);
    const rows = [dividendRow];
    const chart_evidence = status === 'verified' ? dividendEvidence : { ...dividendEvidence, diagnostics: ['unknown_coverage'], coverage: { status } };
    const matched = backendFinancialResponse({ results: rows, extra: { results_metadata: { chart_evidence } } }, url);
    expect(matched?.evidence).toEqual(chart_evidence);
    const acquired = datasetFromRows(rows, 'dividends', 1, 'backend', undefined, [], undefined, {
      endpoint, parameters, retrievedAt: Date.parse(dividendEvidence.retrieved_at), financialEvidence: matched?.evidence,
    });
    expect(acquired.completeness.kind).toBe('unknown');
    if (status === 'verified') expect(history(acquired).figure.data).toEqual([trace('markers', [second], [.2])]);
    else expect(runRecipe(acquired, options, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/coverage.*unknown/i) });
  });

  it('clears a previously rendered figure for a verified covered empty file without requiring absent columns', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      rows: [], completeness: 'bounded', chart_evidence: emptyDividendEvidence,
    }));
    const acquired = await datasetFromBytes('empty.json', bytes, 'dividends', 1);
    const result = history(acquired);
    expect(result.figure.data).toEqual([]);
    expect(result.notes.join(' ')).toMatch(/no dividend events were supplied.*2026-01-01.*2026-06-30/i);
  });

  it('refuses an empty result without verified acquisition evidence', () => {
    const result = runRecipe(datasetFromRows([], 'dividends', 1, 'backend'), options, context);
    expect(result).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/acquisition evidence/i) });
  });

  it('keeps an acquisition failure separate from the verified zero-event state', () => {
    const acquired = snapshot([], { payment_currencies: [] });
    acquired.freshness = { availability: 'error', stale: false, error: 'Server could not be reached.' };
    expect(runRecipe(acquired, options, context)).toMatchObject({ ok: false, message: expect.stringMatching(/server could not be reached/i) });
  });

  it.each([
    [snapshot([event(second, .2)], { diagnostics: ['unknown_coverage'], coverage: { status: 'unknown' } }), /coverage.*unknown/i],
    [snapshot([event(second, .2)], { requested_start: '2025-12-31', diagnostics: ['clipped_coverage'], coverage: clipped.coverage }), /coverage.*clipped/i],
    [snapshot([event(second, .2)], { requested_start: null, requested_end: null, diagnostics: ['unknown_coverage'], coverage: { status: 'unknown' } }), /explicit.*inclusive/i],
    [snapshot([event(second, .2)], { raw_count: 2, diagnostics: ['invalid_ex_date'], unsafe: { ...dividendEvidence.unsafe, invalid_ex_date: true } }), /invalid.*ex-dividend date/i],
    [snapshot([event(second, .2), event(second, .2)], { diagnostics: ['duplicate_ex_date'], duplicate_dates: [second] }), /multiple.*same ex-dividend date/i],
    [snapshot([event(second, .2)], { diagnostics: ['instrument_conflict'], unsafe: { ...dividendEvidence.unsafe, instrument_conflict: true } }), /conflicting.*instrument/i],
    [snapshot([event(second, .2)], { diagnostics: ['amount_basis_conflict'], unsafe: { ...dividendEvidence.unsafe, amount_basis_conflict: true } }), /conflicting.*amount basis/i],
    [snapshot([event(second, .2)], { payment_currencies: ['GBP', 'USD'], raw_count: 2,
      event_dates: [first, second], invalid_amount_dates: [first], diagnostics: ['currency_conflict', 'invalid_amount'], unsafe: { ...dividendEvidence.unsafe, currency_conflict: true } }), /conflicting.*payment currenc/i],
    [snapshot([event(second, .2, { currency: null })], { payment_currencies: [],
      diagnostics: ['unknown_payment_currency'], unsafe: { ...dividendEvidence.unsafe, unknown_payment_currency: true } }), /unknown.*payment currency/i],
    [snapshot([event('2025-12-31', .2)], { diagnostics: ['outside_requested_window'], unsafe: { ...dividendEvidence.unsafe, outside_requested_window: true } }), /outside.*window/i],
  ] satisfies [WidgetDataset, RegExp][])('refuses unsafe or unverified acquired data %#', (acquired, message) => {
    expect(runRecipe(acquired, options, context)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(message) });
  });

  it('refuses an unverifiable missing coordinate and distinguishes an entirely filtered history from an empty acquisition', () => {
    const acquired = snapshot([event(first, 1), event(second, 2)]);
    expect(runRecipe({ ...acquired, rows: [acquired.rows[0]] }, options, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/continuity.*unfiltered/i) });
    expect(runRecipe(filter(acquired, []), options, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/no usable historical.*2 filtered or omitted/i) });
  });

  it('refuses conflicting presented identity, currency and date cells', () => {
    const acquired = snapshot([event(second, .2, { symbol: 'SHEL.LSE' })]);
    expect(runRecipe(acquired, { ...options, instrument: 'BP.LSE' }, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/acquired instrument.*SHEL.LSE/i) });
    acquired.rows[0].values.symbol = 'BP.LSE';
    expect(runRecipe(acquired, options, context)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/presented.*instrument/i) });
    acquired.rows[0].values.symbol = 'SHEL.LSE';
    acquired.rows[0].values.currency = 'GBX';
    expect(runRecipe(acquired, options, context)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/presented.*payment currency/i) });
    acquired.rows[0].values.currency = 'GBP';
    acquired.rows[0].values.ex_dividend_date = '2026-02-12T12:00:00Z';
    expect(runRecipe(acquired, options, context)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/invalid.*ex-dividend date/i) });
  });

  it('refuses multiple presented rows on the same date even with a safe acquired receipt', () => {
    const acquired = snapshot([event(second, .2)]);
    acquired.rows.push(structuredClone(acquired.rows[0]));
    expect(runRecipe(acquired, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/multiple.*same ex-dividend date.*unambiguous/i),
    });
  });

  it('refuses raw unadjusted amount bindings, but accepts an alias of the canonical amount', () => {
    const acquired = snapshot([event(second, .2)]);
    expect(runRecipe(acquired, { ...options, fields: { ...options.fields, amount: 'unadjusted_amount' } }, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/split-adjusted amount/i) });
    acquired.rows[0].values.adjusted = .2;
    acquired.columns.push({ id: 'adjusted', label: 'Adjusted payment', sourceFieldId: 'amount' });
    expect(chart(runRecipe(acquired, { ...options, fields: { ...options.fields, amount: 'adjusted' } }, context)).figure.data)
      .toEqual([trace('markers', [second], [.2])]);
  });

  it.each([[Number.MAX_VALUE, 0], [0, Number.MIN_VALUE], [1e30, 1.0000000000000002e30]])('refuses Plotly-unsafe finite levels (%s, %s)', (a, b) => {
    const acquired = snapshot([event(first, a), event(second, b)]);
    expect(runRecipe(acquired, options, context)).toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/plot.*safely/i) });
  });

  it('gives large constant levels a usable axis without changing the original hover amounts', () => {
    const large = 1e30;
    const result = history(snapshot([event(first, large), event(second, large)]));
    expect(result.figure.data).toEqual([
      trace('lines', [first, second], [large, large]),
      trace('markers', [first, second], [large, large]),
    ]);
    const { range } = result.figure.layout.yaxis as { range: number[] };
    expect(range.map(value => value / large)).toEqual([expect.closeTo(.95, 14), expect.closeTo(1.05, 14)]);
  });

  it('autoscales the actual Plotly dividend axis around ordinary payments', async () => {
    const { figure } = history(snapshot([event(first, .2), event(second, .5)]));
    const node = document.body.appendChild(document.createElement('div'));
    try {
      await renderPlot(node, figure);
      const { _fullLayout } = node as HTMLDivElement & { _fullLayout: { yaxis: { range: [number, number] } } };
      const [low, high] = _fullLayout.yaxis.range;
      expect(low).toBeLessThan(.2);
      expect(high).toBeGreaterThan(.5);
      expect(high - low).toBeLessThan(.6);
    } finally {
      purgePlot(node);
      node.remove();
    }
  });

  it('keeps revision stable across viewport and same-question data refreshes', () => {
    const a = snapshot([event(second, .2)]);
    const b = snapshot([event(second, .4)], { retrieved_at: '2026-11-19T16:30:00Z' });
    const firstRevision = history(a).revision;
    expect(chart(runRecipe(b, options, { ...context, viewportWidth: 320 })).revision).toBe(firstRevision);
    expect(history({ ...a, provenance: { ...a.provenance, sourceWidgetId: 'other' } }).revision).not.toBe(firstRevision);
    expect(history(a).figure.layout.uirevision).toBe(firstRevision);
  });
});
