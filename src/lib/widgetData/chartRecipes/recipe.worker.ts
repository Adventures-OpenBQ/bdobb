// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { calendarDate } from './priceEvidence';
import { runRecipe } from './run';
import type { RecipeReply, RecipeRequest } from './workerClient';

self.onmessage = ({ data }: MessageEvent<RecipeRequest>) => {
  const { identity, dataset, options, context } = data;
  try {
    const result = runRecipe(dataset, options, context);
    if (result.ok && options.kind !== 'income-sankey' && options.kind !== 'bubble-regression'
      && options.kind !== 'dividend-steps' && ('periodEnd' in options.fields || 'date' in options.fields)) {
      const dateField = 'periodEnd' in options.fields ? options.fields.periodEnd : options.fields.date;
      let first: string | undefined, last: string | undefined;
      for (const row of dataset.rows) {
        const date = !row.cellErrors?.[dateField] && calendarDate(row.values[dateField]);
        if (!date) continue;
        if (!first || date < first) first = date;
        if (!last || date > last) last = date;
      }
      if (first && last) result.notes.push(`Presented observation dates: ${first} to ${last}.`);
    }
    self.postMessage({ ...identity, result } satisfies RecipeReply);
  } catch (error) {
    self.postMessage({ ...identity, error: error instanceof Error ? error.message : String(error) } satisfies RecipeReply);
  }
};
