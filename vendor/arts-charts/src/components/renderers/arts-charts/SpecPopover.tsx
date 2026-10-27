// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect, useId, useState } from "react";

/**
 * The `{ }` popover (spec §9): the whole chart as one JSON document, in a
 * monospace editor. Copy puts it on the clipboard; Apply hands the text to
 * the renderer, which validates and patches -- an error comes back as a
 * string and is shown under the editor, never thrown.
 */
export function SpecPopover({ json, onApply, onClose }: { json: string; onApply: (text: string) => string | null; onClose: () => void }) {
  const [text, setText] = useState(json);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  // A fresh document when the card changes underneath an open popover.
  useEffect(() => { setText(json); setError(null); }, [json]);
  return (
    <>
      <label htmlFor={id}>Chart spec</label>
      <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error === null ? null : <p className="chart-popover-error" role="alert">{error}</p>}
      <div className="chart-popover-actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(text)}>Copy</button>
        <button type="button" onClick={onClose}>Close</button>
        <button type="button" onClick={() => { const problem = onApply(text); setError(problem); if (problem === null) onClose(); }}>Apply</button>
      </div>
      <p className="chart-popover-preview">Post it to /ta_series_ws to re-materialize the layers server-side.</p>
    </>
  );
}
