// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { isPrivateHost } from "./privateHost";

// Hostnames as `new URL(...).hostname` hands them over: IPv4 already in
// dotted-decimal, IPv6 bracketed and compressed.
const host = (url: string) => new URL(url).hostname;

describe("isPrivateHost", () => {
  it.each([
    ["localhost", "http://localhost:8080/mcp"],
    ["IPv4 loopback", "http://127.0.0.1/mcp"],
    ["the rest of 127/8", "http://127.9.9.9/mcp"],
    ["IPv4 loopback in shorthand, normalised by URL", "http://127.1/mcp"],
    ["IPv6 loopback", "http://[::1]:3000/mcp"],
    ["RFC 1918 10/8", "http://10.1.2.3/mcp"],
    ["RFC 1918 172.16/12, low end", "http://172.16.0.1/mcp"],
    ["RFC 1918 172.16/12, high end", "http://172.31.255.255/mcp"],
    ["RFC 1918 192.168/16", "http://192.168.1.10/mcp"], // scrub-allow: an example private address
    ["link-local 169.254/16", "http://169.254.169.254/latest"],
    ["IPv6 link-local fe80::/10", "http://[fe80::1]/mcp"],
    ["IPv6 ULA fc00::/7 (fd)", "http://[fd12:3456::1]/mcp"],
    ["IPv6 ULA fc00::/7 (fc)", "http://[fc00::1]/mcp"],
    // C1 stage C (the stage A review's o1/o2): forms the first cut let by.
    ["the unspecified IPv4 address", "http://0.0.0.0/mcp"],
    ["`http://0/`, which URL writes as 0.0.0.0", "http://0/mcp"],
    ["the unspecified IPv6 address", "http://[::]/mcp"],
    ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/mcp"],
    ["IPv4-mapped IPv6 RFC 1918", "http://[::ffff:10.0.0.1]/mcp"],
    ["localhost with a trailing dot", "http://localhost./mcp"],
    ["a *.localhost name", "http://foo.localhost/mcp"],
    ["the top of IPv6 link-local fe80::/10", "http://[febf::1]/mcp"],
  ])("flags %s", (_, url) => {
    expect(isPrivateHost(host(url))).toBe(true);
  });

  it.each([
    ["a public name", "https://mcp.example.com/mcp"],
    ["a public IPv4 address", "http://8.8.8.8/mcp"],
    ["172.32, just past 172.16/12", "http://172.32.0.1/mcp"],
    // The user's own MCP servers live on the tailnet: flagging it is noise.
    ["a Tailscale CGNAT address", "http://100.64.1.2/mcp"], // scrub-allow: an example tailnet address
    ["a *.ts.net name", "https://mcp.example.ts.net/mcp"],
    ["a public IPv6 address", "http://[2001:db8::1]/mcp"],
    // A first group of "fc" is 0x00fc, not fc00::/7.
    ["an IPv6 address whose short first group only looks like ULA", "http://[fc::1]/mcp"],
    ["a name that merely contains localhost", "https://localhost.example.com/mcp"],
    ["172.15, just below 172.16/12", "http://172.15.0.1/mcp"],
    ["fec0::, just past IPv6 link-local fe80::/10", "http://[fec0::1]/mcp"],
    ["IPv4-mapped IPv6 of a public address", "http://[::ffff:8.8.8.8]/mcp"],
    ["a *.ts.net name with a trailing dot", "https://mcp.example.ts.net./mcp"],
  ])("does not flag %s", (_, url) => {
    expect(isPrivateHost(host(url))).toBe(false);
  });
});
