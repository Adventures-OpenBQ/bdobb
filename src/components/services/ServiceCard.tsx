// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";

export type ServiceCardProps = {
  mark: ReactNode;
  name: string;
  kind: string;
  status: ReactNode;
  actions?: ReactNode;
  endpoint?: { label: string; value: ReactNode };
  detail?: ReactNode;
  ariaLabel?: string;
};

/**
 * The shared service row used by Connections (backends), Agents (Rita) and MCP
 * servers. Purely presentational: it owns no state and no store, so the same
 * markup can carry a status dot, an inline endpoint <input>, and any detail
 * block a caller passes. The mark ("DB"/"AI"/"MCP", or the OpenBB glyph) is decorative and hidden
 * from assistive tech; the name in the <h4> is the accessible name.
 */
export function ServiceCard({ mark, name, kind, status, actions, endpoint, detail, ariaLabel }: ServiceCardProps) {
  return (
    <article className="bd-service" aria-label={ariaLabel}>
      <div className="bd-service-top">
        <span className="bd-service-icon" aria-hidden="true">
          {mark}
        </span>
        <div className="bd-service-title">
          <h4>{name}</h4>
          <p>{kind}</p>
        </div>
        {status}
        {actions !== undefined ? <div className="bd-actions">{actions}</div> : null}
      </div>
      {endpoint !== undefined ? (
        <div className="bd-service-endpoint">
          <label>{endpoint.label}</label>
          {endpoint.value}
        </div>
      ) : null}
      {detail !== undefined ? <div className="bd-service-detail">{detail}</div> : null}
    </article>
  );
}
