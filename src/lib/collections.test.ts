// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { withOptional } from "./collections";

describe("withOptional", () => {
  it("sets the key on a copy, and deletes it -- absent, not undefined -- for undefined", () => {
    const o: { a: number; b?: string } = { a: 1, b: "x" };
    expect(withOptional(o, "b", "y")).toEqual({ a: 1, b: "y" });
    const cleared = withOptional(o, "b", undefined);
    expect("b" in cleared).toBe(false);
    expect(o).toEqual({ a: 1, b: "x" });
  });
});
