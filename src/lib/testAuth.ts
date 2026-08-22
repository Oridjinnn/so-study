// Test-only helpers for the session cookie. NEVER imported by application code —
// its whole job is to let a route test present a REAL, correctly-signed cookie
// instead of stubbing out authentication, so the test exercises the same
// verification path production does.
//
// Kept out of `*.test.ts` so several route tests can share it (vitest's node
// project only treats `*.test.ts` as suites, plain modules are just imports).

import { SESSION_COOKIE, createSessionToken } from "./auth";

/** The owner most route tests act as. */
export const TEST_USER_ID = "test-user-owner";

/** A second identity, for "this row is not yours" assertions. */
export const OTHER_USER_ID = "test-user-intruder";

/** A `Cookie:` header value carrying a valid session for `userId`. */
export async function sessionCookie(userId: string = TEST_USER_ID): Promise<string> {
  return `${SESSION_COOKIE}=${encodeURIComponent(await createSessionToken(userId))}`;
}

/**
 * Minimal `Headers`-shaped stub that answers `cookie` with a valid session and
 * anything else (notably `content-length`, which the size guards read) with null
 * unless overridden. Matches the `headers: { get }` fakes the existing route
 * tests already build.
 */
export async function authedHeaders(
  userId: string = TEST_USER_ID,
  overrides: Record<string, string> = {},
): Promise<{ get: (name: string) => string | null }> {
  const cookie = await sessionCookie(userId);
  const lookup: Record<string, string> = { cookie, ...overrides };
  return {
    get: (name: string) => lookup[name.toLowerCase()] ?? null,
  };
}

/** Headers with no session at all — the 401 case. */
export function anonymousHeaders(
  overrides: Record<string, string> = {},
): { get: (name: string) => string | null } {
  return { get: (name: string) => overrides[name.toLowerCase()] ?? null };
}
