// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { Auth } from "@auth/core";
import GitHub from "@auth/core/providers/github";
import { getToken } from "@auth/core/jwt";
import { SESSION_COOKIE, SESSION_SECONDS } from "./config.mjs";

export function authConfig(config) {
  return {
    basePath: "/auth",
    trustHost: true, // Request URLs are constructed ONLY from validated APP_ORIGIN.
    secret: config.secret,
    useSecureCookies: true,
    session: { strategy: "jwt", maxAge: SESSION_SECONDS },
    cookies: {
      sessionToken: {
        name: SESSION_COOKIE,
        options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
      },
    },
    providers: [GitHub({
      clientId: config.githubId, clientSecret: config.githubSecret,
      checks: ["pkce", "state"],
      authorization: { params: { scope: "read:user" } },
      // Identity only. No repository/email permission and no fallback email fetch.
      userinfo: {
        url: "https://api.github.com/user",
        async request({ tokens }) {
          const response = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "bdobb-preview" },
            signal: AbortSignal.timeout(10000), redirect: "error",
          });
          if (!response.ok) throw new Error("GitHub identity lookup failed");
          return response.json();
        },
      },
    })],
    callbacks: {
      signIn: ({ account }) => account?.provider === "github" &&
        config.allowedIds.has(account.providerAccountId),
      jwt({ token, account }) {
        if (account) return {
          githubId: account.providerAccountId, epoch: config.epoch,
          deadline: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
        };
        // Session polling must not extend the absolute authorization lifetime.
        return token;
      },
      session({ session, token }) {
        return {
          expires: session.expires,
          user: { id: token.githubId },
        };
      },
      redirect: () => config.origin + "/",
    },
    // Never log OAuth codes, cookies, provider tokens or request bodies.
    logger: {
      error() { console.error("Preview authentication failed"); },
      warn() { console.warn("Preview authentication warning"); },
      debug() {},
    },
  };
}

export const handleAuth = (request, config) => Auth(request, authConfig(config));

/** Cookie only: a copied bearer header must not bypass browser session policy. */
export async function identity(headers, config, now = Date.now() / 1000) {
  const token = await getToken({
    req: { headers: new Headers({ cookie: headers.cookie ?? "" }) },
    secret: config.secret, cookieName: SESSION_COOKIE, secureCookie: true,
  });
  if (!token || token.epoch !== config.epoch || !config.allowedIds.has(token.githubId) ||
      !Number.isFinite(token.deadline) || token.deadline <= now ||
      !Number.isFinite(token.exp) || token.exp <= now) return null;
  return { id: token.githubId, deadline: Math.min(token.deadline, token.exp) };
}
