# Workspace Connection and Settings Storage Implementation Plan (spec revision 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** this plan does five things:
- Move the OpenBB Workspace sign-in from Settings ▸ General into Connections as Workspace connections.
- Add Settings ▸ General ▸ **User Settings**: Local or Server. Server offers a dropdown of the connections that present the Workspace settings API, each labelled with its probed mode (key or login), and gives two-way sync.
- Give every connection an **Ask for credentials on startup** option.
- Show the OpenBB mark on Platform-API backend cards and on Workspace cards.
- Remove the per-backend "Allowed code languages" field and its client gate.

**Architecture:**
- **`workspaceAccount.ts`** builds on the bug #9 fix (`c8c7f7c`) and supports two modes, chosen by the probe:
  - **Login mode** signs in with `/pro/login` only and takes `user.pro_display_settings` from the response. Its token goes only in `Authorization: Bearer`.
  - **Key mode** reads `GET /pro/user` and posts `/pro/display-settings` with the connection's own key/value credential alone, with no login and no token.

  Either way, the session holds `displaySettings`. The sign-in diff is computed from it with no network call, and an upload merges onto it.
- **`workspaceStore`** holds:
  - the Workspace connections and remembered usernames, persisted as `workspace.json`;
  - one in-memory session per connection id, each with its `mode`;
  - the probe answers (modes);
  - per-connection upload queues.

  `settingsStore.save` feeds the queue when `settingsStorage` names a connection with a live session.
- **`backendsStore`** gains in-memory runtime credentials, which are never written, and a discovery that waits for flagged backends without a value.
- **Dialogs** follow `decideImportConflicts`' own-root idiom: the Workspace sign-in dialog, the backend credential step and the conflict dialog.
- **`runWorkspaceSync.ts`** holds four flows:
  - `connectServer` probes the connection, then connects by key or by login, then syncs;
  - the sign-in sync;
  - a card's Sign in;
  - the launch sequence, which always connects the settings server first and then walks the other flagged connections.
- **The OpenBB mark** is a port of the bdobb-v2 worktree's uncommitted diff.

**Tech Stack:** TypeScript, React 19, zustand, Tauri plugins (`plugin-http`, `plugin-fs` via `jsonStore`, `plugin-dialog`), vitest + Testing Library, `src/test/memfs`, `src/test/mockServer`.

**Spec:** `docs/superpowers/specs/2026-10-08-workspace-connection-design.md` (revision 4, commit 335e820). Bug #9: https://github.com/Adventures-OpenBQ/bdobb/issues/9, fixed in `c8c7f7c`. Task 1 is built as `3a63d99`.

## Global Constraints

**Repository and git**
- Branch `codex/clean-v3-repair`, local only, never push. Before every commit, run `git -C ~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair branch --show-current` and require `codex/clean-v3-repair`. Always use absolute paths and `git -C <repo>`.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The bdobb-v2 worktree `~/Developer/bdobb-v2/.claude/worktrees/laughing-mayer-c7afb3` is read-only. Read it with `git -C <path> diff`; never modify or commit there.
- The bug #9 fix is on the branch as `c8c7f7c`. Task 5 builds on it; nothing depends on that commit's code beyond what Task 5 restates.
- Tracked files use `workspace.example` for any hostname; real tailnet names never appear. `pnpm scrub` must pass.

**What is stored on disk**
- `workspace.json` has exactly `{ "connections": [{ "id", "name", "serverUrl", "askOnStartup" }], "usernames": { "<connection id>": string } }`.
  - There may be any number of Workspace connections.
  - A username is stored only when Remember me was ticked at that connection's last sign-in; unticking deletes it.
  - No password and no token is ever written.
- `BackendConfig.askOnStartup?: boolean`. A flagged backend always keeps its `headerName`. Its `headerValue` reaches `backends.json` only when remembered; otherwise it lives in memory for the run.
- `Settings.settingsStorage?: string` holds a connection id; absent means Local, and an id that names no existing connection is Local. It is never uploaded or downloaded, and it is excluded from the export bundle the way `dashboardOrder` is.

**Sync and requests**
- The synced keys are exactly `NATIVE_KEYS` in `workspaceAccount.ts`: theme, fontSize, defaultTicker, matchDashboardSymbol, maxDecimalPlaces, minimizeButton, collapseWidgetControls, cornerDragHandles, quickAddToolbar, railWidth, autoRefreshMinutes.
- **`defaultTicker` is not written as a shared key.** It travels only inside `extensions.bdobb`.
- **Never call `GET /pro/user` with a session token.** It is called only with the connection's own key/value credential, by the probe and by key mode.
- Login mode sends the token **only** as `Authorization: Bearer <token>`; `X-OpenBB-Authorization` is never sent. Key mode sends no token and never calls `/pro/login`.
- A data backend always sends its own credential (header, query or cookie, per `authLocation`).
- A backend whose own credential header is `Authorization` is fine in key mode. It is disabled only for login mode, with the reason "Credential uses the Authorization header".
- Every upload merges onto the session's `displaySettings`, POSTs to `/pro/display-settings`, and on success replaces `displaySettings`. Uploads run on a `serialize` chain per connection and send the latest state.
- The address rule (HTTPS, or HTTP on loopback; no credentials, query or fragment) applies to every connection that receives a password.
- **The probe** sends `GET /pro/user` with the connection's own credential (none for a Workspace connection) and no token, with a 5 s limit. The answer decides the mode:
  - 200 with a `pro_display_settings` object → **key**;
  - 401 or 403 → **login**;
  - anything else → no API.
- **Launch with Server on** always connects the chosen connection first, flagged or not:
  - A flagged backend without a value gets its Key/Value step first.
  - Key mode then syncs with no prompt.
  - Login mode opens the sign-in dialog.
  - Cancel or a failure keeps local settings for the run and uploads nothing.
- **A 401 in key mode** is `not-synced: key refused`, never `expired`.

**User-facing strings, verbatim**
- Session states: "Signed in as X", "Connected by key", "Signed out", "Session expired", "Not synced: <reason>", reason "key refused".
- Cards: "Holds settings", "Add Workspace", "Settings API: key" / "Settings API: login" / "Settings API: no".
- User Settings: "User Settings", "Local", "Server", "Choose a server…", "<name> — key", "<name> — login", "No settings API", "Needs HTTPS", "Credential uses the Authorization header".
- Dialogs: "Ask for credentials on startup", "Remember me", "Signing in can replace another OpenBB Workspace session", "Use <connection name>", "Keep local".
- Empty-list hint: "Add a Workspace connection in Connections, or a backend that serves the Workspace settings API."

**Behaviour and style**
- No Workspace error blocks or undoes a local save; local settings stay authoritative.
- Old `backends.json` files that still carry `allowedCodeLanguages` load, and the field is dropped on the next write.
- Keep the repo style: the license header on new files, and long explanatory comments on non-obvious choices.

**Commands**
- One file: `pnpm test:run <file>`. All tests: `pnpm test:run`.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm scrub`.
- If the full suite times out, check `uptime` for host load before suspecting the code.

## Review Focus

1. **A failed connect or sync while choosing a server in User Settings** (refused key, cancelled sign-in, or refused display settings). The choice stays on its previous value and nothing is uploaded. Test: Task 9, "choosing a server connects to it; a failure or Cancel keeps the previous value".
2. **Sign-out or removal while an upload is in flight.** The late result must not reinstate a session state or overwrite `displaySettings`. Test: Task 6, "ignores an upload result that lands after sign-out".
3. **Secrets on disk.** After sign-in, an upload and an unremembered backend value, no file in app data contains the password, the token or that value. Test: Task 6, "never writes the password or token to disk"; Task 4, "never writes an unremembered value".
4. **The `?viewer=` window at launch.** It must never prompt or connect a settings server. It discovers every backend, flagged ones included, because no prompt will ever supply their value there. Test: Task 10, "never prompts in a viewer window and discovers every backend".
5. **Ticking Ask for credentials on startup on a working backend mid-run.** The stored value leaves `backends.json`, but the backend keeps its credential in memory until quit, instead of going offline at once. Test: Task 4, "ticking Ask for credentials on startup keeps the value in memory for this run".

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `src/lib/types.ts` | modify | drop `allowedCodeLanguages`; add `BackendConfig.askOnStartup?`, `Settings.settingsStorage?` |
| `src/lib/backendsFile.ts` (+ test) | modify | no code-language default; drop the old field on read; validate `askOnStartup` |
| `src/lib/omni.ts`, `src/components/renderers/OmniRenderer.tsx` (+ test) | modify | delete `codeBlocked` and the block banner |
| `src/components/dialogs/BackendEditForm.tsx` (+ test) | modify | delete the languages field; add the Ask for credentials on startup checkbox |
| `src/lib/dataClient.ts`, `src/lib/discovery.ts` (+ test) | modify | `fetchServiceName`, `OPENBB_PLATFORM_SERVICE`, `service` |
| `src/stores/backendsStore.ts` (+ test) | modify | `services`, `runtimeCredentials`, `setCredential`, `refresh(only?)` |
| `src/components/services/ServiceCard.tsx` | modify | `mark: ReactNode` |
| `src/lib/settingsFile.ts`, `src/lib/settingsBundle.ts` (+ tests) | modify | validate and exclude `settingsStorage` |
| `src/lib/workspaceAccount.ts` (+ test) | rewrite around the bug #9 fix | login mode, key mode, session settings, upload, mode probe, merge |
| `src/stores/workspaceStore.ts` (+ test) | create | connections, usernames, sessions, probes, upload queues |
| `src/stores/settingsStore.ts` (+ test) | modify | upload hook in `save` |
| `src/components/dialogs/WorkspaceDialogs.tsx` (+ test) | create | Workspace form, sign-in dialog, backend credential step, conflict dialog |
| `src/components/runWorkspaceSync.ts` (+ test) | create | `syncAfterSignIn`, `connectServer`, `promptSignIn`, `runStartupPrompt` |
| `src/components/dialogs/ConnectionsDialog.tsx` (+ test) | modify | OpenBB mark, Workspace group, Settings API line, removal rules, backend edit seeding |
| `src/components/dialogs/SettingsDialog.tsx` (+ test) | modify | User Settings (Local / Server + dropdown) replaces the account panel |
| `src/components/dialogs/settings/WorkspaceAccountSettings.tsx` | delete | replaced |
| `src/lib/bootstrap.ts` (+ test) | modify | load `workspace.json`; discovery that waits; launch sequence |
| help, docs, `scripts/*` | modify | follow the UI |

---

### Task 1: Remove "Allowed code languages" (spec §5) — DONE

- [x] **Built as `3a63d99`** ("fix(v3): remove per-backend allowed code languages; the server decides"). Do not redo it. Later tasks assume its result:
  - `BackendConfig` has no `allowedCodeLanguages`, and `Draft` has none;
  - `src/lib/omni.ts` has no `codeBlocked`;
  - `withDefaults` in `backendsFile.ts` drops the old field on read.

---

### Task 2: OpenBB mark on Platform-API backend cards (spec §6, port)

**Files:**
- Modify: `src/lib/dataClient.ts`: add after `fetchAppsJson` (ends near line 553).
- Modify: `src/lib/discovery.ts`: `DiscoveryResult` and `discoverBackend`.
- Modify: `src/stores/backendsStore.ts`: the `services` map.
- Modify: `src/components/services/ServiceCard.tsx:7` (`mark: ReactNode`)
- Modify: `src/components/dialogs/ConnectionsDialog.tsx`: the `OPENBB_MARK` glyph and `markFor`.
- Test: `src/lib/discovery.test.ts`, `src/stores/backendsStore.test.ts`, `src/components/dialogs/ConnectionsDialog.test.tsx`

**Interfaces:**
- Produces:
  - `export const OPENBB_PLATFORM_SERVICE = "openbb-platform"` and `fetchServiceName(backend: BackendConfig): Promise<string | undefined>` (never rejects) in `dataClient`;
  - `DiscoveryResult.service?: string`;
  - `useBackendsStore` state `services: Record<string, string | undefined>`;
  - `export const OPENBB_MARK: ReactNode` from `ConnectionsDialog.tsx`, which Task 8's Workspace cards use.

- [ ] **Step 1: Write the failing tests**

`src/lib/discovery.test.ts`: change `import { APPS_TIMEOUT_MS } from "./dataClient";` to `import { APPS_TIMEOUT_MS, OPENBB_PLATFORM_SERVICE } from "./dataClient";`, then append:

```ts
describe("discoverBackend service probe", () => {
  it("reads the service name from GET /", async () => {
    const b = await serve({ "/widgets.json": {}, "/": { service: "rss-ticker", version: "8.3.0" } }, "rss");
    expect((await discoverBackend(b)).service).toBe("rss-ticker");
  });

  it("recognises the OpenBB Platform API by its HTML landing page", async () => {
    const page = "<!doctype html><html><head><title>OpenBB Platform</title></head></html>";
    const other = "<!doctype html><html><head><title>Something else</title></head></html>";
    const obb = await serve({ "/widgets.json": {}, "/": { __status: 200, __body: page, __contentType: "text/html" } }, "obb");
    const html = await serve({ "/widgets.json": {}, "/": { __status: 200, __body: other, __contentType: "text/html" } }, "html");
    expect((await discoverBackend(obb)).service).toBe(OPENBB_PLATFORM_SERVICE);
    expect((await discoverBackend(html)).service).toBeUndefined();
  });

  it("a / that 404s or is not JSON leaves the backend online with no service", async () => {
    // The probe is advisory: online/offline is widgets.json's call alone.
    const b = await serve({ "/widgets.json": {} }, "plain");
    const result = await discoverBackend(b);
    expect(result.status).toBe("online");
    expect(result.service).toBeUndefined();
  });
});
```

`src/stores/backendsStore.test.ts`:
- In `beforeEach`, change the reset to `useBackendsStore.setState({ backends: [], statuses: {}, issues: {}, services: {} });`.
- Append:

```ts
describe("services", () => {
  it("records the service name discovery found, and forgets it on remove", async () => {
    const url = await serve({ "/widgets.json": {}, "/": { service: "rss-ticker" } });
    const id = await useBackendsStore.getState().addBackend({ name: "Feeds", baseUrl: url, authLocation: "header", validateWidgets: false });
    await vi.waitFor(() => expect(useBackendsStore.getState().services[id]).toBe("rss-ticker"));
    await useBackendsStore.getState().removeBackend(id);
    expect(useBackendsStore.getState().services).not.toHaveProperty(id);
  });
});
```

`src/components/dialogs/ConnectionsDialog.test.tsx`:
- Add `import { OPENBB_PLATFORM_SERVICE } from "../../lib/dataClient";`.
- In `beforeEach`, add `services: {}` to the `useBackendsStore.setState` reset.
- Add inside `describe("ConnectionsDialog")`:

```tsx
  it("marks only an OpenBB Platform API backend with the OpenBB logo", () => {
    useBackendsStore.setState({
      backends: [
        backend({ id: "b1", name: "Platform", baseUrl: "http://a" }),
        backend({ id: "b2", name: "Custom", baseUrl: "http://b" }),
      ],
      statuses: { b1: "online", b2: "online" },
      services: { b1: OPENBB_PLATFORM_SERVICE, b2: "rss-ticker" },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    const platform = screen.getByRole("article", { name: /platform/i });
    const custom = screen.getByRole("article", { name: /custom/i });
    expect(platform.querySelector(".bd-service-icon svg")).not.toBeNull();
    expect(custom.querySelector(".bd-service-icon svg")).toBeNull();
    expect(custom.querySelector(".bd-service-icon")).toHaveTextContent("DB");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run src/lib/discovery.test.ts src/stores/backendsStore.test.ts src/components/dialogs/ConnectionsDialog.test.tsx`
Expected: FAIL, because `OPENBB_PLATFORM_SERVICE` is not exported, `service` is undefined, and `services` does not exist.

- [ ] **Step 3: Implement (port of the bdobb-v2 diff)**

`src/lib/dataClient.ts`: add this after `fetchAppsJson`:

```ts
/**
 * The service name discovery records for a backend whose root names one;
 * the OpenBB Platform API's is synthesised from its landing page, below.
 */
export const OPENBB_PLATFORM_SERVICE = "openbb-platform";

/**
 * `GET <baseUrl>/` -> the body's `service` name, or undefined. A backend's
 * root is not part of the OpenBB contract, so this is advisory only. Any
 * failure -- 404, not JSON, no `service`, timeout -- is simply "not
 * recognised", never an error: the backend's online/offline status is
 * widgets.json's call alone. Same deadline as apps.json, for the same
 * reason: it runs inside discovery.
 *
 * The OpenBB Platform API answers `/` with an HTML landing page rather than
 * JSON; its <title> is how Connections tells it from any other backend
 * speaking the same widgets.json protocol (stores-explorer, a custom one).
 */
export async function fetchServiceName(backend: BackendConfig): Promise<string | undefined> {
  try {
    const url = applyAuthQuery(new URL(joinUrl(backend.baseUrl, "")), backend);
    const body = await request("GET", url.toString(), authHeaders(backend), undefined, {
      signal: AbortSignal.timeout(APPS_TIMEOUT_MS),
    });
    if (typeof body === "string") {
      return /<title>\s*OpenBB Platform\s*<\/title>/i.test(body) ? OPENBB_PLATFORM_SERVICE : undefined;
    }
    const service = (body as { service?: unknown } | null)?.service;
    return typeof service === "string" && service !== "" ? service : undefined;
  } catch {
    return undefined;
  }
}
```

`src/lib/discovery.ts`:
- Import `fetchServiceName`.
- Add `/** The backend's \`GET /\` service name, online results only; see fetchServiceName. */ service?: string;` to `DiscoveryResult`.
- In `discoverBackend`, after `const apps = discoverApps(backend);`, add:

```ts
  // Started alongside apps.json for the same reason; fetchServiceName never rejects.
  const service = fetchServiceName(backend);
```

- On the online path, before the `return`, add `const name = await service;`, and add `...(name !== undefined ? { service: name } : {}),` to the returned object.
- On the catch path, after `await apps;`, add `await service;`.

`src/stores/backendsStore.ts`:
- Add this to `BackendsState`: `/** Backend id → its \`GET /\` service name from the last discovery; see fetchServiceName. */ services: Record<string, string | undefined>;`
- Add `services: {},` to the initial state.
- In `refresh`'s `set`, add:

```ts
        // Every live result overwrites its entry, undefined included: an
        // offline backend, or one whose root stopped naming a service, must
        // not keep the mark from a previous probe.
        services: {
          ...state.services,
          ...Object.fromEntries(live.map((r) => [r.backendId, r.service])),
        },
```

- In `removeBackend`, build `const services = { ...get().services }; delete services[id];` alongside `statuses` and `issues`, and include `services` in its `set`.

`src/components/services/ServiceCard.tsx`: change `mark: string;` to `mark: ReactNode;`. Extend the doc comment's mark sentence to: "The mark ("DB"/"AI"/"MCP", or the OpenBB glyph) is decorative and hidden from assistive tech."

`src/components/dialogs/ConnectionsDialog.tsx`:
- Add `import { OPENBB_PLATFORM_SERVICE } from "../../lib/dataClient";`.
- After `PANEL_ID`, add:

```tsx
/** The OpenBB "BB" glyph, cut from the wordmark on openbb.co; marks the OpenBB Platform API and every Workspace connection. */
export const OPENBB_MARK = (
  <svg viewBox="51 -6.3 24 24" width="28" height="28" fill="currentColor">
    <path d="M60.707 1.416h-9.285v4.25h9.285v1.42h-7.854v4.25h9.283V1.423h-1.428l-.001-.007Zm0 7.793v.707H54.28V8.5h6.427v.709Zm0-5.668v.71h-7.854V2.831h7.855l-.001.71ZM69.99 11.333h2.852V7.087H64.99V5.671h9.285V1.42H63.562v9.913h6.428Zm-5-7.791v-.709h7.852V4.25H64.99v-.709Zm2.858 6.375H64.99V8.5h6.438v1.417h-3.58ZM63.563 0h-1.428v1.416h1.428V0Z" />
  </svg>
);
```

- Add `markFor: (backend: BackendConfig) => ReactNode;` to `ServiceGroup`'s props, and destructure it. Replace `mark="DB"` with `mark={markFor(b)}`.
- In `ConnectionsDialog`, add `const services = useBackendsStore((s) => s.services);` and:

```ts
  /** Discovery's `GET /` probe names the OpenBB Platform API; see fetchServiceName. */
  const markFor = (b: BackendConfig) => (services[b.id] === OPENBB_PLATFORM_SERVICE ? OPENBB_MARK : "DB");
```

- Pass `markFor={markFor}` to the `ServiceGroup` render.

If `pnpm lint` flags `react-refresh/only-export-components` on the exported `OPENBB_MARK`, move the constant unchanged into `src/components/services/OpenBBMark.tsx` (with the license header) and import it from there in Task 2 and Task 8.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm test:run src/lib/discovery.test.ts src/stores/backendsStore.test.ts src/components/dialogs/ConnectionsDialog.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/lib/dataClient.ts src/lib/discovery.ts src/lib/discovery.test.ts src/stores/backendsStore.ts src/stores/backendsStore.test.ts src/components/services/ServiceCard.tsx src/components/dialogs/ConnectionsDialog.tsx src/components/dialogs/ConnectionsDialog.test.tsx
git -C $R commit -m "feat(v3): mark OpenBB Platform API backends with the OpenBB glyph

Ported from the uncommitted bdobb-v2 claude/openbb-logo-dialog-c99ee6 work,
adding the fetchServiceName probe and services map clean v3 lacked.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `settingsStorage` setting

**Files:**
- Modify: `src/lib/types.ts` (`Settings`)
- Modify: `src/lib/settingsFile.ts` (`withDefaults`)
- Modify: `src/lib/settingsBundle.ts:49-58`: the exclusion type and the `BUNDLE_SETTINGS_KEYS` comment.
- Test: `src/lib/settingsFile.test.ts`, `src/lib/settingsBundle.test.ts`

**Interfaces:**
- Produces: `Settings.settingsStorage?: string`. After `withDefaults` it is a non-empty string or `undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/settingsFile.test.ts`, inside the `describe` holding the `loadSettings` tests:

```ts
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
```

Append to `src/lib/settingsBundle.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run src/lib/settingsFile.test.ts src/lib/settingsBundle.test.ts`
Expected: FAIL. `settingsStorage: 7` survives the load, and the bundle test fails to typecheck.

- [ ] **Step 3: Implement**

`src/lib/types.ts`: add this inside `Settings`, after `autoRefreshMinutes`:

```ts
  /**
   * The id of the connection settings are stored on: a Workspace connection
   * (workspace.json) or a data backend that serves the Workspace settings
   * API. Absent means Local. An id naming no connection is Local too --
   * see storageConnection in workspaceStore. It describes this machine, so
   * it is itself never synced and never in the export bundle.
   */
  settingsStorage?: string;
