// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: this reads the captured agents.json from disk, and under
// jsdom import.meta.url is an http:// URL that readFileSync refuses.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeAgentsJson, normalizeFeatures, fetchAgentsJson } from "./agents-json";

vi.mock("../logger", () => ({
  logOnce: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logInfo: vi.fn(() => Promise.resolve()),
}));

const CAPTURE = JSON.parse(
  readFileSync(new URL("../../test/fixtures/rita/agents.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("normalizeAgentsJson against the real capture", () => {
  it("keeps the agent under its own key", () => {
    const out = normalizeAgentsJson(CAPTURE);
    expect(Object.keys(out)).toEqual(["openbb_agent_rita"]);
    expect(out.openbb_agent_rita.name).toBe("Agent Rita");
    expect(out.openbb_agent_rita.queryPath).toBe("/v1/query");
  });

  it("skips an entry that is not an object", () => {
    const out = normalizeAgentsJson({ good: CAPTURE.openbb_agent_rita, bad: 42 });
    expect(Object.keys(out)).toEqual(["good"]);
  });

  it("defaults a missing name to its key and a missing description to empty", () => {
    const out = normalizeAgentsJson({ solo: { endpoints: { query: "/q" } } });
    expect(out.solo.name).toBe("solo");
    expect(out.solo.description).toBe("");
  });

  it("falls back to an empty queryPath when endpoints.query is not a string", () => {
    const out = normalizeAgentsJson({ solo: { endpoints: { query: 7 } } });
    expect(out.solo.queryPath).toBe("");
  });
});

describe("normalizeFeatures against the real capture", () => {
  const features = normalizeAgentsJson(CAPTURE).openbb_agent_rita.features;

  it("reads the seven plain booleans", () => {
    const booleans = Object.entries(features)
      .filter(([, f]) => f.kind === "boolean")
      .map(([k]) => k);
    expect(booleans).toHaveLength(7);
    expect(booleans).toContain("streaming");
    expect(booleans).toContain("mcp-tools");
  });

  it("reads prompt-suggestions as a toggle even though it has NO type field", () => {
    // The shape that breaks a parser keyed on `type`. It is in the capture
    // exactly like this, which is why the capture is the test input.
    const f = features["prompt-suggestions"];
    expect(f.kind).toBe("toggle");
    if (f.kind !== "toggle") throw new Error("unreachable");
    expect(f.label).toBe("Follow-up Suggestions");
    expect(f.default).toBe(true);
  });

  it("reads model as an eleven-option select", () => {
    const f = features.model;
    expect(f.kind).toBe("select");
    if (f.kind !== "select") throw new Error("unreachable");
    expect(f.options).toHaveLength(11);
    expect(f.options[0]).toEqual({ label: "OpenAI: GPT-5.5", value: "openai:gpt-5.5" });
    expect(f.default).toBe("openai:nemotron-3.5-lightning");
  });

  it("normalizes a boolean feature that is false", () => {
    // Every boolean in the captured agents.json is true, so a regression to
    // `if (value === true)` would pass every capture-driven test above while
    // silently dropping a feature that is switched off. Synthetic input is
    // legitimate here: this tests branch logic, not wire format.
    const out = normalizeFeatures({ "some-flag": false }, "someAgent");
    expect(out["some-flag"]).toEqual({ kind: "boolean", value: false });
  });

  it("normalizes a toggle whose default is false", () => {
    const out = normalizeFeatures(
      { "some-toggle": { label: "Some Toggle", default: false, description: "d" } },
      "someAgent",
    );
    expect(out["some-toggle"]).toEqual({
      kind: "toggle",
      label: "Some Toggle",
      default: false,
      description: "d",
    });
  });

  it("reads a text feature", () => {
    expect(
      normalizeFeatures({ "agent-name": { type: "text", label: "Name", default: "Bot", description: "d" } }, "a"),
    ).toEqual({ "agent-name": { kind: "text", label: "Name", default: "Bot", description: "d" } });
  });

  it("drops an unrecognised feature shape and logs once per agent+feature", async () => {
    const { logOnce } = await import("../logger");
    const out = normalizeFeatures({ weird: 12345 }, "someAgent");
    expect(out.weird).toBeUndefined();
    expect(logOnce).toHaveBeenCalled();
    const key = (logOnce as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(String(key)).toContain("someAgent");
    expect(String(key)).toContain("weird");
  });
});

describe("fetchAgentsJson", () => {
  it("GETs <backendUrl>/agents.json", async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify(CAPTURE), { status: 200 }));
    await fetchAgentsJson("http://rita.example", fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://rita.example/agents.json");
  });

  it("tolerates a trailing slash on the base url", async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify(CAPTURE), { status: 200 }));
    await fetchAgentsJson("http://rita.example/", fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://rita.example/agents.json");
  });

  it("preserves the first 500 characters of an error body in the thrown error", async () => {
    // A reverse proxy's own error page names the real problem where a bare
    // status code does not.
    const fetchImpl = vi.fn(async () => new Response("nginx: upstream refused", { status: 502 }));
    await expect(fetchAgentsJson("http://rita.example", fetchImpl as never)).rejects.toThrow(
      /upstream refused/,
    );
  });

  it("truncates that preview to 500 characters", async () => {
    const fetchImpl = vi.fn(async () => new Response("y".repeat(2000), { status: 500 }));
    const error = (await fetchAgentsJson("http://rita.example", fetchImpl as never).catch(
      (e: unknown) => e,
    )) as Error;
    const run = /y+/.exec(error.message)?.[0] ?? "";
    expect(run).toHaveLength(500);
  });
});

it("keeps features.feedback: true as a boolean feature (agents-for-openbb 42)", () => {
  const out = normalizeAgentsJson({ a: { name: "A", endpoints: { query: "/v1/query" }, features: { feedback: true } } });
  expect(out.a.features.feedback).toEqual({ kind: "boolean", value: true });
});
