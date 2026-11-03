// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import fixture from '../test/fixtures/market-time.json';
import {barTimeSeconds} from './marketTime';
import {seriesBars} from './liveChart';

describe('shared host/client timestamp conformance', () => {
  it.each(fixture.valid)('$input retains its instant or market-date label', ({input, wire}) => {
    expect(barTimeSeconds(input)).toBe(Date.parse(wire)/1000);
    const rows = seriesBars([{date:wire, open:1, high:1, low:1, close:1}]);
    expect(rows[0].time).toBe(barTimeSeconds(input));
  });
  it.each(fixture.invalid)('refuses %s', (input) => {
    expect(Number.isNaN(barTimeSeconds(input))).toBe(true);
  });
});
