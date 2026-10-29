# `mcp_tool` Widget Citation (v6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A widget whose `widgets.json` declares `mcp_tool: { mcp_server, tool_id }` is cited in Rita's Sources when the latest answer's recorded MCP calls include that server name and tool, and clicking the citation adds the widget to the open dashboard or brings its existing card into view.

**Architecture:** `widgetsJson.ts` parses `mcp_tool` into `WidgetDef.mcpTool`. `chatStore` keeps the latest turn's calls (`turnCalls`) beside the chat-wide ledger. A pure `citedWidgets()` in `Sources.tsx` matches those calls (server id → Settings `name`) against the widget registry, and `Sources` renders the matches as buttons wired to `openCitedWidget()`. `ChatPane` connects the stores.

**Tech Stack:** React 18, TypeScript, zustand, vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-workspace-field-gaps-design.md`. This plan covers item G only, plus the spec's "Shared rules" and "Success criteria" as they apply to G. OpenBB's interface reference for the field: bdobb-v2 `docs/openbb-reference/widget-configuration/matching-widget-to-mcp-tool.md` and `json-specs/widgets-json-reference.md` (`mcp_tool`).

## Open questions (found in v6.0.0; the plan builds the spec as written, these need a ruling)

1. **Successful direct calls from live Rita are not recorded.** A successful `execute_agent_tool` call reaches `calls` only through a status event whose `tool_call` carries `server_id` (`src/stores/chatStore.ts:444-453`), or through `labelProxiedStep`, which handles only `call_tool` and `run_pipeline` (`chatStore.ts:75-85`, `396-410`). Live agent-rita 0011 sends the status step without `server_id` (`chatStore.test.ts`, the "#37" tests). So a successful call to a plain tool such as `get_company_revenue_data` is never in `calls`, and its widget is never cited against live Rita. Only failures (`ok: false`) and status steps that carry `server_id` are recorded. To fix it, record every `execute_agent_tool` call in the `executeFunction` wrapper. That changes the ledger and the chat export, so it needs a ruling.
2. **Proxied calls record the proxy, not the tool.** A call through `call_tool` is recorded as `tool: "call_tool"`. The tool it really ran survives only inside the display string `display` ("OpenBQ MCP · equity_price_historical (via call_tool)"). The OpenBQ MCP runs almost all its tools this way (`src/help/guide/ai-library.md`). If `tool` must equal `tool_id` exactly, as the spec says, no OpenBQ provider tool can ever match. To fix it, store the effective names (`effectiveToolNames`) on the `AgentCall` and match on them too. That is beyond the spec, so it needs a ruling.
3. **Only some servers have a name.** `McpServerConfig.name` exists for apps.json imports and for the build default `"OpenBQ MCP"` (`src/lib/settingsFile.ts:190`). A server added by URL, or a dashboard server from `storage.mcpUrl`, has no name, and the AI Library cannot give it one. The plan matches on `name` only. An unnamed server never matches, and the plan does **not** fall back to the host that `mcpServerLabel` displays.
4. **Failed, denied or stopped calls.** The spec says "include a call". The plan skips calls with `ok === false`, because a call that returned no data should not be cited as a source. Confirm.
5. **What the OpenBB doc has that spec G leaves out.** The doc also shows a "Matching widget found" toast and a trailing `*` on the citation, and it adds the widget "to the same parameters as the ones that were utilized by the copilot". `AgentCall` stores no call arguments, so those parameters cannot be recovered. The plan follows spec G: no toast, no `*`, and the widget is added with its own defaults.
6. **"That answer" means the latest answer.** In v6, Sources renders once, for the latest turn. `citations` is reset on every send and is not persisted. The plan ties widget citations to the latest turn's calls (`turnCalls`). Like Rita's own citations, they are not persisted, so they are gone after a restart or Clear.

## Global Constraints

- The manifest is untrusted JSON. Read literal types only: non-empty strings. A malformed value is treated as absent, and it is reported as an issue the way `storage.mcpUrl` already is.
- An absent field leaves today's behaviour exactly as it is. With no match, nothing changes.
- `mcp_server` and `tool_id` match **exactly**. Do not trim or change case.
- New source files carry the AGPL-3.0-only two-line header (`scripts/header-check.sh`). Never an Apache header. (This plan creates no new source files.)
- Update in-app help (`src/help/guide/`) where the field's behaviour shows: `rita-chat.md`, the Sources bullet.
- No new dependencies. Match the surrounding idiom.
- Gates, all passing on the branch: `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, `bash scripts/header-check.sh`. Existing tests pass unchanged; only additive edits to fixtures/beforeEach.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The cited server's Settings entry was removed or renamed after the turn. The name is looked up at render, so a removed or renamed server gives no citation and no crash. Test in Task 4.
2. Two widgets on different backends declare the same `mcp_tool`. Both are cited, one button each. Test in Task 4.
3. The widget's card is on **another tab** of the open dashboard. That tab becomes active and no duplicate card is added. Test in Task 4.
4. There is no open dashboard (`activeDashboard()` is undefined). The click does nothing and does not throw. Test in Task 4.
5. The same tool is called twice in one turn. The widget is cited once. Test in Task 4.

