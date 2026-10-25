// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { resolveParams } from "../../lib/params";

/**
 * Takes the card's EFFECTIVE params — the group-merged values WidgetCard
 * computes — and shows them as a request would carry them, tokens resolved.
 * A built-in with no backend: the whole point is to make a group's effect
 * visible on a card that fetches nothing.
 */
export function ParamEchoRenderer({ params }: { params: Record<string, string> }) {
  const resolved = resolveParams(params);
  const names = Object.keys(resolved).sort();
  return (
    <dl className="param-echo">
      {names.map((name) => (
        // aria-label on both halves so a term and its definition are findable
        // by the param's name alone; the visible text is the same string.
        <div key={name} className="param-echo-row">
          <dt aria-label={name}>{name}</dt>
          <dd aria-label={name}>{resolved[name]}</dd>
        </div>
      ))}
    </dl>
  );
}
