// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { pivotFoldWarnings, pivotValueKey } from "./pivotKeys";

describe("pivotValueKey", () => {
  it("distinguishes primitive types and escapes path separators", () => {
    expect(pivotValueKey(1)).not.toBe(pivotValueKey("1"));
    expect(pivotValueKey("a\u001fb")).not.toContain("\u001f");
    expect(pivotValueKey("a\u001fb")).not.toBe(`${pivotValueKey("a")}\u001f${pivotValueKey("b")}`);
  });
  it("warns once for unmarked legacy fold intent", () => {
    expect(pivotFoldWarnings({ enabled: true, grouping: ["g"], split: [], expanded: { old: false } })).toHaveLength(1);
    expect(pivotFoldWarnings({ enabled: true, grouping: ["g"], split: [], keyEncoding: "typed-v1", expanded: { [pivotValueKey(1)]: false } })).toEqual([]);
  });
  it("warns for malformed typed tuples but accepts canonical blank and special numbers", () => {
    const config = { enabled: true, grouping: ["g"], split: [], keyEncoding: "typed-v1" as const };
    for (const malformed of ['["number","1"]', '["boolean","true"]', '["blank","not-null"]',
      '["string",1]', '["bigint","01"]']) {
      expect(pivotFoldWarnings({ ...config, expanded: { [malformed]: false } })).toHaveLength(1);
    }
    for (const value of [null, NaN, Infinity, -Infinity]) {
      expect(pivotFoldWarnings({ ...config, expanded: { [pivotValueKey(value)]: false } })).toEqual([]);
    }
  });
});
