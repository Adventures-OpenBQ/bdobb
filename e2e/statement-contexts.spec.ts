// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { seedCards } from './fixtures';

test('module worker refuses mixed Statement units and currency', async ({ page }) => {
  await seedCards(page, []);
  const cases = await page.evaluate(async () => {
    const fixturePath = '/src/lib/statementModel/compileFixtures.ts';
    const executorPath = '/src/lib/tableExecution/workerClient.ts';
    const { fixture } = await import(fixturePath);
    const { createWorkerExecutor } = await import(executorPath);
    const results = [];
    for (const field of ['currency', 'unit'] as const) {
      const f = fixture();
      f.statement.bindings.shape = 'long';
      f.statement.bindings.mappings = [];
      f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
      if (field === 'currency') f.statement.bindings.currencyFieldId = field;
      else f.statement.bindings.unitFieldId = field;
      const base = f.source.rows[0].values;
      f.source.rows = [
        { id: 'r', values: { ...base, item: f.ids.line('revenue'), amount: 100, [field]: field === 'currency' ? 'USD' : 'dollars' } },
        { id: 'c', values: { ...base, item: f.ids.line('cost_of_revenue'), amount: 60, [field]: field === 'currency' ? 'EUR' : 'millions' } }
      ];
      f.source.columns = Object.keys(f.source.rows[0].values).map(id => ({ id, label: id }));
      const executor = createWorkerExecutor('source');
      const signal = new AbortController().signal;
      try {
        await executor.registerInput(f.source, 1, signal);
        const preview: import('../src/lib/tableExecution/types').DefinitionPreview = await executor.previewDefinition({widgetId:'source', input:1, model:1, output:1}, {table:{}, search:'', analytical:f.statement}, signal);
        const col = preview.columns.find(c => c.measureId === f.ids.value)!;
        const row = preview.rows.find(r => r.groupPath?.at(-1)?.value === f.ids.line('calculated_gross_profit'))!;
        results.push({field, value:row.values[col.id], error:row.cellErrors?.[col.id]});
      } finally { executor.dispose(); }
    }
    return results;
  });
  for (const result of cases) {
    expect(result.error).toBeDefined();
    expect(result.value).not.toBe(40);
  }
});
