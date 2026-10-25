// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// The conformance suite: BDOBB's client code against OpenBB's own reference
// backend, which is the spec's implementation rather than our reading of it.
//
//   pnpm reference-backend      # in another terminal
//   pnpm test:reference
//
// OPT-IN, NOT SKIP-IF-UNREACHABLE. Without OPENBB_REFERENCE the file skips.
// WITH it and no backend, every check fails -- which is the point: a suite
// that turned itself off when the backend was missing would report green for
// a completely broken client, the exact failure it exists to catch.
import { describe, it, expect, beforeAll } from "vitest";
import { normalizeWidgets, type WidgetIssue } from "../../lib/widgetsJson";
import { buildWidgetUrl, extractData } from "../../lib/dataClient";
import { RENDERED_TYPES, KNOWN_UNRENDERED_TYPES } from "../../lib/widgetTypes";
import { seedParams } from "../../lib/params";
import type { BackendConfig, WidgetDef } from "../../lib/types";

const BASE = process.env.OPENBB_REFERENCE_URL ?? "http://127.0.0.1:7779";
const enabled = process.env.OPENBB_REFERENCE === "1";

/** The corpus measured at the pinned commit is 70; 50 is a floor, not a count. */
const MIN_WIDGETS = 50;

describe.skipIf(!enabled)("reference backend conformance", () => {
  let widgets: WidgetDef[];
  let issues: WidgetIssue[];
  // The reference backend takes no credential, which is exactly what makes it
  // usable as a test environment: authLocation is moot with no key to place.
  const backend: BackendConfig = {
    id: "reference",
    name: "Reference",
    baseUrl: BASE,
    authLocation: "header",
    validateWidgets: true,
  };

  beforeAll(async () => {
    // A refused connection throws out of fetch before any assertion runs, so
    // the reason has to be attached here or the failure reads as a bare
    // ECONNREFUSED with no mention of what was supposed to be listening.
    const res = await fetch(`${BASE}/widgets.json`).catch((cause: unknown) => {
      throw new Error(
        `could not reach ${BASE}/widgets.json — start it with \`pnpm reference-backend\`, ` +
          `or point OPENBB_REFERENCE_URL at one that is running`,
        { cause },
      );
    });
    expect(
      res.ok,
      `${BASE}/widgets.json answered ${res.status} — is pnpm reference-backend running?`,
    ).toBe(true);
    const parsed = normalizeWidgets(await res.json(), backend.id);
    widgets = parsed.widgets;
    issues = parsed.issues;
  });

  it("serves a corpus big enough for the rest of this suite to mean anything", () => {
    // Without this, a backend answering 200 with {} makes every check below
    // vacuously true.
    expect(widgets.length).toBeGreaterThanOrEqual(MIN_WIDGETS);
  });

  it("loses nothing in normalizeWidgets", () => {
    // A reported issue is a widgets.json field the parser does not understand.
    expect(issues).toEqual([]);
  });

  it("gives every widget the fields the renderers require", () => {
    const bad = widgets.filter((w) => !w.id || !w.name || !w.endpoint);
    expect(bad.map((w) => w.id)).toEqual([]);
  });

  it("keeps every generated URL on the backend's own origin", () => {
    // Nothing in a remote widgets.json may steer a request elsewhere.
    const origin = new URL(BASE).origin;
    const offsite = widgets
      .map((w) => ({ id: w.id, url: buildWidgetUrl(backend, w, seedParams(w)) }))
      .filter((x) => new URL(x.url).origin !== origin);
    expect(offsite).toEqual([]);
  });

  it("actually fetches every table, metric and chart widget", async () => {
    const targets = widgets.filter((w) => ["table", "metric", "chart"].includes(w.type));
    expect(targets.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const w of targets) {
      // seedParams, not {}: a new card opens with the widget's declared
      // defaults, so fetching with nothing tests a request the app never
      // makes. company_performance requires `company`, and declares "TM".
      const res = await fetch(buildWidgetUrl(backend, w, seedParams(w)));
      if (!res.ok) {
        failures.push(`${w.id}: HTTP ${res.status}`);
        continue;
      }
      if (extractData(await res.json(), w.dataKey) === undefined) {
        failures.push(`${w.id}: no data at dataKey`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("either renders every type or names it as known-unrendered", () => {
    const types = [...new Set(widgets.map((w) => w.type))];
    const unaccounted = types.filter(
      (t) => !RENDERED_TYPES.has(t) && !KNOWN_UNRENDERED_TYPES.has(t),
    );
    // A new upstream type lands here rather than silently enlarging the set
    // of widgets shown as raw JSON.
    expect(unaccounted).toEqual([]);
  });
});
