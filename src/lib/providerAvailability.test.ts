// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { KeysRow } from "../components/renderers/KeysRenderer";
import {
  deriveProvider,
  filterProviders,
  sortProviders,
  summarize,
  type Provider,
} from "./providerAvailability";

const row = (r: Partial<KeysRow> & Pick<KeysRow, "provider" | "env_var" | "status">): KeysRow => r as KeysRow;

describe("deriveProvider — keyed providers", () => {
  it("set + no demo + result ok is available with Own key", () => {
    const p = deriveProvider(row({ provider: "FMP", env_var: "FMP_API_KEY", status: "set", test: { result: "ok", detail: "HTTP 200" } }));
    expect(p.category).toBe("available");
    expect(p.statusLabel).toBe("Available");
    expect(p.credential).toBe("own");
    expect(p.explanation).toBe("HTTP 200");
    expect(p.tested).toBe(true);
  });

  it("set + demo is attention with Demo access (Review Focus: demo is limited, not available)", () => {
    const p = deriveProvider(row({ provider: "AV", env_var: "AV_KEY", status: "set", demo: true, test: { result: "ok", detail: "" } }));
    expect(p.category).toBe("attention");
    expect(p.statusLabel).toBe("Demo access");
    expect(p.credential).toBe("demo");
  });

  it("a stale ok over a missing key is not_configured, never available (Review Focus)", () => {
    const p = deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "missing", test: { result: "ok", detail: "key accepted" } }));
    expect(p.category).toBe("not_configured");
    expect(p.statusLabel).toBe("Not configured");
    expect(p.credential).toBe("not_set");
  });

  it("set + auth_failed with no code uses the PROBE_RESULTS label", () => {
    const p = deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "set", test: { result: "auth_failed", detail: "HTTP 200, rejected by body" } }));
    expect(p.category).toBe("attention");
    expect(p.statusLabel).toBe("vendor rejected the key");
  });

  it("set + failure with a code uses the code label", () => {
    const p = deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "set", test: { result: "error", detail: "denied", code: "egress_policy_denied" } }));
    expect(p.statusLabel).toBe("Firewall blocked");
    expect(p.code).toBe("egress_policy_denied");
  });

  it("skipped and unrecognised results read Not checked with the right explanation (Review Focus)", () => {
    expect(deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "set" })).explanation).toBe("No test result yet");
    expect(deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "set", test: { result: "skipped", detail: "x" } })).explanation).toBe("Probe skipped");
    const weird = deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "set", test: { result: "weird", detail: "x" } }));
    expect(weird.category).toBe("not_checked");
    expect(weird.explanation).toBe("Result not recognised");
  });

  it("status unknown is Not checked / Credential state unreadable / Unknown credential", () => {
    const p = deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "unknown" }));
    expect(p.category).toBe("not_checked");
    expect(p.explanation).toBe("Credential state unreadable");
    expect(p.credential).toBe("unknown");
  });

  it("an unrecognised diagnostic code is dropped, not shown", () => {
    const p = deriveProvider(row({ provider: "P", env_var: "P_KEY", status: "set", test: { result: "error", detail: "x", code: "made_up" as never } }));
    expect(p.code).toBeUndefined();
    expect(p.statusLabel).toBe("vendor returned an error"); // falls back to the PROBE_RESULTS label
  });
});

describe("deriveProvider — keyless providers", () => {
  it("auth not_required + ok is available with None Required", () => {
    const p = deriveProvider(row({ provider: "yf", env_var: "YF", status: "empty", auth: "not_required", test: { result: "ok", detail: "passed" } }));
    expect(p.category).toBe("available");
    expect(p.credential).toBe("none_required");
    expect(p.keyRequired).toBe(false);
  });

  it("keyless with no credential is never not_configured (Review Focus)", () => {
    const p = deriveProvider(row({ provider: "feed", env_var: "FEED", status: "missing", auth: "not_required" }));
    expect(p.category).toBe("not_checked");
    expect(p.credential).toBe("none_required");
  });

  it("keyless failure with a code is attention with the code label; keyless skipped is Not checked", () => {
    const t = deriveProvider(row({ provider: "hist", env_var: "H", status: "empty", auth: "not_required", test: { result: "no_response", detail: "no response within 10 seconds", code: "connect_timeout" } }));
    expect(t.category).toBe("attention");
    expect(t.statusLabel).toBe("Timed out");
    const s = deriveProvider(row({ provider: "ref", env_var: "R", status: "empty", auth: "not_required", test: { result: "skipped", detail: "x" } }));
    expect(s.category).toBe("not_checked");
    expect(s.explanation).toBe("Probe skipped");
  });

  it("auth required maps keyRequired true; absent maps null", () => {
    expect(deriveProvider(row({ provider: "P", env_var: "P", status: "set", auth: "required" })).keyRequired).toBe(true);
    expect(deriveProvider(row({ provider: "P", env_var: "P", status: "set" })).keyRequired).toBeNull();
  });
});