```

`src/lib/settingsFile.ts`: in `withDefaults`, add this after the `dashboardOrder` entry:

```ts
    // Only the shape is checked here. Whether the id still names a
    // connection is decided once connections have loaded (storageConnection
    // in workspaceStore), because settings load before backends.json and
    // workspace.json do. Anything else is Local, i.e. absent.
    settingsStorage:
      typeof loaded.settingsStorage === "string" && loaded.settingsStorage !== "" ? loaded.settingsStorage : undefined,
```

`src/lib/settingsBundle.ts`: change the exclusion to `(typeof BUNDLE_SETTINGS_KEYS)[number] | "dashboardOrder" | "settingsStorage"`. Add to the `BUNDLE_SETTINGS_KEYS` comment: "settingsStorage is excluded too: it names a connection on THIS machine, and on another machine it would name nothing."

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm test:run src/lib/settingsFile.test.ts src/lib/settingsBundle.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/lib/types.ts src/lib/settingsFile.ts src/lib/settingsFile.test.ts src/lib/settingsBundle.ts src/lib/settingsBundle.test.ts
git -C $R commit -m "feat(v3): add the settingsStorage setting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ask for credentials on startup for data backends (storage and edit form)

**Files:**
- Modify: `src/lib/types.ts` (`BackendConfig`)
- Modify: `src/lib/backendsFile.ts` (`isStoredBackend`)
- Modify: `src/stores/backendsStore.ts`:
  - add `runtimeCredentials` and `setCredential`;
  - change `refresh(only?)`;
  - apply `persistable` to every write;
  - update `updateBackend`.
- Modify: `src/components/dialogs/BackendEditForm.tsx`: add the `Draft.askOnStartup` field, update `EMPTY_DRAFT` and `toInput`, add the checkbox, and hide Value when it is ticked.
- Modify: `src/components/dialogs/ConnectionsDialog.tsx` (`startEdit`)
- Test: `src/lib/backendsFile.test.ts`, `src/stores/backendsStore.test.ts`, `src/components/dialogs/BackendEditForm.test.tsx`, `src/components/dialogs/ConnectionsDialog.test.tsx`

**Interfaces:**
- Produces:
  - `BackendConfig.askOnStartup?: boolean`
  - `useBackendsStore` state `runtimeCredentials: string[]`: the ids whose in-memory `headerValue` must never be written.
  - `setCredential(id: string, headerName: string, headerValue: string, remember: boolean): Promise<void>`: sets the credential, persists it only if `remember`, then discovers that backend.
  - `refresh(only?: string[]): Promise<void>`. With no argument, it skips flagged backends that have no value yet. With ids, it discovers exactly those backends.
  - `Draft.askOnStartup: boolean`

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `src/lib/backendsFile.test.ts` that holds "loads a valid list":

```ts
  it("keeps Ask for credentials on startup, and quarantines a non-boolean one", async () => {
    const flagged = [{ ...valid[0], headerName: "username", askOnStartup: true }];
    __seed("backends.json", JSON.stringify(flagged));
    expect(await loadBackends()).toEqual(flagged);
    __seed("backends.json", JSON.stringify([{ ...valid[0], askOnStartup: "yes" }]));
    await loadBackends();
    expect(__read("backends.json.corrupt")).not.toBeUndefined();
  });
```

In `src/stores/backendsStore.test.ts`, change the `beforeEach` reset to `useBackendsStore.setState({ backends: [], statuses: {}, issues: {}, services: {}, runtimeCredentials: [] });`, then append:

```ts
describe("Ask for credentials on startup", () => {
  const flagged = (baseUrl: string) => ({ name: "Gateway", baseUrl, headerName: "username", authLocation: "header" as const, validateWidgets: false, askOnStartup: true });

  it("never writes an unremembered value, through any later write", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend(flagged(url));
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", false);
    expect(useBackendsStore.getState().backends[0].headerValue).toBe("admin@workspace.example");
    expect(useBackendsStore.getState().runtimeCredentials).toEqual([id]);
    await useBackendsStore.getState().updateBackend(id, { name: "Renamed" });
    expect(__read("backends.json")).not.toContain("admin@workspace.example");
    expect(JSON.parse(__read("backends.json") ?? "")[0]).toMatchObject({ name: "Renamed", headerName: "username", askOnStartup: true });
  });

  it("Remember me stores the value; unticking it removes the stored value again", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend(flagged(url));
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", true);
    expect(JSON.parse(__read("backends.json") ?? "")[0].headerValue).toBe("admin@workspace.example");
    await useBackendsStore.getState().setCredential(id, "username", "admin@workspace.example", false);
    expect(__read("backends.json")).not.toContain("admin@workspace.example");
  });

  it("refresh() leaves a flagged backend without a value waiting; refresh([id]) discovers it", async () => {
    const url = await serve({ "/widgets.json": {} });
    useBackendsStore.setState({ backends: [{ id: "g", ...flagged(url) }], statuses: { g: "unknown" } });
    await useBackendsStore.getState().refresh();
    expect(useBackendsStore.getState().statuses.g).toBe("unknown");
    await useBackendsStore.getState().refresh(["g"]);
    expect(useBackendsStore.getState().statuses.g).toBe("online");
  });

  it("ticking Ask for credentials on startup keeps the value in memory for this run", async () => {
    const url = await serve({ "/widgets.json": {} });
    const id = await useBackendsStore.getState().addBackend({ name: "Gateway", baseUrl: url, headerName: "K", headerValue: "V", authLocation: "header", validateWidgets: false });
    await useBackendsStore.getState().updateBackend(id, { askOnStartup: true, headerName: "K", headerValue: undefined });
    expect(useBackendsStore.getState().backends[0].headerValue).toBe("V");
    expect(JSON.parse(__read("backends.json") ?? "")[0]).not.toHaveProperty("headerValue");
    // Unticking makes what the form saved the stored value again.
    await useBackendsStore.getState().updateBackend(id, { askOnStartup: undefined, headerName: "K", headerValue: "V" });
    expect(JSON.parse(__read("backends.json") ?? "")[0].headerValue).toBe("V");
    expect(useBackendsStore.getState().runtimeCredentials).toEqual([]);
  });
});
```

In `src/components/dialogs/BackendEditForm.test.tsx`, add `askOnStartup: false,` to the file's `draft` literal. Then append inside `describe("BackendEditForm")`:

```tsx
  it("hides Value but keeps Key when Ask for credentials on startup is ticked", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<BackendEditForm draft={draft} onChange={onChange} onSubmit={() => {}} onCancel={() => {}} />);
    await userEvent.click(screen.getByLabelText("Ask for credentials on startup"));
    expect(onChange).toHaveBeenCalledWith({ ...draft, askOnStartup: true });
    rerender(<BackendEditForm draft={{ ...draft, askOnStartup: true }} onChange={onChange} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Key")).toBeInTheDocument();
    expect(screen.queryByLabelText("Value")).toBeNull();
  });

  it("saves the key, drops the value and sets the flag when asking on startup", () => {
    expect(toInput({ ...EMPTY_DRAFT, name: "a", baseUrl: "b", headerName: " username ", headerValue: "secret", askOnStartup: true })).toMatchObject({
      askOnStartup: true,
      headerName: "username",
      headerValue: undefined,
    });
    expect(toInput({ ...EMPTY_DRAFT, name: "a", baseUrl: "b" }).askOnStartup).toBeUndefined();
  });
```

In `src/components/dialogs/ConnectionsDialog.test.tsx`, append inside `describe("ConnectionsDialog")`:

```tsx
  it("seeds the edit form's Ask for credentials on startup from the backend", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "g", name: "Gateway", headerName: "username", askOnStartup: true })], statuses: { g: "online" } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Gateway" }));
    expect(screen.getByLabelText("Ask for credentials on startup")).toBeChecked();
    expect(screen.getByLabelText("Key")).toHaveValue("username");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run src/lib/backendsFile.test.ts src/stores/backendsStore.test.ts src/components/dialogs/BackendEditForm.test.tsx src/components/dialogs/ConnectionsDialog.test.tsx`
Expected: FAIL. `askOnStartup` is not a field yet, and `setCredential` and `runtimeCredentials` do not exist.

- [ ] **Step 3: Implement**

`src/lib/types.ts`: add this to `BackendConfig`, after `validateWidgets`:

```ts
  /**
   * Ask for this backend's credential value at launch instead of storing it.
   * headerName (the key, e.g. "username") stays stored; headerValue reaches
   * backends.json only when the startup prompt's Remember me was ticked, and
   * otherwise lives in memory for the run (backendsStore.runtimeCredentials).
   */
  askOnStartup?: boolean;
```

`src/lib/backendsFile.ts`: in `isStoredBackend`, next to the `validateWidgets` check, add `if ("askOnStartup" in value && typeof value.askOnStartup !== "boolean") return false;`.

`src/stores/backendsStore.ts`:

- Add this at module scope, after `PROBED_FIELDS`:

```ts
/**
 * What may be written: a backend whose value was typed at the startup prompt
 * without Remember me keeps it in memory only. Every saveBackends call goes
 * through this, so no later edit of the same backend can write it by accident.
 */
function persistable(backends: BackendConfig[], runtime: string[]): BackendConfig[] {
  return backends.map((b) => (runtime.includes(b.id) ? { ...b, headerValue: undefined } : b));
}

/** Flagged and still without a value: discovery waits for its startup step. */
const waiting = (b: BackendConfig) => b.askOnStartup === true && !b.headerValue;
```

- Add these to `BackendsState`:

```ts
  /** Ids whose in-memory headerValue must never be written; see persistable. */
  runtimeCredentials: string[];
  setCredential: (id: string, headerName: string, headerValue: string, remember: boolean) => Promise<void>;
```

- Change `refresh: () => Promise<void>;` to `refresh: (only?: string[]) => Promise<void>;`.
- Add `runtimeCredentials: [],` to the initial state.
- Replace every `await saveBackends(backends);` with `await saveBackends(persistable(backends, get().runtimeCredentials));`. In `updateBackend`, use its own `runtimeCredentials` variable instead, as shown below.
- In `refresh`, change its signature to `refresh: async (only) => {` and its first line to:

```ts
      // An explicit list is discovered as given -- a startup step's Continue or
      // Skip, or the viewer window. Otherwise a flagged backend still waiting
      // for its value is left alone: probing it without its credential would
      // only mark it offline before its prompt is answered.
      const probed = only ? get().backends.filter((b) => only.includes(b.id)) : get().backends.filter((b) => !waiting(b));
```

- Replace the body of `updateBackend`'s enqueued task with:

```ts
        const before = get().backends.find((b) => b.id === id);
        if (before === undefined) return;
        // Ticking Ask for credentials on startup removes the stored value (the
        // form sends headerValue undefined), but the backend keeps working
        // this run: the value it had moves to memory, exactly as if typed at
        // the prompt without Remember me. Unticking it makes whatever the
        // form saved the stored value again.
        const keep =
          patch.askOnStartup === true && patch.headerValue === undefined && before.headerValue !== undefined && patch.headerName === before.headerName;
        const backends = get().backends.map((b) => (b.id === id ? { ...b, ...patch, ...(keep ? { headerValue: before.headerValue } : {}) } : b));
        const others = get().runtimeCredentials.filter((x) => x !== id);
        const runtimeCredentials = keep || (patch.askOnStartup === true && get().runtimeCredentials.includes(id)) ? [...others, id] : others;
        await saveBackends(persistable(backends, runtimeCredentials));
        set({ backends, runtimeCredentials });
        void get().refresh([id]).catch(() => {});
```

  `addBackend` still calls `refresh()`. `refresh([id])` is used here so that an edited flagged backend is re-probed even while it is waiting for its value.

- In `removeBackend`, include `runtimeCredentials: get().runtimeCredentials.filter((x) => x !== id)` in its `set`.
- Add the new action:

```ts
    // A startup step's Continue. The value is stored only with Remember me;
    // otherwise it is memory-only (and, if it was stored before, removed
    // from the file now). Then that backend's discovery runs.
    setCredential: (id, headerName, headerValue, remember) =>
      enqueue(async () => {
        if (!get().backends.some((b) => b.id === id)) return;
        const backends = get().backends.map((b) => (b.id === id ? { ...b, headerName, headerValue } : b));
        const others = get().runtimeCredentials.filter((x) => x !== id);
        const runtimeCredentials = remember ? others : [...others, id];
        await saveBackends(persistable(backends, runtimeCredentials));
        set({ backends, runtimeCredentials });
        void get().refresh([id]).catch(() => {});
      }),
```

`src/components/dialogs/BackendEditForm.tsx`:

- Add `/** Key stays stored; the value is asked for at launch (Value is hidden). */ askOnStartup: boolean;` to `Draft`, and `askOnStartup: false,` to `EMPTY_DRAFT`.
- In `toInput`, add `askOnStartup: draft.askOnStartup ? true : undefined,` to `base`, with the comment "Explicit undefined, so unticking clears the flag through `{ ...b, ...patch }`". Then put this as the first `return` after `base`:

```ts
  if (draft.askOnStartup) {
    // The key stays stored; the value is asked for at every launch. Explicit
    // undefined so updateBackend drops a stored value (backendsStore keeps it
    // in memory for the rest of this run).
    return { ...base, headerName: draft.headerName.trim() || undefined, headerValue: undefined };
  }
```

- In the form, replace the Key/Value `bd-form-grid` with:

```tsx
        <label className="bd-check">
          <input
            type="checkbox"
            checked={draft.askOnStartup}
            onChange={(e) => onChange({ ...draft, askOnStartup: e.target.checked })}
          />
          Ask for credentials on startup
        </label>
        <div className="bd-form-grid">
          <div className="bd-field">
            <label htmlFor="backend-key">Key</label>
            <input
              id="backend-key"
              className="bd-input"
              value={draft.headerName}
              onChange={(e) => onChange({ ...draft, headerName: e.target.value })}
            />
          </div>
          {draft.askOnStartup ? null : (
            <div className="bd-field">
              <label htmlFor="backend-value">Value</label>
              <input
                id="backend-value"
                className="bd-input"
                type="password"
                value={draft.headerValue}
                onChange={(e) => onChange({ ...draft, headerValue: e.target.value })}
              />
            </div>
          )}
        </div>
```

  If no `.bd-check` class exists in `src/styles/dialogs.css`, use the same markup with `className="bd-inline"`. Do not add CSS.

`src/components/dialogs/ConnectionsDialog.tsx`: in `startEdit`, add `askOnStartup: backend.askOnStartup === true,` to the seeded draft.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm test:run src/lib/backendsFile.test.ts src/stores/backendsStore.test.ts src/components/dialogs/BackendEditForm.test.tsx src/components/dialogs/ConnectionsDialog.test.tsx && pnpm typecheck && pnpm lint`

Expected: PASS and clean. If `typecheck` names another literal `Draft`, add `askOnStartup: false` to it and change nothing else.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/lib/types.ts src/lib/backendsFile.ts src/lib/backendsFile.test.ts src/stores/backendsStore.ts src/stores/backendsStore.test.ts src/components/dialogs/BackendEditForm.tsx src/components/dialogs/BackendEditForm.test.tsx src/components/dialogs/ConnectionsDialog.tsx src/components/dialogs/ConnectionsDialog.test.tsx
git -C $R commit -m "feat(v3): ask for a backend's credential on startup instead of storing it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Workspace requests: login mode (bug #9), key mode, session settings, upload, probe

**Files:**
- Modify: `src/lib/workspaceAccount.ts`. It already carries the bug #9 fix (`c8c7f7c`).
  - Keep `serverAddress`, `responseJson`, `preferencePatch`, `UUID` and `NATIVE_KEYS`.
  - Replace `loadWorkspaceSettings`; Task 9 removes its only caller.
- Test: `src/lib/workspaceAccount.test.ts`. Rewrite it, keeping every case `c8c7f7c` left, adapted to the new interfaces.

**Interfaces:**
- Consumes: `authHeaders` and `applyAuthQuery` from `dataClient`; `BackendConfig`; `Settings` (Task 3).
- Produces:
  - `type SettingsConnection = { id: string; name: string; baseUrl: string; backend?: BackendConfig }`
  - `type WorkspaceCredentials = { connection: SettingsConnection; username: string; password: string }`
  - `type WorkspaceSession = { mode: "login"; connection: SettingsConnection; username: string; userId: string; token: string; displaySettings: unknown } | { mode: "key"; connection: SettingsConnection; displaySettings: unknown }`
  - `type WorkspaceResult<T> = { ok: true; value: T } | { ok: false; message: string; expired: boolean }`
  - `type WorkspaceDownload = { patch: Partial<Settings>; notes: string[]; review: string[] }`
  - `type SettingsApi = "key" | "login" | "no" | "needs-https" | "authorization-header"`
  - `KEY_REFUSED = "key refused"`: the not-synced reason for a key-mode 401.
  - `workspaceAddress(raw: string): WorkspaceResult<string>`
  - `workspaceSignIn(input: WorkspaceCredentials, signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceSession>>`. Login mode; one `POST /pro/login`.
  - `connectByKey(connection: SettingsConnection, signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceSession>>`. Key mode; one `GET /pro/user` with the connection's own credential, and no token.
  - `readSessionSettings(session: WorkspaceSession, current: Settings): WorkspaceResult<WorkspaceDownload>`. Synchronous, with no network.
  - `uploadWorkspaceSettings(session: WorkspaceSession, settings: Settings, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, unknown>>>`. It resolves with the merged object it posted.
  - `mergeUpload(display: Record<string, unknown>, settings: Settings): Record<string, unknown>`
  - `probeSettingsApi(connection: SettingsConnection): Promise<SettingsApi>`

- [ ] **Step 0: Build on the bug #9 fix**

The fix is on the branch as `c8c7f7c` ("read Workspace preferences from the login response"). Check that it is still there:

```bash
git -C ~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair log --oneline 638c69e..HEAD -- src/lib/workspaceAccount.ts src/lib/workspaceAccount.test.ts
```

Read every commit that command lists with `git -C <repo> show <sha>`.

- **What the fix already does.** It reads `user.pro_display_settings` from the login response. It drops the token's `GET /pro/user` and `X-OpenBB-Authorization`. It keeps the `UUID.test` check on the login's `uuid`.
- **What this task adds.** Treat the fix's login parsing and its tests as the starting point. This task adds:
  - the `SettingsConnection` argument;
  - backend credentials;
  - the returned session, including `mode` and `displaySettings`;
  - key mode;
  - `readSessionSettings`;
  - the upload and the merge;
  - the probe.
- **Missing or different commit.** If the commit is gone, or a later commit changed this file differently, implement Step 3 as written; nothing here depends on that commit's code. Where a later change contradicts the spec, the spec wins; note the difference in the task report.

- [ ] **Step 1: Write the failing tests**

Replace `src/lib/workspaceAccount.test.ts` with the following. Any case a later commit added stays too.

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import {
  connectByKey,
  KEY_REFUSED,
  mergeUpload,
  probeSettingsApi,
  readSessionSettings,
  uploadWorkspaceSettings,
  workspaceAddress,
  workspaceSignIn,
  type SettingsConnection,
  type WorkspaceSession,
} from "./workspaceAccount";
import { DEFAULT_SETTINGS } from "./settingsFile";
import { backend } from "../test/fixtures";
import type { AuthLocation, Settings } from "./types";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
const userId = "11111111-1111-4111-8111-111111111111";
const workspace: SettingsConnection = { id: "ws1", name: "Work", baseUrl: "https://workspace.example/api/" };
const credentials = { connection: workspace, username: "alice", password: "synthetic-password" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const login = (display: unknown = { theme: "light" }) =>
  vi.mocked(fetch).mockResolvedValueOnce(reply({ uuid: userId, access_token: "synthetic-session", force_2fa: false, temporary_password: false, user: { pro_display_settings: display } }));
const session = (displaySettings: unknown, connection: SettingsConnection = workspace): WorkspaceSession => ({ mode: "login", connection, username: "alice", userId, token: "synthetic-session", displaySettings });
const keySession = (displaySettings: unknown, connection: SettingsConnection): WorkspaceSession => ({ mode: "key", connection, displaySettings });
const call = (n: number) => vi.mocked(fetch).mock.calls[n];
const headersOf = (n: number) => call(n)[1]?.headers as Record<string, string>;
const viaBackend = (headerName: string, authLocation: AuthLocation = "header"): SettingsConnection => {
  const b = backend({ id: "b1", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName, headerValue: "Basic c3ludGhldGlj", authLocation });
  return { id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b };
};
beforeEach(() => vi.mocked(fetch).mockReset());

describe("workspaceAddress", () => {
  it("normalises an HTTPS address and refuses an unsafe one", () => {
    expect(workspaceAddress("https://workspace.example/api/")).toEqual({ ok: true, value: "https://workspace.example/api" });
    for (const raw of ["", "http://remote.example", "https://name:pass@workspace.example", "https://workspace.example/?token=secret", "https://workspace.example/#x"]) {
      expect(workspaceAddress(raw).ok).toBe(false);
    }
    expect(workspaceAddress("http://127.0.0.1:6900").ok).toBe(true);
  });
});

describe("workspaceSignIn (login mode; bug #9: login only)", () => {
  it.each([
    { ...credentials, username: "" },
    { ...credentials, password: "" },
    { ...credentials, connection: { ...workspace, baseUrl: "" } },
  ])("rejects partial input without network traffic", async (input) => {
    expect((await workspaceSignIn(input)).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns the session with the login response's display settings, and calls nothing else", async () => {
    login({ theme: "light", keepMe: 1 });
    const result = await workspaceSignIn(credentials);
    expect(result).toEqual({ ok: true, value: session({ theme: "light", keepMe: 1 }) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe("https://workspace.example/api/pro/login");
    expect(JSON.parse(call(0)[1]?.body as string)).toEqual({ email: "alice", password: "synthetic-password", remember: false, source: "pro" });
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
  });
  it.each([202, 401, 403, 500])("refuses a login answered with HTTP %i, not as an expiry", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ detail: "synthetic-password" }, status));
    const result = await workspaceSignIn(credentials);
    expect(result).toMatchObject({ ok: false, expired: false });
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
  });
  it.each([{ force_2fa: true }, { temporary_password: true }, { uuid: "not-a-uuid" }])("refuses an unverified account or an invalid response", async (flags) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ uuid: userId, access_token: "synthetic-session", ...flags }));
    expect((await workspaceSignIn(credentials)).ok).toBe(false);
  });
  it.each(["http://remote.example", "https://name:pass@workspace.example", "https://workspace.example/?token=secret"])("refuses %s before sending credentials", async (baseUrl) => {
    expect((await workspaceSignIn({ ...credentials, connection: { ...workspace, baseUrl } })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("allows a loopback development server", async () => {
    login();
    expect((await workspaceSignIn({ ...credentials, connection: { ...workspace, baseUrl: "http://127.0.0.1:6900" } })).ok).toBe(true);
  });
  it("cancels before making a request when already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await workspaceSignIn(credentials, controller.signal)).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("handles invalid JSON and network failure without echoing response data", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic-password"));
    const result = await workspaceSignIn(credentials);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not JSON"));
    expect((await workspaceSignIn(credentials)).ok).toBe(false);
  });
  it("sends a data backend's own credential with the login", async () => {
    login();
    await workspaceSignIn({ ...credentials, connection: viaBackend("X-Gateway-Key") });
    expect(headersOf(0)).toMatchObject({ "X-Gateway-Key": "Basic c3ludGhldGlj" });
  });
});

