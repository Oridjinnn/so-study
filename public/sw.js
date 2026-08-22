// Hand-rolled service worker for the installed iPad app (single-user app: no
// next-pwa dependency). Strategy:
//  - Precache the app shell ("/") plus the *install contract* assets (the
//    manifest and its icons) so a Home-Screen launch still opens, and still has
//    a valid manifest, with no network.
//  - Navigations: network-first, fall back to the cached shell (so Airplane
//    Mode still opens the app, not a blank error page).
//  - Build assets (/_next/static/*) and the precached public files: cache-first,
//    then background network-update.
//  - EVERYTHING under /api/* and /login: passed straight to the network and
//    NEVER cached. See "Auth safety" below.
//
// Auth safety (this app is behind a login as of the auth workstream):
//  - /api/* responses are scoped to a session cookie. Caching them would let
//    one session's data outlive it, and would let a cached 200 mask a real 401,
//    so the whole /api/* space is now cache-exempt. That intentionally drops the
//    old offline module-reading cache; correctness under auth wins.
//  - /login is never cached, so a login page can never be served stale.
//  - Only a *non-redirected, basic, status-200* response is ever stored. An
//    unauthenticated fetch of "/" answers with a redirect to /login, and storing
//    that under the shell key would pin the login page as the app shell forever.
//  - An auth redirect is never replaced by the cached shell: the cache is only
//    consulted when the network *fails* (a rejected fetch), never when the
//    server answers with a redirect or a 401.
//  - Navigation requests have redirect mode "manual", so a 3xx arrives here as
//    an opaqueredirect (status 0, type "opaqueredirect"). It is passed through
//    untouched, which is what lets the standalone window follow the redirect to
//    /login while staying inside the manifest scope (i.e. staying standalone
//    instead of bouncing out to Safari).
//
// iOS hardening: service-worker caches are wiped after ~7 days of inactivity,
// storage is capped near ~50MB, and Background Sync is unavailable. Mitigations:
// (1) re-precache on activate, (2) a REPRECACHE message refreshes the precache
// on every app launch, and (3) a generated offline document guarantees the app
// still opens something after a full wipe.

// Bumped to v2 when /api/* caching was removed: the activate handler deletes
// every other cache name, which is what evicts session-scoped JSON already
// stored on the iPad by v1.
const CACHE = "so-study-v2";
const APP_SHELL = "/";

// The install contract: without a reachable manifest (and its icons) iOS
// degrades "Add to Home Screen" to a plain Safari bookmark. Precaching these
// keeps the installed app self-sufficient offline. Bonus: the service worker's
// own fetch sends the session cookie, while Safari fetches the manifest WITHOUT
// credentials — so this cache also keeps the manifest resolvable for the
// installer even though its request is anonymous.
const PRECACHE = [
  APP_SHELL,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

// Path prefixes that must never enter the cache, at all, in any code path.
// "/api" covers both the AI-backed online-only routes and the read-only record
// routes: all of them are session-scoped now. "/login" must stay live so the
// auth state on screen is always the real one.
const NEVER_CACHE = ["/api", "/login"];

const OFFLINE_DOC =
  "<!DOCTYPE html><html lang='id'><head><meta charset='utf-8'>" +
  "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
  "<title>Offline</title></head><body style='font-family:system-ui,sans-serif;" +
  "padding:2rem;color:#333'><h1>Sedang offline</h1>" +
  "<p>So-study belum bisa memuat halaman ini karena tidak ada koneksi. " +
  "Sambungkan internet lalu buka ulang aplikasinya.</p></body></html>";

function sameOrigin(url) {
  return url.origin === self.location.origin;
}
function isStatic(url) {
  return url.pathname.startsWith("/_next/static/");
}
// Public, non-personalised files we deliberately keep offline.
function isPrecachedAsset(url) {
  return url.pathname !== APP_SHELL && PRECACHE.includes(url.pathname);
}
function isNeverCache(url) {
  return NEVER_CACHE.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + "/"),
  );
}

// The single gate for writing anything into the cache. `status === 200` rejects
// 206 partials and errors, `!redirected` rejects a followed auth redirect, and
// `type === "basic"` rejects opaque / opaqueredirect responses (which `cache.put`
// would throw on anyway, and which must never stand in for real content).
function isCacheable(res) {
  return !!res && res.status === 200 && !res.redirected && res.type === "basic";
}

function offlineDoc() {
  return new Response(OFFLINE_DOC, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    status: 200,
  });
}

// Re-fetch and store the install contract. Safe to call repeatedly (e.g. on
// every launch, to outrun the ~7-day iOS cache wipe). Each entry is fetched
// individually and failures are swallowed, so one unreachable file (or an
// unauthenticated shell that redirects to /login) never aborts the rest.
function precache() {
  return caches
    .open(CACHE)
    .then((cache) =>
      Promise.all(
        PRECACHE.map((path) =>
          fetch(path)
            .then((res) => (isCacheable(res) ? cache.put(path, res.clone()) : undefined))
            .catch(() => {}),
        ),
      ),
    )
    .catch(() => {});
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(precache) // re-seed after a wipe / version bump
      .then(() => self.clients.claim()),
  );
});

// Allows the page to ask the SW to refresh its cache each launch, helping to
// survive the ~7-day iOS cache expiry, or to take a waiting update immediately.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "REPRECACHE") {
    event.waitUntil(precache());
  } else if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!sameOrigin(url)) return;

  // Auth-sensitive URLs: nothing is read from or written to the cache. A
  // navigation still gets the generated offline page when the network is gone
  // (never the app shell — showing the logged-in UI at /login would be a lie).
  if (isNeverCache(url)) {
    if (req.mode === "navigate") {
      event.respondWith(fetch(req).catch(() => offlineDoc()));
    }
    return;
  }

  // App shell navigation: network-first with cached fallback, and a final
  // generated offline document so the app opens even right after a 7-day wipe.
  // Redirects and 401s flow through untouched (see "Auth safety" above); only a
  // genuine network failure reaches the cache.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only the shell URL itself may refresh the shell entry, so another
          // page can never be stored under the "/" key.
          if (url.pathname === APP_SHELL && isCacheable(res)) {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(APP_SHELL, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(APP_SHELL).then((r) => r || offlineDoc())),
    );
    return;
  }

  // Build assets + the precached public files: cache-first, background update.
  if (isStatic(url) || isPrecachedAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (isCacheable(res)) {
              caches
                .open(CACHE)
                .then((c) => c.put(req, res.clone()))
                .catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Everything else (RSC payloads, other public files, …): pass through
  // untouched, so nothing personalised is ever stored by accident.
});

// --- Real iOS web-push notifications ---------------------------------------
// Only reachable when the app is installed to the Home Screen (standalone) and
// the student granted permission; a plain browser tab has no push path.
self.addEventListener("push", (event) => {
  let payload = { title: "Soso", body: "" };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Keep the default Soso shell if the payload isn't JSON.
  }
  const title = payload.title || "Soso";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "soso-reminder",
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/");
        return undefined;
      }),
  );
});
