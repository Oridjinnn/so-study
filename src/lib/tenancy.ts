// Request-level tenancy: turn a cookie into "which user is this, and are they
// allowed to touch this row".
//
// Two layers exist on purpose:
//   1. `proxy.ts` rejects unauthenticated traffic at the edge, so an unauthorized
//      request never reaches a route handler or the database.
//   2. Every route handler ALSO calls `requireUser` and scopes its queries by the
//      returned id. Layer 1 is a matcher regex — one typo in it would silently
//      expose a route — so authorization is never delegated to it. The route
//      handlers verify the signed cookie themselves and trust NO request header,
//      which also means a route stays safe if it is ever invoked outside the
//      proxy's matcher (tests, a future adapter, a rewrite).
//
// Ownership is checked by FOLDING `ownerId` into the query that was already being
// run (`findFirst({ where: { id, ownerId } })`) rather than by a separate
// "can I?" round-trip. One query cannot drift out of sync with itself, and the
// natural failure is a 404 — which is also the right answer: the existence of
// another student's module is not information this user is entitled to.

import { NextResponse } from "next/server";
import { AuthConfigError, readSessionCookie, verifySessionToken } from "./auth";

export interface AuthorizedUser {
  ok: true;
  userId: string;
}

export interface RejectedUser {
  ok: false;
  response: NextResponse;
}

export type AuthResult = AuthorizedUser | RejectedUser;

/**
 * Resolve the caller's user id from the signed session cookie.
 *
 * Returns `{ ok: true, userId }` or `{ ok: false, response }` so a route reads:
 *
 *   const auth = await requireUser(req);
 *   if (!auth.ok) return auth.response;
 *
 * 401 for a missing/invalid/expired session; 503 when the deployment has no
 * SESSION_SECRET (an operator error, not the caller's fault — and it must never
 * degrade into "allow").
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const token = readSessionCookie(req.headers.get("cookie"));
  try {
    const claims = await verifySessionToken(token);
    if (!claims) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Belum masuk. Buka /login lalu masukkan kata sandi." },
          { status: 401 },
        ),
      };
    }
    return { ok: true, userId: claims.userId };
  } catch (e) {
    if (e instanceof AuthConfigError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Server belum dikonfigurasi (SESSION_SECRET kosong)." },
          { status: 503 },
        ),
      };
    }
    throw e;
  }
}

/**
 * 404 for a row that either does not exist or belongs to someone else. Deliberately
 * NOT 403: distinguishing the two tells the caller that an id they guessed is real.
 */
export function notFoundForUser(what: string): NextResponse {
  return NextResponse.json({ error: `${what} tidak ditemukan.` }, { status: 404 });
}