---

### Task 1: Spec copy on this branch

The spec lives in the sibling v3 worktree. A copy at the same relative path makes this plan's Spec link resolve on this branch. **This step was done in the commit that added this plan.** Verify only.

**Files:**
- Create: `docs/superpowers/specs/2026-10-29-workspace-field-gaps-design.md` (verbatim copy of `/Users/artcashin/Developer/openbq-bdobb-v3-field-gaps/docs/superpowers/specs/2026-10-29-workspace-field-gaps-design.md`)

- [ ] **Step 1: Verify the copy is present and identical**

Run: `cmp /Users/artcashin/Developer/openbq-bdobb-v6-mcp-tool/docs/superpowers/specs/2026-10-29-workspace-field-gaps-design.md /Users/artcashin/Developer/openbq-bdobb-v3-field-gaps/docs/superpowers/specs/2026-10-29-workspace-field-gaps-design.md && echo same`
Expected: `same`. (If the v3 copy has changed since then, stop and ask; do not re-copy silently.)

---

### Task 2: Parse `mcp_tool` from widgets.json

**Files:**
- Modify: `src/lib/types.ts` (WidgetDef, next to `mcpUrl?: string;` ~line 335)
- Modify: `src/lib/widgetsJson.ts` (`normalizeWidgets`, next to the `storage.mcpUrl` block ~lines 560-566 and the `mcpUrl,` property ~line 603)
- Test: `src/lib/widgetsJson.test.ts` (after the `storage.mcpUrl` test ~line 835)

**Interfaces:**
- Produces: `WidgetDef.mcpTool?: { mcpServer: string; toolId: string }`
- Issue reason string (exact): `"mcp_tool needs non-empty string mcp_server and tool_id; ignored"`

- [ ] **Step 1: Write the failing test**

Add inside the same `describe` block as the `storage.mcpUrl` test in `src/lib/widgetsJson.test.ts`:

```ts
  it("reads mcp_tool as two non-empty strings, exactly as written, and reports anything else as an issue", () => {
    const { widgets, issues } = normalizeWidgets(
      {
        ok: { endpoint: "e", mcp_tool: { mcp_server: "Financial Data", tool_id: "get_company_revenue_data" } },
        empty: { endpoint: "e", mcp_tool: { mcp_server: "", tool_id: "t" } },
        missing: { endpoint: "e", mcp_tool: { mcp_server: "Financial Data" } },
        number: { endpoint: "e", mcp_tool: { mcp_server: "Financial Data", tool_id: 7 } },
        string: { endpoint: "e", mcp_tool: "Financial Data/get_company_revenue_data" },
        none: { endpoint: "e" },
      },
      "b1",
    );
    const tool = (id: string) => widgets.find((w) => w.id === id)?.mcpTool;
    expect(tool("ok")).toEqual({ mcpServer: "Financial Data", toolId: "get_company_revenue_data" });
    for (const id of ["empty", "missing", "number", "string", "none"]) expect(tool(id)).toBeUndefined();
    const reason = "mcp_tool needs non-empty string mcp_server and tool_id; ignored";
    for (const id of ["empty", "missing", "number", "string"]) expect(issues).toContainEqual({ id, reason });
    expect(issues.filter((i) => i.id === "none" || i.id === "ok")).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts -t "mcp_tool"`
Expected: FAIL. `tool("ok")` is `undefined` (and it is a TS error on `mcpTool`, which vitest does not type-check).

