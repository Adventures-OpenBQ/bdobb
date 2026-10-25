// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { APPS_ISSUE_ID, type App } from "../../lib/appsJson";
import { safeUrl } from "../../lib/safeUrl";
import type { BackendConfig } from "../../lib/types";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { backendLabel, FilterSelect } from "../LibraryFilters";
import { RailIcon } from "../RailIcon";

/**
 * Every field below is read defensively, and that is not belt-and-braces:
 * parseAppsJson casts to `App` after checking only `name` and `tabs`
 * (appsJson.ts), so a backend can serve an app whose `description` is a
 * number and whose `tabs` is a string, and the type would not have noticed.
 */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** "3 tabs", "1 tab", and "0 tabs" for anything that is not a tabs record. */
function tabCount(app: App): number {
  const tabs: unknown = app.tabs;
  if (typeof tabs !== "object" || tabs === null || Array.isArray(tabs)) return 0;
  return Object.keys(tabs).length;
}

/**
 * The URL an <img> may be pointed at, or null for "draw the glyph instead".
 *
 * Two steps, and only the first is new here. An apps.json image is usually a
 * path, so it is resolved against the backend's own baseUrl -- the only
 * origin such a path can have meant. The scheme decision is then safeUrl's,
 * unchanged: apps.json is remote input, so a `javascript:` or `data:` img
 * would be the backend scripting this window. Resolving first is what lets
 * that shared boundary be reused, since safeUrl refuses a bare path.
 */
function safeImageUrl(raw: unknown, baseUrl: string): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let absolute: string;
  try {
    absolute = new URL(raw, baseUrl).href;
  } catch {
    // An unparseable img, or a baseUrl that is not a URL at all.
    return null;
  }
  return safeUrl(absolute);
}

/** The themed image if the app has one, otherwise the plain `img`. */
function imageFor(app: App, baseUrl: string, dark: boolean): string | null {
  const themed = dark ? app.img_dark : app.img_light;
  return safeImageUrl(themed, baseUrl) ?? safeImageUrl(app.img, baseUrl);
}

function AppCard({
  app,
  backend,
  dark,
  onOpen,
}: {
  app: App;
  backend: BackendConfig;
  dark: boolean;
  onOpen: () => void;
}) {
  // The src that failed to load, rather than a boolean: an <img> carries no
  // auth header, so a 401/404 is ordinary — but switching theme picks a
  // different URL, and that one deserves its own attempt. Comparing against
  // the current src resets the fallback without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = imageFor(app, backend.baseUrl, dark);
  const showImage = src !== null && src !== failedSrc;
  const name = text(app.name);
  const tabs = tabCount(app);

  return (
    <div className="library-card app-card" data-testid="app-card">
      <span className="app-card-image">
        {showImage ? (
          // alt is empty on purpose: the name sits right below it, so a
          // described image would make a screen reader say it twice.
          <img
            data-testid="app-card-img"
            src={src}
            alt=""
            onError={() => setFailedSrc(src)}
          />
        ) : (
          <span data-testid="app-card-glyph">
            <RailIcon name="apps" />
          </span>
        )}
      </span>
      <span className="library-card-title" data-testid="app-card-name">
        {name}
      </span>
      <span className="library-card-description">{text(app.description)}</span>
      <span className="app-card-footer">
        <span className="app-card-tabs">{tabs === 1 ? "1 tab" : `${tabs} tabs`}</span>
        <button type="button" aria-label={`Open ${name}`} onClick={onOpen}>
          Open
        </button>
      </span>
    </div>
  );
}