describe("connectByKey (key mode)", () => {
  it.each([
    ["header", "X-Gateway-Key", (n: number) => expect(headersOf(n)).toEqual({ "X-Gateway-Key": "Basic c3ludGhldGlj" })],
    ["cookie", "session", (n: number) => expect(headersOf(n)).toEqual({ Cookie: "session=Basic c3ludGhldGlj" })],
    ["query", "apikey", (n: number) => expect(call(n)[0]).toBe("https://gateway.workspace.example/pro/user?apikey=Basic+c3ludGhldGlj")],
  ] as const)("reads GET /pro/user with only the %s credential: no login, no token", async (location, name, check) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: { theme: "light" } }));
    const connection = viaBackend(name, location);
    expect(await connectByKey(connection)).toEqual({ ok: true, value: keySession({ theme: "light" }, connection) });
    expect(fetch).toHaveBeenCalledTimes(1);
    check(0);
    expect(JSON.stringify(call(0))).not.toContain("Bearer");
  });
  it("works for a backend whose own credential is the Authorization header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect((await connectByKey(viaBackend("Authorization"))).ok).toBe(true);
    expect(headersOf(0)).toEqual({ Authorization: "Basic c3ludGhldGlj" });
  });
  it.each([[401, KEY_REFUSED], [500, undefined]])("a %i is a failure, never an expiry", async (status, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, status));
    const result = await connectByKey(viaBackend("X-Gateway-Key"));
    expect(result).toMatchObject({ ok: false, expired: false });
    if (message !== undefined) expect(result).toMatchObject({ message });
  });
  it("refuses a 200 without display settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ uuid: userId }));
    expect((await connectByKey(viaBackend("X-Gateway-Key"))).ok).toBe(false);
  });
});

describe("readSessionSettings", () => {
  it("maps the session's display settings and reviews what differs, with no network", () => {
    const current = { ...DEFAULT_SETTINGS, autoRefreshMinutes: 15 as const };
    const result = readSessionSettings(session({ theme: "light", decimalDigits: 3, fontSize: "large", defaultTicker: { symbol: "MSFT" }, showWidgetControls: true }), current);
    expect(result).toMatchObject({ ok: true, value: { patch: { theme: "light", maxDecimalPlaces: 3, fontSize: "large", defaultTicker: "MSFT", collapseWidgetControls: false } } });
    if (result.ok) expect(result.value.review).toContain("Theme: dark → light");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lets the extensions.bdobb block override the shared keys", () => {
    const result = readSessionSettings(session({ theme: "light", extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { theme: "dark", autoRefreshMinutes: 5, railWidth: 60, defaultTicker: null } } } }), DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true, value: { patch: { theme: "dark", autoRefreshMinutes: 5, railWidth: 60, defaultTicker: undefined } } });
  });
  it("reviews nothing when the server matches local", () => {
    expect(readSessionSettings(session({ theme: DEFAULT_SETTINGS.theme }), DEFAULT_SETTINGS)).toMatchObject({ ok: true, value: { review: [] } });
  });
  it.each([
    undefined,
    { extensions: { bdobb: { schemaVersion: 2, profile: "v3", settings: {} } } },
    { extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { autoRefreshMinutes: 2 } } } },
    { extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { headerValue: "secret" } } } },
    { extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { settingsStorage: "ws1" } } } },
    { decimalDigits: "bad" },
  ])("refuses invalid or missing display settings", (display) => {
    expect(readSessionSettings(session(display), DEFAULT_SETTINGS)).toMatchObject({ ok: false, expired: false });
  });
  it("reports unsupported OpenBB preferences without replacing supported local values", () => {
    const result = readSessionSettings(session({ theme: null, fontSize: "small", decimalDigits: 8 }), DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true, value: { patch: {} } });
    if (result.ok) expect(result.value.notes.length).toBeGreaterThan(0);
  });
});

describe("mergeUpload", () => {
  const local: Settings = { ...DEFAULT_SETTINGS, theme: "light", fontSize: "large", maxDecimalPlaces: 4, collapseWidgetControls: true, cornerDragHandles: true, defaultTicker: "AAPL", autoRefreshMinutes: 5, settingsStorage: "ws1" };
  it("writes the shared keys and the bdobb block, and keeps everything else", () => {
    const server = { theme: "dark", defaultTicker: { id: "x", symbol: "MSFT", name: "Microsoft" }, dashboardDensity: "compact", gridCorners: ["ne", "sw"], extensions: { other: { a: 1 } } };
    const merged = mergeUpload(server, local);
    expect(merged).toMatchObject({ theme: "light", fontSize: "large", decimalDigits: 4, showWidgetControls: false, gridCorners: ["ne", "sw"], dashboardDensity: "compact" });
    // The server's instrument object stands: BDOBB holds a symbol only.
    expect(merged.defaultTicker).toEqual(server.defaultTicker);
    expect(merged.extensions).toEqual({
      other: { a: 1 },
      bdobb: { schemaVersion: 1, profile: "v3", settings: expect.objectContaining({ defaultTicker: "AAPL", autoRefreshMinutes: 5, railWidth: 48 }) },
    });
    const native = (merged.extensions as { bdobb: { settings: Record<string, unknown> } }).bdobb.settings;
    expect(Object.keys(native)).toHaveLength(11);
    expect(native).not.toHaveProperty("settingsStorage");
  });
  it("applies the gridCorners rule", () => {
    expect(mergeUpload({ gridCorners: ["ne"] }, { ...local, cornerDragHandles: false }).gridCorners).toEqual([]);
    expect(mergeUpload({ gridCorners: [] }, local).gridCorners).toEqual(["se"]);
    expect(mergeUpload({}, local).gridCorners).toEqual(["se"]);
  });
  it("sends a cleared ticker or auto-refresh as null so another device clears it too", () => {
    const native = (mergeUpload({}, { ...local, defaultTicker: undefined, autoRefreshMinutes: undefined }).extensions as { bdobb: { settings: Record<string, unknown> } }).bdobb.settings;
    expect(native.defaultTicker).toBeNull();
    expect(native.autoRefreshMinutes).toBeNull();
  });
});

describe("uploadWorkspaceSettings", () => {
  const local: Settings = { ...DEFAULT_SETTINGS, theme: "light", railWidth: 60, defaultTicker: "AAPL", settingsStorage: "ws1" };
  it("login mode: merges onto the session's display settings, posts once with Bearer only, and returns what it posted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await uploadWorkspaceSettings(session({ theme: "dark", keepMe: true }), local);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe("https://workspace.example/api/pro/display-settings");
    expect(call(0)[1]?.method).toBe("POST");
    expect(headersOf(0)).toEqual({ Authorization: "Bearer synthetic-session", "Content-Type": "application/json" });
    const posted = JSON.parse(call(0)[1]?.body as string);
    expect(posted).toMatchObject({ theme: "light", keepMe: true });
    expect(result).toEqual({ ok: true, value: posted });
  });
  it("round-trips: what an upload posts reads back as the same synced settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await uploadWorkspaceSettings(session({}), local);
    if (!result.ok) throw new Error(result.message);
    const back = readSessionSettings(session(result.value), DEFAULT_SETTINGS);
    expect(back.ok).toBe(true);
    if (back.ok) expect({ ...DEFAULT_SETTINGS, ...back.value.patch, settingsStorage: "ws1" }).toEqual(local);
  });
  it("login mode on a data backend: its own credential per authLocation, plus Bearer, never X-OpenBB-Authorization", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await uploadWorkspaceSettings(session({}, viaBackend("X-Gateway-Key")), local);
    expect(headersOf(0)).toMatchObject({ "X-Gateway-Key": "Basic c3ludGhldGlj", Authorization: "Bearer synthetic-session" });
    expect(headersOf(0)).not.toHaveProperty("X-OpenBB-Authorization");
  });
  it("login mode refuses, without a request, a backend whose own credential uses the Authorization header", async () => {
    expect(await uploadWorkspaceSettings(session({}, viaBackend("authorization")), local)).toMatchObject({ ok: false, expired: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("key mode posts with only the backend credential, and a 401 is key refused, not an expiry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await uploadWorkspaceSettings(keySession({ keepMe: 1 }, viaBackend("Authorization")), local);
    expect(headersOf(0)).toEqual({ Authorization: "Basic c3ludGhldGlj", "Content-Type": "application/json" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await uploadWorkspaceSettings(keySession({}, viaBackend("X-Gateway-Key")), local)).toEqual({ ok: false, expired: false, message: KEY_REFUSED });
  });
  it("login mode: a 401 is expired and a 5xx a plain failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: true });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: false, message: "The server refused the settings upload (HTTP 503)." });
  });
  it("reports a network failure without throwing", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: false });
  });
});

describe("probeSettingsApi", () => {
  it("classifies 200 with display settings as key mode", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect(await probeSettingsApi(viaBackend("X-Gateway-Key"))).toBe("key");
    // The connection's own credential, and no token.
    expect(headersOf(0)).toEqual({ "X-Gateway-Key": "Basic c3ludGhldGlj" });
  });
  it.each([401, 403])("classifies %i as login mode", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }));
    expect(await probeSettingsApi(workspace)).toBe("login");
    expect(call(0)[0]).toBe("https://workspace.example/api/pro/user");
    expect(headersOf(0)).toEqual({});
    expect(call(0)[1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    ["404", () => new Response(null, { status: 404 })],
    ["500", () => new Response(null, { status: 500 })],
    ["200 without display settings", () => reply({ uuid: userId })],
    ["200 that is not JSON", () => new Response("<html></html>", { status: 200 })],
  ])("classifies %s as no API", async (_label, answer) => {
    vi.mocked(fetch).mockResolvedValueOnce(answer());
    expect(await probeSettingsApi(workspace)).toBe("no");
  });
  it.each([new Error("offline"), new DOMException("timed out", "TimeoutError")])("a failed or timed-out probe means no API", async (err) => {
    vi.mocked(fetch).mockRejectedValueOnce(err);
    expect(await probeSettingsApi(workspace)).toBe("no");
  });
  it("never probes a backend that would not be allowed a credential", async () => {
    const plain = backend({ id: "b3", baseUrl: "http://nas.workspace.example:6900" });
    expect(await probeSettingsApi({ id: plain.id, name: plain.name, baseUrl: plain.baseUrl, backend: plain })).toBe("needs-https");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a backend whose own credential is Authorization can be key mode but never login mode", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect(await probeSettingsApi(viaBackend("Authorization"))).toBe("key");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await probeSettingsApi(viaBackend("Authorization"))).toBe("authorization-header");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/lib/workspaceAccount.test.ts`
Expected: FAIL. `workspaceSignIn`, `connectByKey` and the other new exports do not exist yet.

- [ ] **Step 3: Implement**

In `src/lib/workspaceAccount.ts`:

1. Add `import { applyAuthQuery, authHeaders } from "./dataClient";` and add `BackendConfig` to the type import from `./types`.

2. Replace `WorkspaceCredentials`, `WorkspaceSettingsResult` and `class WorkspaceError extends Error {}` with:

```ts
/**
 * Anything settings can be stored on. A Workspace connection (workspace.json)
 * has no `backend`; a data backend that serves the Workspace settings API
 * carries its BackendConfig, whose own credential then rides on every request
 * exactly as it rides on that backend's data requests.
 */
export type SettingsConnection = { id: string; name: string; baseUrl: string; backend?: BackendConfig };
export type WorkspaceCredentials = { connection: SettingsConnection; username: string; password: string };
/**
 * A connected server, in memory only (workspaceStore). Login mode holds a
 * /pro/login session; key mode holds nothing but the connection, whose own
 * key/value credential authorises the settings calls (spec: Key mode
 * contract). `displaySettings` is the server's pro_display_settings -- from
 * the login response (bug #9: a self-hosted server refuses the opaque token
 * on GET /pro/user) or from key mode's GET /pro/user -- then replaced by what
 * each successful upload posted.
 */
export type WorkspaceSession =
  | { mode: "login"; connection: SettingsConnection; username: string; userId: string; token: string; displaySettings: unknown }
  | { mode: "key"; connection: SettingsConnection; displaySettings: unknown };
/**
 * Every request's answer. Requests never throw: the callers are a store and
 * fire-and-forget uploads, and a rejection there would surface nowhere.
 * `expired` marks a 401 on a login-mode request, the one failure that ends
 * the session rather than just this attempt.
 */
export type WorkspaceResult<T> = { ok: true; value: T } | { ok: false; message: string; expired: boolean };
export type WorkspaceDownload = { patch: Partial<Settings>; notes: string[]; review: string[] };
/**
 * The probe's mode. "needs-https" is decided without a request;
 * "authorization-header" is a login-mode server whose backend credential
 * already occupies the header the session token needs.
 */
export type SettingsApi = "key" | "login" | "no" | "needs-https" | "authorization-header";
/** A key-mode 401: the user fixes the key in Connections (spec §7). */
export const KEY_REFUSED = "key refused";
class WorkspaceError extends Error {
  expired: boolean;
  constructor(message: string, expired = false) {
    super(message);
    this.expired = expired;
  }
}
```

3. In `preferencePatch`, change the return type to `{ patch: Partial<Settings>; notes: string[]; review: string[] }`, and change its last line to `return { patch: plan.patch, notes, review: plan.review };`. `planSettingsImport` already writes one `"Label: local → server"` line per key that differs from `current`. That is exactly the sign-in diff over the synced keys, so the conflict dialog reuses it rather than diffing twice.

4. Delete `loadWorkspaceSettings`. Add the following below `preferencePatch`. `workspaceSignIn` keeps `c8c7f7c`'s parsing, including its `UUID.test` check.

```ts
/**
 * The abort/timeout/refusal wrapper every request shares, lifted unchanged
 * out of v3.0.0's loadWorkspaceSettings: a 30 s ceiling, the caller's signal
 * honoured, and only WorkspaceError's own messages reach the caller -- never
 * server text, never a credential.
 */
async function guarded<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<WorkspaceResult<T>> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    if (controller.signal.aborted) throw new WorkspaceError("Request cancelled.");
    const value = await run(controller.signal);
    if (controller.signal.aborted) throw new WorkspaceError("Request cancelled.");
    return { ok: true, value };
  } catch (err) {
    const message = timedOut ? "The server timed out; local settings are unchanged."
      : signal?.aborted ? "Request cancelled."
      : err instanceof WorkspaceError ? err.message : "Could not contact the server; local settings are unchanged.";
    return { ok: false, message, expired: err instanceof WorkspaceError && err.expired };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}

/** A backend whose own credential is an Authorization header: a session token has nowhere left to go. */
const usesAuthorizationHeader = (b: BackendConfig | undefined) =>
  b !== undefined && (b.authLocation ?? "header") === "header" && b.headerName?.trim().toLowerCase() === "authorization";

/**
 * `path` on a connection, with a backend's query-placed credential applied
 * last, as its data requests apply it. serverAddress throws on an address the
 * rule refuses, so no credential is ever sent to one.
 */
function endpoint(connection: SettingsConnection, path: string): string {
  const url = new URL(`${serverAddress(connection.baseUrl)}${path}`);
  return (connection.backend ? applyAuthQuery(url, connection.backend) : url).toString();
}

/**
 * A backend's own credential (header, query -- see endpoint -- or cookie, per
 * authLocation), plus, in login mode, the session token as
 * `Authorization: Bearer`. Only there: X-OpenBB-Authorization sends the
 * server down its JWT path, which the opaque login token fails (bug #9). A
 * backend whose own credential IS the Authorization header cannot carry a
 * token, so it cannot use login mode; key mode sends no token and is fine.
 */
function requestHeaders(connection: SettingsConnection, token?: string): Record<string, string> {
  const own = connection.backend ? authHeaders(connection.backend) : {};
  if (token === undefined) return own;
  if (usesAuthorizationHeader(connection.backend)) {
    throw new WorkspaceError("This backend's credential uses the Authorization header, so it cannot sign in to hold settings.");
  }
  return { ...own, Authorization: `Bearer ${token}` };
}

/** The address rule, for a form that must refuse before writing anything. */
export function workspaceAddress(raw: string): WorkspaceResult<string> {
  try { return { ok: true, value: serverAddress(raw) }; }
  catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err), expired: false }; }
}

/**
 * Login mode: POST /pro/login, and nothing else (bug #9) -- the response
 * carries the account's display settings. The token comes back for the
 * in-memory session; the password goes nowhere else.
 */
export function workspaceSignIn(input: WorkspaceCredentials, signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceSession>> {
  const username = input.username.trim();
  if (username === "" || input.password === "") return Promise.resolve({ ok: false, message: "Provide both a username and password.", expired: false });
  return guarded(signal, async (s) => {
    const loginResponse = await fetch(endpoint(input.connection, "/pro/login"), {
      method: "POST", headers: { ...requestHeaders(input.connection), "Content-Type": "application/json" },
      body: JSON.stringify({ email: username, password: input.password, remember: false, source: "pro" }),
      credentials: "omit", redirect: "error", maxRedirections: 0, signal: s,
    });
    if (loginResponse.status === 202) throw new WorkspaceError("This account requires additional verification. Complete it in OpenBB Workspace before signing in here.");
    if (loginResponse.status !== 200) throw new WorkspaceError("Sign-in failed. Check the account details and server address.");
    const login = await responseJson(loginResponse);
    if (login.force_2fa === true || login.temporary_password === true) throw new WorkspaceError("Complete account verification or password setup in OpenBB Workspace first.");
    if (typeof login.uuid !== "string" || !UUID.test(login.uuid) || typeof login.access_token !== "string" || login.access_token === "") throw new WorkspaceError("The server returned an invalid sign-in response.");
    const displaySettings = isRecord(login.user) ? login.user.pro_display_settings : undefined;
    return { mode: "login", connection: input.connection, username, userId: login.uuid, token: login.access_token, displaySettings };
  });
}

/**
 * Key mode: GET /pro/user authorised by the connection's own key/value
 * credential alone -- no /pro/login, no token. A 401/403 is "key refused";
 * nothing here can expire.
 */
export function connectByKey(connection: SettingsConnection, signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceSession>> {
  return guarded(signal, async (s) => {
    const response = await fetch(endpoint(connection, "/pro/user"), {
      headers: requestHeaders(connection), credentials: "omit", redirect: "error", maxRedirections: 0, signal: s,
    });
    if (response.status === 401 || response.status === 403) throw new WorkspaceError(KEY_REFUSED);
    if (response.status !== 200) throw new WorkspaceError("Settings could not be read from the server; local settings are unchanged.");
    const body = await responseJson(response);
    if (!isRecord(body.pro_display_settings)) throw new WorkspaceError("The server returned no display settings.");
    return { mode: "key", connection, displaySettings: body.pro_display_settings };
  });
}

/** The sign-in sync's download, from the session alone: today's mapping and refusals, plus the review of what differs. */
export function readSessionSettings(session: WorkspaceSession, current: Settings): WorkspaceResult<WorkspaceDownload> {
  try {
    return { ok: true, value: preferencePatch(session.displaySettings, current) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), expired: false };
  }
}
```

5. Add `mergeUpload` and its doc comment exactly as they were in revision 2:

```ts
/**
 * The upload's merge. POST /pro/display-settings REPLACES the whole object,
 * so this starts from what the server holds and overwrites only what BDOBB
 * owns; every other key, other extensions included, goes back untouched.
 * defaultTicker is deliberately not written as a shared key: the server's
 * is a full instrument object (id, symbol, exchange, ...) that a bare symbol
 * cannot rebuild, and an invalid one is silently reset server-side -- so
 * the ticker travels only inside extensions.bdobb. Absent optionals go as
 * null, as the export bundle writes them, so a cleared value clears on the
 * other side instead of being left behind.
 */
export function mergeUpload(display: Record<string, unknown>, settings: Settings): Record<string, unknown> {
  const corners = Array.isArray(display.gridCorners) && display.gridCorners.length > 0 ? display.gridCorners : ["se"];
  const extensions = isRecord(display.extensions) ? display.extensions : {};
  return {
    ...display,
    theme: settings.theme,
    fontSize: settings.fontSize,
    decimalDigits: settings.maxDecimalPlaces,
    showWidgetControls: !settings.collapseWidgetControls,
    gridCorners: settings.cornerDragHandles ? corners : [],
    extensions: {
      ...extensions,
      bdobb: {
        schemaVersion: 1,
        profile: "v3",
        settings: Object.fromEntries([...NATIVE_KEYS].map((k) => [k, settings[k as keyof Settings] ?? null])),
      },
    },
  };
}
```

6. Add the upload and the probe:

```ts
/**
 * Merge onto what the session last knew the server held and POST it; no
 * GET /pro/user first (bug #9). Login mode adds the Bearer token, and its 401
 * expires the session; key mode sends only the connection's own credential,
 * and its 401 is "key refused" (spec §7). Resolves with what was posted,
 * which the caller keeps as the session's new displaySettings. The server
 * keeps no version, so another writer between two uploads is lost -- an
 * accepted limit (spec, Server contract).
 */
export function uploadWorkspaceSettings(session: WorkspaceSession, settings: Settings, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, unknown>>> {
  return guarded(signal, async (s) => {
    const merged = mergeUpload(isRecord(session.displaySettings) ? session.displaySettings : {}, settings);
    const token = session.mode === "login" ? session.token : undefined;
    const response = await fetch(endpoint(session.connection, "/pro/display-settings"), {
      method: "POST", headers: { ...requestHeaders(session.connection, token), "Content-Type": "application/json" },
      body: JSON.stringify(merged),
      credentials: "omit", redirect: "error", maxRedirections: 0, signal: s,
    });
    if (response.status === 401) {
      throw session.mode === "login" ? new WorkspaceError("The session expired. Sign in again.", true) : new WorkspaceError(KEY_REFUSED);
    }
    if (!response.ok) throw new WorkspaceError(`The server refused the settings upload (HTTP ${response.status}).`);
    return merged;
  });
}

/**
 * Which mode, if any, this connection offers (spec: Probe and mode).
 * GET /pro/user with the connection's own key/value credential (none for a
 * Workspace connection) and no session token, 5 s at most: 200 carrying a
 * pro_display_settings object is key mode, 401/403 is login mode, anything
 * else -- another status, a body without settings, an error, silence -- is
 * no API. A connection whose address would not be allowed a credential is
 * never probed; a login-mode backend whose own credential is the
 * Authorization header is reported as such, since login cannot work there.
 */
export async function probeSettingsApi(connection: SettingsConnection): Promise<SettingsApi> {
  if (!workspaceAddress(connection.baseUrl).ok) return "needs-https";
  try {
    const response = await fetch(endpoint(connection, "/pro/user"), {
      headers: requestHeaders(connection), credentials: "omit", redirect: "error", maxRedirections: 0,
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      return usesAuthorizationHeader(connection.backend) ? "authorization-header" : "login";
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return "no";
    }
    const body = await responseJson(response);
    return isRecord(body.pro_display_settings) ? "key" : "no";
  } catch {
    return "no";
  }
}
```

If `dataClient.ts` turns out to import from `workspaceAccount.ts` (it does not today), stop and report the cycle rather than restructuring.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:run src/lib/workspaceAccount.test.ts`
Expected: PASS. `pnpm typecheck` still fails in one place, `WorkspaceAccountSettings.tsx`, on the deleted `loadWorkspaceSettings`. Task 9 deletes that file.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/lib/workspaceAccount.ts src/lib/workspaceAccount.test.ts
git -C $R commit -m "feat(v3): Workspace sessions by login or key, session-based upload and mode probe

Builds on c8c7f7c (Adventures-OpenBQ/bdobb#9): no GET /pro/user with a token,
and the token only as Authorization: Bearer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `workspaceStore` (connections, usernames, sessions per id, key and login) and the upload hook

**Files:**
- Create: `src/stores/workspaceStore.ts`
- Modify: `src/stores/settingsStore.ts` (`save`)
- Test: `src/stores/workspaceStore.test.ts` (create), `src/stores/settingsStore.test.ts`

**Interfaces:**
- Consumes:
  - from Task 5: `workspaceSignIn`, `connectByKey`, `uploadWorkspaceSettings`, `probeSettingsApi`, `KEY_REFUSED`, and the types `SettingsConnection`, `WorkspaceSession` and `SettingsApi`;
  - `useBackendsStore`, `jsonStore`, `serialize` and `logError`.
- Produces:
  - `type WorkspaceConnection = { id: string; name: string; serverUrl: string; askOnStartup: boolean }`
  - `type SessionEntry = WorkspaceSession & { state: "signed-in" | "expired" | "not-synced"; reason?: string }`. An absent entry means signed out; `mode` comes from `WorkspaceSession`.
  - `toSettingsConnections(connections: WorkspaceConnection[], backends: BackendConfig[]): SettingsConnection[]`. Workspace connections come first, then backends.
  - `storageConnection(settings: Settings, list: SettingsConnection[]): SettingsConnection | null`. It returns null for Local and for a dangling id.
  - `useWorkspaceStore` state:
    - `connections: WorkspaceConnection[]`
    - `usernames: Record<string, string>`
    - `sessions: Record<string, SessionEntry>`
    - `apis: Record<string, SettingsApi>`
  - `useWorkspaceStore` actions:
    - `load(): Promise<void>`
    - `saveConnection(input: { id?: string; name: string; serverUrl: string; askOnStartup: boolean }): Promise<WorkspaceConnection>`
    - `removeConnection(id: string): Promise<void>`. It works for Workspace and backend ids.
    - `signIn(connection: SettingsConnection, username: string, password: string, remember: boolean, signal?: AbortSignal): Promise<string | null>`. Login mode. It resolves null on success, otherwise the message.
    - `connectByKey(connection: SettingsConnection, signal?: AbortSignal): Promise<string | null>`. Key mode. It resolves null on success, otherwise the message, and creates no session on failure.
    - `probe(connection: SettingsConnection): Promise<SettingsApi>`. It records the answer in `apis`.
    - `signOut(id: string): void`
    - `fail(id: string, failure: { message: string; expired: boolean }): void`
    - `probeAll(): Promise<void>`
    - `queueUpload(id: string, settings: Settings): Promise<void>`. It needs only a live session for `id`; the caller decides whether to upload at all.

- [ ] **Step 1: Write the failing store tests**

Create `src/stores/workspaceStore.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import { __list, __read, __reset, __seed } from "../test/memfs";
import { backend } from "../test/fixtures";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useBackendsStore } from "./backendsStore";
import { storageConnection, toSettingsConnections, useWorkspaceStore } from "./workspaceStore";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false };
const wsConn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const entry = { mode: "login" as const, connection: wsConn, username: "alice", userId, token: "synthetic-session", displaySettings: { keepMe: 1 }, state: "signed-in" as const };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const loginReply = () => reply({ uuid: userId, access_token: "synthetic-session", user: { pro_display_settings: { keepMe: 1 } } });
const uploads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/pro/display-settings"));
const file = () => JSON.parse(__read("workspace.json") ?? "null");

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  useBackendsStore.setState({ backends: [] });
  useWorkspaceStore.setState({ connections: [], usernames: {}, sessions: {}, apis: {} });
});

