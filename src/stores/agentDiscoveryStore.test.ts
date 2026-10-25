// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAgentsJson = vi.fn();
vi.mock("../lib/agent/agents-json", async () => {
  const actual = await vi.importActual<typeof import("../lib/agent/agents-json")>("../lib/agent/agents-json");
  return { ...actual, fetchAgentsJson: (...a: unknown[]) => fetchAgentsJson(...a) };
});

import { __resetAgentDiscoveryForTests, useAgentDiscoveryStore } from "./agentDiscoveryStore";

beforeEach(() => {
  __resetAgentDiscoveryForTests();
  fetchAgentsJson.mockReset();
});

describe("agent discovery", () => {
  it("is idle for an empty URL and never fetches", async () => {
    await useAgentDiscoveryStore.getState().discover("");
    expect(useAgentDiscoveryStore.getState().discovery).toEqual({ state: "idle" });
    expect(fetchAgentsJson).not.toHaveBeenCalled();
  });

  it("records the agents, and does not refetch an online URL", async () => {
    fetchAgentsJson.mockResolvedValue({ a: { id: "a" } });
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    expect(useAgentDiscoveryStore.getState().discovery).toEqual({ state: "online", agents: { a: { id: "a" } } });
    expect(fetchAgentsJson).toHaveBeenCalledTimes(1);
  });

  it("records a failure, and retries an offline URL", async () => {
    fetchAgentsJson.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({});
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    expect(useAgentDiscoveryStore.getState().discovery).toEqual({ state: "offline", message: "down" });
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    expect(useAgentDiscoveryStore.getState().discovery.state).toBe("online");
  });

  // final review M7: an online URL was kept for the whole session, so the
  // pane said "online" after Rita went down and a new feature never showed.
  it("refreshes an online URL in the background: stays online during the fetch, then updates", async () => {
    fetchAgentsJson.mockResolvedValueOnce({ a: { id: "a" } });
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    let resolve!: (v: unknown) => void;
    fetchAgentsJson.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const pending = useAgentDiscoveryStore.getState().refresh("https://rita.example");
    expect(useAgentDiscoveryStore.getState().discovery).toEqual({ state: "online", agents: { a: { id: "a" } } });
    resolve({ b: { id: "b" } });
    await pending;
    expect(useAgentDiscoveryStore.getState().discovery).toEqual({ state: "online", agents: { b: { id: "b" } } });
    expect(fetchAgentsJson).toHaveBeenCalledTimes(2);
  });

  it("a background refresh that fails goes offline", async () => {
    fetchAgentsJson.mockResolvedValueOnce({ a: { id: "a" } }).mockRejectedValueOnce(new Error("down"));
    await useAgentDiscoveryStore.getState().discover("https://rita.example");
    await useAgentDiscoveryStore.getState().refresh("https://rita.example");
    expect(useAgentDiscoveryStore.getState().discovery).toEqual({ state: "offline", message: "down" });
  });

  it("a refresh of a URL that is not online is an ordinary discover", async () => {
    fetchAgentsJson.mockResolvedValueOnce({ a: {} });
    await useAgentDiscoveryStore.getState().refresh("https://rita.example");
    expect(useAgentDiscoveryStore.getState()).toMatchObject({ url: "https://rita.example", discovery: { state: "online" } });
  });

  it("lets only the latest URL's answer land", async () => {
    let resolveOld!: (v: unknown) => void;
    fetchAgentsJson.mockImplementationOnce(() => new Promise((r) => (resolveOld = r))).mockResolvedValueOnce({ b: {} });
    const old = useAgentDiscoveryStore.getState().discover("https://old.example");
    await useAgentDiscoveryStore.getState().discover("https://new.example");
    resolveOld({ a: {} });
    await old;
    expect(useAgentDiscoveryStore.getState()).toMatchObject({ url: "https://new.example", discovery: { state: "online", agents: { b: {} } } });
  });
});
