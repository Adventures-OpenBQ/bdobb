// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import { buildEstimateRange, estimateRangeIdentityFields } from './estimateRange';
import type { RecipeOptions, RecipeResult } from './types';

const context = { theme: 'dark', maxDecimals: 2, today: '2026-11-19' } as const;
const eps = {
  version: 1, kind: 'estimate-range', metric: 'eps',
  fields: {
    periodEnd: 'period_ending', fiscalPeriod: 'fiscal_period', status: 'band_status',
    note: 'band_note', low: 'eps_low', average: 'eps_avg', high: 'eps_high',
  },
} satisfies RecipeOptions;
const revenue = {
  ...eps,
  metric: 'revenue',
  fields: { ...eps.fields, low: 'revenue_low', average: 'revenue_avg', high: 'revenue_high' },
} satisfies RecipeOptions;
const q3 = '2026-06-27', q4 = '2026-09-26', q1 = '2026-12-26';
const row = (date = q4, fiscal: string | null = 'FQ4 2026') => ({
  symbol: 'AAPL', period_ending: date, fiscal_period: fiscal, band_status: 'ok', band_note: null as string | null,
  eps_low: -2 as number | null, eps_avg: -1 as number | null, eps_high: .5 as number | null,
  revenue_low: 1e9, revenue_avg: 2e9, revenue_high: 3e9,
});
const source = (rows: Parameters<typeof datasetFromRows>[0]) => datasetFromRows(rows, 'estimates', 1, 'localFile');

