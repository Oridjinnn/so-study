// Edge gate for the whole app. NOTE: in this Next.js version the `middleware`
// file convention is DEPRECATED and renamed to `proxy`
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// Same semantics, different file and export name.
//
// Before this file existed, all 24 route handlers were world-readable AND
// world-writable: anyone who found the deployment could list the study data,
// spend the Gemini key, or delete a module. This is the first of the two auth
// layers — it stops unauthenticated traffic before it reaches a handler or the
// database. The second layer lives in each handler (`requireUser` in
// src/lib/tenancy.ts), because a matcher regex is too easy to get subtly wrong to
// be the only thing standing between the internet and the data.
//
// The proxy verifies the cookie's SIGNATURE only — no database, no Prisma. Per
// the docs, proxy code runs outside the app's module graph and should not rely on
// shared globals, and it may be deployed to the CDN edge; a DB round-trip here
// would also add latency to every request including static assets.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AuthConfigError, readSessionCookie, verifySessionToken } from "@/src/lib/auth";

/**
 * Paths that must stay reachable WITHOUT a session:
 *
 *   /login, /api/auth/*   the way in — gating these would be a redirect loop.
 *   /api/health           deploy smoke check (reports liveness only, no data).
 *   /api/cron/*           Vercel cron (vercel.json) authenticates with
 *   /api/push/send        CRON_SECRET instead of a cookie (src/lib/cronAuth.ts).
 *                         Cron carries no cookie, so a session gate would break
 *                         the scheduled jobs.
 *   /manifest.webmanifest Safari fetches the manifest WITHOUT credentials. If it
 *                         redirects to /login, "Add to Home Screen" silently
 *                         degrades to a plain bookmark — the exact bug this
 *                         release fixes. Same for the icons it references.
 *   /sw.js                the service worker must be fetchable to install.
 *
 * Everything else — every page, every other API route — requires a valid session.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",
  "/api/health",
  "/api/cron/",
  "/api/push/send",
  "/_next/",
];

const PUBLIC_EXACT = new Set([
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return true;
  // Static assets shipped from public/: never sensitive, and blocking them breaks
  // the install (icons) and the offline shell (svg).
  return /\.(png|svg|ico|webmanifest|txt|woff2?)$/.test(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  let authenticated = false;
  let misconfigured = false;
  try {
    const claims = await verifySessionToken(readSessionCookie(request.headers.get("cookie")));
    authenticated = claims !== null;
  } catch (e) {
    // No SESSION_SECRET: fail CLOSED. A deployment without a signing key cannot
    // tell a forged cookie from a real one, so it must look broken, not open.
    if (!(e instanceof AuthConfigError)) throw e;
    misconfigured = true;
  }

  if (authenticated) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  if (misconfigured) {
    return isApi
      ? NextResponse.json({ error: "Server belum dikonfigurasi (SESSION_SECRET kosong)." }, { status: 503 })
      : new NextResponse(
          "Server belum dikonfigurasi: SESSION_SECRET kosong. Setel dulu di environment.",
          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
        );
  }

  // An API caller gets a machine-readable 401; the client turns that into "sesi
  // habis, masuk lagi" rather than rendering a login page inside a JSON fetch.
  if (isApi) {
    return NextResponse.json(
      { error: "Belum masuk. Buka /login lalu masukkan kata sandi." },
      { status: 401 },
    );
  }

  // A page request is redirected to the login screen, remembering where the
  // student was headed so the installed app resumes there after login.
  const login = new URL("/login", request.url);
  const target = `${pathname}${search}`;
  if (target && target !== "/") login.searchParams.set("next", target);
  return NextResponse.redirect(login);
}

export const config = {
  // Without a matcher the proxy runs on EVERY request including static files and
  // image optimization. The negative lookahead keeps _next/* and the install
  // assets out of the hot path; `isPublic` above repeats the important ones so
  // the security decision does not live in a regex alone.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|manifest\\.webmanifest|apple-touch-icon\\.png|icon-.*\\.png).*)",
  ],
};
