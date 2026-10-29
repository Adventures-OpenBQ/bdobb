// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendFeedback = vi.fn();
vi.mock("../../lib/agent/feedback", async (orig) => ({
  ...(await orig<typeof import("../../lib/agent/feedback")>()),
  sendFeedback: (...a: unknown[]) => sendFeedback(...a),
}));
import { FeedbackBar } from "./FeedbackBar";

const bar = () => render(<FeedbackBar agentUrl="https://rita.example" prompt="hi" response="hello" />);

describe("FeedbackBar", () => {
  beforeEach(() => sendFeedback.mockReset().mockResolvedValue(undefined));

  it("sends a thumbs up once, with the prompt and reply, then thanks the user", async () => {
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(sendFeedback).toHaveBeenCalledWith("https://rita.example", {
      vote: "thumbs_up", tags: [], user_comment: "", ai_response: "hello", user_prompt: "hi", trace_id: expect.any(String),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Thanks for the feedback.");
    expect(sendFeedback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });

  it("thumbs down asks for optional tags and a comment, and sends them", async () => {
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Bad response" }));
    expect(sendFeedback).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Feedback comment" }), "too vague");
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(sendFeedback).toHaveBeenCalledWith("https://rita.example", expect.objectContaining({ vote: "thumbs_down", tags: ["Other"], user_comment: "too vague" }));
  });

  it("shows a failure inline and retries with the same trace id", async () => {
    sendFeedback.mockRejectedValueOnce(new Error("HTTP 500"));
    bar();
    await userEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Feedback not sent: HTTP 500");
    await userEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(sendFeedback).toHaveBeenCalledTimes(2);
    expect(sendFeedback.mock.calls[1][1].trace_id).toBe(sendFeedback.mock.calls[0][1].trace_id);
  });
});
