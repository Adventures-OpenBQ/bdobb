// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export function RawJsonView({ data }: { data: unknown }) {
  return (
    <pre className="raw-json" data-testid="raw-json">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
