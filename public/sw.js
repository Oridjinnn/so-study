// Hand-rolled service worker for offline module reading (single-user app: no
// next-pwa dependency). Strategy:
//  - Precache the app shell ("/") on install so the app loads offline at all.
//  - Navigations: network-first, fall back to the cached shell (so Airplane
//    Mode still opens the app, not a blank error page).
//  - Build assets (/_next/static/*) + read-only Module/Topic/Paper records:
//    cache-first, then background network-update.
//  - Tanya / Latih / grade / synthesize / retrieve / export: pass through to
//    the network untouched and NEVER cached, so they fail normally offline and
//    the existing "Mode offline" banner in Workspace.tsx stays accurate.
//
// iOS hardening (see task): service-worker caches are wiped after ~7 days of
// inactivity, storage is capped near ~50MB, and Background Sync is unavailable.
// Mitigations below: (1) re-precache the shell on activate, (2) a REPRECACHE
// message refreshes the shell on every app launch, (3) read-only API responses
// are FIFO-pruned to a sane cap to respect the storage limit, and (4) a
// generated offline document guarantees the app still opens after a full wipe.

const CACHE = "so-study-v1";
const APP_SHELL = "/";
const MAX_READ_ENTRIES = 200;
const APP_SHELL_OFFLINE_DOC =
  "<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>" +
  "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
  "<title>Offline</title></head><body style='font-family:system-ui,sans-serif;" +
  "padding:2rem;color:#333'><h1>Offline</h1>" +
  "<p>This study app is offline. Reconnect to the internet and reload to keep " +
  "your saved notes available.</p></body></html>";

// AI-backed, explicitly online-only routes. Do not cache; let them hit the
// network so the offline banner in the UI reflects reality.
const ONLINE_ONLY = [
  "/api/qa",
  "/api/mcq",
  "/api/grade",
  "/api/essay",
  "/api/synthesize",
  "/api/retrieve",
];

function sameOrigin(url) {
  return url.origin === self.location.origin;
}
function isStatic(url) {
  return url.pathname.startsWith("/_next/static/");
}
function isOnlineOnly(url) {
  if (url.pathname.includes("/export")) return true; // PDF / Markdown / Anki export
  return ONLINE_ONLY.some((p) => url.pathname.startsWith(p));
}
// Read-only records that should work offline once loaded.
function isReadContent(url) {
  return /\/api\/(modules|topics|papers|courses)\b/.test(url.pathname);
}

// Re-fetch and store the app shell. Safe to call repeatedly (e.g. on launch).
function precacheShell() {
  return caches
    .open(CACHE)
    .then((cache) =>
      fetch(APP_SHELL)
        .then((res) => {
          if (res && res.ok) return cache.put(APP_SHELL, res.clone());
        })
        .catch(() => {}),
    )
    .catch(() => {});
}

// FIFO-prune the oldest read-only API responses so the cache stays under the
// ~50MB iOS limit. cache.keys() yields entries in insertion order, so deleting
// the head of the list is a reasonable LRU-ish eviction.
function pruneReadContent(max) {
  return caches
    .open(CACHE)
    .then((cache) =>
      cache.keys().then((entries) => {
        const read = entries.filter((req) => {
          try {
            return isReadContent(new URL(req.url));
          } catch {
            return false;
          }
        });
        if (read.length <= max) return;
        const stale = read.slice(0, read.length - max);
        return Promise.all(stale.map((req) => cache.delete(req)));
      }),
    )
    .catch(() => {});
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(precacheShell) // re-seed the shell after a wipe / version bump
      .then(() => self.clients.claim()),
  );
});

// Allows the page to ask the SW to refresh its cache each launch, helping to
// survive the ~7-day iOS cache expiry, or to take a waiting update immediately.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "REPRECACHE") {
    event.waitUntil(precacheShell());
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
  // Online-only routes: never cache, just go to the network.
  if (isOnlineOnly(url)) return;

  // App shell navigation: network-first with cached fallback, and a final
  // generated offline document so the app opens even right after a 7-day wipe.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(APP_SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(APP_SHELL).then(
            (r) =>
              r ||
              new Response(APP_SHELL_OFFLINE_DOC, {
                headers: { "Content-Type": "text/html; charset=utf-8" },
                status: 200,
              }),
          ),
        ),
    );
    return;
  }

  // Static assets + read-only module content: cache-first, background update.
  if (isStatic(url) || isReadContent(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              caches
                .open(CACHE)
                .then((c) => c.put(req, res.clone()))
                .then(() => {
                  if (isReadContent(url)) pruneReadContent(MAX_READ_ENTRIES);
                })
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

  // Everything else (RSC payloads, progress, usage, …): pass through untouched.
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