function chart(result: RecipeResult) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('buildEstimateRange', () => {
  it('draws negative EPS bounds and a distinct average on chronologically ordered fiscal quarters', () => {
    const dataset = source([row(), row(q3, 'FQ3 2026')]);
    // These individual records do not need daily price coverage.
    dataset.completeness.kind = 'unknown';
    const { figure } = chart(buildEstimateRange(dataset, eps, context));

    expect(figure.data).toEqual([
      expect.objectContaining({
        type: 'scatter', mode: 'lines+markers', connectgaps: false,
        x: [-2, .5, null, -2, .5], y: [q3, q3, null, q4, q4],
        customdata: expect.arrayContaining([expect.arrayContaining(['FQ4 2026', q4])]),
      }),
      expect.objectContaining({ type: 'scatter', mode: 'markers', x: [-1, -1], y: [q3, q4] }),
    ]);
    expect(figure.layout.yaxis).toMatchObject({ type: 'category', tickvals: [q3, q4], ticktext: ['FQ3 2026', 'FQ4 2026'] });
    expect(figure.layout.xaxis).toMatchObject({ title: { text: 'EPS' } });
  });

  it('withholds flagged ranges even if all three estimate cells contain finite numbers', () => {
    const dataset = source([
      { ...row(), band_status: 'withheld', band_note: 'Consensus mismatch.' },
      row(q3, 'FQ3 2026'),
      { ...row(q1, 'FQ1 2027'), band_status: 'no_estimate' },
    ]);
    const { figure, notes } = chart(buildEstimateRange(dataset, eps, context));

    expect(figure.data[0]).toMatchObject({ x: [-2, .5], y: [q3, q3] });
    expect(figure.data[1]).toMatchObject({ x: [-1], y: [q3] });
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/FQ4 2026.*2026-09-26.*withheld.*Consensus mismatch/i),
      expect.stringMatching(/FQ1 2027.*2026-12-26.*no estimate/i),
    ]));
  });

  it.each([
    { patch: { eps_low: 1 }, reason: /low.*average.*high/i },
    { patch: { eps_avg: null }, reason: /finite/i },
    { patch: { eps_high: Infinity }, reason: /finite/i },
    { patch: { band_status: 'OK' }, reason: /provider.*status/i },
  ])('omits an invalid provider band $patch and keeps the other quarter', ({ patch, reason }) => {
    const dataset = source([{ ...row(), ...patch }, row(q3, 'FQ3 2026')]);
    const { figure, notes } = chart(buildEstimateRange(dataset, eps, context));
    expect(figure.data[0]).toMatchObject({ y: [q3, q3] });
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining(q4), expect.stringMatching(reason)]));
  });

  it('reports the period end directly when the provider fiscal quarter is unavailable', () => {
    const dataset = source([row(q4, null), row(q3, 'unknown')]);
    const { figure, notes } = chart(buildEstimateRange(dataset, eps, context));

    expect(figure.layout.yaxis).toMatchObject({ ticktext: [q3, q4] });
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/2026-06-27.*fiscal quarter unavailable/i),
      expect.stringMatching(/2026-09-26.*fiscal quarter unavailable/i),
    ]));
  });

  it('omits an explicitly annual label without substituting its date for a quarter', () => {
    const dataset = source([row(q4, 'FY2026'), row(q3, 'FQ3 2026')]);
    const { figure, notes } = chart(buildEstimateRange(dataset, eps, context));
    expect(figure.data[0]).toMatchObject({ y: [q3, q3] });
    expect(notes).toEqual(expect.arrayContaining([expect.stringMatching(/FY2026.*2026-09-26.*annual/i)]));
  });

  it('returns the named withheld reasons when no period qualifies', () => {
    const dataset = source([
      { ...row(), band_status: 'withheld', band_note: 'Consensus mismatch.' },
      { ...row(q3, null), band_status: 'no_estimate' },
    ]);

    expect(buildEstimateRange(dataset, eps, context)).toMatchObject({
      ok: false, refused: true,
      message: expect.stringMatching(/no valid.*2026-06-27.*no estimate.*FQ4 2026.*withheld.*Consensus mismatch/i),
    });
  });

  it('uses revenue bounds on their own axis and rejects a binding to the other metric', () => {
    const dataset = source([row()]);
    const { figure } = chart(buildEstimateRange(dataset, revenue, context));

    expect(figure.data[0]).toMatchObject({ x: [1e9, 3e9] });
    expect(figure.data[1]).toMatchObject({ x: [2e9] });
    expect(figure.layout.xaxis).toMatchObject({ title: { text: 'Revenue' } });
    expect(buildEstimateRange(dataset, { ...revenue, fields: { ...revenue.fields, low: 'eps_low' } }, context))
      .toMatchObject({ ok: false, refused: true, message: expect.stringMatching(/revenue/i) });
  });

  it('does not merge conflicting rows for the same period end or fiscal identity', () => {
    const rows = [
      row(q3, 'FQ3 2026'), row(q3, 'FQ3 2026'), { ...row(q3, 'FQ3 2026'), eps_avg: 0 },
      row(), row('2026-09-30', 'FY2026-Q4'), row(q1, 'FQ1 2027'),
    ];
    const { figure, notes } = chart(buildEstimateRange(source(rows), eps, context));
    expect(figure.data[0]).toMatchObject({ y: [q1, q1] });
    expect(notes.join(' ')).toMatch(/conflict.*2026-06-27/i);
    expect(notes.join(' ')).toMatch(/conflict.*2026-09-26.*2026-09-30/i);
  });

  it('reports the provider withholding reason when an approved duplicate conflicts', () => {
    const dataset = source([
      row(), { ...row(), band_status: 'withheld', band_note: 'Consensus mismatch.' },
      row(q3, 'FQ3 2026'),
    ]);
    const { figure, notes } = chart(buildEstimateRange(dataset, eps, context));

    expect(figure.data[0]).toMatchObject({ y: [q3, q3] });
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/FQ4 2026.*2026-09-26.*withheld.*Consensus mismatch/i),
    ]));
  });

  it('collapses identical duplicate periods instead of plotting them twice', () => {
    const { figure, notes } = chart(buildEstimateRange(source([row(), row()]), eps, context));
    expect(figure.data[0]).toMatchObject({ y: [q4, q4] });
    expect(notes.join(' ')).toMatch(/duplicate.*2026-09-26/i);
  });

  it('refuses instruments or units that differ across periods even when there are no duplicate dates', () => {
    const mixedSymbols = source([row(), { ...row(q3, 'FQ3 2026'), symbol: 'MSFT' }]);
    const mixedCurrencies = source([
      { ...row(), currency: 'USD' }, { ...row(q3, 'FQ3 2026'), currency: 'EUR' },
    ]);
    const mismatchedUnits = source([row()]);
    mismatchedUnits.columns.find(c => c.id === 'eps_low')!.metadata = { unit: 'dollars per share' };
    mismatchedUnits.columns.find(c => c.id === 'eps_high')!.metadata = { unit: 'cents per share' };

    expect(buildEstimateRange(mixedSymbols, eps, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/one instrument/i),
    });
    for (const dataset of [mixedCurrencies, mismatchedUnits]) {
      expect(buildEstimateRange(dataset, eps, context)).toMatchObject({
        ok: false, refused: true, message: expect.stringMatching(/consistent.*(currency|unit)/i),
      });
    }
  });

  it('requires single-instrument evidence when chart projection hides the symbol', () => {
    const { symbol, ...values } = row();
    const projected = { ...source([values]), kind: 'chartData' };
    expect(buildEstimateRange(projected, eps, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/single.*symbol/i),
    });
    projected.provenance.parameters = { symbol: symbol.toLowerCase() };
    expect(buildEstimateRange(projected, eps, context).ok).toBe(true);
    projected.provenance.receipt = { symbol: 'MSFT' };
    expect(buildEstimateRange(projected, eps, context)).toMatchObject({ ok: false, refused: true });

    expect(estimateRangeIdentityFields([
      { id: 'Ticker', label: 'Security' }, { id: 'report_currency', label: 'Currency', sourceFieldId: 'currency' },
      { id: 'unit', label: 'Unit' }, { id: 'price', label: 'Price' },
    ])).toEqual(['Ticker', 'report_currency', 'unit']);
  });

  it('requires raw provider approval for every guarded band', () => {
    const dataset = source([row()]);
    dataset.columns.find(c => c.id === 'band_status')!.analytical = {
      kind: 'formula', name: 'Always OK', definitionId: 'formula-status', scope: 'source',
    };
    expect(buildEstimateRange(dataset, eps, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/raw.*guarded/i),
    });
  });

  it('requires the provider band status when a projection omits the actual guard', () => {
    const dataset = { ...source([{ ...row(), band_status: 'withheld', quality_status: 'ok' }]), kind: 'chartData' };
    dataset.columns = dataset.columns.filter(column => column.id !== 'band_status');
    delete dataset.rows[0].values.band_status;
    const options = { ...eps, fields: { ...eps.fields, status: 'quality_status' } };

    expect(buildEstimateRange(dataset, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/provider.*band_status/i),
    });
  });

  it('refuses an unrelated finite field in the estimate bounds', () => {
    const dataset = source([{ ...row(), volume: -3 }]);
    const options = { ...eps, fields: { ...eps.fields, low: 'volume' } };

    expect(buildEstimateRange(dataset, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/low.*EPS/i),
    });
  });

  it('uses source identity ahead of the presented field name', () => {
    const dataset = source([row()]);
    dataset.columns.find(column => column.id === 'band_status')!.sourceFieldId = 'quality_status';

    expect(buildEstimateRange(dataset, eps, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/provider.*band_status/i),
    });

    dataset.columns.find(column => column.id === 'band_status')!.sourceFieldId = 'band_status';
    dataset.columns.find(column => column.id === 'eps_low')!.sourceFieldId = 'volume';
    expect(buildEstimateRange(dataset, eps, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/low.*EPS/i),
    });
  });

  it('accepts renamed fields backed by the provider guard and bound identities', () => {
    const values = {
      symbol: 'AAPL', period_ending: q4, fiscal_period: 'FQ4 2026', band_note: null,
      guard: 'ok', lower: -2, midpoint: -1, upper: .5,
    };
    const dataset = source([values]);
    const aliases: Record<string, string> = { guard: 'band_status', lower: 'eps_low', midpoint: 'EPS_AVERAGE', upper: 'eps_high' };
    for (const column of dataset.columns) if (aliases[column.id]) column.sourceFieldId = aliases[column.id];
    const options = { ...eps, fields: { ...eps.fields, status: 'guard', low: 'lower', average: 'midpoint', high: 'upper' } };

    const { figure } = chart(buildEstimateRange(dataset, options, context));
    expect(figure.data[0]).toMatchObject({ x: [-2, .5], y: [q4, q4] });
    expect(figure.data[1]).toMatchObject({ x: [-1], y: [q4] });
  });

  it('checks cell errors without discarding another valid reported quarter', () => {
    const dataset = source([row(), row(q3, 'FQ3 2026')]);
    dataset.rows[0].cellErrors = { eps_avg: { code: 'VALUE_ERROR', message: 'Invalid value' } };
    const { figure } = chart(buildEstimateRange(dataset, eps, context));
    expect(figure.data[0]).toMatchObject({ y: [q3, q3] });
  });

  it('keeps the question revision on refresh and changes it when the metric changes', () => {
    const initial = chart(buildEstimateRange(source([row()]), eps, context));
    const refreshed = chart(buildEstimateRange({
      ...source([{ ...row(), eps_avg: 0 }, row(q3, 'FQ3 2026')]),
      resultRevision: 2, outputRevision: 2,
    }, eps, { ...context, theme: 'light', maxDecimals: 3 }));
    const otherMetric = chart(buildEstimateRange(source([row()]), revenue, context));

    expect(refreshed.figure.data[1]).toMatchObject({ x: [-1, 0] });
    expect(refreshed.revision).toBe(initial.revision);
    expect(refreshed.figure.layout.uirevision).toBe(initial.revision);
    expect(otherMetric.revision).not.toBe(initial.revision);
  });
});
