// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  classifyProbe,
  findKeyMaintWidget,
  isKeyMaintWidget,
  KEY_MAINT_WIDGET_ID,
  needsKey,
  normalizeProvider,
  pickProbeWidget,
  probeResult,
  probeTone,
  REGISTRY_PROVIDERS,
  worstTone,
} from "./providerKeys";
import type { WidgetDef } from "./types";

function widget(over: Partial<WidgetDef>): WidgetDef {
  return {
    id: "w", backendId: "b1", name: "W", description: "", type: "table",
    category: "", subCategory: "", endpoint: "/e", gridData: { w: 1, h: 1 },
    params: [], source: [], ...over,
  };
}

describe("normalizeProvider", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeProvider("Alpha_vantage")).toBe("alphavantage");
    expect(normalizeProvider("Alpha Vantage")).toBe("alphavantage");
    expect(normalizeProvider("Eodhd")).toBe("eodhd");
    expect(normalizeProvider("EODHD")).toBe("eodhd");
    expect(normalizeProvider("Congress.gov")).toBe("congressgov");
  });

  it("strips a parenthetical suffix before normalizing", () => {
    expect(normalizeProvider("Alpaca (secret)")).toBe("alpaca");
    expect(normalizeProvider("Alpaca")).toBe("alpaca");
  });
});

describe("REGISTRY_PROVIDERS", () => {
  it("holds the 17 distinct providers key-maint knows", () => {
    // 18 registry rows collapse to 17: Alpaca and Alpaca (secret) share a name.
    expect(REGISTRY_PROVIDERS.size).toBe(17);
    expect(REGISTRY_PROVIDERS.has("alpaca")).toBe(true);
    expect(REGISTRY_PROVIDERS.has("fmp")).toBe(true);
    expect(REGISTRY_PROVIDERS.has("eodhd")).toBe(true);
  });
});

describe("needsKey", () => {
  it("is true for a provider in the registry", () => {
    expect(needsKey("FMP")).toBe(true);
    expect(needsKey("Alpha_vantage")).toBe(true);
  });

  it("is false for a provider the registry has never heard of", () => {
    // Keyless by definition: they require no credential.
    expect(needsKey("yfinance")).toBe(false);
    expect(needsKey("Federal Reserve")).toBe(false);
    expect(needsKey("cboe")).toBe(false);
  });
});

describe("pickProbeWidget", () => {
  it("prefers a widget whose params all have defaults", () => {
    const chosen = pickProbeWidget([
      widget({ id: "needs-arg", params: [{ paramName: "symbol" }] }),
      widget({ id: "ready", params: [{ paramName: "provider", value: "fmp" }] }),
    ]);
    expect(chosen?.id).toBe("ready");
  });

  it("declines when even the best candidate still needs an argument", () => {
    // Firing it would return a validation error, which classifies as
    // `unknown` anyway — declining is the same answer without the call.
    expect(
      pickProbeWidget([widget({ id: "needs-arg", params: [{ paramName: "symbol" }] })]),
    ).toBeNull();
  });

  it("accepts table, chart and metric, and nothing else", () => {
    for (const type of ["table", "chart", "metric"]) {
      expect(pickProbeWidget([widget({ type, params: [] })])).not.toBeNull();
    }
    for (const type of ["iframe", "html", "markdown", "pdf", "multi_file_viewer", "note"]) {
      expect(pickProbeWidget([widget({ type, params: [] })])).toBeNull();
    }
  });

  it("returns null for no candidates at all", () => {
    expect(pickProbeWidget([])).toBeNull();
  });

  it("ignores a param whose default is the empty string", () => {
    expect(
      pickProbeWidget([widget({ params: [{ paramName: "symbol", value: "" }] })]),
    ).toBeNull();
  });
});

describe("classifyProbe", () => {
  it("treats any 2xx as keyed", () => {
    expect(classifyProbe(true, '{"results":[]}')).toBe("keyed");
  });

  it("treats a Missing credential body as unkeyed", () => {
    expect(classifyProbe(false, '{"detail":"Missing credential: FMP_API_KEY"}')).toBe("unkeyed");
  });

  it("treats every other failure as unknown, never unkeyed", () => {
    // The failure does not prove the key is absent — that is the whole
    // reason the third state exists.
    expect(classifyProbe(false, '{"detail":"Unauthorized"}')).toBe("unknown");
    expect(classifyProbe(false, "")).toBe("unknown");
    expect(classifyProbe(false, "gateway timeout")).toBe("unknown");
  });
});

