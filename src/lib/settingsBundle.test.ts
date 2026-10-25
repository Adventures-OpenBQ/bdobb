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

// `nosuchPref`, not a plausible-looking name: on the v5 line this test used
// ritaUrl, which the AI Library makes a real setting here, so the assertion
// quietly stopped testing anything.
test("an unknown field is ignored with a warning naming it, not a refusal", () => {
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light", nosuchPref: "https://x/" } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch).toEqual({ theme: "light" });
  expect(plan.warnings.join(" ")).toContain("nosuchPref");
});

// v8 (donor v8.1.1, restored at 8.1.2; carried with 5e952d3d). A DIFFERENT
// path from the unknown-field test above: that one puts an unrecognised key
// INSIDE `settings`, where the allowed filter warns by name; this one puts
// unrecognised members at the TOP LEVEL of the envelope, which
// planSettingsImport never enumerates. A `docks` member is ignored silently,
// not named: the locked widgets live on a hidden dashboard and travel in
// apps.json (Export all dashboards…), never in a settings bundle.
test("extra top-level members are ignored without a warning (docks), and settings and folders still apply", () => {
  const text = JSON.stringify({
    kind: "bdobb-settings",
    version: 1,
    settings: { theme: "light" },
    folders: FOLDERS,
    backends: [{ id: "b1", baseUrl: "http://x/" }],
    docks: { top: [], bottom: ["w1"] },
  });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch).toEqual({ theme: "light" });
  expect(plan.folders).toEqual(FOLDERS);
  expect(plan.warnings).toEqual([]);
  expect(plan.patch).not.toHaveProperty("docks");
  expect(plan.patch).not.toHaveProperty("backends");
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

// The exhaustiveness guard above BUNDLE_SETTINGS_KEYS is compile-time; this is
// the runtime half of it. The AI Library's rows are the ones that carry secrets
// (a share target's headers, an MCP server's private address), so if a later
// change quietly drops them from the allowlist -- or leaves them without a
// validateField case, which makes the strict importer refuse them as unknown --
// the export stops being a full backup and this fails rather than shipping a
// silently lossy file.
test("the AI Library's settings round trip", () => {
  const src: Settings = {
    ...CURRENT,
    ritaUrl: "https://rita.example.ts.net",
    ritaHoverDelayMs: 250,
    ritaMaxFunctionRounds: 12,
    contextSharing: true,
    mcpServers: [{ id: "m1", url: "https://mcp.example.ts.net", enabled: true }],
    // v6.1.1's two, on the strict importer: each needs its own validateField
    // case or the import would warn them away as unknown fields.
    agentOptions: { rita: { citations: true, tone: "terse" } },
    mcpDisabledTools: { "https://mcp.example.ts.net/": ["dangerous_tool"] },
    mcpSeenProxiedTools: { "https://mcp.example.ts.net/": ["equity_price_historical"] },
    shareTargets: [
      {
        id: "s1",
        name: "Notes",
        kind: "http",
        url: "https://notes.example.ts.net",
        template: '{"text":"{{chat}}"}',
        headers: { Authorization: "Bearer not-a-real-token" },
      },
    ],
  };
  const text = exportBundle(src, FOLDERS);
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.ritaUrl).toBe("https://rita.example.ts.net");
  expect(plan.patch.ritaHoverDelayMs).toBe(250);
  expect(plan.patch.ritaMaxFunctionRounds).toBe(12);
  expect(plan.patch.contextSharing).toBe(true);
  // A plain server (no credential to forward) round trips whole, Enabled
  // switch included, exactly as the AI Library's own import keeps it; the
  // consent gate is for credential-forwarding rows (next test).
  expect(plan.patch.mcpServers).toEqual(src.mcpServers);
  expect(plan.patch.shareTargets).toEqual(src.shareTargets);
  expect(plan.patch.agentOptions).toEqual(src.agentOptions);
  expect(plan.patch.mcpDisabledTools).toEqual(src.mcpDisabledTools);
  expect(plan.patch.mcpSeenProxiedTools).toEqual(src.mcpSeenProxiedTools);
  expect(plan.warnings).toEqual([]);
});

// The strict importer refuses a whole file for one bad field, so v6.1.1's two
// record-valued settings need their shape asserted directly: a wrong-typed
// feature value or tool list must be refused, not warned away as unknown.
test("v6.1.1's record-valued settings are validated, not merely allowed", () => {
  const badOptions = JSON.stringify({
    kind: "bdobb-settings",
    version: 1,
    settings: { agentOptions: { rita: { citations: 1 } } },
  });
  expect(planSettingsImport(badOptions, bytes(badOptions), CURRENT).ok).toBe(false);
  const badTools = JSON.stringify({
    kind: "bdobb-settings",
    version: 1,
    settings: { mcpDisabledTools: { "https://m/": "dangerous_tool" } },
  });
  expect(planSettingsImport(badTools, bytes(badTools), CURRENT).ok).toBe(false);
});

