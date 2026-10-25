// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { MAX_PARAM_VALUE_LENGTH, originOf, paramsFromUpdate, parseInbound } from "./iframeProtocol";

describe("parseInbound", () => {
  it("accepts openbb-connect, keeping nothing but its type", () => {
    // The reference puts `widgets` and `params` on a connect; the reply
    // depends on neither, so neither is carried through.
    expect(parseInbound({ type: "openbb-connect", widgets: ["a"], params: { x: 1 } })).toEqual({
      type: "openbb-connect",
    });
    expect(parseInbound({ type: "openbb-connect" })).toEqual({ type: "openbb-connect" });
  });

  it("accepts the map form of a params update", () => {
    expect(parseInbound({ type: "openbb:widget-params:update", params: { symbol: "MSFT" } })).toEqual(
      { type: "openbb:widget-params:update", params: { symbol: "MSFT" } },
    );
  });

  it("accepts the single-name form of a params update", () => {
    expect(
      parseInbound({ type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" }),
    ).toEqual({ type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" });
  });

  it("prefers the map form when a message carries both", () => {
    // Both forms are documented; a message carrying both is malformed. Taking
    // the map is a choice, not an accident: it is the form that can express
    // several parameters at once, so nothing the sender asked for is lost.
    expect(
      parseInbound({
        type: "openbb:widget-params:update",
        params: { symbol: "MSFT" },
        paramName: "other",
        value: "x",
      }),
    ).toEqual({ type: "openbb:widget-params:update", params: { symbol: "MSFT" } });
  });

  // event.data is whatever the framed page chose to send. Every one of these
  // must answer null rather than throw: the listener runs on messages from
  // pages this app does not control.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "openbb-connect"],
    ["a number", 7],
    ["an array", [{ type: "openbb-connect" }]],
    ["an object with no type", { params: { symbol: "MSFT" } }],
    ["an unknown type", { type: "openbb-theme" }],
    ["a non-string type", { type: 3 }],
    ["a params update with neither form", { type: "openbb:widget-params:update" }],
    [
      "a params update whose params is not an object",
      { type: "openbb:widget-params:update", params: "symbol=MSFT" },
    ],
    [
      "a params update whose paramName is empty",
      { type: "openbb:widget-params:update", paramName: "", value: "MSFT" },
    ],
    [
      "a params update whose paramName is not a string",
      { type: "openbb:widget-params:update", paramName: 3, value: "MSFT" },
    ],
  ])("rejects %s", (_label, data) => {
    expect(parseInbound(data)).toBeNull();
  });

  // Recognised by the reference protocol, deliberately not acted on here (the
  // design's Out of scope). parseInbound answers null for them like anything
  // else; naming them as ignored is useWidgetMessages' job, not this one's.
  it.each([["openbb-request"], ["openbb-data"]])("rejects %s, which is out of scope", (type) => {
    expect(parseInbound({ type, foo: 1 })).toBeNull();
  });
});

describe("paramsFromUpdate", () => {
  it("stringifies every value of the map form", () => {
    expect(
      paramsFromUpdate({
        type: "openbb:widget-params:update",
        params: { symbol: "MSFT", limit: 20, adjusted: true },
      }),
    ).toEqual({ symbol: "MSFT", limit: "20", adjusted: "true" });
  });

  it("turns the single-name form into a one-key map", () => {
    expect(
      paramsFromUpdate({ type: "openbb:widget-params:update", paramName: "limit", value: 20 }),
    ).toEqual({ limit: "20" });
  });

  it("renders null and undefined as the empty value, never as the word", () => {
    // "" is this app's own "send nothing": buildWidgetUrl drops an empty
    // param from the query string, and a required param left empty stops the
    // card at "incomplete" rather than firing a request. String(null) would
    // put the literal text "null" in a query parameter instead.
    expect(
      paramsFromUpdate({
        type: "openbb:widget-params:update",
        params: { a: null, b: undefined },
      }),
    ).toEqual({ a: "", b: "" });
  });

  it("comma-joins an array, which is how a multiSelect param travels", () => {
    expect(
      paramsFromUpdate({
        type: "openbb:widget-params:update",
        paramName: "symbols",
        value: ["AAPL", "MSFT"],
      }),
    ).toEqual({ symbols: "AAPL,MSFT" });
  });

  it("answers an empty map for an empty params block", () => {
    expect(paramsFromUpdate({ type: "openbb:widget-params:update", params: {} })).toEqual({});
  });
});

describe("originOf", () => {
  it.each([
    ["https://example.com/a/b?q=1", "https://example.com"],
    ["http://example.com/", "http://example.com"],
  ])("answers the origin of %s", (url, origin) => {
    expect(originOf(url)).toBe(origin);
  });

  it("keeps a non-default port, which is what a loopback backend has", () => {
    expect(originOf("http://127.0.0.1:4174/embed")).toBe("http://127.0.0.1:4174");
  });

  // Everything below has no origin this app may name as a postMessage target.
  // about:blank and about:srcdoc are the two a frame actually sits at before
  // and instead of a real document; the rest can never be a frame src at all
  // (safeUrl already refuses them) and are covered so a future caller cannot
  // be surprised.
  it.each([
    ["about:blank"],
    ["about:srcdoc"],
    [""],
    ["javascript:alert(1)"],
    ["data:text/html,<p>hi</p>"],
    ["/relative/path"],
  ])("answers null for %s", (url) => {
    expect(originOf(url)).toBeNull();
  });
});

describe("paramsFromUpdate value bound", () => {
  it("truncates a value a frame made unbounded", () => {
    const huge = "x".repeat(MAX_PARAM_VALUE_LENGTH + 10);
    const out = paramsFromUpdate({ type: "openbb:widget-params:update", params: { symbol: huge } });
    expect(out.symbol).toHaveLength(MAX_PARAM_VALUE_LENGTH);
  });
});