export function AppsDialog({
  onClose,
  onOpen,
  error,
}: {
  onClose: () => void;
  onOpen: (app: App, backendId: string) => void;
  /** Set by the caller when an Open failed; the dialog stays up to show it. */
  error?: string;
}) {
  const backends = useBackendsStore((s) => s.backends);
  const issues = useBackendsStore((s) => s.issues);
  const apps = useWidgetRegistryStore((s) => s.apps);
  // "system" resolves through the hook's media query, and flips live when
  // the OS appearance changes -- so the themed image follows it too.
  const dark = useResolvedTheme() === "dark";

  const [query, setQuery] = useState("");
  /** A backend id, not a name, as in the Widget Library's filter. */
  const [backendId, setBackendId] = useState<string | null>(null);

  // Like the Widget Library: the options come from what is served, so a
  // backend with no app never becomes one, and they sort by the label shown.
  const backendIds = useMemo(() => {
    const served = new Set(apps.map((a) => a.backendId));
    return backends
      .filter((b) => served.has(b.id))
      .map((b) => b.id)
      .sort((a, b) => backendLabel(a, backends).localeCompare(backendLabel(b, backends)));
  }, [apps, backends]);

  // Backend order outside, apps.json order inside: both are the order the
  // user already sees elsewhere (the Connections table, and the file the
  // backend served). A backend that serves no app — or none that survives
  // the search — contributes no group at all.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (app: App) =>
      needle === "" ||
      text(app.name).toLowerCase().includes(needle) ||
      text(app.description).toLowerCase().includes(needle);
    // Object.hasOwn, never a bare index: `issues` is keyed by backend id,
    // and an id spelled like "constructor" would otherwise answer with
    // something off Object.prototype instead of "this backend reported
    // nothing" -- and .some would then throw on it.
    const failed = (backendId: string) =>
      (Object.hasOwn(issues, backendId) ? issues[backendId] : []).some(
        (issue) => issue.id === APPS_ISSUE_ID,
      );
    return backends
      .filter((backend) => backendId === null || backend.id === backendId)
      .map((backend) => ({
        backend,
        // Numbered BEFORE the search is applied, so an app's index is its
        // position in the backend's apps.json and nothing else. That index
        // is the card's key below, and a key that shifted as the search
        // narrowed would hand one app another's card -- and another app's
        // per-card state with it.
        apps: apps
          .filter((a) => a.backendId === backend.id)
          .map((a, index) => ({ app: a.app, index }))
          .filter(({ app }) => matches(app)),
        // Only while nothing is being searched for. A backend whose
        // apps.json was refused has no apps to match, so carrying its group
        // through a search would make "No apps match." unreachable and put
        // a heading over nothing but the line below.
        failed: needle === "" && failed(backend.id),
      }))
      // A backend that serves nothing still gets a group when it has
      // something to say about WHY -- that line is the only trace a refused
      // apps.json leaves in this dialog.
      .filter((group) => group.apps.length > 0 || group.failed);
  }, [backends, issues, apps, query, backendId]);

  /** Before the search is applied — which is what tells the three empty
   * states apart: nothing connected, nothing served, nothing matched. */
  const servedAny = apps.some((a) => backends.some((b) => b.id === a.backendId));

  // On the shared modal stack, like every other dialog: Escape closes
  // whichever dialog is on top, so Apps opened over Settings closes itself
  // rather than the dialog beneath it.
  const dialogRef = useModalDialog(onClose);

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-label="Apps"
    >
      <div className="modal modal-apps">
        <header className="modal-header apps-header">
          <h2>Apps</h2>
          <input
            type="search"
            aria-label="Search apps"
            placeholder="Search apps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <FilterSelect
            label="Backend"
            allLabel="All backends"
            value={backendId}
            options={backendIds.map((id) => ({ value: id, label: backendLabel(id, backends) }))}
            onSelect={setBackendId}
          />
          <button type="button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {/* Directly under the header, above the list: an Open that failed
            leaves the dialog up, and this is the only thing on screen that
            can say why. role="alert" because it appears in response to the
            click that just happened, on a surface the reader is already on. */}
        {error !== undefined && error !== "" ? (
          <p className="apps-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="apps-body">
          {/* `groups.length > 0` is checked before the two "nothing here"
              lines rather than after: a group can now hold an issue line
              instead of apps, and "None of your connections serves an app."
              printed above one would contradict it. */}
          {backends.length === 0 ? (
            <p className="empty-state">Add a connection to see its apps.</p>
          ) : groups.length > 0 ? null : !servedAny ? (
            <p className="empty-state">None of your connections serves an app.</p>
          ) : (
            <p className="empty-state">No apps match.</p>
          )}

          {groups.map(({ backend, apps: served, failed }) => (
            <section className="apps-group" data-testid="apps-group" key={backend.id}>
              <h3 className="apps-group-name">{backend.name}</h3>
              {/* Discovery's own reason is deliberately not shown: it is a
                  sentence about a backend's document (and the backend's
                  name), written for the log and for Connections. Here there
                  is one thing worth saying, and it is the same every time. */}
              {failed ? (
                <p className="apps-issue">This connection&apos;s apps.json could not be read.</p>
              ) : null}
              <div className="library-grid">
                {served.map(({ app, index }) => (
                  <AppCard
                    // apps.json gives an app no id, so position within its
                    // backend's own list is the only stable identity there
                    // is -- `index` is that position, counted before the
                    // search narrowed the list.
                    key={`${backend.id}:${index}`}
                    app={app}
                    backend={backend}
                    dark={dark}
                    onOpen={() => onOpen(app, backend.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
