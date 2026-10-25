// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "vitest";
import { makeEmptyFolders } from "./foldersFile";
import { DEFAULT_SETTINGS } from "./settingsFile";
import {
  BUNDLE_FILENAME,
  BUNDLE_KIND,
  BUNDLE_VERSION,
  exportBundle,
  isSettingsBundle,
  planSettingsImport,
} from "./settingsBundle";
import type { Settings } from "./types";

const CURRENT: Settings = { ...DEFAULT_SETTINGS, theme: "dark", railWidth: 48, autoRefreshMinutes: undefined, defaultTicker: undefined };
const FOLDERS = { ...makeEmptyFolders(), folders: [{ id: "f1", name: "Macro", parentId: null }], folderOrder: ["f1"] };
const bytes = (s: string) => new TextEncoder().encode(s).length;

test("the filename, kind and version are the ones the dialog names", () => {
  expect(BUNDLE_FILENAME).toBe("bdobb-settings.json");
  expect(BUNDLE_KIND).toBe("bdobb-settings");
  expect(BUNDLE_VERSION).toBe(1);
});

test("export writes kind, version, the 11 keys, and null for absent optionals", () => {
  const text = exportBundle(CURRENT, makeEmptyFolders());
  const obj = JSON.parse(text);
  expect(obj.kind).toBe("bdobb-settings");
  expect(obj.version).toBe(1);
  expect(obj.settings.defaultTicker).toBeNull();
  expect(obj.settings.autoRefreshMinutes).toBeNull();
  expect(Object.keys(obj.settings).sort()).toEqual(
    [
      "theme",
      "fontSize",
      "matchDashboardSymbol",
      "maxDecimalPlaces",
      "minimizeButton",
      "collapseWidgetControls",
      "cornerDragHandles",
      "quickAddToolbar",
      "railWidth",
      "autoRefreshMinutes",
      "defaultTicker",
    ].sort(),
  );
  // v3 has no widgetGap, and dashboardOrder/credential-shaped fields never ship.
  for (const k of ["widgetGap", "dashboardOrder", "credential", "url", "baseUrl", "header", "headerName", "headerValue", "value"]) {
    expect(obj.settings).not.toHaveProperty(k);
  }
  expect(obj).not.toHaveProperty("folders"); // empty tree omitted
});

test("a round trip preserves the recognised prefs and the folder tree", () => {
  const src: Settings = { ...CURRENT, theme: "light", autoRefreshMinutes: 15, defaultTicker: "AAPL" };
  const text = exportBundle(src, FOLDERS);
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.theme).toBe("light");
  expect(plan.patch.autoRefreshMinutes).toBe(15);
  expect(plan.patch.defaultTicker).toBe("AAPL");
  expect(plan.folders).toEqual(FOLDERS);
  expect(plan.review).toContain("Theme: dark → light");
  expect(plan.folderReview).toBe("Folders: replace 1 folder");
});

test("an older unversioned file is accepted with the older-format notice", () => {
  const text = JSON.stringify({ settings: { theme: "light" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.notice).toBe("Older settings file; imported the fields it names.");
  expect(plan.patch).toEqual({ theme: "light" });
});

test("a wrong kind is refused without a patch", () => {
  const text = JSON.stringify({ kind: "bdobb-apps", version: 1, settings: { theme: "light" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan).toEqual({ ok: false, refusal: "That file is not a bdobb-settings file." });
});

test("a higher version is refused", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 2, settings: { theme: "light" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(false);
  if (plan.ok) return;
  expect(plan.refusal).toContain("version 2");
});

test("a version that is not a number is refused, not read as v1", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: "2", settings: { theme: "light" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(false);
  if (plan.ok) return;
  expect(plan.refusal).toContain("not a number");
});

test("a malformed field is a field-specific refusal, and the theme message names only dark/light", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "system" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan).toEqual({ ok: false, refusal: "theme must be dark or light." });
});

test("null clears an optional field but refuses a required one", () => {
  const ok = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { defaultTicker: null } }),
    50,
    CURRENT,
  );
  expect(ok.ok).toBe(true);
  if (ok.ok) expect(ok.patch).toEqual({ defaultTicker: undefined });

  const okAutoRefresh = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { autoRefreshMinutes: null } }),
    50,
    CURRENT,
  );
  expect(okAutoRefresh.ok).toBe(true);
  if (okAutoRefresh.ok) expect(okAutoRefresh.patch).toEqual({ autoRefreshMinutes: undefined });

  const bad = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: null } }),
    50,
    CURRENT,
  );
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.refusal).toContain("theme");

  const badRailWidth = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { railWidth: null } }),
    50,
    CURRENT,
  );
  expect(badRailWidth.ok).toBe(false);
});

