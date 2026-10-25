// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { IMPORT_MAX_BACKENDS } from "./importLimits";
import { connectionDetailsChanged, planBackendsImport } from "./backendsJson";
import type { BackendConfig } from "./types";

function backend(over: Partial<BackendConfig>): BackendConfig {
  return {
    id: "a",
    name: "A",
    baseUrl: "http://a.example",
    authLocation: "header",
    validateWidgets: true,
    ...over,
  };
}

const text = (v: unknown) => JSON.stringify(v);

describe("planBackendsImport", () => {
  it("replaces an existing connection by id and appends a new one, in file order", () => {
    const existing = [backend({ id: "a", name: "old A" }), backend({ id: "b", name: "B" })];
    const plan = planBackendsImport(
      text([
        { id: "a", name: "new A", baseUrl: "http://a2.example", headerValue: "s3cret" },
        { id: "c", name: "C", baseUrl: "http://c.example" },
      ]),
      existing,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends.map((b) => [b.id, b.name])).toEqual([
      ["a", "new A"],
      ["b", "B"],
      ["c", "C"],
    ]);
    // The credential travels with the file: that is the point of the export.
    expect(plan.backends[0].headerValue).toBe("s3cret");
    // Defaults filled on the way in, as loadBackends does, so an older file
    // yields complete configs.
    expect(plan.backends[2].authLocation).toBe("header");
    expect(plan.backends[2].validateWidgets).toBe(true);
    expect(plan.notice).toBe("Imported 2 connections (1 updated, 1 added).");
  });

  it("is idempotent: importing what is already there changes nothing and says so", () => {
    const existing = [backend({ id: "a" })];
    const plan = planBackendsImport(text(existing), existing);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends).toEqual(existing);
    expect(plan.notice).toBe("Imported 1 connection (1 updated, 0 added).");
  });

  it("collapses a duplicate id within the file to one row, the last one winning", () => {
    const existing = [backend({ id: "a" })];
    const plan = planBackendsImport(
      text([
        { id: "c", name: "C first", baseUrl: "http://c1.example" },
        { id: "a", name: "A again", baseUrl: "http://a.example" },
        { id: "c", name: "C last", baseUrl: "http://c2.example" },
      ]),
      existing,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends.map((b) => [b.id, b.name])).toEqual([
      ["a", "A again"],
      ["c", "C last"],
    ]);
    expect(plan.notice).toBe("Imported 2 connections (1 updated, 1 added).");
  });

  it("refuses text that is not JSON", () => {
    const plan = planBackendsImport("{nope", []);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusal).toMatch(/not JSON/i);
  });

  it("refuses a file that is not a list of connections, naming what it wanted", () => {
    // An apps.json picked by mistake is the likely case: same picker, same
    // extension.
    const plan = planBackendsImport(text([{ name: "Main", widgets: [] }]), []);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusal).toMatch(/backends\.json/);
    expect(plan.refusal).toMatch(/connections/i);
  });

  it("refuses the whole file when one entry is malformed, rather than importing the rest", () => {
    const plan = planBackendsImport(
      text([{ id: "a", name: "A", baseUrl: "http://a.example" }, { id: "b", name: 7 }]),
      [],
    );
    expect(plan.ok).toBe(false);
  });

  it("refuses an empty list: there is nothing to import, and it should not read as success", () => {
    const plan = planBackendsImport("[]", []);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusal).toMatch(/no connections/i);
  });

  // P3: the entry used to be replaced whole, so a file whose exporter held
  // the secret in memory only (same header, no value) erased this device's.
  it("keeps this device's secret when the file names the same header without a value", () => {
    const existing = [backend({ id: "a", headerName: "X-Key", headerValue: "mine", authLocation: "query", validateWidgets: false })];
    const plan = planBackendsImport(text([{ id: "a", name: "Renamed", baseUrl: "http://a.example", headerName: "X-Key" }]), existing);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends).toEqual([
      backend({ id: "a", name: "Renamed", headerName: "X-Key", headerValue: "mine", authLocation: "query", validateWidgets: false }),
    ]);
  });

  // Re-review: a file cannot say "cleared", so the merge must not resurrect
  // a credential or askOnStartup the exporting device cleared.
  it("clears the credential and askOnStartup when the file carries neither", () => {
    const existing = [backend({ id: "a", headerName: "Authorization", headerValue: "Basic x", askOnStartup: true })];
    const plan = planBackendsImport(text([{ id: "a", name: "A", baseUrl: "http://a.example" }]), existing);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends[0].headerName).toBeUndefined();
    expect(plan.backends[0].headerValue).toBeUndefined();
    expect(plan.backends[0].askOnStartup).toBeUndefined();
  });

  it("does not keep this device's secret under a different header name", () => {
    const existing = [backend({ id: "a", headerName: "X-Key", headerValue: "mine" })];
    const plan = planBackendsImport(text([{ id: "a", name: "A", baseUrl: "http://a.example", headerName: "Y-Key" }]), existing);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends[0]).toMatchObject({ headerName: "Y-Key" });
    expect(plan.backends[0].headerValue).toBeUndefined();
  });

  it("still takes every field the file does carry, a credential included", () => {
    const existing = [backend({ id: "a", headerName: "X-Key", headerValue: "mine", authLocation: "query" })];
    const plan = planBackendsImport(
      text([{ id: "a", name: "A", baseUrl: "http://b.example", headerName: "Y", headerValue: "theirs", authLocation: "cookie" }]),
      existing,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.backends[0]).toMatchObject({ baseUrl: "http://b.example", headerName: "Y", headerValue: "theirs", authLocation: "cookie" });
  });

  // P5: no ceiling, so 100k entries were accepted and probed.
  it("refuses a file holding more connections than the limit", () => {
    const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, baseUrl: "http://b.example" }));
    const over = planBackendsImport(text(entries(IMPORT_MAX_BACKENDS + 1)), []);
    expect(over).toEqual({ ok: false, refusal: "File holds 201 connections; the limit is 200." });
    expect(planBackendsImport(text(entries(IMPORT_MAX_BACKENDS)), []).ok).toBe(true);
  });
});

describe("connectionDetailsChanged", () => {
  it("is true for a changed address or credential, false for a rename", () => {
    const a = backend({ headerName: "X", headerValue: "k" });
    expect(connectionDetailsChanged(a, { ...a, name: "Other" })).toBe(false);
    for (const change of [{ baseUrl: "http://z" }, { headerName: "Y" }, { headerValue: "j" }, { authLocation: "query" as const }]) {
      expect(connectionDetailsChanged(a, { ...a, ...change })).toBe(true);
    }
  });
});