describe("deriveProvider — amendment: optional, not_installed, checks", () => {
  it("optional with no key is keyless-category and reads Credential: Optional, never Not configured (Review Focus)", () => {
    const p = deriveProvider(row({ provider: "bls", env_var: "BLS_KEY", status: "empty", auth: "optional", test: { result: "ok", detail: "passed" } }));
    expect(p.category).toBe("available");
    expect(p.credential).toBe("optional");
    expect(p.keyRequired).toBe(false);
    const missing = deriveProvider(row({ provider: "cftc", env_var: "CFTC_KEY", status: "missing", auth: "optional" }));
    expect(missing.category).toBe("not_checked");
    expect(missing.credential).toBe("optional");
  });

  it("optional WITH a key set reads Own key (a set credential wins over the optional label)", () => {
    const p = deriveProvider(row({ provider: "econdb", env_var: "ECONDB_KEY", status: "set", auth: "optional", test: { result: "ok", detail: "" } }));
    expect(p.credential).toBe("own");
    expect(p.category).toBe("available");
  });

  it("a not_installed row is Not checked / Not installed, offers no Test, and identifies by provider_id", () => {
    const p = deriveProvider(row({ provider: "Congress", env_var: "CONGRESS_KEY", provider_id: "congress_gov", supported: false, status: "empty", test: { result: "skipped", detail: "n/a", code: "not_installed" } }));
    expect(p.category).toBe("not_checked");
    expect(p.statusLabel).toBe("Not installed");
    expect(p.explanation).toBe("Not installed on this backend");
    expect(p.testable).toBe(false);
    expect(p.id).toBe("congress_gov");
    expect(p.envVar).toBe("CONGRESS_KEY");
  });

  it("derivation stays on `test` (the worse): credential ok + connectivity timeout is Needs attention with the timeout label", () => {
    const p = deriveProvider(row({
      provider: "Hist",
      env_var: "HIST_KEY",
      status: "set",
      test: { result: "no_response", detail: "no response within 10 seconds", kind: "connectivity", code: "connect_timeout", checked_at: "2026-09-23T12:01:00Z" },
      checks: [
        { kind: "credential", result: "ok", detail: "vendor accepted the key", checked_at: "2026-09-23T12:01:00Z" },
        { kind: "connectivity", result: "no_response", detail: "no response within 10 seconds", code: "connect_timeout", checked_at: "2026-09-23T12:01:00Z" },
      ],
    }));
    expect(p.category).toBe("attention");
    expect(p.statusLabel).toBe("Timed out");
    expect(p.checks).toHaveLength(2);
  });
});

describe("summarize / filterProviders", () => {
  const derived = (): Provider[] => [
    deriveProvider(row({ provider: "A", env_var: "A", status: "set", test: { result: "ok", detail: "" } })), // available
    deriveProvider(row({ provider: "B", env_var: "B", status: "set", demo: true, test: { result: "ok", detail: "" } })), // attention
    deriveProvider(row({ provider: "C", env_var: "C", status: "missing" })), // not_configured
    deriveProvider(row({ provider: "D", env_var: "D", status: "set" })), // not_checked
    deriveProvider(row({ provider: "E", env_var: "E", status: "empty", auth: "not_required", test: { result: "ok", detail: "" } })), // available + none_required
  ];

  it("counts each category and counts none_required across the overlap", () => {
    const c = summarize(derived());
    expect(c).toEqual({ available: 2, attention: 1, not_configured: 1, not_checked: 1, none_required: 1 });
  });

  it("each filter selects its category; none_required selects keyRequired===false; all passes through", () => {
    const ps = derived();
    expect(filterProviders(ps, "all")).toHaveLength(5);
    expect(filterProviders(ps, "attention").map((p) => p.id)).toEqual(["B"]);
    expect(filterProviders(ps, "not_configured").map((p) => p.id)).toEqual(["C"]);
    expect(filterProviders(ps, "none_required").map((p) => p.id)).toEqual(["E"]);
  });
});

describe("sortProviders", () => {
  const mk = (name: string, id: string): Provider =>
    deriveProvider(row({ provider: name, env_var: id, status: "set", test: { result: "ok", detail: "" } }));

  it("numeric collation puts Provider 10 after Provider 9, tie-breaking by env_var (Review Focus)", () => {
    const rows = [mk("Provider 10", "P10"), mk("Provider 9", "P9"), mk("dup", "Z"), mk("dup", "A")];
    expect(sortProviders(rows, "name-asc").map((p) => p.id)).toEqual(["A", "Z", "P9", "P10"]);
  });

  it("name-desc reverses; it never mutates the input", () => {
    const rows = [mk("a", "a"), mk("b", "b")];
    const copy = [...rows];
    expect(sortProviders(rows, "name-desc").map((p) => p.name)).toEqual(["b", "a"]);
    expect(rows).toEqual(copy);
  });

  it("available-first and attention-first order by category then name", () => {
    const rows = [
      deriveProvider(row({ provider: "z", env_var: "z", status: "missing" })), // not_configured
      deriveProvider(row({ provider: "a", env_var: "a", status: "set", demo: true, test: { result: "ok", detail: "" } })), // attention
      deriveProvider(row({ provider: "m", env_var: "m", status: "set", test: { result: "ok", detail: "" } })), // available
    ];
    expect(sortProviders(rows, "available-first").map((p) => p.category)).toEqual(["available", "attention", "not_configured"]);
    expect(sortProviders(rows, "attention-first").map((p) => p.category)).toEqual(["attention", "not_configured", "available"]);
  });
});
