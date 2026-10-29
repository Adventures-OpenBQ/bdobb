// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Browser mode has no OS URL scheme: the web query (?inbox= / ?chart=) is read from the location instead.
export const getCurrent = async (): Promise<string[] | null> => null;
export const onOpenUrl = async (_: (urls: string[]) => void) => () => {};
