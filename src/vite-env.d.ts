// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time seed for a fresh install's one backend (see makeDefaultBackend). */
  readonly VITE_DEFAULT_BACKEND_URL?: string;
  /** Its Authorization header value, e.g. `Basic <base64 of user:password>`. */
  readonly VITE_DEFAULT_BACKEND_AUTH?: string;
  /** Build-time seed for a fresh install's Rita URL (AI Library). */
  readonly VITE_DEFAULT_RITA_URL?: string;
  /** Build-time seed for a fresh install's MCP server. */
  readonly VITE_DEFAULT_MCP_URL?: string;
}
