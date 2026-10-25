// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
// Remove confirms through the native dialog, as TabBar's delete does.
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(), save: vi.fn(), open: vi.fn() }));
vi.mock("../runWorkspaceSync", () => ({ promptSignIn: vi.fn(async () => {}) }));

import { confirm, open, save } from "@tauri-apps/plugin-dialog";

import { __read, __reset, __seed } from "../../test/memfs";
import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { OPENBB_PLATFORM_SERVICE, OPENBB_REFERENCE_SERVICE } from "../../lib/dataClient";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { APPS_ISSUE_ID, type App } from "../../lib/appsJson";
import { ROOT_ISSUE_ID } from "../../lib/widgetsJson";
import { backend, widget } from "../../test/fixtures";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { promptSignIn } from "../runWorkspaceSync";
import { ConnectionsDialog } from "./ConnectionsDialog";

const makeWidget = (id: string) =>
  widget({ id, name: id, category: "Uncategorized", endpoint: "/x", gridData: { w: 10, h: 8 } });

const makeApp = (name: string): App => ({
  name,
  description: "",
  img: "",
  img_dark: "",
  img_light: "",
  allowCustomization: false,
  tabs: {},
  groups: [],
  prompts: [],
});

// Several tests below replace store actions with a vi.fn() via setState.
// vi.restoreAllMocks() does NOT undo that (it only reverts vi.spyOn spies),
// so the real actions are captured once at module load and reinstated here
// before every test.
const REAL_ACTIONS = {
  addBackend: useBackendsStore.getState().addBackend,
  updateBackend: useBackendsStore.getState().updateBackend,
  removeBackend: useBackendsStore.getState().removeBackend,
  refresh: useBackendsStore.getState().refresh,
  setBackends: useBackendsStore.getState().setBackends,
};

const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false };
const wsConn = { id: "ws1", name: "Work", baseUrl: ws.serverUrl };
const entry = (state: "signed-in" | "expired" | "not-synced", reason?: string) => ({ mode: "login" as const, connection: wsConn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state, reason });

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useBackendsStore.setState({ ...REAL_ACTIONS, backends: [], statuses: {}, issues: {}, services: {}, runtimeCredentials: [] });
  useWidgetRegistryStore.setState({ widgets: [], apps: [] });
  vi.mocked(confirm).mockReset();
  // probeAll is stubbed: opening the dialog probes every connection, and a
  // real probe here would send requests to the fixtures' fake addresses.
  useWorkspaceStore.setState({ probeAll: vi.fn(async () => {}), connections: [], usernames: {}, sessions: {}, apis: {}, notices: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  vi.mocked(promptSignIn).mockClear();
});