- [ ] **Step 3: Add the type**

In `src/lib/types.ts`, directly after the `mcpUrl?: string;` member of `WidgetDef`:

```ts
  /**
   * `mcp_tool`: the MCP server name and tool this widget answers for. When
   * Rita's latest answer called that tool on a server whose Settings name is
   * `mcpServer`, Sources cites this widget (see citedWidgets). Both are
   * non-empty strings, matched exactly.
   */
  mcpTool?: { mcpServer: string; toolId: string };
```

- [ ] **Step 4: Parse it**

In `src/lib/widgetsJson.ts`, directly after the `storage.mcpUrl` block (the `if (storage && storage.mcpUrl !== undefined) { ... }`):

```ts
    // mcp_tool names a server and tool to match exactly, so both must be
    // non-empty strings; anything else is reported and treated as absent.
    let mcpTool: WidgetDef["mcpTool"];
    if (w.mcp_tool !== undefined) {
      const t = asRecord(w.mcp_tool);
      if (t && typeof t.mcp_server === "string" && t.mcp_server !== "" && typeof t.tool_id === "string" && t.tool_id !== "") {
        mcpTool = { mcpServer: t.mcp_server, toolId: t.tool_id };
      } else issues.push({ id, reason: "mcp_tool needs non-empty string mcp_server and tool_id; ignored" });
    }
```

And in the `widgets.push({ ... })` object, directly after `mcpUrl,`:

```ts
      mcpTool,
```

