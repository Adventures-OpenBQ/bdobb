// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { normalizeMcpUrl, resetMcpCache } from "../lib/agent/mcp";
import { loadMcpTokens, saveMcpTokens, type McpTokens } from "../lib/mcpTokensFile";

type TokensState = {
  tokens: McpTokens;
  load: () => Promise<void>;
  setToken: (url: string, token: string) => Promise<void>;
  removeToken: (url: string) => Promise<void>;
};

export const useMcpTokensStore = create<TokensState>((set, get) => ({
  tokens: {},
  load: async () => set({ tokens: await loadMcpTokens() }),
  setToken: async (url, token) => {
    const tokens = { ...get().tokens, [normalizeMcpUrl(url)]: { token } };
    set({ tokens });
    // A discovery cached under the old (or no) credential is stale now.
    resetMcpCache();
    await saveMcpTokens(tokens);
  },
  removeToken: async (url) => {
    const key = normalizeMcpUrl(url);
    if (!(key in get().tokens)) return;
    const { [key]: _gone, ...rest } = get().tokens;
    set({ tokens: rest });
    resetMcpCache();
    await saveMcpTokens(rest);
  },
}));
