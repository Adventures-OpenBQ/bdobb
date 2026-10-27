// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
import { getHost, type GroupLinkProps } from "../host";

/** The host's join/leave chip for a declared parameter (bdobb-v2 GroupLink). */
export function GroupLink(props: GroupLinkProps) {
  const Link = getHost().components.GroupLink;
  return <Link {...props} />;
}
