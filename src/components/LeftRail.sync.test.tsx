// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(), save: vi.fn(), open: vi.fn() }));
import { confirm } from "@tauri-apps/plugin-dialog";
import { __reset } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { SyncLink } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { LeftRail } from "./LeftRail";

const link = (over: Partial<SyncLink> = {}): SyncLink => ({ dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: "aaaaaaaa-0000-4000-8000-000000000002", serverUpdatedDate: "t", localRevisionAtSync: 0, shared: false, ...over });
const rail = () => render(<LeftRail onOpenLibrary={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(confirm).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWorkspaceStore.setState({ connections: [{ id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false }], sessions: {}, deciding: [] });
  useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] }, { id: "d2", name: "Second", tabs: [] }], activeId: "d1", activeTabId: "t1", viewer: false });
  useWorkspaceSyncStore.setState({ links: [], tombstones: [] });
});

describe("LeftRail and dashboard sync", () => {
  it("names the server in a synced dashboard's delete confirm, and deletes through the sync", async () => {
    useWorkspaceSyncStore.setState({ links: [link()] });
    vi.mocked(confirm).mockResolvedValue(true);
    rail();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["d2"]));
    expect(confirm).toHaveBeenCalledWith('Delete "Main" here and on Work?', expect.objectContaining({ title: "Delete dashboard" }));
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([{ connectionId: "ws1", store: "dashboard", uuid: link().uuid }]);
  });

  it("marks a shared dashboard, and confirms its delete as a local one", async () => {
    useWorkspaceSyncStore.setState({ links: [link({ shared: true })] });
    vi.mocked(confirm).mockResolvedValue(false);
    rail();
    expect(screen.getByText("Main · shared")).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Delete dashboard "Main"?', expect.anything()));
  });
});
