// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import type { ClientArtifact } from "../../lib/agent/types";
import { isPlotlyFigure, type PlotlyFigure } from "../../lib/chartShapes";
import { isRecord } from "../../lib/isRecord";
import { logError } from "../../lib/logger";
import { purgePlot, REGISTERED_TRACE_TYPES, renderPlot } from "../../lib/plotly";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import { DATA_IMAGE, LOCAL_IMAGE, MarkdownRenderer } from "../renderers/MarkdownRenderer";

export const MAX_ARTIFACT_ROWS = 50;
const numberFormat = new Intl.NumberFormat();

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return numberFormat.format(v);
  return typeof v === "string" ? v : JSON.stringify(v);
}

function ArtifactTable({ rows }: { rows: unknown[] }) {
  const objects = rows.filter(isRecord);
  const shown = objects.slice(0, MAX_ARTIFACT_ROWS);
  const columns = shown.length > 0 ? Object.keys(shown[0]) : [];
  return (
    <div className="artifact-table">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{cell(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {objects.length > MAX_ARTIFACT_ROWS ? (
        <p className="artifact-note">
          Showing {MAX_ARTIFACT_ROWS} of {objects.length} rows
        </p>
      ) : null}
    </div>
  );
}

function unregistered(figure: PlotlyFigure): string | null {
  for (const trace of figure.data) {
    const type = isRecord(trace) && typeof trace.type === "string" ? trace.type : "scatter";
    if (!REGISTERED_TRACE_TYPES.has(type)) return type;
  }
  return null;
}

const inertImages = (images: unknown) =>
  Array.isArray(images) ? images.filter((i) => isRecord(i) && typeof i.source === "string" && (DATA_IMAGE.test(i.source) || LOCAL_IMAGE.test(i.source))) : images;

/**
 * A Rita chart's layout with nothing that fetches a URL. The app's CSP allows
 * remote images, so a layout image (or a named one in its template) would be
 * fetched on render and could carry data out with zero clicks -- the channel
 * MarkdownRenderer and the HTML artifact CSP close. Only data:/blob: images
 * stay, MarkdownRenderer's rule. updatemenus and sliders go too: a button's
 * args can relayout new images in.
 */
export function inertLayout(layout: Record<string, unknown>): Record<string, unknown> {
  const { updatemenus: _menus, sliders: _sliders, ...rest } = layout;
  const out: Record<string, unknown> = { ...rest };
  if ("images" in layout) out.images = inertImages(layout.images);
  const template = layout.template;
  if (isRecord(template) && isRecord(template.layout)) {
    const { updatemenus: _tm, sliders: _ts, ...tl } = template.layout;
    out.template = { ...template, layout: "images" in tl ? { ...tl, images: inertImages(tl.images) } : tl };
  }
  return out;
}

export function ArtifactChart({ figure }: { figure: PlotlyFigure }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    renderPlot(node, { ...figure, layout: inertLayout(figure.layout) }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      void logError(`artifact chart render failed: ${message}`);
    });
    return () => purgePlot(node);
  }, [figure]);
  return <div className="artifact-chart" ref={ref} />;
}

/**
 * The frame runs no script (no allow-scripts, and srcdoc inherits the app's
 * script-src 'self'), so an artifact can only follow the theme through
 * prefers-color-scheme. WebKit -- the macOS and iPad app -- derives that from
 * the iframe's own color-scheme, so this carries the app's theme setting in;
 * Chromium (WebView2, browser mode) ignores it and keeps the OS appearance.
 */
/**
 * Prepended to every HTML artifact: srcdoc inherits the app's CSP, which
 * allows remote images, so without this an artifact's <img>/<link> fetches on
 * render and can carry data out with zero clicks.
 */
export const ARTIFACT_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">`;

/** After a leading doctype (which must stay first, or the frame drops to quirks mode), else at the start. */
export function withCsp(content: string): string {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content);
  return doctype ? doctype[0] + ARTIFACT_CSP + content.slice(doctype[0].length) : ARTIFACT_CSP + content;
}

function ArtifactHtml({ name, content }: { name?: string; content: string }) {
  const theme = useResolvedTheme();
  return (
    <iframe
      className="artifact-html"
      title={name ?? "HTML artifact"}
      srcDoc={withCsp(content)}
      sandbox="allow-forms allow-popups"
      style={{ colorScheme: theme }}
    />
  );
}

function Body({ artifact }: { artifact: ClientArtifact }) {
  const { type, content, name } = artifact;
  if (type === "tool-error" && isRecord(content)) {
    // Client-made, never sent to the agent: the diagnostic for a tool call
    // that failed mid-turn, placed where it happened in the transcript.
    return (
      <p className="artifact-tool-error" role="alert">
        {`Tool call failed: ${typeof content.display === "string" ? content.display : `${String(content.server)}.${String(content.tool)}`} — ${String(content.code)}: ${String(content.message)}`}
      </p>
    );
  }
  if ((type === "markdown" || type === "text") && typeof content === "string") return <MarkdownRenderer data={content} />;
  if (type === "table" && Array.isArray(content)) return <ArtifactTable rows={content} />;
  if (type === "chart" && isPlotlyFigure(content)) {
    const missing = unregistered(content);
    if (missing === null) return <ArtifactChart figure={content} />;
    return (
      <>
        <p className="artifact-note">Chart type "{missing}" is not available; showing the figure as JSON.</p>
        <pre>{JSON.stringify(content, null, 2)}</pre>
      </>
    );
  }
  if (type === "html" && typeof content === "string") {
    return <ArtifactHtml name={name} content={content} />;
  }
  return <pre>{JSON.stringify(content, null, 2)}</pre>;
}

export function ArtifactView({ artifact }: { artifact: ClientArtifact }) {
  return (
    <section className="artifact" aria-label={artifact.name ?? artifact.type}>
      {artifact.name && artifact.type !== "tool-error" ? <h4>{artifact.name}</h4> : null}
      <Body artifact={artifact} />
    </section>
  );
}
