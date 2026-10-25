// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Whether a URL's hostname names this computer or a private network:
 * loopback (127/8, ::1, `localhost` and any `*.localhost`), the unspecified
 * address (0/8 -- `http://0/` and `0.0.0.0` reach this computer -- and `::`),
 * RFC 1918 (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10)
 * and IPv6 ULA (fc00::/7), plus any of those IPv4 addresses written as an
 * IPv4-mapped IPv6 address (`::ffff:127.0.0.1`). A trailing dot (`localhost.`)
 * is the same name and is judged without it.
 * It drives warnings, never a refusal: a local MCP server is legitimate, it
 * just should not arrive unremarked from a file someone else shared.
 *
 * Tailscale (100.64/10 and `*.ts.net`) is deliberately NOT private here: the
 * user's own servers live on the tailnet, and a warning on every one of them
 * would train people to ignore it.
 *
 * Takes `new URL(...).hostname`, which has already normalised the forms that
 * matter — `127.1` and `0x7f000001` arrive as `127.0.0.1`, IPv6 arrives
 * bracketed and compressed. A name is judged as written; nothing is resolved,
 * so a public name pointing at a private address is not caught.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (v4 !== null) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h === "::") return true;
  // IPv4-mapped IPv6: `new URL` writes [::ffff:127.0.0.1] as ::ffff:7f00:1,
  // so the two hex groups are turned back into the IPv4 address and judged
  // as one. The dotted form is accepted too, for a hostname not from URL.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mappedHex !== null) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mappedDotted !== null) return isPrivateHost(mappedDotted[1]);
  // The first group must be all four hex digits for the prefix to mean
  // anything: `fc::1` is 00fc::1, outside fc00::/7.
  return h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
}
