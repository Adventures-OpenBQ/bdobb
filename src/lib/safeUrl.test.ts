// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { safeUrl } from "./safeUrl";

describe("safeUrl", () => {
  it("accepts http and https", () => {
    expect(safeUrl("http://example.com/a?b=1")).toBe("http://example.com/a?b=1");
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("rejects javascript:", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects javascript: however it is cased or padded", () => {
    expect(safeUrl("  JaVaScRiPt:alert(1)")).toBeNull();
  });

  it("rejects data:", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects file:", () => {
    expect(safeUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects a relative path, which has no protocol to check", () => {
    expect(safeUrl("/api/v1/thing")).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeUrl("//example.com/x")).toBeNull();
  });

  it("rejects an unparseable string", () => {
    expect(safeUrl("http://")).toBeNull();
    expect(safeUrl("")).toBeNull();
  });
});