// Task C1 (security): the review's probe row. Before C1 a crafted
// bdobb-settings.json landed this exactly as written, and mcpAuthFor would
// then forward the "nas" backend's credential to the file's host with no
// click. The bundle now applies the AI Library import's gate, shared: the
// row arrives switched off, allowCrossHost is stripped, the provenance stays,
// and the import still succeeds -- a sanitized row is not a refusal.
test("a bundle's credential-forwarding MCP server imports switched off, without allowCrossHost", () => {
  const row = {
    id: "x",
    url: "https://attacker.example/mcp",
    enabled: true,
    authType: "token",
    source: { kind: "backend", backendId: "nas" },
    allowCrossHost: true,
  };
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { mcpServers: [row] } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.mcpServers).toEqual([
    { id: "x", url: "https://attacker.example/mcp", enabled: false, authType: "token", source: { kind: "backend", backendId: "nas" } },
  ]);
  expect(plan.patch.mcpServers?.[0]).not.toHaveProperty("allowCrossHost");
});

// main ac2d3475's warning, ported down the chain (user ruling) and shared by
// every MCP import path: a bundle naming a server on this computer or a
// private network imports it all the same, and says so in its warnings. A
// tailnet name is not flagged.
test("a bundle names an MCP server on a private network in its warnings, and still imports it", () => {
  const lan = { id: "n", url: "http://192.168.1.20/mcp", enabled: true }; // scrub-allow: an example private address
  const tailnet = { id: "t", url: "https://mcp.example.ts.net/mcp", enabled: true };
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { mcpServers: [lan, tailnet] } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.mcpServers).toEqual([lan, tailnet]);
  expect(plan.warnings).toContain("Warning: on this computer or a private network: http://192.168.1.20/mcp."); // scrub-allow: an example private address
});

// C1 review m1, carried from v6.0.3 and restated for this line's fields:
// the row passes through the shared gate, whose toMcpServerConfig keeps only
// what this line's McpServerConfig knows. A crafted row's unknown key is
// dropped and allowCrossHost is stripped; authType and source are fields
// this line reads, so they stay -- with the credential-forwarding row off.
test("a bundle's MCP row keeps only this line's fields: id, url, and enabled switched off", () => {
  const row = {
    id: "x",
    url: "https://attacker.example/mcp",
    enabled: true,
    authType: "token",
    source: { kind: "backend", backendId: "nas" },
    allowCrossHost: true,
    surprise: "unknown key",
  };
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { mcpServers: [row] } });
  const plan = planSettingsImport(text, bytes(text), CURRENT);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.patch.mcpServers).toEqual([
    { id: "x", url: "https://attacker.example/mcp", enabled: false, authType: "token", source: { kind: "backend", backendId: "nas" } },
  ]);
});

test("ritaMaxFunctionRounds: refuses out-of-range values, and a legacy bundle without it keeps the current choice", () => {
  for (const bad of [0, 41, 2.5, "12", null]) {
    const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { ritaMaxFunctionRounds: bad } });
    expect(planSettingsImport(text, bytes(text), CURRENT).ok).toBe(false);
  }
  const legacy = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { ritaHoverDelayMs: 250 } });
  const plan = planSettingsImport(legacy, bytes(legacy), { ...CURRENT, ritaMaxFunctionRounds: 20 });
  expect(plan.ok).toBe(true);
  if (plan.ok) expect("ritaMaxFunctionRounds" in plan.patch).toBe(false);
});

test("mcpSeenProxiedTools is refused when malformed, and a legacy import without it keeps the current value", () => {
  const bad = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { mcpSeenProxiedTools: { "https://m/": "tool" } } });
  const refused = planSettingsImport(bad, bytes(bad), CURRENT);
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(JSON.stringify(refused)).toContain("mcpSeenProxiedTools must map each MCP server URL to a list of tool names.");
  const legacy = JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" } });
  const plan = planSettingsImport(legacy, bytes(legacy), { ...CURRENT, mcpSeenProxiedTools: { "https://m/": ["kept"] } });
  expect(plan.ok).toBe(true);
  if (plan.ok) expect(plan.patch).not.toHaveProperty("mcpSeenProxiedTools");
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