describe("probeTone", () => {
  it("gives each result key-maint sends its dot colour", () => {
    // A 2xx that rejects the key is amber, not red: the vendor answered.
    expect(probeTone("ok")).toBe("green");
    expect(probeTone("auth_failed")).toBe("amber");
    expect(probeTone("error")).toBe("amber");
    expect(probeTone("no_response")).toBe("red");
    expect(probeTone("skipped")).toBe("grey");
  });

  it("is grey when no probe has run", () => {
    expect(probeTone(undefined)).toBe("grey");
  });

  it("is grey for a result the app does not recognise", () => {
    // Inventing a colour for a state we do not understand is worse than
    // admitting we do not know it.
    expect(probeTone("teleported")).toBe("grey");
  });

  it("does not read an inherited Object.prototype member as a result", () => {
    expect(probeTone("constructor")).toBe("grey");
    expect(probeTone("toString")).toBe("grey");
  });
});

describe("worstTone", () => {
  it("ranks red worst, then amber, then grey, then green", () => {
    expect(worstTone(["green", "red", "amber", "grey"])).toBe("red");
    expect(worstTone(["green", "amber", "grey"])).toBe("amber");
    expect(worstTone(["green", "grey"])).toBe("grey");
    expect(worstTone(["green", "green"])).toBe("green");
  });

  it("is grey for no tones at all, which is the not-probed state", () => {
    expect(worstTone([])).toBe("grey");
  });
});

describe("probeResult", () => {
  it("calls a successful probe ok", () => {
    expect(probeResult(true, "")).toBe("ok");
  });

  it("calls a failure that carries an HTTP status an error, because the vendor answered", () => {
    expect(probeResult(false, "HTTP 401: Unauthorized")).toBe("error");
    expect(probeResult(false, "HTTP 500")).toBe("error");
  });

  it("calls a failure with no HTTP status no_response, because nothing came back", () => {
    // dataClient prefixes every answered failure with `HTTP <status>`; a
    // connect timeout or a refused connection never gets one.
    expect(probeResult(false, "fetch failed (http://x/e)")).toBe("no_response");
    expect(probeResult(false, "")).toBe("no_response");
  });

  it("feeds the same table the key-maint rows do", () => {
    expect(probeTone(probeResult(true, ""))).toBe("green");
    expect(probeTone(probeResult(false, "HTTP 401"))).toBe("amber");
    expect(probeTone(probeResult(false, "fetch failed"))).toBe("red");
  });
});

describe("findKeyMaintWidget", () => {
  const panel = widget({ id: "provider_api_keys_panel", type: "keys", endpoint: "keys" });
  const table = widget({ id: KEY_MAINT_WIDGET_ID, type: "table", endpoint: "keys" });
  const other = widget({ id: "quote", type: "table", endpoint: "quote" });

  it("recognises both of key-maint's handles", () => {
    expect(isKeyMaintWidget(panel)).toBe(true);
    expect(isKeyMaintWidget(table)).toBe(true);
    expect(isKeyMaintWidget(other)).toBe(false);
  });

  // The two consumers used to find key-maint by different handles -- the
  // panel by type, the store by id -- so a backend serving only one of them
  // was half-connected. One rule now answers for both.
  it("finds key-maint by either handle", () => {
    expect(findKeyMaintWidget([other, panel])).toBe(panel);
    expect(findKeyMaintWidget([other, table])).toBe(table);
    expect(findKeyMaintWidget([other])).toBeUndefined();
  });

  // The tie-break, and the reason this is a selector and not just a filter:
  // only a `keys`-type widget makes fetchWidgetData hand back the whole
  // { tier, rows } envelope, which is what KeysPanel renders from. Order in
  // the registry must not decide it.
  it("prefers the keys-type widget however the registry is ordered", () => {
    expect(findKeyMaintWidget([table, panel])).toBe(panel);
    expect(findKeyMaintWidget([panel, table])).toBe(panel);
  });
});
