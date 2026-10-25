// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  native: true,
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => undefined),
  handlers: new Map<string, () => void>(),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => tauri.native,
  invoke: tauri.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: () => void) => {
    tauri.handlers.set(event, handler);
    return () => tauri.handlers.delete(event);
  },
}));

import { __resetLoggerForTests } from "../lib/logger";
import type { Workspace } from "../lib/workspacesFile";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { useDashboardShortcuts } from "./useDashboardShortcuts";
import { RITA_PIN, SIDEBAR_PIN, useWindowMenuPins } from "./useWindowMenuPins";

const workspace = (id: string, left: boolean): Workspace => ({ id, name: id, preset: "full-screen", slots: [], railsOpen: { left } });
/** What the menu item shows now: the last set_window_pin for that id. */
const sentFor = (id: string) =>
  tauri.invoke.mock.calls.map((call) => call[1] as { id: string } | undefined).filter((sent) => sent?.id === id).at(-1);
const chooseMenuItem = (event: string) => act(async () => { tauri.handlers.get(event)!(); });

let failWrite = false;
beforeEach(() => {
  __resetLoggerForTests();
  tauri.native = true;
  tauri.invoke.mockClear();
  tauri.handlers.clear();
  failWrite = false;
  useChatStore.setState({ pinned: false });
  // A Rita URL is set, so the Rita pin is live (D-009 covers the empty URL).
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
  useWorkspacesStore.setState({
    workspaces: [workspace("w1", false), workspace("w2", true)],
    activeWorkspaceId: null,
    // The real setRailsOpen also writes workspaces/<id>.json; the store change is what the menu follows.
    setRailsOpen: vi.fn(async (id: string, left: boolean) => {
      if (failWrite) throw new Error("disk full");
      useWorkspacesStore.setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, railsOpen: { left } } : w)) }));
    }),
  });
});

it("is disabled and unchecked outside a workspace, and follows the active workspace's pin", () => {
  renderHook(() => useWindowMenuPins(true));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: false });
  act(() => useWorkspacesStore.setState({ activeWorkspaceId: "w2" }));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: true, enabled: true });
  act(() => useWorkspacesStore.setState({ activeWorkspaceId: "w1" }));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: true });
  act(() => useWorkspacesStore.setState({ activeWorkspaceId: null }));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: false });
});

it("choosing the item toggles the active workspace's pin once and checks it", async () => {
  useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(SIDEBAR_PIN.event)).toBe(true));
  await chooseMenuItem(SIDEBAR_PIN.event);
  await waitFor(() => expect(useWorkspacesStore.getState().setRailsOpen).toHaveBeenCalledWith("w1", true));
  expect(useWorkspacesStore.getState().setRailsOpen).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: true, enabled: true }));
});

it("follows a pin changed by the rail's own button", () => {
  useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
  renderHook(() => useWindowMenuPins(true));
  act(() => void useWorkspacesStore.getState().setRailsOpen("w1", true));
  expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: true, enabled: true });
});

it("a pin write that fails puts the checkmark back", async () => {
  useWorkspacesStore.setState({ activeWorkspaceId: "w1" });
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(SIDEBAR_PIN.event)).toBe(true));
  failWrite = true;
  tauri.invoke.mockClear();
  await chooseMenuItem(SIDEBAR_PIN.event);
  // macOS already flipped the native checkmark on the click; the stored pin is still false.
  await waitFor(() => expect(sentFor(SIDEBAR_PIN.id)).toEqual({ id: SIDEBAR_PIN.id, checked: false, enabled: true }));
});

it("choosing the item outside a workspace writes nothing", async () => {
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(SIDEBAR_PIN.event)).toBe(true));
  await chooseMenuItem(SIDEBAR_PIN.event);
  expect(useWorkspacesStore.getState().setRailsOpen).not.toHaveBeenCalled();
});

it("does nothing in the browser build or in a viewer window", async () => {
  tauri.native = false;
  renderHook(() => useWindowMenuPins(true));
  tauri.native = true;
  renderHook(() => useWindowMenuPins(false));
  await act(async () => {});
  expect(tauri.invoke).not.toHaveBeenCalled();
  expect(tauri.handlers.size).toBe(0);
});

it("Keep Rita Open follows the Rita pin from any source", () => {
  renderHook(() => useWindowMenuPins(true));
  expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: false, enabled: true });
  act(() => useChatStore.getState().togglePinned()); // the pane's Lock button
  expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: true, enabled: true });
});

it("⌘⇧A in the desktop app toggles the Rita pin exactly once", async () => {
  // macOS: the accelerator chooses Window ▸ Keep Rita Open; if the keydown also
  // reaches the page, the two together must still be one toggle.
  renderHook(() => {
    useWindowMenuPins(true);
    useDashboardShortcuts(() => {}, () => {});
  });
  await waitFor(() => expect(tauri.handlers.has(RITA_PIN.event)).toBe(true));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "A", code: "KeyA", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await chooseMenuItem(RITA_PIN.event);
  expect(useChatStore.getState().pinned).toBe(true);
  await waitFor(() => expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: true, enabled: true }));
});

// D-009: with no Rita URL there is no pane (App renders RitaPane only with one), so nothing to keep open.
it("Keep Rita Open is disabled and unchecked while no Rita URL is set, and follows the URL", () => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "" } });
  useChatStore.setState({ pinned: true }); // a stale pin from before the URL was cleared
  renderHook(() => useWindowMenuPins(true));
  expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: false, enabled: false });
  act(() => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } }));
  expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: true, enabled: true });
});

it("choosing Keep Rita Open while it is disabled changes nothing", async () => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "" } });
  renderHook(() => useWindowMenuPins(true));
  await waitFor(() => expect(tauri.handlers.has(RITA_PIN.event)).toBe(true));
  await chooseMenuItem(RITA_PIN.event);
  expect(useChatStore.getState().pinned).toBe(false);
  await waitFor(() => expect(sentFor(RITA_PIN.id)).toEqual({ id: RITA_PIN.id, checked: false, enabled: false }));
});
