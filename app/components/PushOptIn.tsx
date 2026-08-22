"use client";

import { useEffect, useState } from "react";
import { isStandalone } from "../lib/standalone";
import { apiFetch } from "../lib/api";

const DISMISS_KEY = "so-study:push-optin-dismissed";

// iOS web push needs the VAPID public key exposed to the browser. It is read
// from NEXT_PUBLIC_VAPID_PUBLIC_KEY (the server uses the same value plus the
// private key + subject).
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Read the optional student name from the client-side Soso profile. */
function readStudentName(): string | undefined {
  try {
    const raw = window.localStorage.getItem("soso.profile");
    if (!raw) return undefined;
    const profile = JSON.parse(raw) as { name?: string };
    return profile.name && profile.name.trim().length > 0 ? profile.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opt-in to real iOS web-push notifications. Shown ONLY when the app is installed
 * to the Home Screen (standalone) AND the notification permission has not yet
 * been decided (`default`). Installing is a hard prerequisite — a regular browser
 * tab has no iOS web-push path at all, so we never show this there.
 *
 * The actual `Notification.requestPermission()` call is triggered by the button
 * click (a user gesture), as required — it cannot be requested automatically.
 */
export default function PushOptIn() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isStandalone()) return; // not installed → no push path
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (window.Notification.permission !== "default") return; // already asked
    if (!VAPID_PUBLIC_KEY) return; // misconfigured — don't show a doomed button
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only detection must run post-mount
    if (!dismissed) setShow(true);
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  async function enable() {
    if (!VAPID_PUBLIC_KEY) return;
    setBusy(true);
    setError(false);
    try {
      const permission = await window.Notification.requestPermission();
      if (permission !== "granted") {
        setBusy(false);
        setShow(false); // don't nag if denied
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const endpoint = sub.endpoint;
      const p256dh = arrayBufferToBase64url(sub.getKey("p256dh") as ArrayBuffer);
      const auth = arrayBufferToBase64url(sub.getKey("auth") as ArrayBuffer);
      const res = await apiFetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, keys: { p256dh, auth }, studentName: readStudentName() }),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setShow(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-3 rounded-card border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-link print:hidden"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="font-medium">Biarkan Soso ingetin kamu?</p>
          <p className="mt-1 leading-relaxed text-muted">
            Soso bisa kirim pengingat tiap sore lewat notifikasi, asal app-nya
            dibuka dari Home Screen. Izinin notifikasi buat aktifin.
          </p>
          {error && (
            <p className="mt-1 text-red-600 dark:text-red-400">
              Gagal mengaktifkan. Coba lagi nanti.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-card bg-brand-600 px-3 py-1.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Mengaktifkan…" : "Aktifkan pengingat Soso"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="tap min-h-11 rounded-card px-2 text-muted transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              Nanti
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
