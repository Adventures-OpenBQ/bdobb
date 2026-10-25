// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Rita URL's agents.json, shared. The Agents tab, the chat pane's model
 * note and chatStore's workspace_options all read the same document; before
 * this, the tab and the pane each fetched their own copy and chatStore had
 * none. Best-effort exactly as before: a failure is a state, never a throw,
 * and an unreachable agents.json never disables chat -- discovery does not
 * gate chat (B1's ruling).
 *
 * Who starts it (final review I1, live check LC1): App calls
 * useAgentDiscovery for the main window's Rita URL, so discovery runs at
 * launch and on every URL change, not only once the chat pane or the Agents
 * tab mounts -- a first message sent from a closed pane (a sendToAgent
 * click) otherwise went out with workspace_options {}. chatStore.send also
 * kicks it off, without waiting, when nothing is known for the URL.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { fetchAgentsJson } from "../lib/agent/agents-json";
import type { AgentsJson } from "../lib/agent/types";

export type Discovery =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "online"; agents: AgentsJson }
  | { state: "offline"; message: string };

type DiscoveryState = {
  url: string;
  discovery: Discovery;
  discover: (url: string) => Promise<void>;
  /**
   * Re-reads an ONLINE url in the background (final review M7): the state
   * stays "online" with the current agents while the fetch runs, then takes
   * the new document or goes "offline". Without it an online answer was kept
   * for the whole session -- presence said "online" after Rita went down,
   * and a feature Rita added never appeared. Any other state is a discover.
   */
  refresh: (url: string) => Promise<void>;
};

/** Only the latest request may land: a slow answer for an old URL must not overwrite a new one. */
let seq = 0;

export const useAgentDiscoveryStore = create<DiscoveryState>((set, get) => {
  async function fetchFor(url: string, mine: number) {
    try {
      const agents = await fetchAgentsJson(url);
      if (mine === seq) set({ discovery: { state: "online", agents } });
    } catch (err) {
      if (mine === seq) set({ discovery: { state: "offline", message: err instanceof Error ? err.message : String(err) } });
    }
  }
  return {
    url: "",
    discovery: { state: "idle" },
    discover: async (url) => {
      const current = get();
      // Online or in flight for this URL already: nothing new to learn. An
      // offline URL is retried, so Rita coming back is noticed on the next
      // mount instead of never.
      if (url !== "" && url === current.url && (current.discovery.state === "online" || current.discovery.state === "loading")) return;
      const mine = ++seq;
      if (url === "") {
        set({ url, discovery: { state: "idle" } });
        return;
      }
      set({ url, discovery: { state: "loading" } });
      await fetchFor(url, mine);
    },
    refresh: async (url) => {
      const current = get();
      if (url === "" || url !== current.url || current.discovery.state !== "online") return get().discover(url);
      // A new seq, so a newer discover/refresh (another URL included) still wins.
      await fetchFor(url, ++seq);
    },
  };
});

/**
 * Discovers `ritaUrl` on mount and whenever it changes; returns the shared
 * state. An already-online URL is refreshed in the background rather than
 * trusted for the rest of the session (M7).
 */
export function useAgentDiscovery(ritaUrl: string): Discovery {
  const discovery = useAgentDiscoveryStore((s) => s.discovery);
  useEffect(() => {
    void useAgentDiscoveryStore.getState().refresh(ritaUrl);
  }, [ritaUrl]);
  return discovery;
}

export function __resetAgentDiscoveryForTests(): void {
  seq++;
  useAgentDiscoveryStore.setState({ url: "", discovery: { state: "idle" } });
}
