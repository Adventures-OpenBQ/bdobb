// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendEditForm, EMPTY_DRAFT, toInput } from "./BackendEditForm";

vi.mock("../../lib/discovery", () => ({ discoverBackend: vi.fn() }));
import { discoverBackend, type DiscoveryResult } from "../../lib/discovery";
import { __reset, __writes } from "../../test/memfs";
import { widget } from "../../test/fixtures";

beforeEach(() => {
  __reset();
});

const makeWidget = (id: string) =>
  widget({
    id,
    backendId: "draft",
    name: id,
    category: "Uncategorized",
    endpoint: "/x",
    gridData: { w: 10, h: 8 },
  });

const draft = {
  name: "Local",
  baseUrl: "http://localhost:6900",
  headerName: "",
  headerValue: "",
  authLocation: "header" as const,
  validateWidgets: false,
  askOnStartup: false,
};

describe("BackendEditForm", () => {
  it("is its own dialog, titled Connect backend with an Add button when adding", () => {
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: "Connect backend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("is titled Edit backend with an Update button when editing", () => {
    render(
      <BackendEditForm
        draft={draft}
        editing
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Edit backend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("closes on its own Close button", async () => {
    const onCancel = vi.fn();
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel, and submits nothing", async () => {
    // The footer's only two other buttons (Test, submit) both commit
    // something, so Cancel is the explicit way out that does not.
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // type="button", not a bare <button> inside the <form>: the implicit
    // type is "submit", and Cancel must never be the form's submit.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves Cancel enabled on a draft too incomplete to Test or Add", () => {
    // `invalid` greys out Test and Add. Greying out the way OUT of a form
    // you cannot complete is exactly backwards.
    render(
      <BackendEditForm draft={EMPTY_DRAFT} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });

  it("hands focus back to the opener on unmount, via useChildDialog", () => {
    // The Edit/Connect backend button that opened this, standing in for the
    // real trigger: useChildDialog's showModal() moves focus into the form,
    // so unmounting without restoring it drops a keyboard user on the list
    // dialog's body instead.
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    try {
      trigger.focus();
      const { unmount } = render(
        <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
      );
      screen.getByRole("button", { name: "Close" }).focus();
      expect(trigger).not.toHaveFocus();

      unmount();

      expect(trigger).toHaveFocus();
    } finally {
      trigger.remove();
    }
  });

  // `localhost:6900` (no scheme) used to save, and every request then failed
  // with an error that said nothing about the missing http://.
  it("refuses an endpoint URL without http:// or https://, and says why", () => {
    render(
      <BackendEditForm
        draft={{ ...draft, baseUrl: "localhost:6900" }}
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
    expect(screen.getByText(/must start with http:\/\/ or https:\/\//)).toBeInTheDocument();
  });

  it("labels the endpoint field 'Endpoint URL'", () => {
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue("http://localhost:6900");
  });

  it("labels the auth fields Key and Value, and masks the value", () => {
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByLabelText("Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Value")).toHaveAttribute("type", "password");
  });

  it.each([
    ["a blank name", { ...draft, name: "  " }],
    ["a blank endpoint URL", { ...draft, baseUrl: "" }],
  ])("disables Add on %s", (_label, d) => {
    render(<BackendEditForm draft={d} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("reports edits through onChange without holding state itself", async () => {
    const onChange = vi.fn();
    render(
      <BackendEditForm draft={draft} onChange={onChange} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.type(screen.getByLabelText("Name"), "X");
    expect(onChange).toHaveBeenCalledWith({ ...draft, name: "LocalX" });
  });

  it("defaults the Location select to Header", () => {
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByLabelText("Location")).toHaveValue("header");
  });

  it("reports a Location change through onChange", async () => {
    const onChange = vi.fn();
    render(
      <BackendEditForm draft={draft} onChange={onChange} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Location"), "query");
    expect(onChange).toHaveBeenCalledWith({ ...draft, authLocation: "query" });
  });

  it("defaults the Validate widgets select to No", () => {
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByLabelText("Validate widgets")).toHaveValue("no");
  });

  it("renders the Validate widgets select showing Yes when the draft has validateWidgets: true", () => {
    render(
      <BackendEditForm
        draft={{ ...draft, validateWidgets: true }}
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText("Validate widgets")).toHaveValue("yes");
  });

  it("reports a Validate widgets change through onChange as a boolean", async () => {
    const onChange = vi.fn();
    render(
      <BackendEditForm draft={draft} onChange={onChange} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Validate widgets"), "yes");
    expect(onChange).toHaveBeenCalledWith({ ...draft, validateWidgets: true });
  });
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
});

describe("Test", () => {
  it("reports the widget count on success, without saving", async () => {
    vi.mocked(discoverBackend).mockResolvedValue({
      backendId: "draft",
      widgets: [makeWidget("w1"), makeWidget("w2")],
      apps: [],
      status: "online",
      issues: [],
    });
    const onSubmit = vi.fn();
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Reachable — 2 widgets")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the failure text for an unreachable backend", async () => {
    vi.mocked(discoverBackend).mockResolvedValue({
      backendId: "draft",
      widgets: [],
      apps: [],
      status: "offline",
      issues: [],
      error: "HTTP 401: Not authenticated",
    });
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("HTTP 401: Not authenticated")).toBeInTheDocument();
  });

  it("does not disable Add while a test is pending", async () => {
    vi.mocked(discoverBackend).mockReturnValue(new Promise(() => {}));
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("clears a shown result once the draft is edited, since it no longer describes the current config", async () => {
    vi.mocked(discoverBackend).mockResolvedValue({
      backendId: "draft",
      widgets: [makeWidget("w1")],
      apps: [],
      status: "online",
      issues: [],
    });
    const { rerender } = render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Reachable — 1 widgets")).toBeInTheDocument();

    rerender(
      <BackendEditForm
        draft={{ ...draft, baseUrl: "http://localhost:7000" }}
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("Reachable — 1 widgets")).not.toBeInTheDocument();
  });

  it("discards a probe that resolves after the draft was edited while it was in flight", async () => {
    // Unlike the "clears a shown result" test above, this covers the guard
    // itself: a probe still IN FLIGHT for the old draft, resolving AFTER
    // the edit. If the reset effect stopped bumping testRunRef, no current
    // test would fail — this one would.
    let resolveProbe!: (r: DiscoveryResult) => void;
    const pending = new Promise<DiscoveryResult>((r) => {
      resolveProbe = r;
    });
    vi.mocked(discoverBackend).mockReturnValueOnce(pending);

    const { rerender } = render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(screen.getByText("Testing…")).toBeInTheDocument();

    // Edit the draft while the probe for the OLD draft is still pending.
    rerender(
      <BackendEditForm
        draft={{ ...draft, baseUrl: "http://localhost:7000" }}
        onChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByText("Testing…")).not.toBeInTheDocument();

    await act(async () => {
      resolveProbe({ backendId: "draft", widgets: [makeWidget("w1")], apps: [], status: "online", issues: [] });
      await Promise.resolve();
    });

    expect(screen.queryByText(/Reachable/)).not.toBeInTheDocument();
    expect(screen.queryByText("Testing…")).not.toBeInTheDocument();
  });

  it("does not write to the filesystem when Test succeeds", async () => {
    vi.mocked(discoverBackend).mockResolvedValue({
      backendId: "draft",
      widgets: [makeWidget("w1")],
      apps: [],
      status: "online",
      issues: [],
    });
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Reachable — 1 widgets")).toBeInTheDocument();

    // Nothing in BackendEditForm ever calls the filesystem mock today, so
    // this assertion cannot fail against current behavior — it is a forward
    // regression net: if a future change wires Test up to a write, this
    // catches that write happening on the success path.
    expect(__writes()).toEqual([]);
  });

  it("does not let a slow first probe overwrite the result of a newer one", async () => {
    let resolveFirst!: (r: DiscoveryResult) => void;
    const first = new Promise<DiscoveryResult>((r) => {
      resolveFirst = r;
    });
    vi.mocked(discoverBackend).mockReturnValueOnce(first);
    render(
      <BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    const testButton = screen.getByRole("button", { name: "Test" });
    await userEvent.click(testButton);

    vi.mocked(discoverBackend).mockResolvedValueOnce({
      backendId: "draft",
      widgets: [makeWidget("w1"), makeWidget("w2")],
      apps: [],
      status: "online",
      issues: [],
    });
    await userEvent.click(testButton);
    expect(await screen.findByText("Reachable — 2 widgets")).toBeInTheDocument();

    // The first (slow) probe finally resolves. It must not clobber the
    // second, already-displayed result.
    resolveFirst({ backendId: "draft", widgets: [makeWidget("w1")], apps: [], status: "online", issues: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("Reachable — 2 widgets")).toBeInTheDocument();
  });

  // A test that asserted "no state update after unmount" used to live here.
  // It always passed, including with the unmount guard in BackendEditForm
  // deleted entirely: React 19 silently no-ops a post-unmount setState (no
  // warning, no error, no observable effect), so there was nothing left for
  // the assertion to actually catch. See the comment on the guard itself in
  // BackendEditForm.tsx for why the guard is kept anyway.
});

describe("toInput", () => {
  it("returns explicit undefined for a half-filled auth pair", () => {
    expect(toInput({ ...EMPTY_DRAFT, name: "a", baseUrl: "b", headerName: "K" })).toEqual({
      name: "a",
      baseUrl: "b",
      headerName: undefined,
      headerValue: undefined,
      authLocation: "header",
      validateWidgets: true,
    });
  });

  it("no longer offers an Allowed code languages field", () => {
    render(<BackendEditForm draft={draft} onChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText(/allowed code languages/i)).toBeNull();
  });

  it("carries Location and Validate widgets into the saved input", () => {
    expect(
      toInput({ ...EMPTY_DRAFT, name: "a", baseUrl: "b", authLocation: "cookie", validateWidgets: true }),
    ).toMatchObject({ authLocation: "cookie", validateWidgets: true });
  });
});
