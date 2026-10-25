// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset, __seed } from "../test/memfs";
import { normalizeMcpUrl } from "./agent/mcp";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests } from "./jsonStore";
import {
  coerceAgentOptions,
  coerceDisabledTools,
  coerceSeenProxiedTools,
  DEFAULT_SETTINGS,
  loadSettings,
  withDefaults,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  saveSettings,
  WIDGET_GAP_MAX,
  WIDGET_GAP_MIN,
  RITA_HOVER_DELAY_MAX,
  RITA_HOVER_DELAY_MIN,
  toMcpServerConfig,
} from "./settingsFile";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("loadSettings", () => {
  it("seeds and writes defaults when absent", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(__read("settings.json") ?? "")).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a partial file over the defaults", async () => {
    __seed("settings.json", JSON.stringify({}));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("passes unrecognized keys through unchanged", async () => {
    __seed("settings.json", JSON.stringify({ theme: "dark", futureFlag: 42 }));
    const loaded = await loadSettings();
    // Forward compatibility is a RUNTIME guarantee -- withDefaults' spread --
    // not a typed one: the Settings type deliberately admits no unknown keys,
    // so reading one back is a cast, as it would be for any caller.
    expect((loaded as Record<string, unknown>).futureFlag).toBe(42);
  });

  it("preserves unknown keys across a rewrite", async () => {
    __seed("settings.json", JSON.stringify({ theme: "dark", futureFlag: 42 }));
    await saveSettings(await loadSettings());
    expect(JSON.parse(__read("settings.json") ?? "").futureFlag).toBe(42);
  });

  it("downgrades a known field of the wrong type instead of quarantining the file", async () => {
    // Everything AROUND the bad field has to survive it: the two known
    // fields by their own coercion, `futureFlag` only by withDefaults'
    // `...loaded` spread.
    const seeded = { theme: 7, fontSize: "large", defaultTicker: "AAPL", futureFlag: 42 };
    __seed("settings.json", JSON.stringify(seeded));

    const loaded = await loadSettings();

    expect(loaded.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(loaded.fontSize).toBe("large");
    expect(loaded.defaultTicker).toBe("AAPL");
    expect((loaded as Record<string, unknown>).futureFlag).toBe(42);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it.each([["a bare string", '"dark"'], ["an array", "[1,2,3]"], ["a number", "7"]])(
    "quarantines %s at the top level",
    async (_label, text) => {
      // Not a downgrade: there are no fields to keep, so the file is moved
      // aside intact and the defaults are written fresh.
      __seed("settings.json", text);

      expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

      expect(__read("settings.json.corrupt")).toBe(text);
      expect(JSON.parse(__read("settings.json") ?? "")).toEqual(DEFAULT_SETTINGS);
    },
  );

  it.each([
    ["fontSize", 7],
    ["defaultTicker", 7],
    ["matchDashboardSymbol", "yes"],
    ["maxDecimalPlaces", "2"],
    ["minimizeButton", 1],
    ["collapseWidgetControls", "no"],
    ["cornerDragHandles", 0],
    ["quickAddToolbar", "true"],
  ])("downgrades a wrong-typed %s without losing the rest of the file", async (field, value) => {
    // "the rest of the file" is these two companions, neither of which is a
    // field this table parametrizes: a known enum, and an unknown key that
    // only the `...loaded` spread carries through.
    const seeded = { theme: "light", futureFlag: 42, [field]: value };
    __seed("settings.json", JSON.stringify(seeded));
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "light",
      futureFlag: 42,
    });
    expect(__read("settings.json.corrupt")).toBeUndefined();
    expect(__read("settings.json")).toBe(JSON.stringify(seeded));
  });

  it("accepts light theme and large font size", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light", fontSize: "large" }));
    const loaded = await loadSettings();
    expect(loaded.theme).toBe("light");
    expect(loaded.fontSize).toBe("large");
  });

  it("accepts a default ticker and matchDashboardSymbol", async () => {
    __seed("settings.json", JSON.stringify({ defaultTicker: "AAPL", matchDashboardSymbol: true }));
    const loaded = await loadSettings();
    expect(loaded.defaultTicker).toBe("AAPL");
    expect(loaded.matchDashboardSymbol).toBe(true);
  });

  it("downgrades an unrecognized theme value to the default instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ theme: "blue" }));
    const loaded = await loadSettings();
    expect(loaded.theme).toBe("system");
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("downgrades an unrecognized font size value to the default instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ fontSize: "huge" }));
    const loaded = await loadSettings();
    expect(loaded.fontSize).toBe("medium");
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("accepts the widget/layout settings and dashboard order", async () => {
    __seed(
      "settings.json",
      JSON.stringify({
        maxDecimalPlaces: 4,
        minimizeButton: true,
        collapseWidgetControls: true,
        cornerDragHandles: true,
        quickAddToolbar: false,
        dashboardOrder: ["d1", "d2"],
      }),
    );
    const loaded = await loadSettings();
    expect(loaded.maxDecimalPlaces).toBe(4);
    expect(loaded.minimizeButton).toBe(true);
    expect(loaded.collapseWidgetControls).toBe(true);
    expect(loaded.cornerDragHandles).toBe(true);
    expect(loaded.quickAddToolbar).toBe(false);
    expect(loaded.dashboardOrder).toEqual(["d1", "d2"]);
  });

  it("defaults maxDecimalPlaces to 2 and quickAddToolbar to true when absent", async () => {
    const loaded = await loadSettings();
    expect(loaded.maxDecimalPlaces).toBe(2);
    expect(loaded.quickAddToolbar).toBe(true);
  });

  it("downgrades an out-of-range maxDecimalPlaces to the default instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ maxDecimalPlaces: 9 }));
    const loaded = await loadSettings();
    expect(loaded.maxDecimalPlaces).toBe(2);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("drops a dashboardOrder that is not an array of strings, keeping the file", async () => {
    __seed("settings.json", JSON.stringify({ dashboardOrder: [1, 2] }));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("loads settings storage as Local by default", async () => {
    expect((await loadSettings()).settingsStorage).toBeUndefined();
  });

  it("keeps a connection id and drops a malformed one, without quarantining", async () => {
    __seed("settings.json", JSON.stringify({ settingsStorage: "conn-1" }));
    expect((await loadSettings()).settingsStorage).toBe("conn-1");
    for (const bad of [7, "", null]) {
      __seed("settings.json", JSON.stringify({ settingsStorage: bad }));
      expect((await loadSettings()).settingsStorage).toBeUndefined();
    }
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});

describe("autoRefreshMinutes", () => {
  it("is absent by default — Off", () => {
    expect(DEFAULT_SETTINGS.autoRefreshMinutes).toBeUndefined();
  });

  it("accepts each of the five offered values", async () => {
    for (const minutes of [1, 5, 15, 30, 60]) {
      __reset();
      __resetJsonStoreForTests();
      __seed("settings.json", JSON.stringify({ autoRefreshMinutes: minutes }));
      expect((await loadSettings()).autoRefreshMinutes).toBe(minutes);
    }
  });

  it("downgrades an unrecognised value to Off rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ autoRefreshMinutes: 7, theme: "light" }));
    const loaded = await loadSettings();
    expect(loaded.autoRefreshMinutes).toBeUndefined();
    // The rest of a well-formed file survives one bad enum value.
    expect(loaded.theme).toBe("light");
  });

  it("downgrades a non-number to Off rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ autoRefreshMinutes: "5" }));
    expect((await loadSettings()).autoRefreshMinutes).toBeUndefined();
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("round-trips Off as an absent key, never as null", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, autoRefreshMinutes: undefined });
    expect(JSON.parse(__read("settings.json") ?? "")).not.toHaveProperty("autoRefreshMinutes");
  });
});

describe("railWidth", () => {
  it("defaults to 48, between the exported bounds", () => {
    expect(DEFAULT_SETTINGS.railWidth).toBe(48);
    expect(RAIL_WIDTH_MIN).toBe(24);
    expect(RAIL_WIDTH_MAX).toBe(120);
  });

  it.each([
    [10, 24],
    [23, 24],
    [80, 80],
    // Rounded too: the settings importer refuses a fractional width, so an
    // unrounded 50.5 would export a bundle this app then cannot import.
    [50.5, 51],
    [121, 120],
    [500, 120],
  ])("clamps a stored %spx into range as %ipx", async (stored, expected) => {
    __seed("settings.json", JSON.stringify({ railWidth: stored }));
    expect((await loadSettings()).railWidth).toBe(expected);
    // In range or out of it, the file is well formed and survives intact.
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("falls back to 48 when the key is absent", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light" }));
    const loaded = await loadSettings();
    expect(loaded.railWidth).toBe(48);
    expect(loaded.theme).toBe("light");
  });

  it("falls back to 48 for a non-number rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ railWidth: "48" }));
    expect((await loadSettings()).railWidth).toBe(48);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});

describe("widgetGap", () => {
  it("defaults to 10, between the exported bounds", () => {
    expect(DEFAULT_SETTINGS.widgetGap).toBe(10);
    expect(WIDGET_GAP_MIN).toBe(1);
    expect(WIDGET_GAP_MAX).toBe(25);
  });

  it.each([
    [0, 1],
    [40, 25],
    [12.7, 13],
    [1, 1],
    [25, 25],
  ])("clamps a stored %spx into range as %spx", async (stored, expected) => {
    __seed("settings.json", JSON.stringify({ widgetGap: stored }));
    expect((await loadSettings()).widgetGap).toBe(expected);
    // In range or out of it, the file is well formed and survives intact.
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("falls back to 10 when the key is absent", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light" }));
    const loaded = await loadSettings();
    expect(loaded.widgetGap).toBe(10);
    expect(loaded.theme).toBe("light");
  });

  it("falls back to 10 for a non-number rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ widgetGap: "x" }));
    expect((await loadSettings()).widgetGap).toBe(10);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("falls back to 10 for a NUMERIC string, rather than coercing it", async () => {
    // "12" is in range and would coerce cleanly, which is exactly why this
    // case is worth pinning: the guard is Number.isFinite, not a coercion,
    // so a wrong-TYPED field is downgraded to the default like any other --
    // the app never invents a number a hand-edited file did not state as
    // one, and the corrected value is what gets written back.
    __seed("settings.json", JSON.stringify({ widgetGap: "12" }));
    expect((await loadSettings()).widgetGap).toBe(10);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});

describe("theme", () => {
  it("accepts system", async () => {
    __seed("settings.json", JSON.stringify({ theme: "system" }));
    expect((await loadSettings()).theme).toBe("system");
  });

  it("downgrades an unrecognized theme value to system instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ theme: "blue" }));
    expect((await loadSettings()).theme).toBe("system");
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});

describe("ritaUrl", () => {
  it("defaults to the empty string, meaning Rita is off", () => {
    expect(DEFAULT_SETTINGS.ritaUrl).toBe("");
  });

  it("keeps an http(s) URL", async () => {
    __seed("settings.json", JSON.stringify({ ritaUrl: "https://rita.example" }));
    expect((await loadSettings()).ritaUrl).toBe("https://rita.example");
  });

  it.each([["ftp://rita.example"], ["not a url"], [42]])(
    "downgrades %s to off without quarantining the file",
    async (stored) => {
      __seed("settings.json", JSON.stringify({ ritaUrl: stored, theme: "light" }));
      const loaded = await loadSettings();
      expect(loaded.ritaUrl).toBe("");
      expect(loaded.theme).toBe("light");
      expect(__read("settings.json.corrupt")).toBeUndefined();
    },
  );
});

describe("contextSharing", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.contextSharing).toBe(false);
  });

  it("keeps a stored true", async () => {
    __seed("settings.json", JSON.stringify({ contextSharing: true }));
    expect((await loadSettings()).contextSharing).toBe(true);
  });

  it("downgrades a non-boolean to false", async () => {
    __seed("settings.json", JSON.stringify({ contextSharing: "yes" }));
    expect((await loadSettings()).contextSharing).toBe(false);
  });
});

describe("mcpServers", () => {
  const good = { id: "s1", url: "https://mcp.example/mcp", enabled: true };

  it("defaults to an empty list", () => {
    expect(DEFAULT_SETTINGS.mcpServers).toEqual([]);
  });

  it("keeps well-formed entries", async () => {
    __seed("settings.json", JSON.stringify({ mcpServers: [good, { ...good, id: "s2", enabled: false }] }));
    expect((await loadSettings()).mcpServers).toEqual([good, { ...good, id: "s2", enabled: false }]);
  });

  it("drops a malformed entry alone, keeping its neighbours", async () => {
    __seed(
      "settings.json",
      JSON.stringify({
        mcpServers: [
          good,
          { id: "", url: good.url, enabled: true },
          { id: "s3", url: "nope", enabled: true },
          { id: "s4", url: good.url, enabled: "yes" },
          "junk",
        ],
      }),
    );
    expect((await loadSettings()).mcpServers).toEqual([good]);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("downgrades a non-array to empty", async () => {
    __seed("settings.json", JSON.stringify({ mcpServers: { id: "s1" } }));
    expect((await loadSettings()).mcpServers).toEqual([]);
  });
});

describe("shareTargets", () => {
  const good = { id: "t1", name: "Notes", kind: "http", url: "https://notes.example/in", template: "{}" };

  it("defaults to an empty list", () => {
    expect(DEFAULT_SETTINGS.shareTargets).toEqual([]);
  });

  it("keeps well-formed entries and drops a malformed one alone", async () => {
    __seed("settings.json", JSON.stringify({ shareTargets: [good, { ...good, id: "t2", template: "[]" }] }));
    expect((await loadSettings()).shareTargets).toEqual([good]);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("survives a save/load round trip with every new field set", async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      ritaUrl: "https://rita.example",
      contextSharing: true,
      mcpServers: [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }],
      shareTargets: [{ ...good, kind: "http" }],
    });
    const loaded = await loadSettings();
    expect(loaded.ritaUrl).toBe("https://rita.example");
    expect(loaded.contextSharing).toBe(true);
    expect(loaded.mcpServers).toHaveLength(1);
    expect(loaded.shareTargets).toEqual([good]);
  });
});

describe("ritaHoverDelayMs", () => {
  it("defaults to 500, between the exported bounds", () => {
    expect(DEFAULT_SETTINGS.ritaHoverDelayMs).toBe(500);
    expect(RITA_HOVER_DELAY_MIN).toBe(0);
    expect(RITA_HOVER_DELAY_MAX).toBe(2000);
  });

  it.each([
    [-100, 0],
    [9000, 2000],
    [512.4, 512],
    [0, 0],
    [2000, 2000],
  ])("clamps a stored %sms into range as %sms", async (stored, expected) => {
    __seed("settings.json", JSON.stringify({ ritaHoverDelayMs: stored }));
    expect((await loadSettings()).ritaHoverDelayMs).toBe(expected);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("falls back to 500 for an absent or wrong-typed value", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light" }));
    expect((await loadSettings()).ritaHoverDelayMs).toBe(500);
    __seed("settings.json", JSON.stringify({ ritaHoverDelayMs: "250" }));
    expect((await loadSettings()).ritaHoverDelayMs).toBe(500);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});

describe("coerceAgentOptions", () => {
  it("keeps boolean and string values per agent and drops everything else", () => {
    expect(coerceAgentOptions({ a: { x: true, y: "s", z: 3 }, b: "nope", c: { w: null } })).toEqual({
      a: { x: true, y: "s" },
      c: {},
    });
    expect(coerceAgentOptions(undefined)).toEqual({});
  });
});

describe("coerceDisabledTools", () => {
  it("keeps string lists per URL and drops everything else", () => {
    expect(coerceDisabledTools({ "https://m.example/mcp": ["a", 1, "b"], bad: "x" })).toEqual({
      "https://m.example/mcp": ["a", "b"],
    });
    expect(coerceDisabledTools(null)).toEqual({});
  });
});

describe("toMcpServerConfig", () => {
  it("keeps valid optional fields and drops a malformed one without dropping the server", () => {
    expect(
      toMcpServerConfig({ id: "s", url: "https://m.example/mcp", enabled: false, name: "M", authType: "token", source: { kind: "file" }, description: 7 }),
    ).toEqual({ id: "s", url: "https://m.example/mcp", enabled: false, name: "M", authType: "token", source: { kind: "file" } });
    expect(toMcpServerConfig({ id: "s", url: "https://m.example/mcp", enabled: true, authType: "basic", source: { kind: "backend" } })).toEqual({
      id: "s",
      url: "https://m.example/mcp",
      enabled: true,
    });
    expect(toMcpServerConfig({ id: "", url: "https://m.example/mcp", enabled: true })).toBeNull();
  });

  it("keeps allowCrossHost only when it is a boolean", () => {
    expect(toMcpServerConfig({ id: "s", url: "https://m.example/mcp", enabled: true, allowCrossHost: true })).toEqual({
      id: "s",
      url: "https://m.example/mcp",
      enabled: true,
      allowCrossHost: true,
    });
    expect(toMcpServerConfig({ id: "s", url: "https://m.example/mcp", enabled: true, allowCrossHost: false })).toEqual({
      id: "s",
      url: "https://m.example/mcp",
      enabled: true,
      allowCrossHost: false,
    });
    expect(toMcpServerConfig({ id: "s", url: "https://m.example/mcp", enabled: true, allowCrossHost: "yes" })).toEqual({
      id: "s",
      url: "https://m.example/mcp",
      enabled: true,
    });
  });
});

describe("ritaMaxFunctionRounds", () => {
  it("defaults to 40 and clamps a stored 0 to 1", () => {
    expect(withDefaults({}).ritaMaxFunctionRounds).toBe(40);
    expect(withDefaults({ ritaMaxFunctionRounds: 0 } as never).ritaMaxFunctionRounds).toBe(1);
  });
});

describe("v6 service seeding (VITE_DEFAULT_RITA_URL / VITE_DEFAULT_MCP_URL)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults a v5 profile to Rita off, sharing off, no MCP, 40 rounds", () => {
    // Stub env to "" to prevent developer .env.local from affecting the test
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "");
    const s = withDefaults({ theme: "dark" });
    expect([s.ritaUrl, s.contextSharing, s.mcpServers, s.ritaMaxFunctionRounds]).toEqual(["", false, [], 40]);
  });
  it("seeds absent keys from the build variables", () => {
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "https://YOUR-TAILNET.ts.net:10443");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "https://YOUR-TAILNET.ts.net:11443/mcp");
    const s = withDefaults({});
    expect(s.ritaUrl).toBe("https://YOUR-TAILNET.ts.net:10443");
    expect(s.mcpServers).toEqual([expect.objectContaining({ name: "OpenBQ MCP", url: "https://YOUR-TAILNET.ts.net:11443/mcp", enabled: true })]);
    expect(s.mcpDisabledTools[normalizeMcpUrl("https://YOUR-TAILNET.ts.net:11443/mcp")]).toEqual(["install_skill"]);
  });
  it("seeds with trailing slash in MCP URL", () => {
    const url = "https://YOUR-TAILNET.ts.net:11443/mcp/";
    vi.stubEnv("VITE_DEFAULT_MCP_URL", url);
    const s = withDefaults({});
    expect(s.mcpServers).toEqual([expect.objectContaining({ url, enabled: true })]);
    expect(s.mcpDisabledTools[normalizeMcpUrl(url)]).toEqual(["install_skill"]);
  });
  it("never reseeds a user's explicit empty choice", () => {
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "https://YOUR-TAILNET.ts.net:10443");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "https://YOUR-TAILNET.ts.net:11443/mcp");
    const s = withDefaults({ ritaUrl: "", mcpServers: [] });
    expect(s.ritaUrl).toBe("");
    expect(s.mcpServers).toEqual([]);
  });
  it("ignores a non-http seed value (javascript:)", () => {
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "javascript:alert('xss')");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "javascript:alert('xss')");
    const s = withDefaults({});
    expect(s.ritaUrl).toBe("");
    expect(s.mcpServers).toEqual([]);
  });
  it("seeds only mcpServers when ritaUrl is present but mcpServers is absent", () => {
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "https://YOUR-TAILNET.ts.net:10443");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "https://YOUR-TAILNET.ts.net:11443/mcp");
    const s = withDefaults({ ritaUrl: "https://custom.ts.net:10443" });
    expect(s.ritaUrl).toBe("https://custom.ts.net:10443");
    expect(s.mcpServers).toEqual([expect.objectContaining({ name: "OpenBQ MCP", url: "https://YOUR-TAILNET.ts.net:11443/mcp", enabled: true })]);
  });
  it("preserves existing mcpDisabledTools entries when seeding", () => {
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "https://YOUR-TAILNET.ts.net:11443/mcp");
    const s = withDefaults({ mcpDisabledTools: { "https://other.ts.net/mcp": ["list_symbols"] } });
    expect(s.mcpDisabledTools["https://other.ts.net/mcp"]).toEqual(["list_symbols"]);
    expect(s.mcpDisabledTools[normalizeMcpUrl("https://YOUR-TAILNET.ts.net:11443/mcp")]).toEqual(["install_skill"]);
  });
  it("emits no console warning for a v5-shaped object", () => {
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    vi.stubEnv("VITE_DEFAULT_RITA_URL", "");
    vi.stubEnv("VITE_DEFAULT_MCP_URL", "");
    withDefaults({ theme: "dark" });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("mcpSeenProxiedTools", () => {
  it("defaults to {} and survives a save/load round trip", async () => {
    expect(DEFAULT_SETTINGS.mcpSeenProxiedTools).toEqual({});
    expect(withDefaults({}).mcpSeenProxiedTools).toEqual({});
    await saveSettings({ ...DEFAULT_SETTINGS, mcpSeenProxiedTools: { "https://mcp.example/mcp": ["a", "b"] } });
    expect((await loadSettings()).mcpSeenProxiedTools).toEqual({ "https://mcp.example/mcp": ["a", "b"] });
  });

  it("coerces like coerceDisabledTools, then normalizes keys, de-duplicates, sorts and caps at 500", () => {
    const many = Array.from({ length: 600 }, (_, i) => `t${String(i).padStart(3, "0")}`);
    const out = coerceSeenProxiedTools({
      "https://mcp.example/mcp/": ["b", "a", "b", 3, "a"],
      "https://other.example/mcp": "nope",
      "https://big.example/mcp": many,
    });
    expect(out["https://mcp.example/mcp"]).toEqual(["a", "b"]);
    expect(out).not.toHaveProperty("https://other.example/mcp");
    expect(out["https://big.example/mcp"]).toHaveLength(500);
    expect(out["https://big.example/mcp"][0]).toBe("t000");
    expect(coerceSeenProxiedTools("x")).toEqual({});
  });
});
