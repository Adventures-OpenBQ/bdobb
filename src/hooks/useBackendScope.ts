// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';
import type { BackendConfig } from '../lib/types';

let nextScope = 0;
/** Opaque render identity: credentials never become a React key, DOM value or log. */
export function useBackendScope(backend: BackendConfig): number {
  // Authentication changes define the lifetime of this opaque identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ++nextScope, [backend.id, backend.baseUrl, backend.authLocation, backend.headerName, backend.headerValue]);
}
