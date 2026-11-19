// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { datasetFromRows } from '../../localTableData';
import type { RecipeOptions } from './types';
import { buildYieldCurve } from './yieldCurve';

const context = { theme: 'dark', maxDecimals: 2, today: '2026-02-01' } as const;
const options = { version: 1, kind: 'yield-curve', fields: { date: 'date', maturity: 'maturity', rate: 'rate' } } satisfies RecipeOptions;
const friday = '2026-01-09';
const monday = '2026-01-12';
const row = (maturity: string, rate: number | null, date = friday) => ({ date, maturity, rate });
const source = (rows: ReturnType<typeof row>[]) => datasetFromRows(rows, 'rates', 1, 'localFile');

describe('buildYieldCurve', () => {
  it('plots numeric months in maturity order with normalized fractions', () => {
    const dataset = source([row('year_10', .04), row('month_1', .03), row('year_2', .035)]);
    const result = buildYieldCurve(dataset, options, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual([expect.objectContaining({
      type: 'scatter', name: friday, x: [1, 24, 120], y: [.03, .035, .04],
      text: ['1M: 3 %', '2Y: 3.5 %', '10Y: 4 %'],
    })]);
    expect(result.figure.layout.xaxis).toMatchObject({ type: 'linear', tickvals: [1, 24, 120], ticktext: ['1M', '2Y', '10Y'] });
    expect(result.figure.layout.yaxis).toMatchObject({ tickformat: '.2%' });
  });

  it('labels distinct observation dates and explains weekend requests resolving to one date', () => {
    const dataset = source([row('month_1', .03), row('month_1', .03), row('month_1', .04, monday)]);
    dataset.provenance.parameters = { date: '2026-01-10, 2026-01-11,2026-01-12' };
    const result = buildYieldCurve(dataset, options, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual([
      expect.objectContaining({ name: friday, y: [.03] }),
      expect.objectContaining({ name: monday, y: [.04] }),
    ]);
    expect(result.notes.join(' ')).toMatch(/2026-01-10.*2026-01-11.*2026-01-09/s);
    expect(result.notes.join(' ')).toContain('1 identical duplicate');
  });

  it('preserves missing grid tenors as gaps and counts unknown maturities', () => {
    const dataset = source([
      row('month_1', -.002), row('year_10', 0), row('<bad>', .01),
      row('month_1', .02, monday), row('year_2', .04, monday), row('year_10', null, monday),
    ]);
    const result = buildYieldCurve(dataset, options, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual([
      expect.objectContaining({ name: friday, x: [1, 24, 120], y: [-.002, null, 0], connectgaps: false }),
      expect.objectContaining({ name: monday, x: [1, 24, 120], y: [.02, .04, null], connectgaps: false }),
    ]);
    expect(result.notes.join(' ')).toContain('1 unknown maturity');
    expect(result.notes.join(' ')).toContain('2 missing tenor');
    expect(JSON.stringify(result.figure)).not.toContain('<bad>');
  });

  it('omits a conflicting date with a note and refuses when every date conflicts', () => {
    const conflicting = [row('year_10', .04), row('year_10', .05)];
    const result = buildYieldCurve(source([...conflicting, row('month_1', .03, monday)]), options, context);
    if (!result.ok) throw new Error(result.message);
    expect(result.figure.data).toEqual([expect.objectContaining({ name: monday, x: [1], y: [.03] })]);
    expect(result.notes.join(' ')).toMatch(/Conflicting duplicate.*2026-01-09/s);
    expect(buildYieldCurve(source(conflicting), options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringMatching(/Conflicting duplicate.*2026-01-09/s),
    });
  });

  it('requires fully loaded long observations and refuses without a finite rate', () => {
    const dataset = source([row('month_1', 0)]);
    dataset.completeness.kind = 'partial';
    expect(buildYieldCurve(dataset, options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringContaining('fully loaded'),
    });
    expect(buildYieldCurve(source([row('month_1', null)]), options, context)).toMatchObject({
      ok: false, refused: true, message: expect.stringContaining('No valid yield'),
    });
  });

  it('keeps revision when the returned observation date changes on refresh', () => {
    const dataset = source([row('month_1', .03)]);
    const refreshed = { ...source([row('month_1', .04, monday)]), outputRevision: 2, resultRevision: 2 };
    const first = buildYieldCurve(dataset, options, context);
    const second = buildYieldCurve(refreshed, options, context);
    refreshed.provenance.parameters = { date: '2026-01-12' };
    const changedQuestion = buildYieldCurve(refreshed, options, context);
    if (!first.ok || !second.ok || !changedQuestion.ok) throw new Error('Expected three valid figures');
    expect(second.revision).toBe(first.revision);
    expect(second.figure.layout.uirevision).toBe(first.revision);
    expect(second.figure.data).toEqual([expect.objectContaining({ name: monday, y: [.04] })]);
    expect(changedQuestion.revision).not.toBe(first.revision);
  });
});