describe("connections", () => {
  it("loads nothing when workspace.json is absent, and every connection when present", async () => {
    await useWorkspaceStore.getState().load();
    expect(useWorkspaceStore.getState().connections).toEqual([]);
    __seed("workspace.json", JSON.stringify({ connections: [ws, { id: "ws2", name: "Home", serverUrl: "https://home.workspace.example" }], usernames: { ws1: "alice" } }));
    await useWorkspaceStore.getState().load();
    expect(useWorkspaceStore.getState().connections).toEqual([ws, { id: "ws2", name: "Home", serverUrl: "https://home.workspace.example", askOnStartup: false }]);
    expect(useWorkspaceStore.getState().usernames).toEqual({ ws1: "alice" });
  });

  it("writes exactly the connections and usernames, and allows several", async () => {
    const a = await useWorkspaceStore.getState().saveConnection({ name: "Work", serverUrl: "https://workspace.example", askOnStartup: true });
    const b = await useWorkspaceStore.getState().saveConnection({ name: "Home", serverUrl: "https://home.workspace.example", askOnStartup: false });
    expect(file()).toEqual({
      connections: [
        { id: a.id, name: "Work", serverUrl: "https://workspace.example", askOnStartup: true },
        { id: b.id, name: "Home", serverUrl: "https://home.workspace.example", askOnStartup: false },
      ],
      usernames: {},
    });
  });

  it("edits in place by id, dropping that session only when the address changes", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: {} }));
    await useWorkspaceStore.getState().load();
    useWorkspaceStore.setState({ sessions: { ws1: entry } });
    await useWorkspaceStore.getState().saveConnection({ ...ws, name: "Work 2", askOnStartup: true });
    expect(useWorkspaceStore.getState().sessions.ws1).toBeDefined();
    await useWorkspaceStore.getState().saveConnection({ ...ws, name: "Work 2", serverUrl: "https://other.workspace.example" });
    expect(file().connections).toEqual([{ ...ws, name: "Work 2", serverUrl: "https://other.workspace.example" }]);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("removes a Workspace connection with its username and session, and forgets a backend's username", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: { ws1: "alice", b1: "bob" } }));
    await useWorkspaceStore.getState().load();
    useWorkspaceStore.setState({ sessions: { ws1: entry, b1: { ...entry, connection: { id: "b1", name: "G", baseUrl: "https://g.workspace.example" } } } });
    await useWorkspaceStore.getState().removeConnection("ws1");
    expect(file()).toEqual({ connections: [], usernames: { b1: "bob" } });
    expect(Object.keys(useWorkspaceStore.getState().sessions)).toEqual(["b1"]);
    await useWorkspaceStore.getState().removeConnection("b1");
    expect(file().usernames).toEqual({});
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("does not create workspace.json when removing a backend it knows nothing about", async () => {
    await useWorkspaceStore.getState().removeConnection("b9");
    expect(__read("workspace.json")).toBeUndefined();
  });

  it("lists Workspace connections first, then backends, and treats a dangling storage id as Local", () => {
    const b = backend({ id: "b1", name: "Gateway", baseUrl: "https://gateway.workspace.example" });
    const list = toSettingsConnections([ws], [b]);
    expect(list).toEqual([wsConn, { id: "b1", name: "Gateway", baseUrl: b.baseUrl, backend: b }]);
    expect(storageConnection({ ...DEFAULT_SETTINGS, settingsStorage: "b1" }, list)?.id).toBe("b1");
    expect(storageConnection({ ...DEFAULT_SETTINGS, settingsStorage: "gone" }, list)).toBeNull();
    expect(storageConnection(DEFAULT_SETTINGS, list)).toBeNull();
  });
});

describe("sign-in", () => {
  it("keeps one session per connection, and Remember me decides whether the username is stored", async () => {
    useWorkspaceStore.setState({ connections: [ws, { ...ws, id: "ws2", name: "Home" }] });
    vi.mocked(fetch).mockResolvedValueOnce(loginReply()).mockResolvedValueOnce(loginReply());
    expect(await useWorkspaceStore.getState().signIn(wsConn, " alice ", "synthetic-password", true)).toBeNull();
    expect(await useWorkspaceStore.getState().signIn({ ...wsConn, id: "ws2", name: "Home" }, "bob", "synthetic-password", false)).toBeNull();
    expect(Object.keys(useWorkspaceStore.getState().sessions).sort()).toEqual(["ws1", "ws2"]);
    expect(useWorkspaceStore.getState().sessions.ws1).toMatchObject({ username: "alice", state: "signed-in", displaySettings: { keepMe: 1 } });
    expect(file().usernames).toEqual({ ws1: "alice" });
    // Unticking Remember me at the next sign-in deletes the stored username.
    vi.mocked(fetch).mockResolvedValueOnce(loginReply());
    await useWorkspaceStore.getState().signIn(wsConn, "alice", "synthetic-password", false);
    expect(file().usernames).toEqual({});
  });

  it("never writes the password or token to disk", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    vi.mocked(fetch).mockResolvedValueOnce(loginReply()).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await useWorkspaceStore.getState().signIn(wsConn, "alice", "synthetic-password", true);
    await useWorkspaceStore.getState().queueUpload("ws1", { ...DEFAULT_SETTINGS, settingsStorage: "ws1" });
    for (const path of __list()) {
      expect(__read(path)).not.toContain("synthetic-session");
      expect(__read(path)).not.toContain("synthetic-password");
    }
  });

  it("returns the refusal and stays signed out when sign-in fails", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 401));
    expect(await useWorkspaceStore.getState().signIn(wsConn, "alice", "wrong", true)).toMatch(/Sign-in failed/);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("drops a sign-in whose connection was removed while it was in flight", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(loginReply());
    expect(await useWorkspaceStore.getState().signIn(wsConn, "alice", "synthetic-password", true)).toMatch(/removed/);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });
});

describe("key mode", () => {
  const gw = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "X-Key", headerValue: "k1" });
  const gwConn = { id: "g", name: "Gateway", baseUrl: gw.baseUrl, backend: gw };
  beforeEach(() => useBackendsStore.setState({ backends: [gw] }));

  it("connects with the key alone and keeps the server's display settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: { keepMe: 1 } }));
    expect(await useWorkspaceStore.getState().connectByKey(gwConn)).toBeNull();
    expect(useWorkspaceStore.getState().sessions.g).toEqual({ mode: "key", connection: gwConn, displaySettings: { keepMe: 1 }, state: "signed-in" });
  });

  it("creates no session when the key is refused", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 401));
    expect(await useWorkspaceStore.getState().connectByKey(gwConn)).toBe("key refused");
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("a key-mode upload refused with 401 is Not synced: key refused, and the session stays", async () => {
    useWorkspaceStore.setState({ sessions: { g: { mode: "key", connection: gwConn, displaySettings: {}, state: "signed-in" } } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await useWorkspaceStore.getState().queueUpload("g", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.g).toMatchObject({ mode: "key", state: "not-synced", reason: "key refused" });
  });
});

describe("probe and probeAll", () => {
  it("records each connection's mode, never probing one that needs HTTPS", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    useBackendsStore.setState({
      backends: [
        backend({ id: "b1", baseUrl: "https://a.workspace.example" }),
        backend({ id: "b2", baseUrl: "http://nas.workspace.example" }),
        backend({ id: "b3", baseUrl: "https://c.workspace.example", headerName: "Authorization", headerValue: "Basic x", authLocation: "header" }),
        backend({ id: "b4", baseUrl: "https://d.workspace.example" }),
      ],
    });
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("https://workspace.example") || u.startsWith("https://c.")) return new Response(null, { status: 401 });
      if (u.startsWith("https://d.")) return reply({ pro_display_settings: {} });
      return new Response(null, { status: 404 });
    });
    await useWorkspaceStore.getState().probeAll();
    expect(useWorkspaceStore.getState().apis).toEqual({ ws1: "login", b1: "no", b2: "needs-https", b3: "authorization-header", b4: "key" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("probe records one connection's answer and returns it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await useWorkspaceStore.getState().probe(wsConn)).toBe("login");
    expect(useWorkspaceStore.getState().apis).toEqual({ ws1: "login" });
  });
});

