"use client";

import { useEffect } from "react";

/**
 * Registers the hand-rolled service worker (public/sw.js) in the browser only.
 * Skipped during SSR/build and in dev (where SW caching fights HMR); the
 * production build is what needs offline support.
 *
 * On every launch it posts a REPRECACHE message so the shell is refreshed,
 * helping survive the ~7-day iOS service-worker cache expiry. It also applies
 * pending service-worker updates immediately (skipWaiting + reload) so the
 * re-precache-on-activate logic runs without a stale worker lingering.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // A new worker is installed but waiting: take it now and reload so the
          // freshly activated worker can re-precache the shell.
          const applyUpdate = () => {
            if (reg.waiting) {
              reg.waiting.postMessage({ type: "SKIP_WAITING" });
              window.location.reload();
            }
          };
          if (reg.waiting) {
            applyUpdate();
          } else {
            reg.addEventListener("updatefound", () => {
              const installing = reg.installing;
              if (!installing) return;
              installing.addEventListener("statechange", () => {
                if (installing.state === "installed" && navigator.serviceWorker.controller) {
                  applyUpdate();
                }
              });
            });
          }

          // Refresh the cache each launch to outrun the iOS 7-day wipe.
          navigator.serviceWorker.ready
            .then((ready) => {
              ready.active?.postMessage({ type: "REPRECACHE" });
            })
            .catch(() => {});
        })
        .catch(() => {
          /* registration is best-effort; the app still works online without it */
        });
    };
    window.addEventListener("load", onLoad);
    // A standalone Home-Screen launch often finishes loading before React
    // hydrates, so the "load" event can already be in the past by the time this
    // effect runs — in that case the listener above would never fire and the app
    // would silently lose its offline cache. Register straight away instead.
    if (document.readyState === "complete") onLoad();
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
