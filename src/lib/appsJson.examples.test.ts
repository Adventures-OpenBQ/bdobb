// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID } from "./builtins";
import { importApps, isAppsJson, type App } from "./appsJson";
import type { WidgetDef } from "./types";

/**
 * Every file under docs/examples is served to users: `pnpm apps:sync` writes
 * each into the apps.json of the openbb-docker backend that owns its widgets
 * (OWNER in scripts/apps-sync.mjs), served at that backend's /apps.json and
 * opened from the rail's Apps catalogue. So each one is parsed and imported
 * here exactly as opening it would, against a registry that serves every
 * widget id the file names. A shipped example that fails to import is a
 * broken promise, and nothing else in the suite reads those files.
 */
const dir = resolve(process.cwd(), "docs/examples");
const files = readdirSync(dir).filter((f) => f.endsWith(".apps.json"));

function widget(id: string): WidgetDef {
  return {
    id,
    backendId: "b1",
    name: id,
    description: "",
    type: "table",
    category: "",
    subCategory: "",
    endpoint: `/${id}`,
    gridData: { w: 20, h: 9 },
    params: [],
    source: [],
  };
}

function load(file: string): { apps: App[]; ids: string[] } {
  const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
  expect(isAppsJson(raw), `${file} is an apps.json array`).toBe(true);
  const apps = raw as App[];
  const ids = apps.flatMap((a) => Object.values(a.tabs).flatMap((t) => t.layout.map((l) => l.i)));
  return { apps, ids };
}

describe("docs/examples", () => {
  it("ships at least the three known examples", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "v3.1.0-builtins.apps.json",
        "v3.1.0-demo-providers.apps.json",
        "v3.2.0-video-library.apps.json",
      ]),
    );
  });

  // The card id is the openbb-videos extension's own widget id (path
  // /api/v1/videos/video, provider "custom"); a rename on either side would
  // import as unresolved on a real stack while this suite's fixture registry
  // still served it.
  it("v3.2.0-video-library: one Video Library card, and demo-providers carries it too", () => {
    expect(load("v3.2.0-video-library.apps.json").ids).toEqual(["videos_video_custom_obb"]);
    expect(load("v3.1.0-demo-providers.apps.json").ids).toContain("videos_video_custom_obb");
  });

  it.each(files)("%s imports every card against a registry that serves it", (file) => {
    const { apps, ids } = load(file);
    // BUILTIN_WIDGETS' own ids are already served by the app without a
    // registry entry, but the fixture registry here has to stand in for
    // every id a file names, built-in or not, since importApps takes one
    // flat registry.
    const registry = [...new Set(ids)].map(widget);
    const { dashboards, cards, unresolved } = importApps(apps, registry);
    expect(unresolved).toBe(0);
    expect(cards).toBe(ids.length);
    expect(dashboards).toHaveLength(apps.length);
  });

  // N2: a sample dashboard exists for every embedded widget, pinned so a new
  // built-in fails the gate until it has a card in the example.
  it("v3.1.0-builtins: every BUILTIN_WIDGETS id, and param_echo, appears at least once", () => {
    const { ids } = load("v3.1.0-builtins.apps.json");
    const present = new Set(ids);
    for (const w of BUILTIN_WIDGETS) {
      // Local file is hidden from the library (WidgetLibrary.tsx) and only
      // ever created by dropping a real file on the dashboard -- its `file`
      // param names a stored file nothing here can portably seed, so it gets
      // no sample card, the same reason it gets no library entry.
      if (w.id === LOCAL_TABLE_ID) continue;
      expect(present.has(w.id), `${w.id} has no card in v3.1.0-builtins.apps.json`).toBe(true);
    }
    expect(present.has("param_echo")).toBe(true);
  });
});
