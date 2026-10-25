# Workspace connection and settings storage — design

Date: 2026-10-08 (revised the same day). Line: v3 (`codex/clean-v3-repair`, local only).
Status: revision 4, amended 2026-10-08 for coordinator rulings R1-R3; approved 2026-10-08 (User Settings Local/Server; launch always connects to the server, by key or login). Revision 3 was approved and committed in ce1fff7; its Task 1 (code languages removal) is built as 3a63d99.

## Goal

1. Move the OpenBB Workspace account sign-in out of Settings ▸ General ("Workspace account") into the Connections dialog as its own kind of connection.
2. Add a **User Settings** item to Settings ▸ General with two choices, **Local** (today's app-data `settings.json`) and **Server**. Choosing Server shows a dropdown of the user's connections that present the settings API, Workspace or data backend. Storage on a server is two-way sync with it.
   - On launch with Server on, BDOBB always connects to that server: with the connection's **key** (its key/value credential, sent as cookie, header or query parameter) when that authorises the settings calls, otherwise through a **login prompt** whose username is filled in when Remember me saved it.
3. Show the OpenBB mark instead of "DB" on the card of a backend that is the OpenBB Platform API, and on Workspace cards.
4. Give every connection, Workspace or data backend, an **Ask for credentials on startup** option, so credentials can be typed at launch instead of stored.
5. Remove BDOBB's per-backend "Allowed code languages" field and its client-side gate. Allowed code languages is an openbq-docker setting, and the server becomes the only gate.

The Workspace account panel and the allowed-languages field both first ship in v3.0.0, so v3 is the home line. Later lines receive the change by carry-forward.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Release line | v3 |
| Storage choice | Settings ▸ General ▸ **User Settings**: Local or Server; Server shows a dropdown of connections |
| Which connections can be picked | Any connection that presents the Workspace settings API, data backends included |
| Meaning of connection storage | Two-way sync: download on sign-in, upload on every save |
| Startup, settings server | With Server on, launch always connects to the chosen connection: by **key** (key mode) when its key/value credential authorises the settings calls, otherwise by a **login prompt** (login mode), username prefilled when remembered. Cancel at the prompt keeps local settings for this run |
| Startup, other connections | Per-connection option **Ask for credentials on startup** stays, on Workspace connections and data backends |
| Local and server differ at sign-in | Ask per sign-in |
| What an upload writes | The `extensions.bdobb` block plus the shared Workspace keys |
| What is kept on disk | Server address and the flag, always. Workspace username: only when **Remember me** is ticked in the sign-in dialog. A flagged data backend: its credential key (e.g. `username`) always; its value (e.g. `admin@openbb.co`) only with Remember me. Never a Workspace password or session token |
| Bug #9 (self-hosted `GET /pro/user` 401) | Sync reads `user.pro_display_settings` from the `/pro/login` response; no `GET /pro/user` call; the token goes only in `Authorization: Bearer`. Built on the regression session's fix of `workspaceAccount.ts` |
| OpenBB mark on cards | Folded in: port of the uncommitted bdobb-v2 work on `claude/openbb-logo-dialog-c99ee6` |
| Allowed code languages | Removed from BDOBB in this plan. openbq-docker owns the setting; that session was told on 2026-10-08 |

## Server contract (the Workspace settings API, from OpenBB Workspace `backend-api`)

All paths are relative to the connection's base address: the server address for a Workspace connection, the `baseUrl` for a data backend.

- `POST /pro/login`: returns `uuid`, `access_token` (an opaque token, not a JWT) and `user.pro_display_settings`. This response is the only source of the account's display settings. The refusals (202, `force_2fa`, `temporary_password`) are unchanged from v3.0.0.
- `GET /pro/user`: **never called with a session token.** A self-hosted server rejects the opaque login token there with 401 (bug #9). It is called only with the connection's own key (the probe, and key mode).
- Authenticated requests send the token **only** as `Authorization: Bearer <token>`, as the Workspace web client does. `X-OpenBB-Authorization` sends the server down its JWT path and fails.
- Signing in replaces the account's open Workspace web session; the web client is logged out at its next poll. The sign-in dialog keeps the warning.
- `POST /pro/display-settings`: **replaces** `pro_display_settings` wholesale (`ProDisplaySettings`, `extra="allow"`). Any key the client omits is lost, so every upload is read-merge-write.
- **Probe and mode.** `GET /pro/user` is sent with the connection's own key/value credential (per `authLocation`; none for a Workspace connection) and no session token:
  - **200 with a `pro_display_settings` object → key mode.** The key alone authorises the settings calls.
  - **Key refused.** A backend credential was sent and the answer is 401 with a `WWW-Authenticate` header whose scheme is Basic (case-insensitive): the server is in key mode and rejected the key, not login mode.
  - **401 without that header, or 403 → login mode.** The connection presents the API but needs a `/pro/login` session.
  - Anything else (404, other status, network error, timeout) → no settings API.
- **Key mode contract** (for servers that choose to support it; openbq-docker is one, its key being HTTP Basic): `GET /pro/user` returns `pro_display_settings`, and `POST /pro/display-settings` replaces it, both authorised by the connection's key/value credential alone. BDOBB sends no login and no token in key mode. Any other result (404, other status, network error) means the connection does not present the API.
- No version or modified time exists on the server, so lost updates can't be detected. If another client and BDOBB both write between two BDOBB sign-ins, the last write wins. The sign-in conflict prompt is the only guard. This is an accepted limit.
- `defaultTicker` on the server is a full instrument object (`id`, `symbol`, `category`, `type`, `name`, `exchange`, …). An invalid value is silently reset to the server default.

## 1. Data

- **`workspace.json`** (new, in app data, written through `jsonStore` like `backends.json`):
  ```json
  { "connections": [{ "id": "…", "name": "…", "serverUrl": "…", "askOnStartup": true }],
    "usernames": { "<connection id>": "…" } }
  ```
  - `connections` lists the Workspace connections. There may be any number of them.
  - `usernames` holds a Workspace-account username per connection id, Workspace or data backend, **only** when Remember me was ticked at its last sign-in. Unticking Remember me deletes the entry.
  - No password or token is ever written.
- **`BackendConfig.askOnStartup?: boolean`** (new, in `backends.json`). When true:
  - `headerName` (the credential key, e.g. `username`) stays stored.
  - `headerValue` is stored only when Remember me was ticked at the last startup prompt. Otherwise it is held in memory for this run only and is absent from `backends.json` and from backend exports.
- **`Settings.settingsStorage?: string`**: the id of the server connection. Absent means Local; present means Server with that connection.
  - Validated in `settingsFile`. An id that matches no existing connection loads as Local.
  - Never uploaded or downloaded: it is not in the synced key set.
  - Not in the settings export bundle: excluded the same way `dashboardOrder` is.
- **Sessions** (an in-memory zustand store, one entry per signed-in connection id):
  - Fields: `{ connectionId, baseUrl, mode, username, userId, token, displaySettings, state }`, where `mode` is `key` or `login` (`username`, `userId` and `token` are absent in key mode) and `state` is `signed-out`, `signed-in`, `expired`, or `not-synced` with a reason.
  - `displaySettings` is the server's `pro_display_settings` from the login response, replaced by the merged object after each successful upload.
  - Quitting or signing out clears an entry. Nothing in it is ever persisted.
- **Runtime backend credentials** (in memory): the values typed at the startup prompt for flagged backends without Remember me. The backend's requests use them exactly as a stored `headerValue` is used today.
- **Synced keys** are the existing `NATIVE_KEYS` set in `workspaceAccount.ts`: theme, fontSize, defaultTicker, matchDashboardSymbol, maxDecimalPlaces, minimizeButton, collapseWidgetControls, cornerDragHandles, quickAddToolbar, railWidth and autoRefreshMinutes; on the v4 line also widgetGap (ruling 2026-10-09); on the v5 line also numberShortcutTarget, but not workspaceOrder, which names this machine's workspace ids (ruling 2026-10-09). A download ignores keys in `extensions.bdobb.settings` that are not in this set (a later line syncs more, such as v4's widgetGap) and adds a note naming them, instead of refusing the sync (ruling 2026-10-09).

## 2. Connections dialog

- **The Workspace group** renders above "Your backends" with one `ServiceCard` per Workspace connection.
  - Status: "Signed in as X", "Signed out", "Session expired" or "Not synced: <reason>". A "Holds settings" badge shows when `settingsStorage` is that connection.
  - Endpoint: the server address.
  - Actions: Sign in / Sign out, Edit and Remove.
  - An **Add Workspace** button is always present.
- **The add/edit form** has three fields: name, server address, and the **Ask for credentials on startup** checkbox.
  - The address rule is unchanged: HTTPS only (HTTP on loopback); no credentials, query or fragment.
  - Saving writes the connection to `workspace.json`. Adding a connection then opens the sign-in dialog for it.
- **The sign-in dialog** (used from a card's Sign in, the User Settings choice and the startup prompt) has username or email, password, and **Remember me**.
  - Username is prefilled and Remember me ticked when a username is remembered.
  - The password field is cleared after every attempt.
  - The warning "Signing in can replace another OpenBB Workspace session" stays.
- **The backend edit form** gains the **Ask for credentials on startup** checkbox. When it is ticked, the Value field is hidden, any stored value is removed on save, and the Key field stays.
- **Data backend cards** gain one line, "Settings API: key", "Settings API: login" or "Settings API: no", from the probe. They gain no sign-in controls; signing in to a backend's settings API happens only through the User Settings choice or the startup prompt.
- **Removing a connection** asks for confirmation. This applies to both kinds. If the removed connection holds settings, the confirmation says so, and storage reverts to Local. Removal also clears the session if it was that connection's, and deletes the connection's `usernames` entry.
- **Code reuse**: the login code as fixed for bug #9 is reused, split so that sign-in returns `{ userId, token, displaySettings }` for the session store instead of discarding it. That covers `serverAddress`, `responseJson`, `/pro/login`, the timeout and abort, and the 202/2FA refusals.

## 3. Settings ▸ General

- `WorkspaceAccountSettings` is removed from the Settings dialog.
- It is replaced by a **User Settings** item: a **Local / Server** choice. With Server chosen, a dropdown lists each connection by name, Workspace connections first and then data backends. Each option shows its mode once probed ("key" or "login").
  - Opening the Settings dialog probes every connection (unauthenticated `GET /pro/user`, 5 s timeout, run in parallel).
  - A connection that does not present the API is listed but disabled, with the reason "No settings API".
  - A data backend whose `baseUrl` is not HTTPS (and not loopback) is disabled with "Needs HTTPS". The address rule applies to every connection that receives a password.
  - A data backend whose own credential header is `Authorization` is disabled with "Credential uses the Authorization header", since the session token must go there.
  - With no eligible connection, a hint reads: "Add a Workspace connection in Connections, or a backend that serves the Workspace settings API."
- Choosing Server with a connection (or changing the dropdown) connects to it: key mode connects directly; login mode opens the sign-in dialog unless that connection is already signed in.
  - On success, the sign-in sync runs (section 4), then `settingsStorage` is saved.
  - On Cancel or on a failed sync, the choice reverts to its previous value.
  - A refused key (at connect or on upload) shows "Key refused by <connection name>; fix the key in Connections." in the User Settings row, as well as the log.
- Choosing Local stops uploads and saves `settingsStorage` as absent. The local file is unchanged.
- A connection whose own credential header is `Authorization` can still be chosen in key mode (no token is sent); it is disabled only for login mode.

## 4. Sync

**Launch.**
- `bootstrap` loads `settings.json`, `backends.json` and `workspace.json` exactly as today, so the app never waits on the network for local settings.
- Discovery starts at once for every backend that is not flagged, or is flagged with a remembered value. A flagged backend without a value waits for its prompt.
- If any connection is flagged, one **startup prompt** walks them in order, one step per connection: Workspace connections first, then data backends.
  - **Workspace step:** the sign-in dialog fields (username, password, Remember me). **Sign in** signs in; **Skip** leaves it signed out.
  - **Data backend step:** Key (prefilled with the stored header name, e.g. `username`), Value (e.g. `admin@openbb.co`) and Remember me. **Continue** gives the backend that credential for this run (and stores the value with Remember me) and starts its discovery. **Skip** starts discovery with no credential.
  - The step asks only Key, Value and Remember me. If the backend holds settings, connectServer then probes and signs in (login mode: the sign-in dialog).
- **The settings server connects at launch whether or not it is flagged**, and its step comes first:
  - If it is a flagged backend without a remembered value, its step asks for Key and Value first.
  - It is then probed. **Key mode:** BDOBB reads `GET /pro/user` with the key and runs the sign-in sync, with no prompt. **Login mode:** the sign-in dialog opens, with the username filled in when Remember me saved it.
  - **Cancel** (or Skip), or a failed connection, keeps local settings for this run; nothing uploads until the user connects from User Settings or the card. The next launch tries again.

**Request auth.**
- A Workspace connection sends only `Authorization: Bearer <token>`.
- A data backend sends its own credential, placed exactly as its data requests place it (header, query or cookie, per `authLocation`). In login mode it adds `Authorization: Bearer <token>`; a backend whose own credential header is `Authorization` cannot use login mode (section 3). In key mode no token is sent.

**Sign-in sync.**
1. Take `pro_display_settings` (login mode: `user.pro_display_settings` from the `/pro/login` response; key mode: the `GET /pro/user` body) and map it with today's `preferencePatch`, in which the `extensions.bdobb` block overrides the shared keys.
2. Diff the mapped patch against the local settings over the synced keys.
3. If nothing differs, finish.
4. If anything differs, a conflict dialog lists each differing key with its local and server values, and offers two choices:
   - **Use <connection name>** saves the patch locally through `settingsStore.save`.
   - **Keep local** uploads the local settings.

**Upload.** After every successful `settingsStore.save` or `commitDraft`, an upload runs when `settingsStorage` names the session's connection and the session is `signed-in` or `not-synced` (a not-synced session is retried on the next save, per section 7).
- No upload runs while the sign-in conflict dialog is open for that connection; its answer sends (Keep local) or saves (Use <connection name>) the latest local state, so a save made meanwhile is not lost.
- Uploads run on a `serialize` chain. Each upload sends the store's state at the moment it starts, so queued uploads collapse to the latest state.
- Each upload has three steps:
  1. Start from the session's `displaySettings` (the login copy, or the result of the last successful upload). No `GET /pro/user`.
  2. Merge:
     - `theme`, `fontSize`. On the v4 line (ruling 2026-10-09), a `theme` of `"system"` is written as the OS's current appearance, `"light"` or `"dark"`, resolved at upload time by `systemTheme()` (src/lib/theme.ts), because Workspace's `theme` holds only light or dark. `extensions.bdobb` still carries `"system"`, so BDOBB round-trips it, and a sign-in download of that object does not refuse;
     - `decimalDigits` ← `maxDecimalPlaces`;
     - `showWidgetControls` ← `!collapseWidgetControls`;
     - `gridCorners` ← `[]` when `cornerDragHandles` is false; when it is true, the server's list if non-empty, otherwise `["se"]`;
     - `extensions.bdobb` ← `{ schemaVersion: 1, profile: "v3", settings: <all synced keys> }`;
     - every other key is preserved, including other `extensions` entries;
     - **`defaultTicker` is not written as a shared key.** BDOBB stores only a symbol. The ticker travels only inside `extensions.bdobb`.
  3. `POST /pro/display-settings` with the merged object. On success it becomes the session's `displaySettings`.
- Because signing in logs out the account's Workspace web session, another writer between BDOBB's sign-in and its uploads is unlikely. The last-write-wins limit above still applies.

## 5. Allowed code languages removal

- **Removed:**
  - `BackendConfig.allowedCodeLanguages`;
  - the "Allowed code languages" field in `BackendEditForm`;
  - the client gate (`codeBlocked` in `src/lib/omni.ts`) and its use in `OmniRenderer`.
- **Loading old files**: a `backends.json` or backend import that still carries `allowedCodeLanguages` loads without error, and the field is dropped on the next write.
- **Omni widgets** that declare a code language are sent to the backend like any other omni request. A refusal from the server is shown in the card as the server's error, through the existing omni error path.
- **Docs and help** that describe the field are updated to say the backend's server decides which languages run.
- **Server side**: decided by the openbq session as `OPENBQ_OMNI_EXEC_ALLOWED`, a comma list of languages, refusing with HTTP 403 and a `detail` message. BDOBB does not depend on the variable or the wording; the plan's test uses that refusal as its fixture.

## 6. OpenBB mark on connection cards

This is a port of the uncommitted work in the bdobb-v2 worktree `laughing-mayer-c7afb3`, branch `claude/openbb-logo-dialog-c99ee6`. That worktree is read only for the port and is not modified.

- **`fetchServiceName(backend)`** (new in `dataClient`): a `GET <baseUrl>/` request.
  - It uses the backend's configured auth and the same deadline as `apps.json`.
  - A JSON body with a non-empty string `service` returns that string.
  - An HTML body whose `<title>` is "OpenBB Platform" returns `OPENBB_PLATFORM_SERVICE` (`"openbb-platform"`).
  - Anything else, or a failure, returns `undefined`. It never changes the backend's online/offline status.
- **Discovery** runs it alongside `widgets.json`/`apps.json` and stores the result in a `services: Record<backendId, string | undefined>` map in `backendsStore`.
- **Data backend cards** show the OpenBB "BB" glyph (inline SVG, `currentColor`) when `services[id] === OPENBB_PLATFORM_SERVICE`, otherwise "DB".
- **Workspace cards** always show the OpenBB glyph.
- `ServiceCard.mark` accepts a `ReactNode`, not only a string.

## 7. Errors

Every failure leaves local settings authoritative and the app usable. No error blocks a local save.

| Failure | Result |
|---|---|
| Network error, timeout or 5xx on upload | Session `not-synced` with the reason. The next successful save re-sends the whole state |
| 401 on any authenticated request | Login mode: session `expired`, with Sign in offered on the card (Workspace) and in User Settings. Key mode: `not-synced: key refused`, shown as "Key refused by <connection name>; fix the key in Connections." in the User Settings row (section 3) as well as the log; the user fixes the key in Connections |
| Sign-in refused (credentials, 202/2FA, temporary password) | Today's messages, shown in the prompt or form |
| Malformed display settings at sign-in | Today's `preferencePatch` refusals. No local change |
| Probe fails or times out | The connection is listed as "No settings API". Nothing else changes |
| Removing the connection that holds settings | Storage reverts to Local after confirmation |
| `settingsStorage` names a connection that no longer exists | Treated as Local |
| A flagged backend is skipped at startup | Discovery runs without its credential; the backend shows whatever status that produces (typically offline). Edit or the next launch supplies the value |
| A flagged Workspace connection is skipped at startup | It stays signed out; the card's Sign in still works |

## Testing

- **Mapping:**
  - download, keeping the existing tests;
  - upload merge: shared keys, the `gridCorners` rule, the ticker untouched, unknown keys and other extensions preserved;
  - round trip: upload then download yields the same synced settings.
- **Probe:** 200 with `pro_display_settings` is key mode; 401 and 403 are login mode; 404, other statuses, a network error and a timeout are no API. A non-HTTPS backend is not probed.
- **Sync, with a mocked `fetch`:**
  - no diff, a conflict choosing the server, a conflict choosing local;
  - offline or 5xx → not-synced; 401 → expired;
  - queued uploads send only the latest state;
  - no upload when storage is Local, or names a different connection than the session's;
  - sign-in reads `user.pro_display_settings` from the login response and makes no `GET /pro/user` call;
  - every authenticated request carries `Authorization: Bearer` and never `X-OpenBB-Authorization`;
  - an upload merges onto the session's `displaySettings` and replaces it on success;
  - a data backend's own credential is placed per `authLocation`;
  - a backend whose credential header is `Authorization` is disabled for storage.
- **Components:**
  - Workspace cards in each state, and add, edit and remove;
  - removing the settings-holding connection reverts storage;
  - backend cards show the Settings API line;
  - User Settings shows Local/Server; Server shows the dropdown, lists eligible connections with their mode, disables the others with their reasons, connects on choose, and reverts on Cancel;
  - the startup prompt walks only flagged connections, Workspace first; Skip on each kind behaves as section 7 says;
  - Remember me ticked stores the username (Workspace) or the value (backend); unticked removes it, and a backend's value then lives only in memory;
  - the backend edit form's Ask for credentials on startup hides Value and removes the stored value on save; an exported backend never carries a value that was not remembered;
  - with Server on, launch connects to the server even when it is not flagged: key mode syncs with no prompt; login mode prompts with the remembered username; Cancel keeps local settings and uploads nothing;
  - a flagged server backend without a value asks for Key and Value first, then connects;
  - the probe classifies 200-with-settings as key mode, 401/403 as login mode, and anything else as no API;
  - key mode sends only the backend credential (header, query and cookie each), never `/pro/login` or a token;
  - `SettingsDialog` no longer renders "Workspace account".
- **Settings file and bundle:** `settingsStorage` is validated, a dangling id loads as Local, and the field is excluded from export, import and sync.
- **OpenBB mark:**
  - `fetchServiceName`: JSON `service`, the OpenBB Platform HTML title, other HTML, failure;
  - a backend card shows the glyph only for the Platform API;
  - a Workspace card always shows the glyph.
- **Allowed code languages:**
  - `BackendEditForm` no longer renders the field;
  - an old `backends.json` carrying the field loads, and the field is dropped on write;
  - an omni widget with a code language is sent to the backend, and a server refusal is shown;
  - the existing gate tests are removed. These are the deliberate deletions this spec requires.

## Out of scope

- Syncing dashboards, backends or provider keys.
- A token in the OS keychain.
- Sign-in controls on data backend cards.
- Server-side changes, including openbq-docker's allowed-languages setting. That is the openbq-docker session's work.
- Carrying the change to v4/v5: that is a later carry-forward.

## Constraints

- Local only, no push.
- Tracked files use `workspace.example` for any hostname; real tailnet names never appear.