describe("queueUpload", () => {
  const signedIn = () => useWorkspaceStore.setState({ connections: [ws], sessions: { ws1: entry } });

  it("does not upload without a session for that connection", async () => {
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("collapses queued uploads to the latest state and keeps what it posted as the session's display settings", async () => {
    signedIn();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const { queueUpload } = useWorkspaceStore.getState();
    await Promise.all([
      queueUpload("ws1", { ...DEFAULT_SETTINGS, railWidth: 30 }),
      queueUpload("ws1", { ...DEFAULT_SETTINGS, railWidth: 40 }),
      queueUpload("ws1", { ...DEFAULT_SETTINGS, railWidth: 50 }),
    ]);
    expect(uploads()).toHaveLength(1);
    const posted = JSON.parse(uploads()[0][1]?.body as string);
    expect(posted.extensions.bdobb.settings.railWidth).toBe(50);
    expect(useWorkspaceStore.getState().sessions.ws1.displaySettings).toEqual(posted);
    expect(posted.keepMe).toBe(1);
  });

  it.each([
    ["a 5xx", () => new Response(null, { status: 503 }), "The server refused the settings upload (HTTP 503)."],
    ["a network failure", () => { throw new Error("offline"); }, "Could not contact the server; local settings are unchanged."],
  ])("reports %s as Not synced and keeps the session", async (_label, post, reason) => {
    signedIn();
    vi.mocked(fetch).mockImplementationOnce(async () => post());
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.ws1).toMatchObject({ token: "synthetic-session", state: "not-synced", reason, displaySettings: { keepMe: 1 } });
  });

  it("marks the session expired on a 401, and uploads nothing more for it", async () => {
    signedIn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.ws1.state).toBe("expired");
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores an upload result that lands after sign-out", async () => {
    signedIn();
    let release!: (r: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((r) => { release = r; }));
    const upload = useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    useWorkspaceStore.getState().signOut("ws1");
    release(new Response(null, { status: 200 }));
    await upload;
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/stores/workspaceStore.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `src/stores/workspaceStore.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { create } from "zustand";
import { isRecord } from "../lib/isRecord";
import { ABSENT, loadJson, saveJson } from "../lib/jsonStore";
import { logError } from "../lib/logger";
import { serialize } from "../lib/serialize";
import type { BackendConfig, Settings } from "../lib/types";
import {
  connectByKey,
  probeSettingsApi,
  uploadWorkspaceSettings,
  workspaceSignIn,
  type SettingsApi,
  type SettingsConnection,
  type WorkspaceSession,
} from "../lib/workspaceAccount";
import { useBackendsStore } from "./backendsStore";

const PATH = "workspace.json";

/** One Workspace connection as workspace.json stores it. Never a password, never a token. */
export type WorkspaceConnection = { id: string; name: string; serverUrl: string; askOnStartup: boolean };
type WorkspaceFile = { connections: WorkspaceConnection[]; usernames: Record<string, string> };
/** One signed-in connection. No entry means signed out. */
export type SessionEntry = WorkspaceSession & { state: "signed-in" | "expired" | "not-synced"; reason?: string };

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  return (
    isRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.every(
      (c) =>
        isRecord(c) &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.serverUrl === "string" &&
        (c.askOnStartup === undefined || typeof c.askOnStartup === "boolean"),
    ) &&
    isRecord(value.usernames) &&
    Object.values(value.usernames).every((u) => typeof u === "string")
  );
}

/** Every connection settings could be stored on: Workspace connections first, then data backends -- the order the User Settings server dropdown lists them in. */
export function toSettingsConnections(connections: WorkspaceConnection[], backends: BackendConfig[]): SettingsConnection[] {
  return [
    ...connections.map((c) => ({ id: c.id, name: c.name, baseUrl: c.serverUrl })),
    ...backends.map((b) => ({ id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b })),
  ];
}

/**
 * The connection settingsStorage names, or null for Local -- which includes
 * an id that names nothing any more (a backend removed elsewhere): storage on
 * a connection that does not exist is Local by definition, so nothing uploads.
 */
export function storageConnection(settings: Settings, list: SettingsConnection[]): SettingsConnection | null {
  return list.find((c) => c.id === settings.settingsStorage) ?? null;
}

type WorkspaceState = WorkspaceFile & {
  /** In memory only, one per signed-in connection id: quitting or signing out drops it. */
  sessions: Record<string, SessionEntry>;
  /** The last probe's answer per connection id; absent means not probed yet. */
  apis: Record<string, SettingsApi>;
  load: () => Promise<void>;
  saveConnection: (input: { id?: string; name: string; serverUrl: string; askOnStartup: boolean }) => Promise<WorkspaceConnection>;
  removeConnection: (id: string) => Promise<void>;
  signIn: (connection: SettingsConnection, username: string, password: string, remember: boolean, signal?: AbortSignal) => Promise<string | null>;
  connectByKey: (connection: SettingsConnection, signal?: AbortSignal) => Promise<string | null>;
  probe: (connection: SettingsConnection) => Promise<SettingsApi>;
  signOut: (id: string) => void;
  fail: (id: string, failure: { message: string; expired: boolean }) => void;
  probeAll: () => Promise<void>;
  queueUpload: (id: string, settings: Settings) => Promise<void>;
};

/**
 * Per connection, the settings its next upload will send. Each queueUpload
 * overwrites its entry and queues a step; the first step to run takes it and
 * clears it, so the steps queued behind find nothing and return. A burst of
 * saves therefore costs one POST carrying the newest state.
 */
const latest = new Map<string, Settings>();

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Every workspace.json writer reads get() INSIDE the queued step, as
  // backendsStore's do, so two overlapping edits cannot both start from the
  // same stale arrays and silently revert each other. `null` writes nothing.
  const write = <T,>(step: (file: WorkspaceFile) => { file: WorkspaceFile; result: T } | null) =>
    serialize("store:workspace", async () => {
      const next = step({ connections: get().connections, usernames: get().usernames });
      if (next === null) return undefined;
      await saveJson(PATH, next.file);
      set(next.file);
      return next.result;
    });
  const dropSession = (id: string) => {
    if (get().sessions[id] === undefined) return;
    const sessions = { ...get().sessions };
    delete sessions[id];
    set({ sessions });
  };
  const withoutKey = (record: Record<string, string>, id: string) =>
    Object.fromEntries(Object.entries(record).filter(([k]) => k !== id));

  return {
    connections: [],
    usernames: {},
    sessions: {},
    apis: {},

    load: async () => {
      const stored = await loadJson(PATH, isWorkspaceFile);
      // Copied field by field so an unknown key in the file is not carried
      // back out by the next write.
      set(
        stored === ABSENT
          ? { connections: [], usernames: {} }
          : {
              connections: stored.connections.map(({ id, name, serverUrl, askOnStartup }) => ({ id, name, serverUrl, askOnStartup: askOnStartup === true })),
              usernames: { ...stored.usernames },
            },
      );
    },

    // A changed address is a different server, so that connection's session
    // is dropped; a renamed or re-flagged connection keeps it.
    saveConnection: async (input) => {
      const connection = { id: input.id ?? crypto.randomUUID(), name: input.name, serverUrl: input.serverUrl, askOnStartup: input.askOnStartup };
      const before = get().connections.find((c) => c.id === connection.id);
      const saved = await write((file) => ({
        file: {
          connections: before ? file.connections.map((c) => (c.id === connection.id ? connection : c)) : [...file.connections, connection],
          usernames: file.usernames,
        },
        result: connection,
      }));
      if (before !== undefined && before.serverUrl !== connection.serverUrl) dropSession(connection.id);
      return saved ?? connection;
    },

    // For both kinds: a Workspace connection leaves `connections`, and any
    // id's remembered username goes. Nothing to change writes nothing, so
    // removing an ordinary backend does not create workspace.json.
    removeConnection: async (id) => {
      await write((file) =>
        file.connections.some((c) => c.id === id) || id in file.usernames
          ? { file: { connections: file.connections.filter((c) => c.id !== id), usernames: withoutKey(file.usernames, id) }, result: undefined }
          : null,
      );
      dropSession(id);
    },

    signIn: async (connection, username, password, remember, signal) => {
      const result = await workspaceSignIn({ connection, username, password }, signal);
      if (!result.ok) return result.message;
      // A Remove that landed while the request was in flight wins: this
      // session would belong to a connection that no longer exists.
      const exists = toSettingsConnections(get().connections, useBackendsStore.getState().backends).some((c) => c.id === connection.id);
      if (!exists) return "That connection was removed; nothing was signed in.";
      set({ sessions: { ...get().sessions, [connection.id]: { ...result.value, state: "signed-in" } } });
      // Remember me decides whether the username is on disk: ticked stores
      // it, unticked deletes any stored one. A failed write costs only the
      // next prefill, so it is logged rather than turned into a failed sign-in.
      const name = result.value.username;
      const stored = get().usernames[connection.id];
      if (remember ? stored !== name : stored !== undefined) {
        await write((file) => ({
          file: { ...file, usernames: remember ? { ...file.usernames, [connection.id]: name } : withoutKey(file.usernames, connection.id) },
          result: undefined,
        })).catch((err: unknown) => logError(`failed to update workspace.json usernames: ${err}`));
      }
      return null;
    },

    // Key mode: no dialog, no username, nothing to remember. A refusal
    // creates no session -- the caller keeps local settings for this run.
    connectByKey: async (connection, signal) => {
      const result = await connectByKey(connection, signal);
      if (!result.ok) return result.message;
      const exists = toSettingsConnections(get().connections, useBackendsStore.getState().backends).some((c) => c.id === connection.id);
      if (!exists) return "That connection was removed; nothing was connected.";
      set({ sessions: { ...get().sessions, [connection.id]: { ...result.value, state: "signed-in" } } });
      return null;
    },

    probe: async (connection) => {
      const answer = await probeSettingsApi(connection);
      set({ apis: { ...get().apis, [connection.id]: answer } });
      return answer;
    },

    signOut: (id) => dropSession(id),

    fail: (id, { message, expired }) => {
      const current = get().sessions[id];
      if (current === undefined) return;
      set({ sessions: { ...get().sessions, [id]: expired ? { ...current, state: "expired", reason: undefined } : { ...current, state: "not-synced", reason: message } } });
    },

    // Parallel, each with its own 5 s deadline (probeSettingsApi), so the
    // whole round takes as long as the slowest connection, not the sum.
    probeAll: async () => {
      const list = toSettingsConnections(get().connections, useBackendsStore.getState().backends);
      const answers = await Promise.all(list.map(async (c) => [c.id, await probeSettingsApi(c)] as const));
      set({ apis: Object.fromEntries(answers) });
    },

    queueUpload: (id, settings) => {
      latest.set(id, settings);
      return serialize(`workspace:upload:${id}`, async () => {
        const pending = latest.get(id);
        latest.delete(id);
        const session = get().sessions[id];
        if (pending === undefined || session === undefined || session.state === "expired") return;
        const result = await uploadWorkspaceSettings(session, pending);
        // Signed out, or connected again, while this was in flight: the
        // result describes a session that is gone and must not overwrite the
        // new one -- least of all its displaySettings. Compared by identity,
        // since a key-mode session has no token to compare.
        if (get().sessions[id] !== session) return;
        if (result.ok) {
          set({ sessions: { ...get().sessions, [id]: { ...session, displaySettings: result.value, state: "signed-in", reason: undefined } } });
        } else {
          get().fail(id, result);
        }
      });
    },
  };
});
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `pnpm test:run src/stores/workspaceStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `settingsStore` tests**

In `src/stores/settingsStore.test.ts`:
- Add `import { useWorkspaceStore } from "./workspaceStore";`.
- Below the imports, add:

```ts
const realQueueUpload = useWorkspaceStore.getState().queueUpload;
const entry = { mode: "login" as const, connection: { id: "ws1", name: "Work", baseUrl: "https://workspace.example" }, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state: "signed-in" as const };
```

- Make this the first line of the existing `beforeEach`: `useWorkspaceStore.setState({ queueUpload: realQueueUpload, sessions: {} });`
- Append inside `describe("useSettingsStore")`:

```ts
  it("hands every save to the upload queue of the connection holding settings", async () => {
    const queueUpload = vi.fn(async () => {});
    useWorkspaceStore.setState({ queueUpload, sessions: { ws1: entry } });
    await useSettingsStore.getState().save({ settingsStorage: "ws1" });
    await useSettingsStore.getState().save({ theme: "light" });
    expect(queueUpload).toHaveBeenLastCalledWith("ws1", expect.objectContaining({ theme: "light", settingsStorage: "ws1" }));
  });

  it.each([
    ["storage is Local", {}, { ws1: entry }],
    ["storage names a connection without a session", { settingsStorage: "ws2" }, { ws1: entry }],
    ["the holding connection's session expired", { settingsStorage: "ws1" }, { ws1: { ...entry, state: "expired" as const } }],
  ])("does not upload when %s", async (_label, patch, sessions) => {
    const queueUpload = vi.fn(async () => {});
    useWorkspaceStore.setState({ queueUpload, sessions });
    await useSettingsStore.getState().save({ ...patch, theme: "light" });
    expect(queueUpload).not.toHaveBeenCalled();
  });

  it("uploads what commitDraft commits", async () => {
    const queueUpload = vi.fn(async () => {});
    useWorkspaceStore.setState({ queueUpload, sessions: { ws1: entry } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useSettingsStore.getState().beginDraft();
    useSettingsStore.getState().stageDraft({ fontSize: "large" });
    expect(await useSettingsStore.getState().commitDraft()).toEqual({ ok: true });
    expect(queueUpload).toHaveBeenCalledWith("ws1", expect.objectContaining({ fontSize: "large" }));
  });

  it("keeps the local save when the upload rejects", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry }, queueUpload: vi.fn(async () => { throw new Error("boom"); }) });
    await useSettingsStore.getState().save({ settingsStorage: "ws1", theme: "light" });
    expect(JSON.parse(__read("settings.json") ?? "").theme).toBe("light");
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test:run src/stores/settingsStore.test.ts`
Expected: FAIL in the upload tests.

- [ ] **Step 7: Implement the hook**

In `src/stores/settingsStore.ts`, add `import { useWorkspaceStore } from "./workspaceStore";`. In `save`, after `set({ settings: merged });`, add:

```ts
      // Storage on a connection mirrors every successful save; commitDraft
      // lands here too, so this is the one hook point. Only to the connection
      // holding settings, and only while it has a live session: signed out or
      // expired, settings stay local until Sign in. Fired, never awaited: a
      // slow or offline server must not hold the settings chain, and the
      // upload reports its own failure on that connection's session state.
      const holder = merged.settingsStorage;
      const session = holder === undefined ? undefined : useWorkspaceStore.getState().sessions[holder];
      if (holder !== undefined && session !== undefined && session.state !== "expired") {
        void useWorkspaceStore.getState().queueUpload(holder, merged).catch(() => {});
      }
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm test:run src/stores/settingsStore.test.ts src/stores/workspaceStore.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/stores/workspaceStore.ts src/stores/workspaceStore.test.ts src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git -C $R commit -m "feat(v3): add the Workspace connection store and upload on save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dialogs (Workspace form, sign-in, backend credential step, conflict), connecting a server, and the startup prompt

**Files:**
- Create: `src/components/dialogs/WorkspaceDialogs.tsx`
- Create: `src/components/runWorkspaceSync.ts`
- Test: `src/components/dialogs/WorkspaceDialogs.test.tsx`, `src/components/runWorkspaceSync.test.ts`

**Interfaces:**
- Consumes:
  - From Task 6: `useWorkspaceStore`, `toSettingsConnections`, `WorkspaceConnection`.
  - From Task 6: `useWorkspaceStore.probe`, `connectByKey`, `signIn`, `storageConnection`.
  - From Task 5: `readSessionSettings`, `SettingsConnection`.
  - From Task 4: `useBackendsStore.setCredential` and `useBackendsStore.refresh(only)`.
  - Also `useSettingsStore`, `useChildDialog` and `DialogShell`.
- Produces:
  - `type WorkspaceFormValues = { name: string; serverUrl: string; askOnStartup: boolean }`.
  - `WorkspaceConnectionForm(props: { title: string; initial: WorkspaceFormValues; onSubmit: (values: WorkspaceFormValues) => Promise<string | null>; onCancel: () => void })`. It has three fields: Name, Server address, and "Ask for credentials on startup".
  - `WorkspaceSignInForm(props: { title: string; subtitle?: string; cancelLabel?: string; initialUsername: string; onSubmit: (username: string, password: string, remember: boolean, signal: AbortSignal) => Promise<string | null>; onCancel: () => void })`. Remember me starts ticked when `initialUsername` is non-empty.
  - `askWorkspaceSignIn(connection: SettingsConnection, step?: string): Promise<boolean>`. With `step`, the cancel button reads "Skip".
  - `askBackendCredential(backend: BackendConfig, step: string): Promise<"continued" | "skipped">`. It asks for Key, Value and Remember me only; it never signs in.
  - `WorkspaceConflictDialog(props: { name: string; review: string[]; notes: string[]; onDecide: (choice: "server" | "local") => void })`.
  - `decideWorkspaceConflict(name: string, review: string[], notes: string[]): Promise<"server" | "local">`.
  - `syncAfterSignIn(id: string): Promise<boolean>`.
  - `connectServer(connection: SettingsConnection): Promise<boolean>`. It connects to the settings server by its probed mode, then runs the sign-in sync. It resolves true only when synced.
  - `promptSignIn(connection: SettingsConnection): Promise<void>`. This is a card's Sign in: `connectServer` for the connection holding settings, otherwise the sign-in dialog alone.
  - `runStartupPrompt(): Promise<void>`.

- [ ] **Step 1: Write the failing dialog tests**

Create `src/components/dialogs/WorkspaceDialogs.test.tsx`:

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "../../test/fixtures";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { askBackendCredential, askWorkspaceSignIn, decideWorkspaceConflict, WorkspaceConnectionForm, WorkspaceSignInForm } from "./WorkspaceDialogs";

const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const realSignIn = useWorkspaceStore.getState().signIn;
const realSetCredential = useBackendsStore.getState().setCredential;
beforeEach(() => {
  useWorkspaceStore.setState({ signIn: realSignIn, connections: [], usernames: { ws1: "alice" }, sessions: {} });
  useBackendsStore.setState({ setCredential: realSetCredential, backends: [], runtimeCredentials: [] });
});

describe("WorkspaceConnectionForm", () => {
  it("has name, address and Ask for credentials on startup, and no credential fields", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<WorkspaceConnectionForm title="Add Workspace" initial={{ name: "", serverUrl: "", askOnStartup: false }} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
    await userEvent.type(screen.getByLabelText("Name"), "Work");
    await userEvent.type(screen.getByLabelText("Server address"), "https://workspace.example");
    await userEvent.click(screen.getByLabelText("Ask for credentials on startup"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Work", serverUrl: "https://workspace.example", askOnStartup: true });
  });
});

describe("WorkspaceSignInForm", () => {
  it("shows the refusal, clears the password after every attempt, and passes Remember me", async () => {
    const onSubmit = vi.fn(async () => "Sign-in failed. Check the account details and server address.");
    render(<WorkspaceSignInForm title="Sign in to Work" initialUsername="" onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Remember me")).not.toBeChecked();
    await userEvent.type(screen.getByLabelText("Username or email"), "alice");
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByLabelText("Remember me"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Sign-in failed/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith("alice", "synthetic-password", true, expect.any(AbortSignal));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByText(/Signing in can replace another OpenBB Workspace session/)).toBeInTheDocument();
  });

  it("Cancel during a pending sign-in aborts it", async () => {
    const onCancel = vi.fn();
    let signal!: AbortSignal;
    render(<WorkspaceSignInForm title="Sign in to Work" initialUsername="alice" onCancel={onCancel} onSubmit={(_u, _p, _r, s) => { signal = s; return new Promise(() => {}); }} />);
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
  });
});

describe("askWorkspaceSignIn", () => {
  it("prefills a remembered username with Remember me ticked; Cancel resolves false", async () => {
    const pending = askWorkspaceSignIn(conn);
    expect(await screen.findByRole("dialog", { name: "Sign in to Work" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toHaveValue("alice");
    expect(screen.getByLabelText("Remember me")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(pending).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a Skip-able step at startup, and resolves true once the store signs in", async () => {
    const signIn = vi.fn(async () => null);
    useWorkspaceStore.setState({ signIn });
    const pending = askWorkspaceSignIn(conn, "Step 1 of 2");
    expect(await screen.findByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await expect(pending).resolves.toBe(true);
    expect(signIn).toHaveBeenCalledWith(conn, "alice", "synthetic-password", true, expect.any(AbortSignal));
  });
});

describe("askBackendCredential", () => {
  const gateway = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true });

  it("prefills the stored key, gives the value for this run, and skips", async () => {
    const setCredential = vi.fn(async () => {});
    useBackendsStore.setState({ setCredential, backends: [gateway] });
    let pending = askBackendCredential(gateway, "Step 1 of 1");
    expect(await screen.findByLabelText("Key")).toHaveValue("username");
    expect(screen.queryByLabelText("Password")).toBeNull();
    await userEvent.type(screen.getByLabelText("Value"), "admin@workspace.example");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(pending).resolves.toBe("continued");
    expect(setCredential).toHaveBeenCalledWith("g", "username", "admin@workspace.example", false);
    pending = askBackendCredential(gateway, "Step 1 of 1");
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await expect(pending).resolves.toBe("skipped");
  });

  it("ticks Remember me and prefills the value only when the value is stored on disk", async () => {
    const remembered = { ...gateway, headerValue: "admin@workspace.example" };
    useBackendsStore.setState({ setCredential: vi.fn(async () => {}), backends: [remembered], runtimeCredentials: [] });
    let pending = askBackendCredential(remembered, "Step 1 of 1");
    expect(await screen.findByLabelText("Value")).toHaveValue("admin@workspace.example");
    expect(screen.getByLabelText("Remember me")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await pending;
    useBackendsStore.setState({ runtimeCredentials: ["g"] });
    pending = askBackendCredential(remembered, "Step 1 of 1");
    expect(await screen.findByLabelText("Value")).toHaveValue("");
    expect(screen.getByLabelText("Remember me")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await pending;
  });
});

describe("decideWorkspaceConflict", () => {
  it.each([["Use Work", "server"], ["Keep local", "local"]] as const)("lists each differing setting and answers %s", async (button, choice) => {
    const pending = decideWorkspaceConflict("Work", ["Theme: dark → light", "Auto-refresh: off → 5"], []);
    expect(await screen.findByText("Theme: dark → light")).toBeInTheDocument();
    expect(screen.getByText("Auto-refresh: off → 5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: button }));
    await expect(pending).resolves.toBe(choice);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/components/dialogs/WorkspaceDialogs.test.tsx`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `src/components/dialogs/WorkspaceDialogs.tsx`**

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useChildDialog } from "../../hooks/useChildDialog";
import type { BackendConfig } from "../../lib/types";
import type { SettingsConnection } from "../../lib/workspaceAccount";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { DialogShell } from "./DialogShell";

export type WorkspaceFormValues = { name: string; serverUrl: string; askOnStartup: boolean };

const WARNING = "Signing in can replace another OpenBB Workspace session. Passwords and session tokens are not saved by this app.";

/**
 * Submits through onSubmit with an AbortSignal and shows its refusal. Every
 * way out aborts a request in flight, so a sign-in the user walked away from
 * cannot land a session afterwards -- one that would skip the sign-in sync
 * and let the next save overwrite the server unasked.
 */
function useSubmission(onCancel: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const cancel = () => {
    request.current?.abort();
    onCancel();
  };
  async function run(submit: (signal: AbortSignal) => Promise<string | null>, after: () => void) {
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    const message = await submit(controller.signal);
    // A setState after a successful submit unmounted the form is a silent
    // no-op in React 19, so there is nothing to guard here.
    after();
    setPending(false);
    setError(message);
  }
  return { pending, error, cancel, run };
}

/** Add/Edit Workspace: what workspace.json stores, and nothing secret. Adding then opens the sign-in dialog. */
export function WorkspaceConnectionForm({ title, initial, onSubmit, onCancel }: { title: string; initial: WorkspaceFormValues; onSubmit: (values: WorkspaceFormValues) => Promise<string | null>; onCancel: () => void }) {
  const [values, setValues] = useState(initial);
  const { pending, error, cancel, run } = useSubmission(onCancel);
  const dialogRef = useChildDialog(cancel);
  const formId = "workspace-connection-form";
  return (
    <DialogShell dialogRef={dialogRef} ariaLabel={title} title={title} subtitle="OpenBB Workspace" modifier="bd-dialog--editor" plain onClose={cancel}
      note={<button type="button" className="bd-button" onClick={cancel}>Cancel</button>}
      footerActions={<button type="submit" form={formId} className="bd-button bd-button--primary" disabled={pending}>Save</button>}
    >
      <form id={formId} className="bd-form" onSubmit={(e) => { e.preventDefault(); void run(() => onSubmit(values), () => {}); }}>
        <div className="bd-field">
          <label htmlFor="workspace-name">Name</label>
          <input id="workspace-name" className="bd-input" value={values.name} disabled={pending} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </div>
        <div className="bd-field">
          <label htmlFor="workspace-server">Server address</label>
          <input id="workspace-server" className="bd-input" type="url" value={values.serverUrl} disabled={pending} onChange={(e) => setValues({ ...values, serverUrl: e.target.value })} placeholder="https://workspace.example" />
        </div>
        <label className="bd-check">
          <input type="checkbox" checked={values.askOnStartup} disabled={pending} onChange={(e) => setValues({ ...values, askOnStartup: e.target.checked })} />
          Ask for credentials on startup
        </label>
        {error !== null ? <p className="bd-notice bd-notice--error" role="status">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/** The sign-in dialog's username, password and Remember me fields, with the warning. */
function AccountFields({ username, setUsername, password, setPassword, remember, setRemember, pending }: {
  username: string; setUsername: (v: string) => void; password: string; setPassword: (v: string) => void;
  remember: boolean; setRemember: (v: boolean) => void; pending: boolean;
}) {
  return (
    <>
      <div className="bd-field">
        <label htmlFor="workspace-username">Username or email</label>
        <input id="workspace-username" className="bd-input" type="text" autoComplete="username" value={username} disabled={pending} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="bd-field">
        <label htmlFor="workspace-password">Password</label>
        <input id="workspace-password" className="bd-input" type="password" autoComplete="current-password" value={password} disabled={pending} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label className="bd-check">
        <input type="checkbox" checked={remember} disabled={pending} onChange={(e) => setRemember(e.target.checked)} />
        Remember me
      </label>
      <p className="bd-muted">{WARNING}</p>
    </>
  );
}

/**
 * The sign-in dialog: username, password, Remember me. Remember me decides
 * whether the username is stored (workspaceStore.signIn); it starts ticked
 * when one is remembered. The password lives in this component's state and
 * in onSubmit's argument, nowhere else, and is cleared after every attempt.
 */
export function WorkspaceSignInForm({ title, subtitle, cancelLabel = "Cancel", initialUsername, onSubmit, onCancel }: {
  title: string; subtitle?: string; cancelLabel?: string; initialUsername: string;
  onSubmit: (username: string, password: string, remember: boolean, signal: AbortSignal) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(initialUsername !== "");
  const { pending, error, cancel, run } = useSubmission(onCancel);
  const dialogRef = useChildDialog(cancel);
  const formId = "workspace-signin-form";
  return (
    <DialogShell dialogRef={dialogRef} ariaLabel={title} title={title} subtitle={subtitle} modifier="bd-dialog--editor" plain onClose={cancel}
      note={<button type="button" className="bd-button" onClick={cancel}>{cancelLabel}</button>}
      footerActions={<button type="submit" form={formId} className="bd-button bd-button--primary" disabled={pending || password === ""}>{pending ? "Signing in…" : "Sign in"}</button>}
    >
      <form id={formId} className="bd-form" onSubmit={(e) => { e.preventDefault(); void run((signal) => onSubmit(username, password, remember, signal), () => setPassword("")); }}>
        <AccountFields username={username} setUsername={setUsername} password={password} setPassword={setPassword} remember={remember} setRemember={setRemember} pending={pending} />
        {error !== null ? <p className="bd-notice bd-notice--error" role="status">{error}</p> : null}
      </form>
    </DialogShell>
  );
}

/**
 * A data backend's credential step: Key (prefilled with the stored header
 * name), Value and Remember me -- which here decides whether the VALUE is
 * stored (backendsStore.setCredential). It never signs in: when this backend
 * holds settings, connectServer probes and connects right after it.
 */
function BackendCredentialForm({ backend, step, onContinue, onSkip }: {
  backend: BackendConfig; step: string;
  onContinue: (input: { key: string; value: string; remember: boolean }) => Promise<string | null>;
  onSkip: () => void;
}) {
  const remembered = backend.headerValue !== undefined && !useBackendsStore.getState().runtimeCredentials.includes(backend.id);
  const [key, setKey] = useState(backend.headerName ?? "");
  const [value, setValue] = useState(remembered ? backend.headerValue ?? "" : "");
  const [remember, setRemember] = useState(remembered);
  const { pending, error, cancel, run } = useSubmission(onSkip);
  const dialogRef = useChildDialog(cancel);
  const formId = "backend-credential-form";
  const title = `Credentials for ${backend.name}`;
  return (
    <DialogShell dialogRef={dialogRef} ariaLabel={title} title={title} subtitle={step} modifier="bd-dialog--editor" plain onClose={cancel}
      note={<button type="button" className="bd-button" onClick={cancel}>Skip</button>}
      footerActions={<button type="submit" form={formId} className="bd-button bd-button--primary" disabled={pending || key.trim() === "" || value === ""}>Continue</button>}
    >
      <form id={formId} className="bd-form" onSubmit={(e) => { e.preventDefault(); void run(() => onContinue({ key: key.trim(), value, remember }), () => {}); }}>
        <div className="bd-form-grid">
          <div className="bd-field">
            <label htmlFor="credential-key">Key</label>
            <input id="credential-key" className="bd-input" value={key} disabled={pending} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="bd-field">
            <label htmlFor="credential-value">Value</label>
            <input id="credential-value" className="bd-input" type="password" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <label className="bd-check">
          <input type="checkbox" checked={remember} disabled={pending} onChange={(e) => setRemember(e.target.checked)} />
          Remember me
        </label>
        {error !== null ? <p className="bd-notice bd-notice--error" role="status">{error}</p> : null}
      </form>
    </DialogShell>
  );
}
```

Then add `WorkspaceConflictDialog`, `ask`, `decideWorkspaceConflict` and the remaining `ask*` functions:

```tsx
/**
 * Two answers and no third, so no ✕ and no Escape: closing without choosing
 * would leave neither side authoritative. Bare markup rather than
 * DialogShell, whose header always renders a ✕. useChildDialog still puts it
 * on modalStack, so an Escape meant for a dialog underneath (Settings,
 * Connections) lands on this entry's no-op instead of closing that dialog
 * under a question still waiting for its answer.
 */
export function WorkspaceConflictDialog({ name, review, notes, onDecide }: { name: string; review: string[]; notes: string[]; onDecide: (choice: "server" | "local") => void }) {
  const dialogRef = useChildDialog(() => {});
  return (
    <dialog ref={dialogRef} className="bd-dialog-backdrop" aria-label="Settings differ">
      <div className="bd-dialog bd-dialog--editor">
        <header className="bd-header">
          <div className="bd-heading">
            <h2 className="bd-title">Settings differ</h2>
            <p className="bd-subtitle">{`Each line reads setting: local → ${name}.`}</p>
          </div>
        </header>
        <div className="bd-body">
          <ul>{review.map((line) => <li key={line}>{line}</li>)}</ul>
          {notes.map((note) => <p key={note} className="bd-muted">{note}</p>)}
        </div>
        <footer className="bd-footer">
          <p />
          <div className="bd-actions">
            <button type="button" className="bd-button" onClick={() => onDecide("local")}>Keep local</button>
            <button type="button" className="bd-button bd-button--primary" onClick={() => onDecide("server")}>{`Use ${name}`}</button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * Renders one dialog into its own root until it answers -- decideImportConflicts'
 * idiom -- so bootstrap, Settings and Connections can all ask without any of
 * them holding dialog state. useChildDialog hands focus back on unmount.
 */
async function ask<T>(render: (answer: (value: T) => void) => ReactNode): Promise<T> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    return await new Promise<T>((resolve) => root.render(render(resolve)));
  } finally {
    root.unmount();
    host.remove();
  }
}

/** The sign-in dialog for one connection. True once signed in; false on Cancel (or Skip, as a startup step). */
export function askWorkspaceSignIn(connection: SettingsConnection, step?: string): Promise<boolean> {
  return ask<boolean>((answer) => (
    <WorkspaceSignInForm
      title={`Sign in to ${connection.name}`}
      subtitle={step}
      cancelLabel={step === undefined ? "Cancel" : "Skip"}
      initialUsername={useWorkspaceStore.getState().usernames[connection.id] ?? ""}
      onCancel={() => answer(false)}
      onSubmit={async (username, password, remember, signal) => {
        const message = await useWorkspaceStore.getState().signIn(connection, username, password, remember, signal);
        if (message === null) answer(true);
        return message;
      }}
    />
  ));
}

/**
 * A flagged backend's credential step. Continue gives the backend its
 * credential for this run (stored only with Remember me) and starts its
 * discovery (setCredential); Skip leaves that to the caller.
 */
export function askBackendCredential(backend: BackendConfig, step: string): Promise<"continued" | "skipped"> {
  return ask<"continued" | "skipped">((answer) => (
    <BackendCredentialForm
      backend={backend}
      step={step}
      onSkip={() => answer("skipped")}
      onContinue={async ({ key, value, remember }) => {
        await useBackendsStore.getState().setCredential(backend.id, key, value, remember);
        answer("continued");
        return null;
      }}
    />
  ));
}

export function decideWorkspaceConflict(name: string, review: string[], notes: string[]): Promise<"server" | "local"> {
  return ask((answer) => <WorkspaceConflictDialog name={name} review={review} notes={notes} onDecide={answer} />);
}
```

Notes for the implementer:
- If `.bd-check` does not exist in `src/styles/dialogs.css`, use `className="bd-inline"`. Do not add CSS.
- If lint's react-refresh rule objects to exporting functions alongside components, keep them in this file anyway: the rule is warn-level for `ImportConflictDialog.tsx`, which already does the same. Check `eslint.config.*`, and report the result rather than splitting the file.

- [ ] **Step 4: Run the dialog test to verify it passes**

Run: `pnpm test:run src/components/dialogs/WorkspaceDialogs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing sync tests**

Create `src/components/runWorkspaceSync.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./dialogs/WorkspaceDialogs", () => ({ askWorkspaceSignIn: vi.fn(), askBackendCredential: vi.fn(), decideWorkspaceConflict: vi.fn() }));
import { __read, __reset } from "../test/memfs";
import { backend } from "../test/fixtures";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { SettingsConnection } from "../lib/workspaceAccount";
import { useBackendsStore } from "../stores/backendsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { askBackendCredential, askWorkspaceSignIn, decideWorkspaceConflict } from "./dialogs/WorkspaceDialogs";
import { connectServer, promptSignIn, runStartupPrompt, syncAfterSignIn } from "./runWorkspaceSync";

const userId = "11111111-1111-4111-8111-111111111111";
const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const ws = (id: string, askOnStartup: boolean) => ({ id, name: id, serverUrl: `https://${id}.workspace.example`, askOnStartup });
const entry = (displaySettings: unknown, connection: SettingsConnection = conn) => ({ mode: "login" as const, connection, username: "alice", userId, token: "synthetic-session", displaySettings, state: "signed-in" as const });
const keyEntry = (displaySettings: unknown, connection: SettingsConnection) => ({ mode: "key" as const, connection, displaySettings, state: "signed-in" as const });
const posts = () => vi.mocked(fetch).mock.calls.filter(([, o]) => o?.method === "POST");
const REAL = { refresh: useBackendsStore.getState().refresh, probe: useWorkspaceStore.getState().probe, connectByKey: useWorkspaceStore.getState().connectByKey };
/** Stubs the probe's answer and, for key mode, a connect that lands the given display settings. */
function serverAnswers(mode: "key" | "login" | "no", display: unknown = { theme: "dark" }) {
  const probe = vi.fn(async () => mode);
  const connectByKey = vi.fn(async (c: SettingsConnection) => {
    useWorkspaceStore.setState({ sessions: { ...useWorkspaceStore.getState().sessions, [c.id]: keyEntry(display, c) } });
    return null;
  });
  useWorkspaceStore.setState({ probe, connectByKey });
  return { probe, connectByKey };
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  vi.mocked(askWorkspaceSignIn).mockReset();
  vi.mocked(askBackendCredential).mockReset();
  vi.mocked(decideWorkspaceConflict).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" }, draft: null });
  useWorkspaceStore.setState({ ...REAL, connections: [{ ...conn, serverUrl: conn.baseUrl, askOnStartup: false }], usernames: {}, sessions: { ws1: entry({ theme: "dark" }) } });
  useBackendsStore.setState({ backends: [], refresh: REAL.refresh });
});

describe("syncAfterSignIn", () => {
  it("finishes, asking nothing and calling nothing, when the session's settings match local", async () => {
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(decideWorkspaceConflict).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Use <name> saves the server's values locally", async () => {
    // Storage Local, as when User Settings switches: the save fires no upload.
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "light" }) } });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("server");
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(decideWorkspaceConflict).toHaveBeenCalledWith("Work", ["Theme: dark → light"], []);
    expect(JSON.parse(__read("settings.json") ?? "").theme).toBe("light");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Keep local uploads the local settings onto the session's display settings", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "light", keepMe: 1 }) } });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("local");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(JSON.parse(posts()[0][1]?.body as string)).toMatchObject({ theme: "dark", keepMe: 1 });
  });

  it("refuses malformed display settings without a local change", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry({ decimalDigits: "bad" }) } });
    expect(await syncAfterSignIn("ws1")).toBe(false);
    expect(useWorkspaceStore.getState().sessions.ws1).toMatchObject({ state: "not-synced" });
    expect(__read("settings.json")).toBeUndefined();
  });

  it("returns false without a session", async () => {
    useWorkspaceStore.setState({ sessions: {} });
    expect(await syncAfterSignIn("ws1")).toBe(false);
  });
});