describe("ConnectionsDialog", () => {
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

  it("marks an OpenBB reference backend with the OpenBB logo too", () => {
    expect(OPENBB_REFERENCE_SERVICE).toBe("openbb-reference");
    useBackendsStore.setState({
      backends: [
        backend({ id: "b1", name: "Reference", baseUrl: "http://a" }),
        backend({ id: "b2", name: "Custom", baseUrl: "http://b" }),
      ],
      statuses: { b1: "online", b2: "online" },
      services: { b1: OPENBB_REFERENCE_SERVICE, b2: "rss-ticker" },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    const reference = screen.getByRole("article", { name: /reference/i });
    expect(reference.querySelector(".bd-service-icon svg")).not.toBeNull();
    expect(screen.getByRole("article", { name: /custom/i }).querySelector(".bd-service-icon")).toHaveTextContent("DB");
  });

  it("shows an empty state when nothing is configured", () => {
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(screen.getByText(/no backends configured/i)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Connections" });
    expect(dialog).toBeInTheDocument();
    // A real modal <dialog>: the top layer puts it over every card with no
    // z-index, and showModal() (jsdom stand-in in src/test/setup.ts) is what
    // sets the open attribute.
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    // Escape is handled by useModalDialog, which unmounts this element; the
    // browser's own close request must not close it behind React's back.
    const cancel = new Event("cancel", { cancelable: true, bubbles: false });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("hands focus back to whatever opened it when it unmounts", () => {
    // The rail's Connections row, standing in for the real trigger:
    // showModal() moves focus into the dialog, so unmounting without
    // restoring it drops a keyboard user on <body>.
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    try {
      trigger.focus();
      const { unmount } = render(<ConnectionsDialog onClose={vi.fn()} />);
      // A real showModal() moves focus into the dialog; jsdom's stand-in
      // (src/test/setup.ts) only sets the open attribute, so do it here —
      // otherwise focus never leaves the trigger and the test proves nothing.
      screen.getByRole("button", { name: "Close" }).focus();
      expect(trigger).not.toHaveFocus();

      unmount();

      expect(trigger).toHaveFocus();
    } finally {
      trigger.remove();
    }
  });

  it("lists each backend with its base URL and an Online status", () => {
    useBackendsStore.setState({
      backends: [backend({ baseUrl: "http://localhost:6900" })],
      statuses: { b1: "online" },
    });
    render(<ConnectionsDialog onClose={vi.fn()} />);

    const card = screen.getByRole("article", { name: "Local" });
    expect(card).toHaveTextContent("http://localhost:6900");
    // Meaning is never carried by colour alone.
    expect(card).toHaveTextContent("Online");
  });

  it("renders no <table> anywhere — the list is service cards, not a table", () => {
    useBackendsStore.setState({
      backends: [
        backend({ name: "Up", baseUrl: "http://a" }),
        backend({ id: "b2", name: "Down", baseUrl: "http://b" }),
      ],
      statuses: { b1: "online", b2: "offline" },
    });
    const { container } = render(<ConnectionsDialog onClose={() => {}} />);
    expect(container.querySelector("table")).toBeNull();
  });

  it("disables Add until both name and base URL are non-blank", async () => {
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));

    const save = screen.getByRole("button", { name: "Add" });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^name$/i), "Local");
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/endpoint url/i), "   ");
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/endpoint url/i), "http://localhost:6900");
    expect(save).toBeEnabled();
  });

  it("adds a backend with a name, base URL, and optional auth header pair", async () => {
    const addBackend = vi.fn().mockResolvedValue("new-id");
    useBackendsStore.setState({ addBackend });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), "Local");
    await userEvent.type(screen.getByLabelText(/endpoint url/i), "http://localhost:6900");
    await userEvent.type(screen.getByLabelText(/^key$/i), "X-Key");
    await userEvent.type(screen.getByLabelText(/^value$/i), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addBackend).toHaveBeenCalledWith({
        name: "Local",
        baseUrl: "http://localhost:6900",
        headerName: "X-Key",
        headerValue: "s3cret",
        authLocation: "header",
        validateWidgets: true,
      }),
    );
  });

  it("omits the header pair when it is left blank", async () => {
    const addBackend = vi.fn().mockResolvedValue("new-id");
    useBackendsStore.setState({ addBackend });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), "Local");
    await userEvent.type(screen.getByLabelText(/endpoint url/i), "http://localhost:6900");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addBackend).toHaveBeenCalledWith({
        name: "Local",
        baseUrl: "http://localhost:6900",
        headerName: undefined,
        headerValue: undefined,
        authLocation: "header",
        validateWidgets: true,
      }),
    );
  });

  it("clears a previously stored header pair when both fields are blanked", async () => {
    // Regression: updateBackend merges via `{ ...b, ...patch }`, so a key
    // that is simply absent from `patch` leaves the old stored value in
    // place. `toEqual`/`toHaveBeenCalledWith` treat a key explicitly set to
    // `undefined` the same as a missing key, so this asserts key presence
    // directly with `toHaveProperty`, which does distinguish the two.
    const updateBackend = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({
      backends: [
        backend({ baseUrl: "http://localhost:6900", headerName: "X-Key", headerValue: "s3cret" }),
      ],
      statuses: { b1: "online" },
      updateBackend,
    });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /edit local/i }));
    await userEvent.clear(screen.getByLabelText(/^key$/i));
    await userEvent.clear(screen.getByLabelText(/^value$/i));
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(updateBackend).toHaveBeenCalled());
    const [id, patch] = updateBackend.mock.calls[0];
    expect(id).toBe("b1");
    expect(patch).toHaveProperty("headerName", undefined);
    expect(patch).toHaveProperty("headerValue", undefined);
  });

  it("keeps the draft's typed values and does not throw when the save rejects", async () => {
    // The store's write-then-mutate contract lets a failed write's rejection
    // propagate; the dialog must catch it (and log it) rather than let it
    // become an unhandled rejection, and must not clear the user's input.
    const addBackend = vi.fn().mockRejectedValue(new Error("disk full"));
    useBackendsStore.setState({ addBackend });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), "Local");
    await userEvent.type(screen.getByLabelText(/endpoint url/i), "http://localhost:6900");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addBackend).toHaveBeenCalled());
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("Local");
    expect(screen.getByLabelText(/endpoint url/i)).toHaveValue("http://localhost:6900");

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to save backend");
    });
  });

  it("says so in the form when the save fails", async () => {
    const addBackend = vi.fn().mockRejectedValue(new Error("disk full"));
    useBackendsStore.setState({ addBackend });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), "Local");
    await userEvent.type(screen.getByLabelText(/endpoint url/i), "http://localhost:6900");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save the backend/i);
  });

  // A double-click on Add, or Enter pressed twice, used to add two backends.
  it("submits once while a save is still in flight", async () => {
    const addBackend = vi.fn(() => new Promise<string>(() => {}));
    useBackendsStore.setState({ addBackend });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), "Local");
    await userEvent.type(screen.getByLabelText(/endpoint url/i), "http://localhost:6900");
    // The submit sits in the dialog footer and names its form by id, so it
    // is reached through .form rather than an enclosing <form>.
    const form = (screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).form!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(addBackend).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("edits an existing backend", async () => {
    const updateBackend = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({
      backends: [backend({ baseUrl: "http://localhost:6900" })],
      statuses: { b1: "online" },
      updateBackend,
    });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /edit local/i }));
    const name = screen.getByLabelText(/^name$/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(updateBackend).toHaveBeenCalledWith("b1", {
        name: "Renamed",
        baseUrl: "http://localhost:6900",
        authLocation: "header",
        validateWidgets: false,
      }),
    );
  });

  it("drops the backend's session when its credential or address changes, but not on a rename", async () => {
    const keyed = backend({ headerName: "Authorization", headerValue: "Basic old" });
    const session = { mode: "key" as const, connection: { id: "b1", name: "Local", baseUrl: keyed.baseUrl, backend: keyed }, displaySettings: {}, state: "not-synced" as const, reason: "key refused" };
    useBackendsStore.setState({ backends: [keyed], statuses: { b1: "online" }, refresh: vi.fn().mockResolvedValue(undefined) });
    useWorkspaceStore.setState({ sessions: { b1: session } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /edit local/i }));
    const name = screen.getByLabelText(/^name$/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(useBackendsStore.getState().backends[0].name).toBe("Renamed"));
    expect(useWorkspaceStore.getState().sessions.b1).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /edit renamed/i }));
    const value = screen.getByLabelText(/^value$/i);
    await userEvent.clear(value);
    await userEvent.type(value, "Basic new");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(useBackendsStore.getState().backends[0].headerValue).toBe("Basic new"));
    expect(useWorkspaceStore.getState().sessions.b1).toBeUndefined();
  });

  it("preserves a stored non-default authLocation and validateWidgets when an unrelated field is edited", async () => {
    const updateBackend = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({
      backends: [
        backend({ baseUrl: "http://localhost:6900", authLocation: "query", validateWidgets: true }),
      ],
      statuses: { b1: "online" },
      updateBackend,
    });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /edit local/i }));
    const name = screen.getByLabelText(/^name$/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(updateBackend).toHaveBeenCalled());
    const [, patch] = updateBackend.mock.calls[0];
    expect(patch).toMatchObject({ authLocation: "query", validateWidgets: true });
  });

  it("saves a changed Location selection", async () => {
    const updateBackend = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({
      backends: [backend({ baseUrl: "http://localhost:6900" })],
      statuses: { b1: "online" },
      updateBackend,
    });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /edit local/i }));
    await userEvent.selectOptions(screen.getByLabelText("Location"), "cookie");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(updateBackend).toHaveBeenCalledWith("b1", {
        name: "Local",
        baseUrl: "http://localhost:6900",
        authLocation: "cookie",
        validateWidgets: false,
      }),
    );
  });

  it("removes a backend after the native confirmation", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const removeBackend = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({
      backends: [backend({ baseUrl: "http://localhost:6900" })],
      statuses: { b1: "online" },
      removeBackend,
    });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /remove local/i }));

    await waitFor(() => expect(removeBackend).toHaveBeenCalledWith("b1"));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('"Local"'),
      expect.objectContaining({ title: "Remove backend", okLabel: "Remove" }),
    );
  });

  // One click used to delete the backend and its stored key outright.
  it("does not remove a backend when the confirmation is declined", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const removeBackend = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({
      backends: [backend({ baseUrl: "http://localhost:6900" })],
      statuses: { b1: "online" },
      removeBackend,
    });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /remove local/i }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(removeBackend).not.toHaveBeenCalled();
  });

  it("re-runs discovery on Refresh", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useBackendsStore.setState({ refresh });

    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("closes on the close button and on Escape", async () => {
    const onClose = vi.fn();
    render(<ConnectionsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes an open edit form on Escape and leaves the list up; the next Escape closes the list", async () => {
    // Exercises the shared modalStack mechanism (useModalDialog +
    // useChildDialog): the editor pushes an entry after the dialog's own, so
    // it sits on top and one Escape closes only it. Only once that entry is
    // gone does a second Escape reach the dialog's own listener.
    const onClose = vi.fn();
    render(<ConnectionsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /connect backend/i }));
    expect(screen.getByRole("dialog", { name: "Connect backend" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Connect backend" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("titles the form Edit backend for a stored backend", async () => {
    useBackendsStore.setState({
      backends: [backend({ baseUrl: "http://localhost:6900" })],
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /edit local/i }));
    expect(screen.getByRole("dialog", { name: "Edit backend" })).toBeInTheDocument();
  });

  it("takes the Escape for itself, so nothing behind it also acts on the same press", async () => {
    const onClose = vi.fn();
    render(<ConnectionsDialog onClose={onClose} />);

    // A bubble-phase WINDOW listener, standing in for a maximized card's own
    // Escape handler. The dialog listens on document, one hop earlier in the
    // bubble path, so it stops this one.
    const spy = vi.fn();
    window.addEventListener("keydown", spy);
    try {
      await userEvent.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", spy);
    }
  });

  it("splits backends into Active and Inactive groups with count badges", () => {
    useBackendsStore.setState({
      backends: [
        backend({ name: "Up", baseUrl: "http://a" }),
        backend({ id: "b2", name: "Down", baseUrl: "http://b" }),
      ],
      statuses: { b1: "online", b2: "offline" },
    });
    const { container } = render(<ConnectionsDialog onClose={() => {}} />);
    // The label and its .bd-badge count are separate DOM nodes, so this
    // reads them directly rather than via a single text-node match.
    const labels = [...container.querySelectorAll(".bd-group-label")].map(
      (el) => el.textContent,
    );
    expect(labels).toContain("Active 1");
    expect(labels).toContain("Inactive 1");
  });

  it("renders no heading for an empty group", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Up", baseUrl: "http://a" })],
      statuses: { b1: "online" },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.queryByText(/^Inactive/)).toBeNull();
  });

  it("counts only that backend's widgets, pluralized", () => {
    useBackendsStore.setState({
      backends: [
        backend({ name: "Up", baseUrl: "http://a" }),
        backend({ id: "b2", name: "Also", baseUrl: "http://b" }),
      ],
      statuses: { b1: "online", b2: "online" },
    });
    useWidgetRegistryStore.setState({
      widgets: [
        { ...makeWidget("w1"), backendId: "b1" },
        { ...makeWidget("w2"), backendId: "b1" },
        { ...makeWidget("w3"), backendId: "b2" },
      ],
      apps: [],
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Up" })).toHaveTextContent("2 widgets");
    expect(screen.getByRole("article", { name: "Also" })).toHaveTextContent("1 widget");
  });

  it("shows Widgets unavailable rather than a count for an offline backend", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Down", baseUrl: "http://a" })],
      statuses: { b1: "offline" },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Down" })).toHaveTextContent("Widgets unavailable");
  });

  it("appends the skipped count only when the backend validates widgets", () => {
    useBackendsStore.setState({
      backends: [
        backend({ name: "Checked", baseUrl: "http://a", validateWidgets: true }),
        backend({ id: "b2", name: "Unchecked", baseUrl: "http://b" }),
      ],
      statuses: { b1: "online", b2: "online" },
      issues: { b1: [{ id: "x", reason: "bad" }], b2: [{ id: "y", reason: "bad" }] },
    });
    useWidgetRegistryStore.setState({ widgets: [{ ...makeWidget("w1"), backendId: "b1" }], apps: [] });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Checked" })).toHaveTextContent(
      "1 widgets, 1 skipped",
    );
    expect(screen.getByRole("article", { name: "Unchecked" })).not.toHaveTextContent("skipped");
  });

  it("does not count an apps.json issue as a skipped widget", () => {
    // An APPS_ISSUE_ID entry rides in the same issues array but says nothing
    // about the widgets, so a backend serving all of them must not read as
    // skipped.
    useBackendsStore.setState({
      backends: [backend({ name: "Checked", baseUrl: "http://a", validateWidgets: true })],
      statuses: { b1: "online" },
      issues: { b1: [{ id: APPS_ISSUE_ID, reason: "apps.json from Checked could not be read" }] },
    });
    useWidgetRegistryStore.setState({ widgets: [{ ...makeWidget("w1"), backendId: "b1" }], apps: [] });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Checked" })).not.toHaveTextContent("skipped");
  });

  it("renders a rejected-payload backend as Widgets rejected, not as a skipped count", () => {
    // A ROOT_ISSUE_ID entry means the whole widgets.json payload was the
    // wrong shape, not that one widget among several was dropped.
    useBackendsStore.setState({
      backends: [backend({ name: "Rejected", baseUrl: "http://a", validateWidgets: true })],
      statuses: { b1: "online" },
      issues: { b1: [{ id: ROOT_ISSUE_ID, reason: "widgets.json root is not an object" }] },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    const card = screen.getByRole("article", { name: "Rejected" });
    expect(card).toHaveTextContent("Widgets rejected");
    expect(card).not.toHaveTextContent("skipped");
  });

  it("shows Widgets unavailable for a rejected payload when the backend is not online", () => {
    // Precedence: offline/unknown status wins over the rejected wording,
    // same as it wins over the skipped count.
    useBackendsStore.setState({
      backends: [backend({ name: "Down", baseUrl: "http://a", validateWidgets: true })],
      statuses: { b1: "offline" },
      issues: { b1: [{ id: ROOT_ISSUE_ID, reason: "widgets.json root is not an object" }] },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Down" })).toHaveTextContent("Widgets unavailable");
  });

  it("places a backend with unknown status in Inactive and shows Widgets unavailable", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Unknown", baseUrl: "http://a" })],
      statuses: { b1: "unknown" },
    });
    const { container } = render(<ConnectionsDialog onClose={() => {}} />);
    expect(container.querySelector(".bd-group-label")).toHaveTextContent("Inactive 1");
    expect(screen.getByRole("article", { name: "Unknown" })).toHaveTextContent(
      "Widgets unavailable",
    );
  });

  it("shows the app count for an online backend, pluralized", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Up", baseUrl: "http://a" })],
      statuses: { b1: "online" },
    });
    useWidgetRegistryStore.setState({
      apps: [
        { backendId: "b1", app: makeApp("A") },
        { backendId: "b1", app: makeApp("B") },
      ],
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Up" })).toHaveTextContent("2 apps");
  });

  it("uses the singular for exactly one app", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Up", baseUrl: "http://a" })],
      statuses: { b1: "online" },
    });
    useWidgetRegistryStore.setState({ apps: [{ backendId: "b1", app: makeApp("A") }] });
    render(<ConnectionsDialog onClose={() => {}} />);
    const card = screen.getByRole("article", { name: "Up" });
    expect(card).toHaveTextContent("1 app");
    expect(card).not.toHaveTextContent("1 apps");
  });

  it("shows 0 apps when the backend is online but serves none", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Up", baseUrl: "http://a" })],
      statuses: { b1: "online" },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Up" })).toHaveTextContent("0 apps");
  });

  it("shows Apps unavailable for an offline backend regardless of any cached app count", () => {
    // applyDiscovery keeps a backend's last-known apps across a Refresh that
    // finds it offline (widgetRegistryStore.ts), so a cached, nonzero app
    // count must not read as current.
    useBackendsStore.setState({
      backends: [backend({ name: "Down", baseUrl: "http://a" })],
      statuses: { b1: "offline" },
    });
    useWidgetRegistryStore.setState({ apps: [{ backendId: "b1", app: makeApp("A") }] });
    render(<ConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole("article", { name: "Down" })).toHaveTextContent("Apps unavailable");
  });

  it("shows Apps unavailable and the issue reason as a note when the backend's apps.json failed", () => {
    useBackendsStore.setState({
      backends: [backend({ name: "Up", baseUrl: "http://a" })],
      statuses: { b1: "online" },
      issues: { b1: [{ id: APPS_ISSUE_ID, reason: "apps.json from Up could not be read" }] },
    });
    render(<ConnectionsDialog onClose={() => {}} />);
    const card = screen.getByRole("article", { name: "Up" });
    expect(card).toHaveTextContent("Apps unavailable");
    expect(screen.getByRole("note")).toHaveTextContent("apps.json from Up could not be read");
  });
  it("seeds the edit form's Ask for credentials on startup from the backend", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "g", name: "Gateway", headerName: "username", askOnStartup: true })], statuses: { g: "online" } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Gateway" }));
    expect(screen.getByLabelText("Ask for credentials on startup")).toBeChecked();
    expect(screen.getByLabelText("Key")).toHaveValue("username");
  });
});

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

  it("shows a connection's notice (a refused key) as a line on its card", () => {
    useWorkspaceStore.setState({ connections: [ws, { ...ws, id: "ws2", name: "Home" }], notices: { ws1: "Key refused by Work; fix the key in Connections." } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(card("Work")).toHaveTextContent("Key refused by Work; fix the key in Connections.");
    expect(card("Home")).not.toHaveTextContent("Key refused");
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
    useBackendsStore.setState({ backends: ["Key", "Login", "No", "Plain", "Auth", "Refused"].map((name, i) => backend({ id: `b${i}`, name })), statuses: {} });
    useWorkspaceStore.setState({ apis: { b0: "key", b1: "login", b2: "no", b3: "needs-https", b4: "authorization-header", b5: "key-refused" } });
    render(<ConnectionsDialog onClose={vi.fn()} />);
    expect(card("Key")).toHaveTextContent("Settings API: key");
    expect(card("Login")).toHaveTextContent("Settings API: login");
    for (const name of ["No", "Plain", "Auth"]) expect(card(name)).toHaveTextContent("Settings API: no");
    // Ruling R2: a refused key is named, not folded into "no".
    expect(card("Refused")).toHaveTextContent("Settings API: key refused");
    expect(within(card("Login")).queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  describe("export and import", () => {
    it("exports the whole list, credentials included, to the chosen path", async () => {
      useBackendsStore.setState({
        backends: [backend({ headerName: "X-Key", headerValue: "s3cret" })],
      });
      vi.mocked(save).mockResolvedValue("/tmp/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Export…" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Exported 1 connection.");
      expect(vi.mocked(save).mock.calls[0][0]).toMatchObject({ defaultPath: "backends.json" });
      expect(JSON.parse(__read("tmp/backends.json") ?? "")).toEqual([
        backend({ headerName: "X-Key", headerValue: "s3cret" }),
      ]);
    });

    it("writes nothing and says nothing when the save dialog is cancelled", async () => {
      useBackendsStore.setState({ backends: [backend()] });
      vi.mocked(save).mockResolvedValue(null);
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Export…" }));

      await waitFor(() => expect(vi.mocked(save)).toHaveBeenCalled());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(__read("tmp/backends.json")).toBeUndefined();
    });

    it("imports by id: replaces a known connection, appends a new one, persists, and reports", async () => {
      useBackendsStore.setState({
        backends: [backend({ id: "b1", name: "Old" }), backend({ id: "b2", name: "Kept" })],
        statuses: { b1: "online", b2: "offline" },
      });
      __seed(
        "imports/backends.json",
        JSON.stringify([
          { id: "b1", name: "New", baseUrl: "http://n", headerName: "X", headerValue: "k", authLocation: "header", validateWidgets: false },
          { id: "b3", name: "Added", baseUrl: "http://a", authLocation: "query", validateWidgets: true },
        ]),
      );
      vi.mocked(open).mockResolvedValue("imports/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Import…" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Imported 2 connections (1 updated, 1 added).",
      );
      expect(useBackendsStore.getState().backends.map((b) => [b.id, b.name])).toEqual([
        ["b1", "New"],
        ["b2", "Kept"],
        ["b3", "Added"],
      ]);
      expect(useBackendsStore.getState().backends[0].headerValue).toBe("k");
      const saved = JSON.parse(__read("backends.json") ?? "[]") as { id: string }[];
      expect(saved.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
      // The new connection is on screen, not waiting on discovery to give it a
      // status. A card, not a row: the ported dialog renders each backend as a
      // ServiceCard (role article, named by the backend) instead of a table row.
      expect(screen.getByRole("article", { name: "Added" })).toBeInTheDocument();
    });

    // P4: the edit path dropped the session on such a change; the import did not.
    it("drops the session of a known connection whose address or credential the import changed", async () => {
      const keyed = backend({ id: "b1", headerName: "Authorization", headerValue: "Basic old" });
      const kept = backend({ id: "b2", name: "Kept" });
      const session = (b: typeof keyed) => ({ mode: "key" as const, connection: { id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b }, displaySettings: {}, state: "not-synced" as const, reason: "key refused" });
      useBackendsStore.setState({ backends: [keyed, kept] });
      useWorkspaceStore.setState({ sessions: { b1: session(keyed), b2: session(kept) } });
      __seed(
        "imports/backends.json",
        JSON.stringify([
          { ...keyed, headerValue: "Basic new" },
          { ...kept, name: "Renamed" },
        ]),
      );
      vi.mocked(open).mockResolvedValue("imports/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Import…" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Imported 2 connections (2 updated, 0 added).");
      expect(useWorkspaceStore.getState().sessions.b1).toBeUndefined();
      // A rename is the same connection.
      expect(useWorkspaceStore.getState().sessions.b2).toBeDefined();
    });

    // P1: the export writes stored credentials as they are.
    it("says the export may carry credentials in plain text", () => {
      render(<ConnectionsDialog onClose={vi.fn()} />);
      expect(screen.getByText("Exports may include stored credentials in plain text.")).toBeInTheDocument();
    });

    it("refuses a file that is not a backends list and leaves the list alone", async () => {
      useBackendsStore.setState({ backends: [backend()] });
      __seed("imports/backends.json", JSON.stringify({ not: "a list" }));
      vi.mocked(open).mockResolvedValue("imports/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Import…" }));

      expect(await screen.findByRole("status")).toHaveTextContent(/not a backends\.json/);
      expect(useBackendsStore.getState().backends).toEqual([backend()]);
      expect(__read("backends.json")).toBeUndefined();
    });

    // Moved from backendsJson.test.ts: the cap is now checked once, by
    // pickImportFile, before the file is read or parsed.
    it("refuses a file over the size cap before parsing it", async () => {
      useBackendsStore.setState({ backends: [backend()] });
      // memfs's stat reports the seeded string's length: an 11 MB non-JSON file.
      __seed("imports/backends.json", "x".repeat(11 * 1024 * 1024));
      vi.mocked(open).mockResolvedValue("imports/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Import…" }));

      expect(await screen.findByRole("status")).toHaveTextContent("File is 11 MB; the limit is 10 MB.");
      expect(useBackendsStore.getState().backends).toEqual([backend()]);
    });

    it("logs a failed import and shows the message", async () => {
      vi.mocked(open).mockResolvedValue("imports/missing.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Import…" }));

      expect(await screen.findByRole("status")).toHaveTextContent(/Import failed: ENOENT/);
      await waitFor(() => {
        expect(__read("logs/bdobb.log") ?? "").toContain("failed to import backends.json");
      });
    });

    it("leaves out a credential held in memory only, as backends.json on disk does", async () => {
      useBackendsStore.setState({
        backends: [backend({ id: "m", headerName: "X-Key", headerValue: "typed-at-startup", askOnStartup: true })],
        runtimeCredentials: ["m"],
      });
      vi.mocked(save).mockResolvedValue("/tmp/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Export…" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Exported 1 connection.");
      const [written] = JSON.parse(__read("tmp/backends.json") ?? "[]") as { headerValue?: string }[];
      expect(written.headerValue).toBeUndefined();
    });

    it("keeps a memory-only credential memory-only when the import leaves it unchanged", async () => {
      useBackendsStore.setState({
        backends: [backend({ id: "m", name: "M", headerName: "X-Key", headerValue: "typed-at-startup", askOnStartup: true })],
        runtimeCredentials: ["m"],
      });
      __seed(
        "imports/backends.json",
        JSON.stringify([{ id: "n", name: "N", baseUrl: "http://n", authLocation: "header", validateWidgets: true }]),
      );
      vi.mocked(open).mockResolvedValue("imports/backends.json");
      render(<ConnectionsDialog onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Import…" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 connection (0 updated, 1 added).");
      expect(useBackendsStore.getState().runtimeCredentials).toEqual(["m"]);
      const saved = JSON.parse(__read("backends.json") ?? "[]") as { id: string; headerValue?: string }[];
      expect(saved.find((b) => b.id === "m")?.headerValue).toBeUndefined();
    });
  });
});
