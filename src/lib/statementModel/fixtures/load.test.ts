// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { STATEMENT_FIXTURES, statementFixture } from "./load";

describe("statement fixtures", () => {
  it("holds both backends' recordings", () => {
    expect(STATEMENT_FIXTURES.filter((f) => f.name.startsWith("libre/"))).toHaveLength(36);
    expect(STATEMENT_FIXTURES.filter((f) => f.name.startsWith("openbqYfinance/"))).toHaveLength(15);
  });

  it.each(STATEMENT_FIXTURES.map((f) => [f.name, f] as const))("%s says where it came from and carries rows", (_name, fixture) => {
    const p = fixture.provenance;
    expect(p.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const text of [p.symbol, p.provider, p.route, p.backend, p.backendVersion, p.params.period]) {
      expect(typeof text === "string" && text.length > 0).toBe(true);
    }
    expect(p.params.limit).toBeGreaterThan(0);
    expect(fixture.rows.length).toBeGreaterThan(0);
  });

  it("Libre's rows are wide and carry no symbol; openbq-yfinance's are long and do", () => {
    const wide = statementFixture("libre/wmt-yfinance-income-annual").rows[0];
    expect(Object.hasOwn(wide, "period_ending")).toBe(true);
    expect(Object.hasOwn(wide, "symbol")).toBe(false);
    const long = statementFixture("openbqYfinance/wmt-income-annual").rows[0];
    expect(long.symbol).toBe("WMT");
    expect(typeof long.line_item).toBe("string");
  });

  it("refuses a name it does not have", () => {
    expect(() => statementFixture("libre/nope")).toThrow(/No statement fixture/);
  });
});
