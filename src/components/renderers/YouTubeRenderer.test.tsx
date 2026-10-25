// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SRC_FRAME_SANDBOX } from "./HtmlRenderer";
import { YouTubeRenderer } from "./YouTubeRenderer";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invoke(cmd) }));

const ID = "uYyhswnZkSw";
const EMBED = `https://www.youtube.com/embed/${ID}`;

describe("YouTubeRenderer", () => {
  beforeEach(() => {
    // The browser build: no Tauri behind invoke, so it rejects.
    invoke.mockReset().mockRejectedValue(new Error("no Tauri"));
  });

  it("frames the embed URL for a watch-URL payload", async () => {
    render(<YouTubeRenderer data={`https://www.youtube.com/watch?v=${ID}`} />);
    const frame = await screen.findByTitle("YouTube video");
    expect(frame).toHaveAttribute("src", EMBED);
    expect(frame).not.toHaveAttribute("sandbox");
  });

  it("trims a text/plain body that ends in a newline", async () => {
    render(<YouTubeRenderer data={`https://www.youtube.com/watch?v=${ID}\n`} />);
    const frame = await screen.findByTitle("YouTube video");
    expect(frame).toHaveAttribute("src", EMBED);
    expect(frame).not.toHaveAttribute("sandbox");
  });

  it("shows an empty state rather than framing when there is no video", () => {
    render(<YouTubeRenderer data="" />);
    expect(screen.getByText(/select a video/i)).toBeInTheDocument();
    expect(screen.queryByTitle("YouTube video")).not.toBeInTheDocument();
  });

  it("never frames a non-YouTube URL", () => {
    render(<YouTubeRenderer data={`https://example.com/watch?v=${ID}`} />);
    expect(screen.queryByTitle("YouTube video")).not.toBeInTheDocument();
    expect(screen.getByText(/select a video/i)).toBeInTheDocument();
  });

  it("frames the loopback wrapper when the app answers with a port", async () => {
    invoke.mockResolvedValue(50123);
    render(<YouTubeRenderer data={`https://www.youtube.com/watch?v=${ID}`} />);
    const frame = await screen.findByTitle("YouTube video");
    expect(frame).toHaveAttribute("src", `http://127.0.0.1:50123/yt?id=${ID}`);
    expect(frame).toHaveAttribute("sandbox", `${SRC_FRAME_SANDBOX} allow-presentation`);
    expect(invoke).toHaveBeenCalledWith("video_wrapper_port");
  });

  it("frames youtube.com when the bind failed (the app answers null)", async () => {
    invoke.mockResolvedValue(null);
    render(<YouTubeRenderer data={`https://www.youtube.com/watch?v=${ID}`} />);
    const frame = await screen.findByTitle("YouTube video");
    expect(frame).toHaveAttribute("src", EMBED);
    expect(frame).not.toHaveAttribute("sandbox");
  });

  it("never asks for the port when the payload is not a valid video", () => {
    for (const data of ["", `https://example.com/watch?v=${ID}`, "https://www.youtube.com/watch?v=tooShort", 42]) {
      const { unmount } = render(<YouTubeRenderer data={data} />);
      unmount();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks again on every mount, so a re-bound port is picked up", async () => {
    invoke.mockResolvedValueOnce(50123).mockResolvedValueOnce(50999);
    const first = render(<YouTubeRenderer data={ID} />);
    expect(await screen.findByTitle("YouTube video")).toHaveAttribute("src", `http://127.0.0.1:50123/yt?id=${ID}`);
    first.unmount();
    render(<YouTubeRenderer data={ID} />);
    expect(await screen.findByTitle("YouTube video")).toHaveAttribute("src", `http://127.0.0.1:50999/yt?id=${ID}`);
  });
});
