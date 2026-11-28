// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Row } from "../../tableColumns";

/**
 * Recorded statement rows, for tests only. Each file is what one backend
 * answered for one request on the day named in its `_provenance`; nothing in
 * it was edited. `libre/` is Libre Terminal (OpenBB's yfinance and SEC
 * providers, wide rows); `openbqYfinance/` is openbq-yfinance (long rows).
 */
export type FixtureProvenance = {
  recorded: string;
  symbol: string;
  provider: string;
  route: string;
  params: { period: string; limit: number };
  backend: string;
  backendVersion: string;
};
export type StatementFixture = { name: string; provenance: FixtureProvenance; rows: Row[] };

const FILES = import.meta.glob<{ _provenance: FixtureProvenance; rows: Row[] }>("./*/*.json", { eager: true, import: "default" });

export const STATEMENT_FIXTURES: readonly StatementFixture[] = Object.entries(FILES)
  .map(([path, file]) => ({ name: path.slice(2, -".json".length), provenance: file._provenance, rows: file.rows }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** `libre/aapl-yfinance-income-annual`, or it throws: a test naming a missing fixture is a broken test. */
export function statementFixture(name: string): StatementFixture {
  const found = STATEMENT_FIXTURES.find((f) => f.name === name);
  if (!found) throw new Error(`No statement fixture named ${name}`);
  return found;
}
