// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

const logError = vi.fn((_m: string) => Promise.resolve());
vi.mock("../../lib/logger", () => ({ logError: (m: string) => logError(m) }));

/**
 * ProseMirror does not run under jsdom, so the editor is a fake with exactly
 * the five members the renderer uses. `serialized` is what the next
 * blocksToMarkdownLossy returns; a test sets it to describe the edit it is
 * about. `parseThrows` makes tryParseMarkdownToBlocks throw.
 */
const fake = {
  serialized: "",
  parseThrows: false,
  document: [{ id: "b0", type: "paragraph" }],
  tryParseMarkdownToBlocks: vi.fn((md: string) => {
    if (fake.parseThrows) throw new Error("bad markdown");
    return [{ type: "paragraph", content: md }];
  }),
  blocksToMarkdownLossy: vi.fn(() => fake.serialized),
  replaceBlocks: vi.fn(),
};
vi.mock("@blocknote/react", () => ({ useCreateBlockNote: () => fake }));

/** The last onChange BlockNoteView was handed; a test calls it to "type". */
let editorChange: (() => void) | null = null;
vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: (props: { theme: string; onChange: () => void }) => {
    editorChange = props.onChange;
    return (
      <div data-testid="bn-view" data-theme={props.theme} contentEditable suppressContentEditableWarning>
        <a href="https://example.com/x">go</a>
        <a href="javascript:alert(1)">bad</a>
      </div>
    );
  },
}));
vi.mock("@blocknote/mantine/style.css", () => ({}));

import { useSettingsStore } from "../../stores/settingsStore";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { MarkdownEditorRenderer } from "./MarkdownEditorRenderer";

const type = () => act(() => editorChange!());
const settle = () => act(() => void vi.advanceTimersByTime(500));

beforeEach(() => {
  vi.useFakeTimers();
  openUrl.mockReset();
  logError.mockClear();
  fake.serialized = "";
  fake.parseThrows = false;
  fake.tryParseMarkdownToBlocks.mockClear();
  fake.blocksToMarkdownLossy.mockClear();
  fake.replaceBlocks.mockClear();
  editorChange = null;
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
});
afterEach(() => vi.useRealTimers());

