import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./manifest";

// Mission step 4: the iPad must install this as a *standalone* app, not as a
// Safari bookmark. Three things have to hold together for that, and all three
// live in different files, so they are pinned here:
//   1. the manifest itself (app/manifest.ts → served at /manifest.webmanifest),
//   2. the <head> wiring in app/layout.tsx that points iOS at it,
//   3. the service worker, which must precache the manifest (so an installed
//      app survives offline) WITHOUT ever caching auth-sensitive URLs.
// A broken icon path or a drifted theme colour is invisible until someone tries
// to install on a real iPad, which is exactly why it is a test and not a review.

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(APP_DIR, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const layoutSource = readFileSync(path.join(APP_DIR, "layout.tsx"), "utf8");
const swSource = readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8");

// Reads a PNG's real pixel size straight out of the IHDR header (bytes 16..24),
// so the manifest cannot advertise sizes the files do not actually have.
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web app manifest (/manifest.webmanifest)", () => {
  it("declares every field the iPad standalone install needs", () => {
    const m = manifest();
    expect(m.name).toBeTruthy();
    expect(m.description).toBeTruthy();
    expect(m.id).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBeTruthy();
    expect(m.lang).toBe("id");
    expect(m.theme_color).toBe("#4f46e5");
    expect(m.background_color).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  it("keeps short_name short enough for a home-screen label", () => {
    // iPad truncates around a dozen characters; anything longer ships as "So-st…".
    expect(manifest().short_name!.length).toBeLessThanOrEqual(12);
  });

  it("scopes the app so an auth redirect to /login stays standalone", () => {
    const m = manifest();
    // A standalone launch of start_url that redirects to /login must stay INSIDE
    // scope, otherwise iOS treats it as leaving the app and hands the student
    // back to Safari on the very first launch.
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect("/login".startsWith(m.scope!)).toBe(true);
    // `id` must be stable and is easiest to keep stable by matching start_url.
    expect(m.id).toBe(m.start_url);
  });

  it("references only icons that exist on disk, at the advertised sizes", () => {
    const icons = manifest().icons ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      const file = path.join(PUBLIC_DIR, icon.src);
      const { width, height } = pngSize(file); // throws if the file is missing
      expect(`${width}x${height}`).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
    }
  });

  it("ships the 192/512/maskable/apple icon set", () => {
    const icons = manifest().icons ?? [];
    const bySrc = new Map(icons.map((i) => [i.src, i]));
    expect(bySrc.get("/icon-192.png")?.sizes).toBe("192x192");
    expect(bySrc.get("/icon-512.png")?.sizes).toBe("512x512");
    // The maskable icon must stay a separate entry: reusing it as the plain icon
    // renders visibly shrunken because of its safe-zone padding.
    expect(bySrc.get("/icon-maskable-512.png")?.purpose).toBe("maskable");
    expect(bySrc.get("/icon-192.png")?.purpose).not.toBe("maskable");
    expect(bySrc.get("/apple-touch-icon.png")?.sizes).toBe("180x180");
  });
});

describe("layout <head> wiring", () => {
  it("points at the manifest URL Next actually serves", () => {
    // app/manifest.ts is served at /manifest.webmanifest (Next appends the
    // extension for the manifest metadata route), so the link must use that URL.
    expect(layoutSource).toContain('manifest: "/manifest.webmanifest"');
  });

  it("keeps the apple-touch-icon link, which is where iOS takes the icon from", () => {
    expect(layoutSource).toContain("/apple-touch-icon.png");
  });

  it("declares the legacy apple standalone meta as a manifest-failure fallback", () => {
    // This Next version emits the standardised `mobile-web-app-capable`, which
    // iOS ignores; iOS takes standalone from the manifest instead. The legacy
    // Apple meta is the only thing that still launches the home-screen app
    // chrome-less if the manifest itself ever fails to load.
    expect(layoutSource).toContain("capable: true");
    expect(layoutSource).toContain('"apple-mobile-web-app-capable": "yes"');
  });

  it("uses the same theme colour as the manifest", () => {
    const themeColor = layoutSource.match(/themeColor:\s*"([^"]+)"/)?.[1];
    expect(themeColor).toBe(manifest().theme_color);
  });
});

// --- service worker -------------------------------------------------------
// public/sw.js is a classic worker script, so it is loaded here with injected
// `self`, `caches` and `fetch` and then driven through real events. That tests
// the *behaviour* the install and the auth workstream depend on, instead of
// grepping the source for reassuring words.

const ORIGIN = "http://localhost:3000";

type SWRequest = { url: string; method: string; mode?: string };
type SWResponse = {
  status: number;
  ok: boolean;
  redirected: boolean;
  type: string;
  clone: () => SWResponse;
  text: () => Promise<string>;
};
type FetchImpl = (input: SWRequest | string) => Promise<SWResponse>;

function cacheKey(input: SWRequest | string): string {
  return new URL(typeof input === "string" ? input : input.url, ORIGIN).toString();
}

function body(text: string, over: Partial<SWResponse> = {}): SWResponse {
  const res: SWResponse = {
    status: 200,
    ok: true,
    redirected: false,
    type: "basic",
    clone: () => res,
    text: async () => text,
    ...over,
  };
  return res;
}

/** What an unauthenticated `fetch("/")` looks like: followed redirect to /login. */
function redirectedToLogin(): SWResponse {
  return body("<html>LOGIN PAGE</html>", { redirected: true });
}

/**
 * What a 3xx looks like to a *navigation* fetch inside a service worker: the
 * request's redirect mode is "manual", so the worker gets an opaque redirect it
 * must hand back untouched for the browser to follow.
 */
function opaqueRedirect(): SWResponse {
  return body("", { status: 0, ok: false, type: "opaqueredirect" });
}

