// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { type FormEvent, useState } from "react";
import { fetchOmniData } from "../../lib/dataClient";
import { parseOmniResponse, type OmniResult } from "../../lib/omni";
import { sendParams, type WireContext } from "../../lib/params";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { ChartRenderer } from "./ChartRenderer";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { OmniCitations } from "./OmniCitations";
import { RawJsonView } from "./RawJsonView";
import { TableRenderer } from "./TableRenderer";

type Status = "idle" | "loading" | "error";

/**
 * An omni widget: a prompt bar that POSTs { prompt, ...params } and renders the
 * response by its data_format.parse_as. Submit-driven -- a POST costs a query,
 * so this never auto-fetches (the card excludes omni from fetchesData). A body
 * that is not an omni envelope falls back to RawJsonView.
 */
export function OmniRenderer({
  widget,
  backend,
  params,
  context,
}: {
  widget: WidgetDef;
  backend: BackendConfig;
  params: Record<string, string>;
  /** The card's exchange, fiscal map and calendars (bundle calendars on a bound card): the same ones its preview uses. */
  context?: WireContext;
}) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<OmniResult | null>(null);
  const [raw, setRaw] = useState<unknown>(undefined); // a non-omni body, shown as JSON

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const p = prompt.trim();
    if (p === "") return;
    setStatus("loading");
    setError("");
    try {
      // Resolve param tokens ($currentDate, T-1bd, ...) exactly as the GET path does in buildWidgetUrl, on the card's
      // own context (final review I-A): the same exchange and calendars as its preview, so a field cannot show one date
      // and POST another. sendParams refuses (throws into the catch below, which shows why) a value that could not
      // resolve. The prompt itself stays literal; fetchOmniData's URL carries no params.
      const payload = await fetchOmniData(backend, widget, { ...sendParams(widget, params, context), prompt: p });
      const parsed = parseOmniResponse(payload);
      setResult(parsed);
      setRaw(parsed ? undefined : payload);
      setStatus("idle");
    } catch (err) {
      // Drop any prior result so a stale table/citations do not sit under the
      // error banner as if the failed request had produced them.
      setResult(null);
      setRaw(undefined);
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="omni" style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to query this widget"
          rows={2}
          style={{ flex: 1, resize: "vertical" }}
        />
        <button type="submit" disabled={status === "loading" || prompt.trim() === ""}>
          {status === "loading" ? "Running…" : "Submit"}
        </button>
      </form>
      {status === "error" ? (
        <div className="omni-error" role="alert" style={{ color: "var(--danger, #ef4444)" }}>
          {error}
        </div>
      ) : null}
      <div className="omni-result" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {result ? (
          <OmniContent result={result} />
        ) : raw !== undefined ? (
          <RawJsonView data={raw} />
        ) : status === "idle" ? (
          <p className="omni-empty" style={{ opacity: 0.7 }}>
            Enter a prompt to query this widget.
          </p>
        ) : null}
      </div>
      {result ? <OmniCitations citations={result.citations} /> : null}
    </div>
  );
}

function OmniContent({ result }: { result: OmniResult }) {
  switch (result.parseAs) {
    case "text":
      return <MarkdownRenderer data={String(result.content)} />;
    case "table":
      return <TableRenderer data={result.content} />;
    case "chart":
      return <ChartRenderer data={result.content} />;
  }
}
