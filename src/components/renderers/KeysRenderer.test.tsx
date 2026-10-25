// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { isKeysPayload, keysRows, type DiagnosticCode, type KeyCheck, type KeysRow } from "./KeysRenderer";

function payload(rows: unknown[], tier = 1) {
  return { tier, rows };
}

describe("keys payloads", () => {
  it("is not a keys payload when it is not a keys response, or null", () => {
    expect(isKeysPayload({ results: [] })).toBe(false);
    expect(keysRows({ results: [] })).toBeNull();
    expect(keysRows(null)).toBeNull();
  });

  // The provider dashboard's byName calls localeCompare on provider and on
  // provider_id ?? env_var: a row whose fields are not strings threw there
  // and took the whole panel down.
  it("drops a null row and one whose provider, env_var or provider_id is not a string", () => {
    const rows = keysRows(
      payload([
        { provider: "FRED", env_var: "B", status: "set" },
        { provider: 7, env_var: "D", status: "set" },
        { provider: "Zed", status: "set" },
        { provider: "Quandl", env_var: "Q", provider_id: 9, status: "set" },
        null,
      ]),
    );
    expect(rows?.map((r) => r.provider)).toEqual(["FRED"]);
  });
});

describe("KeysRow contract", () => {
  it("accepts the extended optional fields", () => {
    const check: KeyCheck = { kind: "connectivity", result: "no_response", detail: "timeout", code: "connect_timeout", checked_at: "2026-09-23T18:30:00Z" };
    const row: KeysRow = {
      provider: "EODHD",
      env_var: "EODHD_API_KEY",
      provider_id: "eodhd",
      supported: true,
      status: "set",
      auth: "optional",
      test: { result: "ok", detail: "HTTP 200", kind: "credential" },
      checks: [check],
    };
    expect(keysRows({ tier: 3, rows: [row] })).toHaveLength(1);
    const code: DiagnosticCode = "not_installed";
    expect(code).toBe("not_installed");
  });
});