function loadServiceWorker(fetchImpl: FetchImpl) {
  const store = new Map<string, SWResponse>();
  const cache = {
    put: async (req: SWRequest | string, res: SWResponse) => {
      store.set(cacheKey(req), res);
    },
    match: async (req: SWRequest | string) => store.get(cacheKey(req)),
    keys: async () => [...store.keys()].map((url) => ({ url, method: "GET" })),
    delete: async (req: SWRequest | string) => store.delete(cacheKey(req)),
  };
  const caches = {
    open: async () => cache,
    keys: async () => ["so-study-v2"],
    delete: async () => true,
    match: async (req: SWRequest | string) => store.get(cacheKey(req)),
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners.set(type, fn);
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { showNotification: async () => {} },
  };
  const factory = new Function("self", "caches", "fetch", swSource) as (
    swSelf: typeof self,
    swCaches: typeof caches,
    swFetch: FetchImpl,
  ) => void;
  factory(self, caches, fetchImpl);

  return {
    store,
    /** Runs install (+ its precache) to completion. */
    install: async () => {
      const pending: Promise<unknown>[] = [];
      listeners.get("install")!({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    },
    /** Dispatches a fetch event; returns the response the SW served, or null. */
    handleFetch: async (request: SWRequest): Promise<SWResponse | null> => {
      let responded: Promise<SWResponse> | null = null;
      listeners.get("fetch")!({
        request,
        respondWith: (value: SWResponse | Promise<SWResponse>) => {
          responded = Promise.resolve(value);
        },
      });
      return responded ? await responded : null;
    },
  };
}

const navigate = (pathname: string): SWRequest => ({
  url: ORIGIN + pathname,
  method: "GET",
  mode: "navigate",
});
const subresource = (pathname: string): SWRequest => ({
  url: ORIGIN + pathname,
  method: "GET",
  mode: "cors",
});

describe("service worker: manifest precache", () => {
  it("precaches the manifest URL and its icons on install", async () => {
    const sw = loadServiceWorker(async (input) => body(`payload for ${cacheKey(input)}`));
    await sw.install();
    // Without the manifest in the cache, an offline launch of the installed app
    // has no manifest to resolve — hence icon/standalone regressions offline.
    expect(sw.store.has(cacheKey("/manifest.webmanifest"))).toBe(true);
    for (const icon of manifest().icons ?? []) {
      expect(sw.store.has(cacheKey(icon.src))).toBe(true);
    }
    expect(sw.store.has(cacheKey("/"))).toBe(true);
  });

  it("serves the manifest from cache when the network is gone", async () => {
    const sw = loadServiceWorker(async () => body('{"name":"So-study"}'));
    await sw.install();
    const offline = loadServiceWorker(async () => {
      throw new Error("offline");
    });
    // Re-use the primed cache in the offline worker.
    for (const [key, value] of sw.store) offline.store.set(key, value);
    const res = await offline.handleFetch(subresource("/manifest.webmanifest"));
    expect(await res!.text()).toContain("So-study");
  });
});

describe("service worker: auth safety", () => {
  it("never caches or intercepts /api/* requests", async () => {
    const sw = loadServiceWorker(async () => body('[{"secret":"session-scoped"}]'));
    // Session-scoped JSON must not outlive the session, and a cached 200 must
    // never be able to mask a real 401.
    expect(await sw.handleFetch(subresource("/api/modules"))).toBeNull();
    expect(await sw.handleFetch(subresource("/api/qa"))).toBeNull();
    expect(sw.store.size).toBe(0);
  });

  it("never serves the app shell (or caches anything) for /login", async () => {
    const sw = loadServiceWorker(async () => {
      throw new Error("offline");
    });
    sw.store.set(cacheKey("/"), body("<html>APP SHELL</html>"));
    const res = await sw.handleFetch(navigate("/login"));
    const html = await res!.text();
    expect(html).not.toContain("APP SHELL");
    expect(html).toContain("offline"); // the generated fallback document
    expect(sw.store.has(cacheKey("/login"))).toBe(false);
  });

  it("passes an auth redirect through instead of answering from the shell cache", async () => {
    const shell = body("<html>APP SHELL</html>");
    const redirect = opaqueRedirect();
    const sw = loadServiceWorker(async () => redirect);
    sw.store.set(cacheKey("/"), shell);
    const res = await sw.handleFetch(navigate("/"));
    // The standalone window must follow the redirect to /login (in scope, so it
    // stays standalone); serving the cached shell would fake a logged-in app.
    expect(res).toBe(redirect);
    expect(sw.store.get(cacheKey("/"))).toBe(shell); // and must not overwrite it
  });

  it("never stores a followed redirect as the app shell", async () => {
    const sw = loadServiceWorker(async () => redirectedToLogin());
    await sw.install();
    // Precaching "/" while logged out would otherwise pin the login page as the
    // app shell for every later offline launch.
    expect(sw.store.has(cacheKey("/"))).toBe(false);
  });

  it("only refreshes the shell entry from the shell URL itself", async () => {
    const shell = body("<html>APP SHELL</html>");
    const other = body("<html>SOME OTHER PAGE</html>");
    const sw = loadServiceWorker(async () => other);
    sw.store.set(cacheKey("/"), shell);
    await sw.handleFetch(navigate("/some-other-page"));
    expect(sw.store.get(cacheKey("/"))).toBe(shell);
  });

  it("falls back to the cached shell only when the network actually fails", async () => {
    const sw = loadServiceWorker(async () => {
      throw new Error("offline");
    });
    sw.store.set(cacheKey("/"), body("<html>APP SHELL</html>"));
    const res = await sw.handleFetch(navigate("/"));
    expect(await res!.text()).toContain("APP SHELL");
  });
});