test("an unknown field is ignored with a warning naming it", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light", widgetGap: 10 } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch).toEqual({ theme: "light" });
  expect(plan.warnings.join(" ")).toContain("widgetGap");
});

test("an invalid folders member is ignored with a warning", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" }, folders: "nonsense" });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.folders).toBeNull();
  expect(plan.warnings.join(" ")).toMatch(/folder/i);
});

test("an empty folders member reviews as clearing the tree", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: {}, folders: makeEmptyFolders() });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.folderReview).toBe("Folders: clear the folder tree");
});

// Restored (pass I, lost-test audit): lost in the v3.1.0 rewrite to the
// versioned bundle. No folders member is not an empty one: the destination's
// folder tree is left alone (no write, nothing to review, nothing to warn).
test("a file with no folders member plans no folder write", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { railWidth: 60 } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.folders).toBeNull();
  expect(plan.folderReview).toBeNull();
  expect(plan.warnings.join(" ")).not.toMatch(/folder/i);
});

test("a member of the wrong type is ignored with a folder tree warning, not refused", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" }, folders: "nonsense" });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.theme).toBe("light");
  expect(plan.folders).toBeNull();
});

test("an unparseable file is refused", () => {
  expect(planSettingsImport("{not json", 9, CURRENT)).toEqual({ ok: false, refusal: "That file is not JSON." });
});

test("a non-bundle shape is refused", () => {
  const text = JSON.stringify([{ name: "an app" }]);
  expect(planSettingsImport(text, bytes(text), CURRENT).ok).toBe(false);
});

test("an oversize file is refused before parsing", () => {
  const plan = planSettingsImport("{}", 11 * 1024 * 1024, CURRENT);
  expect(plan.ok).toBe(false);
  if (plan.ok) return;
  expect(plan.refusal).toContain("the limit is 10 MB");
});

test("the sniff tells a bundle from an apps.json array", () => {
  expect(isSettingsBundle({ settings: {} })).toBe(true);
  expect(isSettingsBundle({ folders: makeEmptyFolders() })).toBe(true);
  expect(isSettingsBundle([{ name: "an app" }])).toBe(false);
  expect(isSettingsBundle({})).toBe(false);
  expect(isSettingsBundle(null)).toBe(false);
});

test("a valid partial patch reviews only the field it carries", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { railWidth: 60 } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(Object.keys(plan.patch)).toEqual(["railWidth"]);
  expect(plan.patch.railWidth).toBe(60);
  expect(plan.review).toEqual(["Collapsed rail width: 48 → 60"]);
});

test("settings storage describes this machine: never exported, ignored on import", () => {
  const obj = JSON.parse(exportBundle({ ...CURRENT, settingsStorage: "conn-1" }, makeEmptyFolders()));
  expect(obj.settings).not.toHaveProperty("settingsStorage");
  const text = JSON.stringify({ kind: BUNDLE_KIND, version: 1, settings: { theme: "light", settingsStorage: "conn-1" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (plan.ok) {
    expect(plan.patch).toEqual({ theme: "light" });
    expect(plan.warnings).toContain("Ignored unknown fields: settingsStorage.");
  }
});
