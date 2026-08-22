// Structural invariant: NO API route may be reachable without authentication.
//
// WHY A STATIC TEST: before this release all 24 route handlers were
// world-readable and world-writable. The fix is one `requireUser` call per
// handler — which is exactly the kind of thing that gets forgotten when route #25
// is added six months from now, and a forgotten call has no failing test of its
// own: the new route just works, for everybody, forever. So this test walks the
// filesystem and fails when a route file is not guarded, rather than trusting
// each route's own suite to remember.
//
// It also cross-checks the guard list against `proxy.ts`, so making a route
// public requires saying so in BOTH places. Two independent declarations mean a
// single typo cannot silently open a door.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const API_DIR = path.join(process.cwd(), "app", "api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(process.cwd(), file).replaceAll(path.sep, "/");

/**
 * Routes that are intentionally reachable without a session, each with the reason
 * and the guard that replaces the session check. Anything not listed here MUST
 * call `requireUser`.
 */
const PUBLIC_ROUTES: Record<string, { why: string; instead: string | null }> = {
  "app/api/auth/login/route.ts": {
    why: "it is the way in; gating it would be a redirect loop",
    instead: null, // guarded by the passphrase itself + an attempt throttle
  },
  "app/api/auth/logout/route.ts": {
    why: "clearing a cookie must work even with an already-invalid session",
    instead: null,
  },
  "app/api/health/route.ts": {
    why: "deploy smoke check; reports liveness only, never study data",
    instead: null,
  },
  "app/api/cron/daily-reminder/route.ts": {
    why: "Vercel cron carries no cookie",
    instead: "checkSecret(",
  },
  "app/api/push/send/route.ts": {
    why: "Vercel cron carries no cookie",
    instead: "checkSecret(",
  },
};

const files = routeFiles(API_DIR);

describe("every API route is authenticated", () => {
  it("finds the route handlers at all (guards against a silently empty glob)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [rel(f), f]))("%s", (relative, file) => {
    const source = readFileSync(file, "utf8");
    const exception = PUBLIC_ROUTES[relative as string];

    if (exception) {
      // A deliberately public route must still be protected by SOMETHING, and the
      // reason must be written down next to it.
      if (exception.instead) expect(source).toContain(exception.instead);
      return;
    }

    expect(
      source,
      `${relative} does not call requireUser(). Every route handler must resolve the ` +
        `caller with requireUser(req) from @/src/lib/tenancy and scope its queries by ` +
        `that user, or be declared in PUBLIC_ROUTES with a reason.`,
    ).toContain("requireUser(");
    expect(source).toContain("@/src/lib/tenancy");
  });
});

describe("owner-scoped routes actually filter by owner", () => {
  // A route that reads Course/Topic/Module rows and never mentions `ownerId` is
  // returning (or mutating) rows it never checked the owner of.
  const OWNED_MODELS = /prisma\.(course|topic|module)\b|tx\.(course|topic|module)\b/;

  const scoped = files.filter((f) => {
    if (PUBLIC_ROUTES[rel(f)]) return false;
    return OWNED_MODELS.test(readFileSync(f, "utf8"));
  });

  it("finds owner-scoped routes", () => {
    expect(scoped.length).toBeGreaterThan(5);
  });

  it.each(scoped.map((f) => [rel(f), f]))("%s filters by ownerId", (relative, file) => {
    const source = readFileSync(file, "utf8");
    expect(
      source,
      `${relative} queries Course/Topic/Module but never mentions ownerId — it is ` +
        `not scoped to the logged-in student.`,
    ).toMatch(/ownerId/);
  });
});

describe("proxy.ts and the route allowlist agree", () => {
  const proxySource = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");

  it("declares every publicly-reachable API route", () => {
    for (const relative of Object.keys(PUBLIC_ROUTES)) {
      // "app/api/auth/login/route.ts" -> "/api/auth/login"
      const urlPath = `/${relative.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`;
      // The proxy may list the exact path or a covering prefix (e.g. "/api/auth/").
      const covered = [urlPath, `${urlPath}/`]
        .concat(urlPath.split("/").map((_, i, parts) => `${parts.slice(0, i + 1).join("/")}/`))
        .some((candidate) => proxySource.includes(`"${candidate}"`));
      expect(covered, `proxy.ts does not allow ${urlPath} through unauthenticated`).toBe(true);
    }
  });

  it("keeps the install assets public (or 'Add to Home Screen' silently degrades)", () => {
    // Safari fetches the manifest WITHOUT credentials: if the proxy redirects it
    // to /login, the iPad install falls back to a plain bookmark.
    expect(proxySource).toContain('"/manifest.webmanifest"');
    expect(proxySource).toContain('"/sw.js"');
    expect(proxySource).toContain('"/apple-touch-icon.png"');
  });

  it("gates everything else — the matcher is not a bare opt-in list", () => {
    // A matcher of only specific paths would leave every future page ungated.
    expect(proxySource).toMatch(/matcher/);
    expect(proxySource).toMatch(/\(\?!/); // negative lookahead => default-deny
  });
});
