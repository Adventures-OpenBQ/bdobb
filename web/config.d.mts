// SPDX-License-Identifier: Apache-2.0
export interface PreviewConfig {
  temporalDB: boolean;
  rita: boolean;
  mcp: boolean;
  origin: string;
  allowedIds: Set<string>;
  feeds: Record<string, number>;
  backend: string | null;
  token: string | null;
  secret: string;
  githubId: string;
  githubSecret: string;
  epoch: string;
}
export function readConfig(environment?: NodeJS.ProcessEnv): PreviewConfig;
export const SESSION_COOKIE: string;