describe("connectServer", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("key mode connects with no prompt and syncs", async () => {
    const { connectByKey } = serverAnswers("key", { theme: "light" });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("server");
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    expect(await connectServer(conn)).toBe(true);
    expect(connectByKey).toHaveBeenCalledWith(conn);
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
    expect(decideWorkspaceConflict).toHaveBeenCalled();
  });

  it("login mode opens the sign-in dialog; Cancel connects nothing and syncs nothing", async () => {
    serverAnswers("login");
    vi.mocked(askWorkspaceSignIn).mockResolvedValueOnce(false);
    expect(await connectServer(conn)).toBe(false);
    expect(askWorkspaceSignIn).toHaveBeenCalledWith(conn);
    expect(decideWorkspaceConflict).not.toHaveBeenCalled();
  });

  it("no settings API, or a refused key, connects nothing and uploads nothing", async () => {
    serverAnswers("no");
    expect(await connectServer(conn)).toBe(false);
    const { connectByKey } = serverAnswers("key");
    connectByKey.mockResolvedValueOnce("key refused");
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses a live session without probing", async () => {
    const { probe } = serverAnswers("login");
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "dark" }) } });
    expect(await connectServer(conn)).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("promptSignIn (a card's Sign in)", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("connects the connection holding settings by its mode", async () => {
    const { connectByKey } = serverAnswers("key");
    await promptSignIn(conn);
    expect(connectByKey).toHaveBeenCalled();
  });

  it("only signs in to any other connection, without probing or syncing", async () => {
    const { probe } = serverAnswers("login");
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    vi.mocked(askWorkspaceSignIn).mockResolvedValueOnce(true);
    await promptSignIn(conn);
    expect(askWorkspaceSignIn).toHaveBeenCalledWith(conn);
    expect(probe).not.toHaveBeenCalled();
    expect(decideWorkspaceConflict).not.toHaveBeenCalled();
  });
});