(`WidgetDef` is already imported in this file's `import type { ... } from "./types"` block; if not, add it there.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/widgetsJson.test.ts`
Expected: PASS. The whole file passes, including the existing tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/widgetsJson.ts src/lib/widgetsJson.test.ts
git commit -m "feat(widgets): parse mcp_tool from widgets.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Keep the latest turn's calls in chatStore

`calls` is the chat-wide ledger. It is merged at the end of every turn and saved with the transcript. Sources describes only the latest answer, so the latest turn's calls are kept apart as `turnCalls`. Like `citations`, they are reset when a turn starts and emptied by Clear, and they are not persisted.

**Files:**
- Modify: `src/stores/chatStore.ts` (`ChatState` ~line 112; initial state ~line 156; `send`'s start `set(...)` ~line 222; `send`'s `finally` ~line 495; `clear` ~line 521)
- Test: `src/stores/chatStore.test.ts`

**Interfaces:**
- Produces: `ChatState.turnCalls: AgentCall[]` (the latest finished turn's calls, in order; `[]` while a turn runs, after Clear and after load).

- [ ] **Step 1: Write the failing test**

Add to `src/stores/chatStore.test.ts`, inside `describe("chatStore.send", ...)` (line ~118), next to "does not refuse a different tool on the same server":

```ts
  it("keeps the latest turn's calls apart from the ledger, and Clear empties them", async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example", mcpServers: [{ id: "s1", name: "Financial Data", url: "https://mcp.example/mcp", enabled: true }] },
    });
    // A status step that names its server is recorded as an agent_tool call.
    const step = (tool: string) =>
      `event: copilotStatusUpdate\ndata: ${JSON.stringify({ eventType: "INFO", message: `Calling ${tool}`, tool_call: { server_id: "s1", tool_name: tool } })}\n\n`;
    replies(step("quote") + fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("one");
    expect(useChatStore.getState().turnCalls).toEqual([{ kind: "agent_tool", server_id: "s1", tool: "quote", narrated: "Calling quote" }]);

    replies(step("news") + fixture("rita/simple-text.sse"));
    await useChatStore.getState().send("two");
    expect(useChatStore.getState().turnCalls.map((c) => (c.kind === "agent_tool" ? c.tool : c.kind))).toEqual(["news"]);
    expect(useChatStore.getState().calls).toHaveLength(2);

    await useChatStore.getState().clear();
    expect(useChatStore.getState().turnCalls).toEqual([]);
  });
```

In the file's top-level `beforeEach` (~line 99), add `turnCalls: [],` beside `calls: [],` in its `useChatStore.setState({ ... })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/stores/chatStore.test.ts -t "latest turn's calls"`
Expected: FAIL. `turnCalls` is `undefined`.

- [ ] **Step 3: Implement**

In `src/stores/chatStore.ts`:

`ChatState`, directly after `calls: AgentCall[];`:

```ts
  /**
   * The latest finished turn's calls: what Sources' widget citations
   * (mcp_tool) are matched against. Reset when a turn starts, like
   * `citations`; not saved.
   */
  turnCalls: AgentCall[];
```

Initial state, directly after `calls: [],` (the first one, in `create(...)`):

```ts
  turnCalls: [],
```

In `send`, the start-of-turn `set(...)`, add `turnCalls: []`:

```ts
    set({ running: true, error: null, citations: [], suggestions: [], trail: [], turnCalls: [], messages: [...prior, human] });
```

In `send`'s `finally`, replace the ledger merge line:

```ts
        set({ calls: [...get().calls, ...calls] });
```

with:

```ts
        set({ calls: [...get().calls, ...calls], turnCalls: calls });
```

In `clear`, directly after `calls: [],`:

```ts
      turnCalls: [],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/stores/chatStore.test.ts`
Expected: PASS. The whole file passes.

- [ ] **Step 5: Commit**

```bash
git add src/stores/chatStore.ts src/stores/chatStore.test.ts
git commit -m "feat(rita): keep the latest turn's calls for Sources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Match, render and open widget citations in Sources

**Files:**
- Modify: `src/components/rita/Sources.tsx`
- Modify: `src/components/DashboardGrid.tsx:177` (grid item `div`: add `data-card-id`)
- Test: `src/components/rita/Sources.test.tsx`
- Test: `src/components/DashboardGrid.test.tsx` ("renders one card per dashboard card")

**Interfaces:**
- Consumes: `WidgetDef.mcpTool` (Task 2); `AgentCall`, `McpServerConfig` from `src/lib/agent/types.ts`; `useDashboardStore` (`activeDashboard()`, `setActiveTab(dashboardId, tabId)`, `addCard(widget)`).
- Produces:
  - `citedWidgets(calls: AgentCall[], servers: McpServerConfig[], widgets: WidgetDef[]): WidgetDef[]`. Returns the registry widgets, in registry order, whose `mcpTool` matches a call with `kind === "agent_tool"` and `ok !== false`, where the call's `server_id` resolves to a Settings entry whose `name === mcpTool.mcpServer` and the call's `tool === mcpTool.toolId`.
  - `openCitedWidget(widget: WidgetDef): Promise<void>`. If the open dashboard has a card with the same `widgetId` and `backendId` on any tab, it makes that tab active and scrolls the card into view. Otherwise it calls `addCard(widget)`. With no open dashboard it does nothing.
  - `Sources({ citations, widgets = [] }: { citations: Record<string, unknown>[]; widgets?: WidgetDef[] })`
  - DOM: every grid item carries `data-card-id={card.id}`.

- [ ] **Step 1: Write the failing tests**

In `src/components/rita/Sources.test.tsx`, replace the import lines at the top (after the header) with:

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCall, McpServerConfig } from "../../lib/agent/types";
import { useDashboardStore } from "../../stores/dashboardStore";
import { card, widget } from "../../test/fixtures";
import { Sources, citationLink, citedWidgets, openCitedWidget } from "./Sources";
```

Then append:

```ts
const servers: McpServerConfig[] = [{ id: "s1", name: "Financial Data", url: "https://mcp.example/mcp", enabled: true }];
const call = (tool: string, over: Partial<Extract<AgentCall, { kind: "agent_tool" }>> = {}): AgentCall => ({
  kind: "agent_tool",
  server_id: "s1",
  tool,
  narrated: `Calling ${tool}`,
  ...over,
});
const revenue = widget({ id: "rev", backendId: "b1", name: "Revenue", mcpTool: { mcpServer: "Financial Data", toolId: "get_company_revenue_data" } });

describe("citedWidgets", () => {
  it("cites a widget whose server name and tool match a call exactly, once", () => {
    const plain = widget({ id: "plain", name: "Plain" });
    expect(citedWidgets([call("get_company_revenue_data"), call("get_company_revenue_data")], servers, [plain, revenue])).toEqual([revenue]);
  });

  it("cites every widget declaring the matched tool, on any backend", () => {
    const twin = widget({ ...revenue, backendId: "b2" });
    expect(citedWidgets([call("get_company_revenue_data")], servers, [revenue, twin])).toEqual([revenue, twin]);
  });

  it("cites nothing for another tool, a near-miss name, a failed call, a widget_data call, or an unnamed or missing server", () => {
    const none = (calls: AgentCall[], s = servers) => expect(citedWidgets(calls, s, [revenue])).toEqual([]);
    none([call("get_company_price_data")]);
    none([call("get_company_revenue_data")], [{ ...servers[0], name: "financial data" }]);
    none([call("get_company_revenue_data", { ok: false, error: "x" })]);
    none([{ kind: "widget_data", url: "u", params: {}, ok: true, durationMs: 1, rows: 1 }]);
    none([call("get_company_revenue_data")], [{ id: "s1", url: "https://mcp.example/mcp", enabled: true }]);
    none([call("get_company_revenue_data")], []);
  });
});

const REAL_ACTIONS = {
  addCard: useDashboardStore.getState().addCard,
  setActiveTab: useDashboardStore.getState().setActiveTab,
};

describe("openCitedWidget", () => {
  const addCard = vi.fn(async () => "new");
  const setActiveTab = vi.fn();
  beforeEach(() => {
    addCard.mockClear();
    setActiveTab.mockClear();
    useDashboardStore.setState({ addCard, setActiveTab });
  });
  afterEach(() => {
    useDashboardStore.setState({ ...REAL_ACTIONS, dashboards: [], activeId: null, activeTabId: null });
    document.body.innerHTML = "";
  });

  it("adds the widget to the open dashboard when no card of it is there", async () => {
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }], activeId: "d1", activeTabId: "t1" });
    await openCitedWidget(revenue);
    expect(addCard).toHaveBeenCalledWith(revenue);
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it("switches to the tab holding its existing card and scrolls it into view, adding nothing", async () => {
    const existing = card({ id: "c9", widgetId: "rev", backendId: "b1" });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "One", cards: [] }, { id: "t2", name: "Two", cards: [existing] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    const el = document.createElement("div");
    el.dataset.cardId = "c9";
    const scroll = vi.fn();
    el.scrollIntoView = scroll;
    document.body.appendChild(el);
    await openCitedWidget(revenue);
    expect(setActiveTab).toHaveBeenCalledWith("d1", "t2");
    expect(addCard).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it("treats a card of the same widget id on another backend as a different widget", async () => {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [card({ id: "c1", widgetId: "rev", backendId: "b2" })] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });
    await openCitedWidget(revenue);
    expect(addCard).toHaveBeenCalledWith(revenue);
  });

  it("does nothing without an open dashboard", async () => {
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    await expect(openCitedWidget(revenue)).resolves.toBeUndefined();
    expect(addCard).not.toHaveBeenCalled();
    expect(setActiveTab).not.toHaveBeenCalled();
  });
});

describe("Sources with widget citations", () => {
  it("renders cited widgets as buttons beside Rita's citations", () => {
    render(<Sources citations={[{ id: "a", source_info: { name: "Prices" } }]} widgets={[revenue]} />);
    expect(screen.getByText("Prices")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revenue" })).toBeTruthy();
  });

  it("renders with widget citations alone", () => {
    render(<Sources citations={[]} widgets={[revenue]} />);
    expect(screen.getByRole("button", { name: "Revenue" })).toBeTruthy();
  });
});
```

In `src/components/DashboardGrid.test.tsx`, extend "renders one card per dashboard card":

```ts
  it("renders one card per dashboard card", () => {
    const { container } = render(<DashboardGrid onOpenLibrary={() => {}} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect([...container.querySelectorAll<HTMLElement>("[data-card-id]")].map((e) => e.dataset.cardId)).toEqual(["c1", "c2"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/rita/Sources.test.tsx src/components/DashboardGrid.test.tsx`
Expected: FAIL. `citedWidgets` and `openCitedWidget` are not exported, and there are no `data-card-id` elements.

- [ ] **Step 3: Implement in `Sources.tsx`**

Replace `src/components/rita/Sources.tsx` from its imports to the end with:

```tsx
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AgentCall, McpServerConfig } from "../../lib/agent/types";
import { isRecord } from "../../lib/isRecord";
import { safeUrl } from "../../lib/safeUrl";
import type { WidgetDef } from "../../lib/types";
import { useDashboardStore } from "../../stores/dashboardStore";

/** Reduces a Rita citation to a label and an openable url (null when the source has none). */
export function citationLink(c: unknown): { name: string; url: string | null } | null {
  if (!isRecord(c)) return null;
  const info = isRecord(c.source_info) ? c.source_info : {};
  const name = typeof info.name === "string" ? info.name : typeof c.id === "string" ? c.id : "Source";
  const raw = typeof info.url === "string" ? info.url : typeof c.url === "string" ? c.url : null;
  if (raw === null) return { name, url: null };
  const url = safeUrl(raw);
  return url === null ? null : { name, url };
}

/**
 * The widgets whose `mcp_tool` matches a completed MCP call: the call's server,
 * by its Settings `name`, and its tool, both exactly. An unnamed server and a
 * failed call (`ok: false`) match nothing.
 */
export function citedWidgets(calls: AgentCall[], servers: McpServerConfig[], widgets: WidgetDef[]): WidgetDef[] {
  const used = calls.flatMap((c) => {
    if (c.kind !== "agent_tool" || c.ok === false) return [];
    const name = servers.find((s) => s.id === c.server_id)?.name;
    return name === undefined ? [] : [{ name, tool: c.tool }];
  });
  return widgets.filter((w) => {
    const t = w.mcpTool;
    return t !== undefined && used.some((u) => u.name === t.mcpServer && u.tool === t.toolId);
  });
}

/** Brings the widget's card on the open dashboard into view, or adds the widget there. */
export async function openCitedWidget(widget: WidgetDef): Promise<void> {
  const store = useDashboardStore.getState();
  const dashboard = store.activeDashboard();
  if (!dashboard) return;
  for (const tab of dashboard.tabs) {
    const existing = tab.cards.find((c) => c.widgetId === widget.id && c.backendId === widget.backendId);
    if (!existing) continue;
    store.setActiveTab(dashboard.id, tab.id);
    // After the tab switch has rendered the card. jsdom has no scrollIntoView.
    setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLElement>("[data-card-id]")].find((e) => e.dataset.cardId === existing.id);
      if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    }, 0);
    return;
  }
  await store.addCard(widget);
}

export function Sources({ citations, widgets = [] }: { citations: Record<string, unknown>[]; widgets?: WidgetDef[] }) {
  const links = citations.map(citationLink).filter((l): l is NonNullable<typeof l> => l !== null);
  if (links.length === 0 && widgets.length === 0) return null;
  return (
    <p className="chat-sources">
      Sources:{" "}
      {links.map((l, i) =>
        l.url === null ? (
          <span key={i}>{l.name}</span>
        ) : (
          <button key={i} type="button" onClick={() => void openUrl(l.url as string)}>
            {l.name}
          </button>
        ),
      )}
      {widgets.map((w) => (
        <button key={`${w.backendId}/${w.id}`} type="button" title={`Add ${w.name} to the dashboard, or show its card`} onClick={() => void openCitedWidget(w)}>
          {w.name}
        </button>
      ))}
    </p>
  );
}
```

Keep the file's two-line AGPL header above the imports, unchanged.

- [ ] **Step 4: Mark grid items**

In `src/components/DashboardGrid.tsx` (~line 177), change:

```tsx
          <div key={card.id} className={card.id === maximizedCardId ? "card-maximized" : undefined}>
```

to:

```tsx
          <div key={card.id} data-card-id={card.id} className={card.id === maximizedCardId ? "card-maximized" : undefined}>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/components/rita/Sources.test.tsx src/components/DashboardGrid.test.tsx`
Expected: PASS, including the existing `citationLink` and `Sources` tests, unchanged.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/rita/Sources.tsx src/components/rita/Sources.test.tsx src/components/DashboardGrid.tsx src/components/DashboardGrid.test.tsx
git commit -m "feat(rita): cite mcp_tool widgets in Sources and open them on click

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire ChatPane, update help, run all gates

**Files:**
- Modify: `src/components/rita/ChatPane.tsx`
- Modify: `src/help/guide/rita-chat.md` (Sources bullet, ~line 42)
- Test: `src/components/rita/ChatPane.test.tsx`

**Interfaces:**
- Consumes: `ChatState.turnCalls` (Task 3); `citedWidgets`, `Sources` `widgets` prop (Task 4); `useSettingsStore` `settings.mcpServers`; `useWidgetRegistryStore` `widgets`.

- [ ] **Step 1: Write the failing test**

In `src/components/rita/ChatPane.test.tsx`:

Add `turnCalls: [],` directly after `calls: [],` in the `beforeEach`'s `useChatStore.setState({ ... })`, so no test inherits another test's turn.

Add the imports:

```ts
import { widget } from "../../test/fixtures";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
```

Add the test inside the `ChatPane` describe:

```ts
  it("cites a widget whose mcp_tool matches a call in the latest turn", () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, mcpServers: [{ id: "s1", name: "Financial Data", url: "https://mcp.example/mcp", enabled: true }] },
    });
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "rev", name: "Revenue", mcpTool: { mcpServer: "Financial Data", toolId: "get_company_revenue_data" } })],
    });
    useChatStore.setState({ turnCalls: [{ kind: "agent_tool", server_id: "s1", tool: "get_company_revenue_data", narrated: "Calling" }] });
    render(<ChatPane onInputFocus={() => {}} />);
    expect(screen.getByRole("button", { name: "Revenue" })).toBeTruthy();
  });

  it("cites nothing when the latest turn made no matching call", () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "rev", name: "Revenue", mcpTool: { mcpServer: "Financial Data", toolId: "get_company_revenue_data" } })],
    });
    render(<ChatPane onInputFocus={() => {}} />);
    expect(screen.queryByRole("button", { name: "Revenue" })).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/rita/ChatPane.test.tsx -t "mcp_tool"`
Expected: FAIL. There is no "Revenue" button.

- [ ] **Step 3: Wire ChatPane**

In `src/components/rita/ChatPane.tsx`:

Add the imports, beside the existing ones:

```ts
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { Sources, citedWidgets } from "./Sources";
```

(Replace the existing `import { Sources } from "./Sources";` line.)

Inside `ChatPane`, after `const promptSuggestions = ...`:

```ts
  const mcpServers = useSettingsStore((s) => s.settings.mcpServers);
  const registry = useWidgetRegistryStore((s) => s.widgets);
```

Add `turnCalls` to the `useChatStore()` destructure:

```ts
  const { messages, calls, turnCalls, trail, citations, suggestions, running, error, pinned, pendingTool, pendingMessage } = useChatStore();
```

Replace `<Sources citations={citations} />` with:

```tsx
        <Sources citations={citations} widgets={citedWidgets(turnCalls, mcpServers, registry)} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/rita/ChatPane.test.tsx`
Expected: PASS. The whole file passes.

- [ ] **Step 5: Update help**

In `src/help/guide/rita-chat.md`, replace the line:

```markdown
- **Sources** — the widgets and documents Rita cited, clickable when they have an address.
```

with:

```markdown
- **Sources** — the widgets and documents Rita cited, clickable when they have an address. A widget whose `widgets.json` declares `mcp_tool` (`mcp_server`, `tool_id`) is listed too when this answer called that tool on an MCP server with that exact name in **AI Library ▸ MCP Servers**. Click it to add the widget to the open dashboard, or, if a card of it is already there, to switch to that card's tab and bring it into view.
```

Then run the guide's own tests: `pnpm vitest run src/help`
Expected: PASS.

- [ ] **Step 6: Run every gate**

Run, each from `/Users/artcashin/Developer/openbq-bdobb-v6-mcp-tool`:

```bash
pnpm typecheck
pnpm lint
pnpm test:run
bash scripts/header-check.sh
```

Expected: all four exit 0. (If `pnpm test:run` times out under host load, rerun the failing file alone before treating it as a failure.)

- [ ] **Step 7: Commit**

```bash
git add src/components/rita/ChatPane.tsx src/components/rita/ChatPane.test.tsx src/help/guide/rita-chat.md
git commit -m "feat(rita): show mcp_tool widget citations in the chat pane; document them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Success check (spec "Success criteria", item G)

- OpenBB's example (`mcp_server: "Financial Data"`, `tool_id: "get_company_revenue_data"`) is cited when a recorded, successful call to that tool on the server named "Financial Data" is in the latest turn. Pinned by the Task 4 and Task 5 tests. Against live Rita this also depends on Open questions 1 and 2.
- A manifest without `mcp_tool` behaves exactly as before. With no `mcp_tool` there is nothing to match, and `Sources` renders exactly as before when `widgets` is empty (the existing tests pass unchanged).
- All four gates pass (Task 5, Step 6).
