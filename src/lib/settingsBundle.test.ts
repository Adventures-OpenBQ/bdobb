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

const CURRENT: Settings = {
  ...DEFAULT_SETTINGS,
  theme: "dark",
  railWidth: 48,
  widgetGap: 10,
  autoRefreshMinutes: undefined,
  defaultTicker: undefined,
};
const FOLDERS = { ...makeEmptyFolders(), folders: [{ id: "f1", name: "Macro", parentId: null }], folderOrder: ["f1"] };
const bytes = (s: string) => new TextEncoder().encode(s).length;

test("the filename, kind and version are the ones the dialog names", () => {
  expect(BUNDLE_FILENAME).toBe("bdobb-settings.json");
  expect(BUNDLE_KIND).toBe("bdobb-settings");
  expect(BUNDLE_VERSION).toBe(1);
});

test("export writes kind, version and null for absent optionals, and never leaks excluded fields", () => {
  const text = exportBundle(CURRENT, makeEmptyFolders());
  const obj = JSON.parse(text);
  expect(obj.kind).toBe("bdobb-settings");
  expect(obj.version).toBe(1);
  expect(obj.settings.defaultTicker).toBeNull();
  expect(obj.settings.autoRefreshMinutes).toBeNull();
  // The exclusion invariant: dashboardOrder is never a member of the
  // exported settings object, and no credential/URL/header-shaped or raw
  // `value` field is either -- this bundle has never carried those, but the
  // invariant is asserted directly rather than assumed.
  expect(obj.settings).not.toHaveProperty("dashboardOrder");
  expect(obj.settings).not.toHaveProperty("value");
  expect(text).not.toMatch(/"value"|"header"|"credential"|"apiKey"|"token"/i);
  expect(obj).not.toHaveProperty("folders"); // empty tree omitted
});

test("a round trip preserves the recognised prefs, including widgetGap, and the folder tree", () => {
  const src: Settings = { ...CURRENT, theme: "light", railWidth: 60, widgetGap: 18, autoRefreshMinutes: 15, defaultTicker: "AAPL" };
  const text = exportBundle(src, FOLDERS);
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.theme).toBe("light");
  expect(plan.patch.railWidth).toBe(60);
  expect(plan.patch.widgetGap).toBe(18);
  expect(plan.patch.autoRefreshMinutes).toBe(15);
  expect(plan.patch.defaultTicker).toBe("AAPL");
  expect(plan.folders).toEqual(FOLDERS);
  expect(plan.review).toContain("Theme: dark → light");
  expect(plan.folderReview).toBe("Folders: replace 1 folder");
});

test("an older unversioned file (no kind/version) is accepted with the older-format notice", () => {
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

test("a higher version is refused with a version-mismatch message", () => {
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

test("a malformed field value refuses the whole import", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "purple" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan).toEqual({ ok: false, refusal: "theme must be dark, light or system." });
});

test("null clears an optional field but refuses a required one", () => {
  const cleared = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { defaultTicker: null } }),
    50,
    CURRENT,
  );
  expect(cleared.ok).toBe(true);
  if (cleared.ok) expect(cleared.patch).toEqual({ defaultTicker: undefined });

  const clearedRefresh = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { autoRefreshMinutes: null } }),
    50,
    CURRENT,
  );
  expect(clearedRefresh.ok).toBe(true);
  if (clearedRefresh.ok) expect(clearedRefresh.patch).toEqual({ autoRefreshMinutes: undefined });

  const bad = planSettingsImport(
    JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: null } }),
    50,
    CURRENT,
  );
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.refusal).toContain("theme");
});

test("an unknown field is ignored with a warning naming it, not a refusal", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light", ritaUrl: "https://x/" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch).toEqual({ theme: "light" });
  expect(plan.warnings.join(" ")).toContain("ritaUrl");
});

test("a folders member is validated and reviewed", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: {}, folders: FOLDERS });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.folders).toEqual(FOLDERS);
  expect(plan.folderReview).toBe("Folders: replace 1 folder");
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

test("an unparseable file is refused", () => {
  expect(planSettingsImport("{not json", 9, CURRENT)).toEqual({ ok: false, refusal: "That file is not JSON." });
});

test("a non-bundle shape is refused", () => {
  const text = JSON.stringify([{ name: "an app" }]);
  expect(planSettingsImport(text, bytes(text), CURRENT).ok).toBe(false);
});

test("an oversize file is refused before anything is parsed", () => {
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