describe("MarkdownEditorRenderer", () => {
  it("loads the stored text into the editor on mount, replacing the whole document", () => {
    render(<MarkdownEditorRenderer text="# Hi" onChange={vi.fn()} />);
    expect(fake.tryParseMarkdownToBlocks).toHaveBeenCalledWith("# Hi");
    expect(fake.replaceBlocks).toHaveBeenCalledWith(fake.document, [{ type: "paragraph", content: "# Hi" }]);
  });

  it("does not parse an empty note: the editor's own empty document is the empty state", () => {
    render(<MarkdownEditorRenderer text="" onChange={vi.fn()} />);
    expect(fake.tryParseMarkdownToBlocks).not.toHaveBeenCalled();
  });

  it("follows the resolved theme", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light" } });
    render(<MarkdownEditorRenderer text="" onChange={vi.fn()} />);
    expect(screen.getByTestId("bn-view")).toHaveAttribute("data-theme", "light");
  });

  it("commits an edit 500 ms after the last change, once", () => {
    const onChange = vi.fn();
    render(<MarkdownEditorRenderer text="" onChange={onChange} />);
    fake.serialized = "hel";
    type();
    act(() => void vi.advanceTimersByTime(400));
    fake.serialized = "hello";
    type();
    act(() => void vi.advanceTimersByTime(400));
    expect(onChange).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(100));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("drops the trailing newline BlockNote appends before storing", () => {
    const onChange = vi.fn();
    render(<MarkdownEditorRenderer text="" onChange={onChange} />);
    fake.serialized = "hello\n\n";
    type();
    act(() => void vi.advanceTimersByTime(500));
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("does not commit when the serialisation equals the stored text", () => {
    const onChange = vi.fn();
    render(<MarkdownEditorRenderer text="same" onChange={onChange} />);
    fake.serialized = "same";
    type();
    settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flushes a pending edit on blur", () => {
    const onChange = vi.fn();
    render(<MarkdownEditorRenderer text="" onChange={onChange} />);
    fake.serialized = "draft";
    type();
    fireEvent.blur(screen.getByTestId("bn-view"));
    expect(onChange).toHaveBeenCalledWith("draft");
    settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending edit on unmount, since blur never fires then", () => {
    const onChange = vi.fn();
    const { unmount } = render(<MarkdownEditorRenderer text="" onChange={onChange} />);
    fake.serialized = "draft";
    type();
    unmount();
    expect(onChange).toHaveBeenCalledWith("draft");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reloads when the text changes from outside, but not when it is what this editor just emitted", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditorRenderer text="" onChange={onChange} />);
    fake.serialized = "typed";
    type();
    settle();
    expect(onChange).toHaveBeenCalledWith("typed");
    fake.replaceBlocks.mockClear();

    // The param round-trips through the store and comes back as the prop.
    rerender(<MarkdownEditorRenderer text="typed" onChange={onChange} />);
    expect(fake.replaceBlocks).not.toHaveBeenCalled();

    // Open file… (or an import) puts something else in the param.
    rerender(<MarkdownEditorRenderer text="## From disk" onChange={onChange} />);
    expect(fake.tryParseMarkdownToBlocks).toHaveBeenLastCalledWith("## From disk");
    expect(fake.replaceBlocks).toHaveBeenCalledTimes(1);
  });

  it("does not treat the load itself as an edit", () => {
    // BlockNote fires onChange for a programmatic replaceBlocks too. Were that
    // emitted, every load would rewrite the stored text in normalised form.
    const onChange = vi.fn();
    fake.replaceBlocks.mockImplementation(() => editorChange?.());
    fake.serialized = "# Hi (normalised)";
    render(<MarkdownEditorRenderer text="# Hi" onChange={onChange} />);
    settle();
    expect(onChange).not.toHaveBeenCalled();
    fake.replaceBlocks.mockReset();
  });

  it("opens a link in the editor externally and refuses an unsafe href", () => {
    render(<MarkdownEditorRenderer text="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("link", { name: "go" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    fireEvent.click(screen.getByRole("link", { name: "bad" }));
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the read-only view under a notice when the text cannot be parsed, and never writes", () => {
    const onChange = vi.fn();
    fake.parseThrows = true;
    render(<MarkdownEditorRenderer text="## Kept" onChange={onChange} />);
    expect(screen.getByRole("status")).toHaveTextContent("Could not open this note in the editor.");
    expect(screen.getByRole("heading", { name: "Kept" })).toBeInTheDocument();
    expect(screen.queryByTestId("bn-view")).not.toBeInTheDocument();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancels a pending save when a later load fails to parse, so the failed text is never overwritten", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditorRenderer text="A" onChange={onChange} />);
    // A change is typed; its 500 ms timer is left pending (not advanced).
    fake.serialized = "typed";
    type();
    // The next load fails to parse -- the fallback shows.
    fake.parseThrows = true;
    rerender(<MarkdownEditorRenderer text="B" onChange={onChange} />);
    expect(screen.getByRole("status")).toHaveTextContent("Could not open this note in the editor.");
    // Were the pending timer left running, it would now serialise the
    // editor's stale document and emit it, clobbering the failed text.
    settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaces an empty document with one empty paragraph rather than a zero-block array", () => {
    const { rerender } = render(<MarkdownEditorRenderer text="A" onChange={vi.fn()} />);
    // BlockNote's own tryParseMarkdownToBlocks("") can return [], which the
    // fake does not do on its own -- forced here to exercise the guard.
    fake.tryParseMarkdownToBlocks.mockReturnValueOnce([]);
    rerender(<MarkdownEditorRenderer text="" onChange={vi.fn()} />);
    expect(fake.replaceBlocks).toHaveBeenLastCalledWith(fake.document, [{ type: "paragraph" }]);
  });

  it("recovers from the fallback when the text reverts to one that parses, even one already seen", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditorRenderer text="A" onChange={onChange} />);
    expect(fake.replaceBlocks).toHaveBeenCalledTimes(1);

    fake.parseThrows = true;
    rerender(<MarkdownEditorRenderer text="B" onChange={onChange} />);
    expect(screen.getByRole("status")).toHaveTextContent("Could not open this note in the editor.");

    fake.parseThrows = false;
    fake.replaceBlocks.mockClear();
    rerender(<MarkdownEditorRenderer text="A" onChange={onChange} />);
    expect(fake.replaceBlocks).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("bn-view")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