describe("runStartupPrompt", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("with Server on, connects at launch even when the server is not flagged: key mode needs no prompt", async () => {
    const { connectByKey } = serverAnswers("key");
    await runStartupPrompt();
    expect(connectByKey).toHaveBeenCalledWith(conn);
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
  });

  it("login mode prompts for the server first, then walks the other flagged connections, Workspace first", async () => {
    serverAnswers("login");
    const order: string[] = [];
    vi.mocked(askWorkspaceSignIn).mockImplementation(async (c, step) => { order.push(`${c.id}:${step ?? "server"}`); return false; });
    vi.mocked(askBackendCredential).mockImplementation(async (b, step) => { order.push(`${b.id}:${step}`); return "continued"; });
    useWorkspaceStore.setState({ connections: [{ ...ws("ws1", true), serverUrl: conn.baseUrl, name: "Work" }, ws("w2", true), ws("w3", false)] });
    useBackendsStore.setState({ backends: [backend({ id: "b1", askOnStartup: true }), backend({ id: "b2" })], refresh: vi.fn(async () => {}) });
    await runStartupPrompt();
    // The server (ws1) is not walked again as a flagged connection.
    expect(order).toEqual(["ws1:server", "w2:Step 1 of 2", "b1:Step 2 of 2"]);
  });

  it("Cancel at the server's sign-in keeps local settings and uploads nothing", async () => {
    serverAnswers("login");
    vi.mocked(askWorkspaceSignIn).mockResolvedValueOnce(false);
    await runStartupPrompt();
    expect(useSettingsStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, settingsStorage: "ws1" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a flagged server backend without a value asks for Key and Value first, then connects", async () => {
    const gw = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true });
    useBackendsStore.setState({ backends: [gw], refresh: vi.fn(async () => {}) });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "g" } });
    const { probe } = serverAnswers("key");
    vi.mocked(askBackendCredential).mockImplementationOnce(async () => {
      useBackendsStore.setState({ backends: [{ ...gw, headerValue: "admin@workspace.example" }] });
      return "continued";
    });
    await runStartupPrompt();
    expect(vi.mocked(askBackendCredential).mock.calls[0][1]).toBe("Step 1 of 1");
    // Connected against the backend as it is after its step, with the value.
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ id: "g", backend: expect.objectContaining({ headerValue: "admin@workspace.example" }) }));
  });

  it("skipping the server backend's credential step keeps settings local and discovers it without", async () => {
    const gw = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true });
    const refresh = vi.fn(async () => {});
    useBackendsStore.setState({ backends: [gw], refresh });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "g" } });
    const { probe } = serverAnswers("key");
    vi.mocked(askBackendCredential).mockResolvedValueOnce("skipped");
    await runStartupPrompt();
    expect(probe).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(["g"]);
  });

  it("does nothing with Local storage and nothing flagged", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useBackendsStore.setState({ backends: [backend({ id: "b1" })] });
    const { probe } = serverAnswers("key");
    await runStartupPrompt();
    expect(probe).not.toHaveBeenCalled();
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
    expect(askBackendCredential).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test:run src/components/runWorkspaceSync.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 7: Implement `src/components/runWorkspaceSync.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0

import { logError } from "../lib/logger";
import { readSessionSettings, type SettingsConnection } from "../lib/workspaceAccount";
import { useBackendsStore } from "../stores/backendsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { storageConnection, toSettingsConnections, useWorkspaceStore } from "../stores/workspaceStore";
import { askBackendCredential, askWorkspaceSignIn, decideWorkspaceConflict } from "./dialogs/WorkspaceDialogs";

/** The connection settings are stored on, read fresh -- a credential step may have just changed its backend. */
function serverConnection(): SettingsConnection | null {
  return storageConnection(
    useSettingsStore.getState().settings,
    toSettingsConnections(useWorkspaceStore.getState().connections, useBackendsStore.getState().backends),
  );
}

/**
 * The sign-in sync for one connection: diff the session's display settings
 * (no request -- bug #9; key mode read them when it connected) against local
 * over the synced keys, and ask which side wins when they differ. The diff is
 * readSessionSettings' `review` (planSettingsImport's change lines), so it
 * exists once. Returns false when there is no session or the settings were
 * refused -- the session state then carries the reason and nothing local
 * changed -- so User Settings knows not to switch on top of a failure.
 *
 * Keep local goes to queueUpload directly rather than through a save: when
 * User Settings switches, settingsStorage does not name this connection yet,
 * and settingsStore.save uploads only when it does.
 */
export async function syncAfterSignIn(id: string): Promise<boolean> {
  const session = useWorkspaceStore.getState().sessions[id];
  if (session === undefined) return false;
  const result = readSessionSettings(session, useSettingsStore.getState().settings);
  if (!result.ok) {
    useWorkspaceStore.getState().fail(id, result);
    return false;
  }
  const { patch, notes, review } = result.value;
  if (review.length === 0) return true;
  if ((await decideWorkspaceConflict(session.connection.name, review, notes)) === "server") await useSettingsStore.getState().save(patch);
  else await useWorkspaceStore.getState().queueUpload(id, useSettingsStore.getState().settings);
  return true;
}

/**
 * Connect to a settings server by its mode, then run the sign-in sync
 * (spec §3 and §4). A live session is reused. Otherwise the server is
 * probed: key mode connects with the connection's own credential and no
 * prompt; login mode opens the sign-in dialog, prefilled with the remembered
 * username; no settings API connects nothing. Any failure or Cancel resolves
 * false and leaves local settings alone -- nothing uploads until a later
 * connect succeeds. A refused key creates no session, so its reason goes to
 * the log (the select simply stays where it was).
 */
export async function connectServer(connection: SettingsConnection): Promise<boolean> {
  const existing = useWorkspaceStore.getState().sessions[connection.id];
  if (existing === undefined || existing.state === "expired") {
    const mode = await useWorkspaceStore.getState().probe(connection);
    if (mode === "key") {
      const message = await useWorkspaceStore.getState().connectByKey(connection);
      if (message !== null) {
        await logError(`settings server ${connection.name}: ${message}`);
        return false;
      }
    } else if (mode === "login") {
      if (!(await askWorkspaceSignIn(connection))) return false;
    } else {
      return false;
    }
  }
  return syncAfterSignIn(connection.id);
}

/**
 * A Workspace card's Sign in, and User Settings' Sign in: the connection
 * holding settings connects by its mode and syncs; any other connection only
 * signs in -- local is the authority there.
 */
export async function promptSignIn(connection: SettingsConnection): Promise<void> {
  if (useSettingsStore.getState().settings.settingsStorage === connection.id) await connectServer(connection);
  else await askWorkspaceSignIn(connection);
}

/**
 * The launch sequence (spec §4, Launch). With Server on, the settings server
 * comes first and is always connected, flagged or not: a flagged backend
 * without a value gets its Key/Value step first (Skip: settings stay local
 * for this run and it is discovered without a credential), then
 * connectServer. Then one step per OTHER flagged connection, Workspace
 * connections first, then data backends -- signing in to a Workspace
 * connection there syncs nothing, since it does not hold settings. A skipped
 * backend is discovered without its credential; a Continue starts discovery
 * inside setCredential. Steps are counted, the server's sign-in is not.
 */
export async function runStartupPrompt(): Promise<void> {
  const server = serverConnection();
  const needsCredential = server?.backend?.askOnStartup === true && !server.backend.headerValue;
  const workspaces = useWorkspaceStore.getState().connections.filter((c) => c.askOnStartup && c.id !== server?.id);
  const backends = useBackendsStore.getState().backends.filter((b) => b.askOnStartup === true && b.id !== server?.id);
  const total = (needsCredential ? 1 : 0) + workspaces.length + backends.length;
  let n = 0;
  if (server !== null) {
    let connect = true;
    if (needsCredential && server.backend) {
      if ((await askBackendCredential(server.backend, `Step ${++n} of ${total}`)) === "skipped") {
        void useBackendsStore.getState().refresh([server.id]).catch(() => {});
        connect = false;
      }
    }
    const current = connect ? serverConnection() : null;
    if (current !== null) await connectServer(current);
  }
  for (const c of workspaces) {
    const [connection] = toSettingsConnections([c], []);
    await askWorkspaceSignIn(connection, `Step ${++n} of ${total}`);
  }
  for (const b of backends) {
    if ((await askBackendCredential(b, `Step ${++n} of ${total}`)) === "skipped") {
      void useBackendsStore.getState().refresh([b.id]).catch(() => {});
    }
  }
}
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm test:run src/components/runWorkspaceSync.test.ts src/components/dialogs/WorkspaceDialogs.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/components/dialogs/WorkspaceDialogs.tsx src/components/dialogs/WorkspaceDialogs.test.tsx src/components/runWorkspaceSync.ts src/components/runWorkspaceSync.test.ts
git -C $R commit -m "feat(v3): add the sign-in and credential dialogs, connecting a settings server, and the startup prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Connections: Workspace group, Settings API line, removal rules

**Files:**
- Modify: `src/components/dialogs/ConnectionsDialog.tsx`
- Test: `src/components/dialogs/ConnectionsDialog.test.tsx`

**Interfaces:**
- Consumes:
  - `OPENBB_MARK` (Task 2)
  - `workspaceAddress` (Task 5)
  - `useWorkspaceStore`, `WorkspaceConnection`, `SessionEntry` (Task 6)
  - `WorkspaceConnectionForm`, `WorkspaceFormValues`, `promptSignIn` (Task 7)
  - `useSettingsStore`
- Produces: `<section aria-label="Workspace connections">`, which Task 11's help shot targets.

- [ ] **Step 1: Write the failing tests**

Edit `src/components/dialogs/ConnectionsDialog.test.tsx` as follows.

1. Add this next to the other mocks:

```ts
vi.mock("../runWorkspaceSync", () => ({ promptSignIn: vi.fn(async () => {}) }));
```

2. Add `__seed` to the existing memfs import.

3. Add these imports:

```ts
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { promptSignIn } from "../runWorkspaceSync";
```

4. Below `REAL_ACTIONS`, add:

```ts
const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false };
const wsConn = { id: "ws1", name: "Work", baseUrl: ws.serverUrl };
const entry = (state: "signed-in" | "expired" | "not-synced", reason?: string) => ({ mode: "login" as const, connection: wsConn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state, reason });
```

5. Add this to the existing `beforeEach`:

```ts
  // probeAll is stubbed: opening the dialog probes every connection, and a
  // real probe here would send requests to the fixtures' fake addresses.
  useWorkspaceStore.setState({ probeAll: vi.fn(async () => {}), connections: [], usernames: {}, sessions: {}, apis: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  vi.mocked(promptSignIn).mockClear();
```

6. Append this test block:

```tsx
describe("ConnectionsDialog Workspace group", () => {
  const card = (name = "Work") => screen.getByRole("article", { name });

  it("always offers Add Workspace and probes every connection on open", () => {
    useWorkspaceStore.setState({ connections: [ws] });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Workspace connections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Workspace" })).toBeInTheDocument();
    expect(useWorkspaceStore.getState().probeAll).toHaveBeenCalled();
  });

  it.each([
    [{ ws1: entry("signed-in") }, "Signed in as alice", "Sign out"],
    [{}, "Signed out", "Sign in"],
    [{ ws1: entry("expired") }, "Session expired", "Sign in"],
    [{ ws1: entry("not-synced", "The server refused the settings upload (HTTP 503).") }, "Not synced: The server refused the settings upload (HTTP 503).", "Sign out"],
    [{ ws1: { mode: "key", connection: wsConn, displaySettings: {}, state: "signed-in" } }, "Connected by key", "Sign out"],
    [{ ws1: { mode: "key", connection: wsConn, displaySettings: {}, state: "not-synced", reason: "key refused" } }, "Not synced: key refused", "Sign out"],
  ] as const)("shows each session state with its action and the OpenBB mark", (sessions, text, action) => {
    useWorkspaceStore.setState({ connections: [ws], sessions });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(card()).toHaveTextContent(text);
    expect(card()).toHaveTextContent("https://workspace.example");
    expect(card().querySelector(".bd-service-icon svg")).not.toBeNull();
    expect(within(card()).getByRole("button", { name: action })).toBeInTheDocument();
  });

  it("keeps a session per connection, and badges the one holding settings", () => {
    useWorkspaceStore.setState({ connections: [ws, { ...ws, id: "ws2", name: "Home" }], sessions: { ws1: entry("signed-in") } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws2" } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(card("Work")).toHaveTextContent("Signed in as alice");
    expect(card("Home")).toHaveTextContent("Signed out");
    expect(card("Home")).toHaveTextContent("Holds settings");
    expect(card("Work")).not.toHaveTextContent("Holds settings");
  });

  it("Sign in opens the sign-in dialog for that connection; Sign out ends only its session", async () => {
    useWorkspaceStore.setState({ connections: [ws, { ...ws, id: "ws2", name: "Home" }], sessions: { ws2: { ...entry("signed-in"), connection: { ...wsConn, id: "ws2" } } } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(within(card("Work")).getByRole("button", { name: "Sign in" }));
    expect(promptSignIn).toHaveBeenCalledWith(wsConn);
    await userEvent.click(within(card("Home")).getByRole("button", { name: "Sign out" }));
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("adds a connection: writes name, address and the flag, then opens the sign-in dialog", async () => {
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Workspace" }));
    await userEvent.type(screen.getByLabelText("Name"), " Work ");
    await userEvent.type(screen.getByLabelText("Server address"), "https://workspace.example/");
    await userEvent.click(screen.getByLabelText("Ask for credentials on startup"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Workspace" })).not.toBeInTheDocument());
    const saved = JSON.parse(__read("workspace.json") ?? "");
    expect(saved).toEqual({ connections: [{ id: expect.any(String), name: "Work", serverUrl: "https://workspace.example", askOnStartup: true }], usernames: {} });
    expect(promptSignIn).toHaveBeenCalledWith({ id: saved.connections[0].id, name: "Work", baseUrl: "https://workspace.example" });
  });

  it("Edit saves without opening the sign-in dialog", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Work" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Work");
    expect(screen.getByLabelText("Server address")).toHaveValue("https://workspace.example");
    await userEvent.click(screen.getByLabelText("Ask for credentials on startup"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(JSON.parse(__read("workspace.json") ?? "").connections[0].askOnStartup).toBe(true));
    expect(promptSignIn).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "Work", server: "http://remote.example" }, /Use an HTTPS Workspace address/],
    [{ name: "", server: "https://workspace.example" }, /Enter a name/],
  ])("refuses bad input before writing anything", async ({ name, server }, message) => {
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Workspace" }));
    if (name !== "") await userEvent.type(screen.getByLabelText("Name"), name);
    await userEvent.type(screen.getByLabelText("Server address"), server);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(__read("workspace.json")).toBeUndefined();
  });

  it("removing the connection that holds settings says so, then reverts storage to Local", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: { ws1: "alice" } }));
    useWorkspaceStore.setState({ connections: [ws], usernames: { ws1: "alice" }, sessions: { ws1: entry("signed-in") } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    vi.mocked(confirm).mockResolvedValueOnce(true);
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Work" }));
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatch(/holds your settings/);
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined());
    expect(JSON.parse(__read("workspace.json") ?? "")).toEqual({ connections: [], usernames: {} });
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("removing a backend that holds settings reverts storage and forgets its username", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [], usernames: { b1: "bob" } }));
    useWorkspaceStore.setState({ usernames: { b1: "bob" } });
    useBackendsStore.setState({ backends: [backend({ id: "b1", name: "Gateway" })], statuses: { b1: "online" } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "b1" } });
    vi.mocked(confirm).mockResolvedValueOnce(true);
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Gateway" }));
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatch(/holds your settings/);
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined());
    expect(JSON.parse(__read("workspace.json") ?? "").usernames).toEqual({});
  });

  it("Remove does nothing when the confirmation is cancelled", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: {} }));
    useWorkspaceStore.setState({ connections: [ws] });
    vi.mocked(confirm).mockResolvedValueOnce(false);
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Work" }));
    expect(useWorkspaceStore.getState().connections).toEqual([ws]);
  });

  it("shows each probed backend's Settings API mode and no sign-in controls", () => {
    useBackendsStore.setState({ backends: ["Key", "Login", "No", "Plain", "Auth"].map((name, i) => backend({ id: `b${i}`, name })), statuses: {} });
    useWorkspaceStore.setState({ apis: { b0: "key", b1: "login", b2: "no", b3: "needs-https", b4: "authorization-header" } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(card("Key")).toHaveTextContent("Settings API: key");
    expect(card("Login")).toHaveTextContent("Settings API: login");
    for (const name of ["No", "Plain", "Auth"]) expect(card(name)).toHaveTextContent("Settings API: no");
    expect(within(card("Login")).queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
```

7. Add `within` to the `@testing-library/react` import if it is missing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/components/dialogs/ConnectionsDialog.test.tsx`
Expected: the new tests FAIL; the existing ones PASS.

- [ ] **Step 3: Implement**

Make these changes in `src/components/dialogs/ConnectionsDialog.tsx`.

Add these imports, merging `useEffect` into the existing react import:

```ts
import { workspaceAddress } from "../../lib/workspaceAccount";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkspaceStore, type SessionEntry, type WorkspaceConnection } from "../../stores/workspaceStore";
import { promptSignIn } from "../runWorkspaceSync";
import { WorkspaceConnectionForm, type WorkspaceFormValues } from "./WorkspaceDialogs";
```

At module scope, after `ServiceGroup`, add:

```ts
/** A Workspace card's dot and words, from that connection's own session (absent: signed out). Key mode has no username to name. */
function workspaceStatusView(session: SessionEntry | undefined): { state: ServiceState; text: string } {
  if (session === undefined) return { state: "unchecked", text: "Signed out" };
  if (session.state === "signed-in") return { state: "online", text: session.mode === "login" ? `Signed in as ${session.username}` : "Connected by key" };
  if (session.state === "expired") return { state: "offline", text: "Session expired" };
  return { state: "offline", text: `Not synced: ${session.reason ?? ""}` };
}
```

Give `ServiceGroup` a `settingsApiFor: (backend: BackendConfig) => ReactNode;` prop, destructure it, and set the card's `detail` to `detail={<>{appNote(b)}{settingsApiFor(b)}</>}`.

Inside `ConnectionsDialog`, after the backend store selectors, add:

```tsx
  const workspaceConnections = useWorkspaceStore((s) => s.connections);
  const sessions = useWorkspaceStore((s) => s.sessions);
  const apis = useWorkspaceStore((s) => s.apis);
  const settingsStorage = useSettingsStore((s) => s.settings.settingsStorage);
  // The add/edit form for one Workspace connection; null when closed.
  const [workspaceForm, setWorkspaceForm] = useState<{ editing: WorkspaceConnection | null } | null>(null);

  // Every connection is probed for the Workspace settings API on open, for
  // the backend cards' "Settings API" line. Fired, never awaited: each probe
  // carries its own 5 s deadline and none can fail the dialog.
  useEffect(() => {
    void useWorkspaceStore.getState().probeAll().catch(() => {});
  }, []);

  /**
   * Advisory, like the apps line: shown once this backend has been probed.
   * Only a usable mode is named; Needs HTTPS and a login server whose
   * credential holds the Authorization header read "no" here, and User
   * Settings gives the reason.
   */
  function settingsApiFor(b: BackendConfig) {
    const answer = apis[b.id];
    if (answer === undefined) return null;
    return <p className="bd-muted">{`Settings API: ${answer === "key" || answer === "login" ? answer : "no"}`}</p>;
  }

  /** After either kind of connection is removed: its username, its session, and settings storage if it held them. */
  async function forgetConnection(id: string) {
    await useWorkspaceStore.getState().removeConnection(id);
    if (useSettingsStore.getState().settings.settingsStorage === id) {
      await useSettingsStore.getState().save({ settingsStorage: undefined });
    }
  }

  /** The confirmation's extra sentence when the connection holds settings. */
  const holdsSettingsNote = (id: string) =>
    useSettingsStore.getState().settings.settingsStorage === id ? " It holds your settings; settings storage returns to Local." : "";

  /**
   * Add/Edit's Save: refuse bad input before anything is written, then write
   * the connection (name, address, Ask for credentials on startup) to
   * workspace.json. Adding opens the sign-in dialog for the new connection;
   * editing does not -- an edited address has already dropped that session
   * (workspaceStore.saveConnection), and the card offers Sign in.
   */
  async function saveWorkspace(values: WorkspaceFormValues): Promise<string | null> {
    const name = values.name.trim();
    if (name === "") return "Enter a name for this connection.";
    const address = workspaceAddress(values.serverUrl);
    if (!address.ok) return address.message;
    const adding = workspaceForm?.editing == null;
    let saved: WorkspaceConnection;
    try {
      saved = await useWorkspaceStore.getState().saveConnection({ id: workspaceForm?.editing?.id, name, serverUrl: address.value, askOnStartup: values.askOnStartup });
    } catch (err) {
      await logError(`failed to save workspace.json: ${err}`);
      return "Could not save the Workspace connection. The reason is in the log.";
    }
    setWorkspaceForm(null);
    if (adding) {
      void promptSignIn({ id: saved.id, name: saved.name, baseUrl: saved.serverUrl }).catch((err: unknown) => logError(`sign-in failed: ${err}`));
    }
    return null;
  }

  async function removeWorkspace(connection: WorkspaceConnection) {
    try {
      const ok = await confirm(`Remove Workspace "${connection.name}"?${holdsSettingsNote(connection.id)}`, {
        title: "Remove Workspace",
        kind: "warning",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      await forgetConnection(connection.id);
    } catch (err) {
      await logError(`failed to remove Workspace connection ${connection.id}: ${err}`);
    }
  }
```

In the existing `handleRemove(backend)`:
- change the confirm text to `` `Remove backend "${backend.name}"?${holdsSettingsNote(backend.id)}` ``;
- after `await removeBackend(backend.id);`, add `await forgetConnection(backend.id);`.

In `handleRefresh`, after `await refresh();`, add `void useWorkspaceStore.getState().probeAll().catch(() => {});`.

Pass `settingsApiFor={settingsApiFor}` to `ServiceGroup`.

A card's Sign in calls `promptSignIn`, which connects by mode when that connection holds settings (Task 7).

In the JSX, insert the Workspace section immediately before the `<div className="bd-inline" …>` that holds "Your backends":

```tsx
      <section aria-label="Workspace connections" style={{ marginBottom: "24px" }}>
        <div className="bd-inline" style={{ justifyContent: "space-between" }}>
          <div>
            <h3>Workspace</h3>
            <p className="bd-muted">OpenBB Workspace accounts that can hold your settings.</p>
          </div>
          <button type="button" className="bd-button" onClick={() => setWorkspaceForm({ editing: null })}>
            Add Workspace
          </button>
        </div>
        {workspaceConnections.length > 0 ? (
          <div className="bd-service-list">
            {workspaceConnections.map((c) => {
              const session = sessions[c.id];
              const view = workspaceStatusView(session);
              // Signed in or Not synced: either way this connection has a live session.
              const live = session !== undefined && session.state !== "expired";
              return (
                <ServiceCard
                  key={c.id}
                  mark={OPENBB_MARK}
                  name={c.name}
                  kind="OpenBB Workspace"
                  ariaLabel={c.name}
                  status={<ServiceStatus live state={view.state} text={view.text} />}
                  endpoint={{ label: "Server", value: <code>{c.serverUrl}</code> }}
                  detail={settingsStorage === c.id ? <span className="bd-badge">Holds settings</span> : undefined}
                  actions={
                    <>
                      {live ? (
                        <button type="button" className="bd-button bd-button--ghost" onClick={() => useWorkspaceStore.getState().signOut(c.id)}>
                          Sign out
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="bd-button bd-button--ghost"
                          onClick={() => void promptSignIn({ id: c.id, name: c.name, baseUrl: c.serverUrl }).catch((err: unknown) => logError(`sign-in failed: ${err}`))}
                        >
                          Sign in
                        </button>
                      )}
                      <button type="button" className="bd-button bd-button--ghost" aria-label={`Edit ${c.name}`} onClick={() => setWorkspaceForm({ editing: c })}>
                        Edit
                      </button>
                      <button type="button" className="bd-button bd-button--danger" aria-label={`Remove ${c.name}`} onClick={() => void removeWorkspace(c)}>
                        Remove
                      </button>
                    </>
                  }
                />
              );
            })}
          </div>
        ) : null}
      </section>
```

After the `{draft ? <BackendEditForm … /> : null}` block, add the form:

```tsx
      {workspaceForm !== null ? (
        <WorkspaceConnectionForm
          title={workspaceForm.editing === null ? "Add Workspace" : "Edit Workspace"}
          initial={
            workspaceForm.editing === null
              ? { name: "", serverUrl: "", askOnStartup: false }
              : { name: workspaceForm.editing.name, serverUrl: workspaceForm.editing.serverUrl, askOnStartup: workspaceForm.editing.askOnStartup }
          }
          onSubmit={saveWorkspace}
          onCancel={() => setWorkspaceForm(null)}
        />
      ) : null}
```

Backend cards gain no sign-in controls (spec §2).

- [ ] **Step 4: Run the tests and lint**

Run: `pnpm test:run src/components/dialogs/ConnectionsDialog.test.tsx && pnpm lint`
Expected: PASS, old and new tests alike.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/components/dialogs/ConnectionsDialog.tsx src/components/dialogs/ConnectionsDialog.test.tsx
git -C $R commit -m "feat(v3): add Workspace connections and the Settings API line to Connections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Settings ▸ General: User Settings (Local / Server) replaces the Workspace account panel

**Files:**
- Modify: `src/components/dialogs/SettingsDialog.tsx`:
  - the import at line 25;
  - `accountPending` (line 176);
  - the Done button (line 403);
  - `<WorkspaceAccountSettings …/>` (lines 540-548).
- Delete: `src/components/dialogs/settings/WorkspaceAccountSettings.tsx`
- Test: `src/components/dialogs/SettingsDialog.test.tsx`

**Interfaces:**
- Consumes:
  - `useWorkspaceStore`, `toSettingsConnections` and `storageConnection` (Task 6);
  - `connectServer` and `promptSignIn` (Task 7);
  - `useBackendsStore`;
  - the file's own `Segments` component.
- Produces:
  - a "User Settings" row containing a `Segments` group named `userSettings`, with the options Local and Server;
  - with Server chosen, a `<select id="settings-server">` labelled "Server".

- [ ] **Step 1: Write the failing tests**

In `src/components/dialogs/SettingsDialog.test.tsx`:

1. Replace lines 13-14 (the `accountLoad` hoist and the `../../lib/workspaceAccount` mock) with:

```ts
const workspaceConnect = vi.hoisted(() => vi.fn());
const workspacePrompt = vi.hoisted(() => vi.fn());
vi.mock("../runWorkspaceSync", () => ({ connectServer: workspaceConnect, promptSignIn: workspacePrompt }));
```

2. Delete `accountLoad.mockReset().mockResolvedValue({ kind: "local" });` from the top-level `beforeEach` (line 95).

3. Delete the four tests from `it("offers optional Workspace credentials…` through the end of `it("reviews conflicts again when a Workspace download changes the pending patch"…`.

4. Add `within` to the `@testing-library/react` import. Add the import `import { useWorkspaceStore } from "../../stores/workspaceStore";`, and import `backend` from `../../test/fixtures` and `useBackendsStore` if they are not imported yet.

5. Append:

```tsx
describe("User Settings", () => {
  const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false };
  const wsConn = { id: "ws1", name: "Work", baseUrl: ws.serverUrl };
  const entry = (state: "signed-in" | "expired") => ({ mode: "login" as const, connection: wsConn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state });
  const choice = (name: "Local" | "Server") => within(screen.getByRole("group", { name: "userSettings" })).getByRole("radio", { name });
  const select = () => screen.getByLabelText("Server") as HTMLSelectElement;
  const option = (label: RegExp) => [...select().options].find((o) => label.test(o.text))!;
  beforeEach(() => {
    workspaceConnect.mockReset();
    workspacePrompt.mockReset();
    // probeAll and queueUpload are stubbed: a real probe or upload would
    // send requests to the fixtures' fake addresses and outlive the test.
    useWorkspaceStore.setState({
      connections: [ws], usernames: {}, sessions: {},
      apis: { ws1: "login" }, probeAll: vi.fn(async () => {}), queueUpload: vi.fn(async () => {}),
    });
    useBackendsStore.setState({ backends: [] });
  });

  it("no longer renders the Workspace account panel, and probes on open", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Workspace account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Workspace settings" })).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().probeAll).toHaveBeenCalled();
  });

  it("is Local by default, with no server dropdown", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(choice("Local")).toBeChecked();
    expect(screen.queryByLabelText("Server")).toBeNull();
  });

  it("Server shows the dropdown: each connection with its mode, the ineligible disabled with their reason, nothing saved yet", async () => {
    useBackendsStore.setState({ backends: ["Gateway", "NAS", "Basic", "Other", "Pending"].map((name, i) => backend({ id: `b${i}`, name })) });
    useWorkspaceStore.setState({ apis: { ws1: "login", b0: "key", b1: "needs-https", b2: "authorization-header", b3: "no" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    expect([...select().options].map((o) => o.text)).toEqual([
      "Choose a server…",
      "Work — login",
      "Gateway — key",
      "NAS — Needs HTTPS",
      "Basic — Credential uses the Authorization header",
      "Other — No settings API",
      "Pending — Checking…",
    ]);
    expect(option(/Work/).disabled).toBe(false);
    expect(option(/Gateway/).disabled).toBe(false);
    for (const label of [/NAS/, /Basic/, /Other/, /Pending/]) expect(option(label).disabled).toBe(true);
    expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined();
  });

  it("hints when no connection is eligible", () => {
    useWorkspaceStore.setState({ apis: { ws1: "no" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByText("Add a Workspace connection in Connections, or a backend that serves the Workspace settings API.")).toBeInTheDocument();
  });

  it("choosing a server connects to it; a failure or Cancel keeps the previous value", async () => {
    workspaceConnect.mockResolvedValueOnce(false);
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    expect(workspaceConnect).toHaveBeenCalledWith(wsConn);
    await waitFor(() => expect(select().value).toBe(""));
    expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined();
  });

  it("saves the server once connected and synced", async () => {
    workspaceConnect.mockResolvedValueOnce(true);
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    expect(JSON.parse(__read("settings.json") ?? "").settingsStorage).toBe("ws1");
    expect(choice("Server")).toBeChecked();
    expect(select().value).toBe("ws1");
  });

  it("Local saves storage as absent and keeps the session", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry("signed-in") } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(choice("Server")).toBeChecked();
    await userEvent.click(choice("Local"));
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined());
    expect(JSON.parse(__read("settings.json") ?? "")).not.toHaveProperty("settingsStorage");
    expect(useWorkspaceStore.getState().sessions.ws1).toBeDefined();
    expect(screen.queryByLabelText("Server")).toBeNull();
  });

  it("shows a dangling storage id as Local", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "gone" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(choice("Local")).toBeChecked();
  });

  it.each([["not connected", {}], ["expired", { ws1: entry("expired") }]])("offers Sign in when the server is %s", async (_label, sessions) => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useWorkspaceStore.setState({ sessions });
    workspacePrompt.mockResolvedValueOnce(undefined);
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(workspacePrompt).toHaveBeenCalledWith(wsConn);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/components/dialogs/SettingsDialog.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

In `src/components/dialogs/SettingsDialog.tsx`:

1. Replace `import { WorkspaceAccountSettings } from "./settings/WorkspaceAccountSettings";` with:

```ts
import { storageConnection, toSettingsConnections, useWorkspaceStore } from "../../stores/workspaceStore";
import { connectServer, promptSignIn } from "../runWorkspaceSync";
```

2. Replace `const [accountPending, setAccountPending] = useState(false);` with the block below. If the file already has a `useBackendsStore((s) => s.backends)` selector, reuse it instead of `storageBackends`.

```ts
  // A server connect in flight (probe, sign-in, sync, conflict question).
  // Done waits for it, as it waits for its own commit.
  const [storagePending, setStoragePending] = useState(false);
  // Server picked but no connection chosen yet: the dropdown shows, nothing
  // is saved. Saved storage alone decides once a connection is chosen.
  const [serverPicked, setServerPicked] = useState(false);
  const workspaceConnections = useWorkspaceStore((s) => s.connections);
  const settingsApis = useWorkspaceStore((s) => s.apis);
  const sessions = useWorkspaceStore((s) => s.sessions);
  const storageBackends = useBackendsStore((s) => s.backends);
  const storageList = useMemo(() => toSettingsConnections(workspaceConnections, storageBackends), [workspaceConnections, storageBackends]);
  const holder = storageConnection(effective, storageList);
  const serverChosen = holder !== null || serverPicked;
  const holderLive = holder !== null && sessions[holder.id] !== undefined && sessions[holder.id].state !== "expired";
  // Every connection is probed when the dialog opens (5 s each, in
  // parallel), so each option can show its mode. Fired, never awaited.
  useEffect(() => {
    void useWorkspaceStore.getState().probeAll().catch(() => {});
  }, []);
```

3. Add these two functions after `applyImport`:

```ts
  /** An option's label suffix: its mode when usable, otherwise why it is disabled. */
  function serverLabel(id: string): { suffix: string; usable: boolean } {
    switch (settingsApis[id]) {
      case "key":
        return { suffix: "key", usable: true };
      case "login":
        return { suffix: "login", usable: true };
      case "no":
        return { suffix: "No settings API", usable: false };
      case "needs-https":
        return { suffix: "Needs HTTPS", usable: false };
      case "authorization-header":
        return { suffix: "Credential uses the Authorization header", usable: false };
      default:
        return { suffix: "Checking…", usable: false };
    }
  }

  /**
   * User Settings saves at once rather than through the draft: choosing a
   * server is a connection and a sync, not a preference Cancel could take
   * back. A server is saved only after connectServer resolves true -- it
   * connected by key or by login, AND the sign-in sync completed. After a
   * refused key, a cancelled sign-in or refused display settings nothing was
   * compared, and switching anyway would let the next save overwrite server
   * values nobody was asked about. Not saving IS the revert: the controls
   * read the saved value. Local saves the field as absent and only stops
   * uploads; sessions stay until Sign out or quit.
   */
  async function chooseStorage(id: string) {
    setStoragePending(true);
    try {
      if (id !== "") {
        const connection = storageList.find((c) => c.id === id);
        if (connection === undefined || !(await connectServer(connection))) return;
        // Use <name> may have saved a new ticker under the open draft; the
        // ticker field is local state, so it follows unless the user has
        // typed in it.
        const draft = useSettingsStore.getState().draft;
        if (draft !== null && !Object.hasOwn(draft.patch, "defaultTicker")) {
          setTickerDraft(useSettingsStore.getState().settings.defaultTicker ?? "");
        }
      } else {
        setServerPicked(false);
      }
      await useSettingsStore.getState().save({ settingsStorage: id === "" ? undefined : id });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoragePending(false);
    }
  }
```

4. On the Done button, change `disabled={pending || accountPending}` to `disabled={pending || storagePending}`.

5. Replace the whole `<WorkspaceAccountSettings … />` element with:

```tsx
          <Row
            label="User Settings"
            description={
              // Every connection has answered and none offers a usable mode --
              // true for an empty list too. While any probe is pending the
              // ordinary description shows, so the hint never flickers.
              storageList.every((c) => settingsApis[c.id] !== undefined && !serverLabel(c.id).usable)
                ? "Add a Workspace connection in Connections, or a backend that serves the Workspace settings API."
                : "Local keeps settings on this computer. Server also syncs them with the server you choose."
            }
            control={
              <div className="bd-inline">
                <Segments
                  name="userSettings"
                  value={serverChosen ? "server" : "local"}
                  options={[
                    ["local", "Local"],
                    ["server", "Server"],
                  ]}
                  onChange={(v) => (v === "local" ? void chooseStorage("") : setServerPicked(true))}
                />
                {serverChosen ? (
                  <select
                    id="settings-server"
                    aria-label="Server"
                    className="bd-input"
                    value={holder?.id ?? ""}
                    disabled={storagePending}
                    onChange={(e) => void chooseStorage(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose a server…
                    </option>
                    {storageList.map((c) => {
                      const { suffix, usable } = serverLabel(c.id);
                      return (
                        <option key={c.id} value={c.id} disabled={!usable}>
                          {`${c.name} — ${suffix}`}
                        </option>
                      );
                    })}
                  </select>
                ) : null}
                {holder !== null && !holderLive ? (
                  <button
                    type="button"
                    className="bd-button"
                    onClick={() => void promptSignIn(holder).catch((err: unknown) => logError(`sign-in failed: ${err}`))}
                  >
                    Sign in
                  </button>
                ) : null}
              </div>
            }
          />
```

6. Delete the old panel:

```bash
git -C ~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair rm src/components/dialogs/settings/WorkspaceAccountSettings.tsx
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm test:run src/components/dialogs/SettingsDialog.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS. Typecheck is clean again, because nothing imports `loadWorkspaceSettings` any more.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/components/dialogs/SettingsDialog.tsx src/components/dialogs/SettingsDialog.test.tsx
git -C $R commit -m "feat(v3): User Settings (Local or Server) replaces the Workspace account panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Launch: load `workspace.json`, discovery that waits, the launch sequence

**Files:**
- Modify: `src/lib/bootstrap.ts`
- Test: `src/lib/bootstrap.test.ts`

**Interfaces:**
- Consumes:
  - `useWorkspaceStore.load` (Task 6)
  - `useBackendsStore.refresh(only?)` (Task 4)
  - `runStartupPrompt` (Task 7)

- [ ] **Step 1: Write the failing tests**

In `src/lib/bootstrap.test.ts`, add this after the `plugin-http` mock:

```ts
vi.mock("../components/runWorkspaceSync", () => ({ runStartupPrompt: vi.fn(() => new Promise<void>(() => {})) }));
```

Add these imports:

```ts
import { runStartupPrompt } from "../components/runWorkspaceSync";
import { useWorkspaceStore } from "../stores/workspaceStore";
```

In `beforeEach`, add:

```ts
  vi.mocked(runStartupPrompt).mockClear();
  useWorkspaceStore.setState({ connections: [], usernames: {}, sessions: {} });
```

Append inside `describe("bootstrap")`:

```ts
  const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: true };

  it("loads workspace.json and runs the startup prompt without waiting for it", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: {} }));
    // runStartupPrompt never settles here; bootstrap must still resolve.
    await bootstrap();
    expect(useWorkspaceStore.getState().connections).toEqual([ws]);
    expect(runStartupPrompt).toHaveBeenCalledTimes(1);
  });

  it("starts discovery with flagged backends still waiting for their values", async () => {
    const refresh = vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue();
    await bootstrap();
    // No ids: refresh() itself leaves flagged backends without a value alone (Task 4).
    expect(refresh).toHaveBeenCalledWith(undefined);
  });

  it("never prompts in a viewer window and discovers every backend", async () => {
    __seed("backends.json", JSON.stringify([{ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true }]));
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    window.history.replaceState({}, "", "/?viewer=z");
    const refresh = vi.spyOn(useBackendsStore.getState(), "refresh").mockResolvedValue();
    await bootstrap();
    expect(runStartupPrompt).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(["g"]);
  });

  it("still loads everything else when workspace.json is unusable", async () => {
    __seed("workspace.json", "not json");
    __seed("dashboards/z.json", dashboardFile("z", "Zeta"));
    await bootstrap();
    expect(useWorkspaceStore.getState().connections).toEqual([]);
    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["Zeta"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run src/lib/bootstrap.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

In `src/lib/bootstrap.ts`, add these imports:

```ts
import { runStartupPrompt } from "../components/runWorkspaceSync";
import { useWorkspaceStore } from "../stores/workspaceStore";
```

Add a fourth member to the `Promise.all` array, after the folders load:

```ts
      // workspace.json: the Workspace connections and remembered usernames
      // the startup prompt needs. Its own catch, because a broken file is no
      // reason to skip activating the viewer's dashboard below.
      useWorkspaceStore
        .getState()
        .load()
        .catch((err: unknown) => logError(`failed to load workspace.json: ${err}`)),
```

Replace `void useBackendsStore.getState().refresh().catch(() => {});` (keep the comment above it) with:

```ts
    // In the main window, refresh() leaves a backend flagged Ask for
    // credentials on startup and still without a value waiting: its startup
    // step starts its discovery (Continue, or Skip without a credential).
    // A viewer window never prompts -- it is read-only, and the main window
    // already asks -- so it discovers every backend now, flagged ones with
    // whatever value backends.json remembered.
    const everyBackend = viewerId !== null ? useBackendsStore.getState().backends.map((b) => b.id) : undefined;
    void useBackendsStore.getState().refresh(everyBackend).catch(() => {});
    // The launch sequence: with Server on, connect to the settings server
    // first (by key, or through the sign-in dialog), then walk the other
    // flagged connections. Fired, never awaited: settings.json is already
    // loaded and in use, so the app never waits on the network or on the
    // user, and a Cancel or failure just leaves settings local for the run.
    if (viewerId === null) void runStartupPrompt().catch((err: unknown) => logError(`startup prompt failed: ${err}`));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:run src/lib/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/lib/bootstrap.ts src/lib/bootstrap.test.ts
git -C $R commit -m "feat(v3): connect the settings server and run the startup prompt at launch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Documentation follows the UI, then full verification

**Files:**
- Modify: `src/help/guide/settings-and-logs.md`, the "Optional Workspace preferences" section at lines 22-30
- Modify: `src/help/guide/connecting-a-backend.md`, the Key/Value bullet
- Modify: `docs/reference-manual/v3/README.md:42-44`
- Modify: `docs/user-guide.md:11`
- Modify: `scripts/help-shots.mjs:249-256`, the `workspace-account` shot

- [ ] **Step 1: Rewrite the help section**

In `src/help/guide/settings-and-logs.md`, replace everything from `## Optional Workspace preferences` up to, but not including, `## Widget` with:

```markdown
## User Settings and Workspace connections

![Workspace connections in Connections](../attachments/workspace-account.png)

### Adding a Workspace connection

An OpenBB Workspace account is a connection. In **Connections**, choose **Add Workspace**, give it a name and its HTTPS server address (loopback HTTP is accepted for a development server), and choose **Save**; the sign-in dialog then asks for your username or email and password. You can add several.

**Remember me** keeps the username for next time; nothing ever stores the password or the session token. Signing in can replace another OpenBB Workspace session, and an account requiring additional verification must finish it in Workspace first.

Each card shows Signed in, Signed out, Session expired or Not synced, with Sign in or Sign out, Edit and Remove. The connection holding your settings is badged **Holds settings**. Data backend cards show **Settings API: key**, **login** or **no**.

### Ask for credentials on startup

Workspace connections and data backends both offer **Ask for credentials on startup**.

- **What the app asks at launch.** At each launch, one prompt walks the flagged connections, Workspace connections first:
  - A Workspace connection asks for your username, password and Remember me.
  - A data backend asks for its Key, its Value and Remember me. The Key is stored; the Value is stored only with Remember me, and is otherwise kept for this run only.
- **Skipping a step.** **Skip** leaves a Workspace connection signed out. A skipped backend connects without its credential.
- **Your settings server.** It is not part of this walk; it always connects first (see User Settings).

### User Settings

**Settings ▸ General ▸ User Settings** chooses where settings live.
- **Local** keeps them on this computer.
- **Server** also syncs your display settings with a server you choose from the dropdown.

**What the dropdown shows.** It lists your connections with how each connects:
- **key**: the connection's own key and value authorise it.
- **login**: you sign in with a username and password.

Connections that cannot hold settings are listed with the reason:
- **No settings API**.
- **Needs HTTPS**: a backend that does not use HTTPS.
- **Credential uses the Authorization header**: a login server whose backend credential occupies the header the session needs.

**Choosing a server** connects to it. When its settings differ from yours, you choose **Use** the server's or **Keep local**. After that, every save is uploaded.

**At launch,** the app always connects to your settings server first, whether or not it is flagged:
- A key server connects without asking.
- A login server asks you to sign in, with your username filled in when it was remembered.
- If its backend asks for credentials on startup, you are first asked for its key and value.
- Cancel keeps your local settings for that run.

If a key is refused, the card shows **Not synced: key refused**; fix the key in Connections.

Removing the server connection returns storage to Local.

User Settings does not synchronize dashboards, backends or provider keys. Live account sign-in remains unqualified in the reference rehearsal.
```

In `src/help/guide/connecting-a-backend.md`, add this bullet after the Key/Value bullet:

```markdown
- **Ask for credentials on startup** — hides **Value** and removes any stored value when you save, keeping **Key**. At each launch the app asks for the value; with **Remember me** it is stored again, otherwise it is kept for that run only. Skipping connects without it.
```

- [ ] **Step 2: Update the reference manual and the user guide**

In `docs/reference-manual/v3/README.md`, replace the two paragraphs at lines 42-44 (`In **Settings ▸ General ▸ Workspace account**…` and `The downloaded changes preview locally…`) with:

```markdown
**Workspace connections.**
- **Adding one.** **Connections ▸ Add Workspace** takes a name and an HTTPS server address (loopback HTTP for development); the sign-in dialog then takes a username or email, a password and **Remember me**. You can add several.
- **What is stored.** Only the name, the address and a remembered username are saved; passwords and session tokens never are.
- **Signing in.** Signing in may replace another Workspace session, and accounts requiring extra verification must complete it in Workspace first.
- **Settings API.** Data backend cards show **Settings API: key**, **login** or **no**.

**Ask for credentials on startup.** Every connection, Workspace or data backend, offers this option. At launch, one prompt walks the flagged connections:
- a Workspace connection asks for its username and password;
- a data backend asks for its Key and Value;
- **Remember me** decides whether the username or the value is stored.

**User Settings.** **Settings ▸ General ▸ User Settings** is **Local** or **Server**.
- **Choosing a server.** **Server** shows a dropdown of connections that serve the Workspace settings API, each labelled **key** (its own key and value authorise it) or **login** (a username and password). A data backend must use HTTPS. A login server's backend credential must not use the Authorization header.
- **Connecting.** Choosing a server connects to it, compares your settings with the server's, and asks **Use <connection>** or **Keep local** when they differ. After that, each save uploads.
- **At launch.** The settings server always connects first: by key without a prompt, or by login with the remembered username filled in. A flagged backend asks for its key and value first. Cancel keeps local settings for the run.
- **Errors and removal.** A refused key reads **Not synced: key refused**. Removing the server connection returns storage to Local.

Dashboards, backends and provider keys are not synchronized. Live account authentication remains unqualified.
```

In `docs/user-guide.md` line 11, replace `Optional Workspace account preference download in General does not synchronize dashboards.` with `Optional User Settings storage on a server syncs display settings with a Workspace connection or a backend serving the Workspace settings API; it does not synchronize dashboards.`

- [ ] **Step 3: Retarget the help screenshot**

In `scripts/help-shots.mjs`, replace the `workspace-account` entry's `prepare` and `take` with:

```js
    prepare: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "Connections" }).click();
      await page.getByRole("dialog", { name: "Connections" }).waitFor();
    },
    take: async (page) => page.getByRole("region", { name: "Workspace connections" }).screenshot({ animations: "disabled" }),
```

Then run `pnpm help:shots --only workspace-account`.
Expected: `src/help/attachments/workspace-account.png` is regenerated.
If the script cannot run in this environment (no browser, or the port is busy), say so in the task report. Do not hand-edit the PNG.

- [ ] **Step 4: Full verification**

Run each command and read its output before claiming anything:

```bash
cd ~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
pnpm typecheck
pnpm lint
pnpm test:run
pnpm scrub
grep -rn "loadWorkspaceSettings\|WorkspaceAccountSettings\|Load Workspace settings\|codeBlocked\|Allowed code languages\|X-OpenBB-Authorization" src scripts docs/reference-manual docs/user-guide.md
```

Expected:
- typecheck, lint and scrub are clean.
- The full suite passes. If it times out, check `uptime` for host load and re-run before suspecting the code.
- The final `grep` prints only the `requestHeaders` comment in `workspaceAccount.ts` that explains why `X-OpenBB-Authorization` is never sent, and the test assertion that it is absent.

- [ ] **Step 5: Commit**

```bash
R=~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb-clean-v3-repair
git -C $R branch --show-current   # must print codex/clean-v3-repair
git -C $R add src/help/guide/settings-and-logs.md src/help/guide/connecting-a-backend.md docs/reference-manual/v3/README.md docs/user-guide.md scripts/help-shots.mjs src/help/attachments
git -C $R commit -m "docs(v3): document Workspace connections, User Settings and Ask for credentials on startup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rulings

### Still in force from earlier revisions

**Choosing a server in User Settings**
- The choice saves immediately, not through the Settings draft. Cancel or a failure reverts to the previous value simply because nothing is saved.
- A server is saved only after it has connected and the sign-in sync has completed.
- A dangling `settingsStorage` id is treated as Local wherever it is used, and is not rewritten on disk.

**Sign-in dialog and sync**
- Cancel aborts a sign-in that is still in flight.
- The conflict dialog offers exactly two choices, with no ✕ and no Escape.
- The diff reuses `planSettingsImport`'s `review` lines.
- A cleared ticker or auto-refresh is uploaded as `null`.

**Uploads**
- A save uploads only to the connection named by `settingsStorage`, and only while that connection has a live session.
- The upload queue itself checks only for the session, so "Keep local" can upload before storage switches.

**Connections and backends**
- Sessions are kept one per connection id, each with its own `displaySettings`.
- Workspace forms hold no credentials. Adding a connection opens the sign-in dialog; editing does not, and an edit drops the session only when the address changes.
- `removeConnection` handles both kinds of connection and writes nothing when there is nothing to change.
- Runtime credentials are never written. Every save goes through `persistable()`, and v3 has no backend export.
- Discovery waits for flagged backends that have no value, except where an explicit list is given.
- Ticking "Ask for credentials on startup" mid-run keeps the value in memory until quit.

**Launch and prompts**
- The viewer window never prompts and discovers every backend.
- The prompt prefill rules for remembered usernames and stored values are unchanged.

**Already-built work**
- The OpenBB mark port is unchanged.
- The allowed-code-languages removal is built as `3a63d99`, and Task 1 is marked done.

### Changed in this revision

- **The probe classifies a mode.** `SettingsApi` is now `"key" | "login" | "no" | "needs-https" | "authorization-header"`.
  - `"authorization-header"` now means a login-mode server whose backend credential is the Authorization header. It is decided after the request, not before.
  - The same backend probed as key mode is usable.
  - `settingsIneligibility` is gone. Only `needs-https` is still decided without a request.
- **Sessions carry `mode`.** `WorkspaceSession` is a union.
  - Login mode has `username`, `userId` and `token`; key mode has none of them.
  - A key-mode 401, at connect or on upload, is the message `KEY_REFUSED` ("key refused"): Not synced, never expired.
  - The upload queue checks that the session is the same object, not that the token matches, because key mode has no token.
- **Bug #9 is now a fixed fact, not a conditional.** Task 5 builds on `c8c7f7c` and keeps its `UUID.test` check on the login's `uuid`. Revision 3 had relaxed that check to "non-empty".
- **One flow connects the settings server.** `connectServer(connection)` reuses a live session, or probes and then connects by key (no prompt) or by login (sign-in dialog), and then runs the sign-in sync. User Settings, the card's Sign in on the holder, and launch all use it.
  - `promptSignIn` connects the holder through `connectServer`; for any other connection it is the sign-in dialog alone.
- **The launch sequence always connects the settings server first.** This replaces revision 3's "syncs only if flagged and signed in". In order:
  1. A flagged server backend without a value gets its Key/Value step. Skip keeps settings local and discovers the backend without a credential.
  2. `connectServer` runs on the connection as re-read after that step, so it has the new value.
  3. The server is excluded from the flagged walk that follows, so it is never asked twice.
  4. Signing in to a flagged Workspace connection in the walk syncs nothing, because it does not hold settings.
  5. The server's sign-in dialog is not counted in the "Step n of N" caption.
- **The backend credential step never signs in.** It asks only for Key, Value and Remember me. The username and password fields and `withSignIn` are gone, because `connectServer` does the login. `AccountFields` now has a single use, in the sign-in dialog.
- **User Settings replaces the Settings storage select.** It is a Local/Server `Segments` group named `userSettings`.
  - Choosing Server shows a `Server` dropdown, starting at the disabled option "Choose a server…".
  - Choosing Server saves nothing until a connection is chosen.
  - Each option reads "<name> — key", "<name> — login", or "<name> — <reason>", and "Checking…" while its probe is pending.
  - Local clears the field.
  - The Sign in button stays next to the controls when the server has no live session.

### New in this revision

- **A Workspace card in key mode reads "Connected by key".** There is no username to name.
- **Backend cards show "Settings API: key", "login" or "no".** "Needs HTTPS" and a login server whose credential is the Authorization header both read "no" on the card; User Settings gives the reason.
- **A refused key at connect time creates no session.** Its reason goes to the log; the choice simply stays where it was.
- **`workspaceStore` gains `probe(connection)`, which records one answer.** `connectServer` probes again even when `probeAll` already answered, because launch needs a fresh probe anyway.
