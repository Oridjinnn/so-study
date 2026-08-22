import { NextResponse } from "next/server";
import { isSecureRequest, serializeClearedSessionCookie } from "@/src/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout -> 200 { ok } and an expired session cookie.
 *
 * POST, not GET: a GET logout can be triggered by any image tag or prefetch, and
 * on an installed PWA the service worker prefetches links.
 *
 * The session is a signed stateless token, so "logout" is exactly "drop the
 * cookie". A stolen token would still verify until it expires — the accepted
 * trade for having no sessions table (see src/lib/auth.ts). Rotating
 * SESSION_SECRET is the global revoke.
 */
export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  // Clearing must use the SAME attributes the cookie was set with (notably
  // Secure): a mismatched attribute set leaves the original cookie in place and
  // "Keluar" silently does nothing.
  res.headers.set("set-cookie", serializeClearedSessionCookie(isSecureRequest(req)));
  return res;
}
