// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { card } from '../../test/fixtures';
import { persistedCard, remapWidgetReferences } from './persistence';
it('keeps fiscal and docked parameter choices through saving and dashboard copies', () => {
  const original = card({ id: 'source', fiscalYearEnd: 9, hideTitleParams: true, paramsOpen: true, calendar: { mode: "paged", cursor: "2026-10-06" } });
  expect(persistedCard(original)).toMatchObject({ fiscalYearEnd: 9, hideTitleParams: true, paramsOpen: true, calendar: { mode: "paged", cursor: "2026-10-06" } });
  expect(remapWidgetReferences(original, new Map([['source', 'copy']]))).toMatchObject({ id: 'copy', fiscalYearEnd: 9, hideTitleParams: true, paramsOpen: true, calendar: { mode: "paged", cursor: "2026-10-06" } });
});
