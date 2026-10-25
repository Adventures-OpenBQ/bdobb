// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { AgentDescriptor } from "./types";
import { pickAgent, workspaceOptionsFor } from "./workspaceOptions";

const agent: AgentDescriptor = {
  id: "a1",
  name: "A",
  description: "",
  queryPath: "/v1/query",
  features: {
    streaming: { kind: "boolean", value: true },
    "deep-research": { kind: "toggle", label: "Deep Research", default: false, description: "" },
    model: { kind: "select", label: "Model", default: "m1", options: [{ label: "M1", value: "m1" }] },
    "agent-name": { kind: "text", label: "Agent name", default: "My Bot", description: "" },
  },
};

describe("workspaceOptionsFor", () => {
  it("sends toggle, select and text defaults with the right primitive types, and no capability booleans", () => {
    expect(workspaceOptionsFor(agent)).toEqual({ "deep-research": false, model: "m1", "agent-name": "My Bot" });
  });

  it("lets a stored value of the right type win over the default", () => {
    expect(workspaceOptionsFor(agent, { "deep-research": true, "agent-name": "Rita" })).toEqual({
      "deep-research": true,
      model: "m1",
      "agent-name": "Rita",
    });
  });

  it("ignores a stored value of the wrong type, and one for an undeclared feature", () => {
    expect(workspaceOptionsFor(agent, { "deep-research": "yes", ghost: true, streaming: false })).toEqual({
      "deep-research": false,
      model: "m1",
      "agent-name": "My Bot",
    });
  });

  it("is {} for no agent, or one with no configurable features", () => {
    expect(workspaceOptionsFor(undefined)).toEqual({});
    expect(workspaceOptionsFor({ ...agent, features: { streaming: { kind: "boolean", value: true } } })).toEqual({});
  });
});

describe("pickAgent", () => {
  it("prefers the agent whose query endpoint is the one posted to, else the first", () => {
    const other = { ...agent, id: "b", queryPath: "https://elsewhere.example/v1/query" };
    expect(pickAgent({ b: other, a1: agent }, "https://rita.example")?.id).toBe("a1");
    expect(pickAgent({ b: other }, "https://rita.example")?.id).toBe("b");
    expect(pickAgent({}, "https://rita.example")).toBeUndefined();
  });
});
