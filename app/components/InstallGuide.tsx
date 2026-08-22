"use client";

import { useEffect, useState } from "react";
import { isStandalone } from "../lib/standalone";

const DISMISS_KEY = "so-study:install-dismissed";

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block align-[-2px]"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
    </svg>
  );
}

/**
 * One-time, dismissible iOS install hint. iOS Safari never shows an automatic
 * install prompt, so the only path is manual: Share → Add to Home Screen. We
 * show this only on iOS Safari that is NOT yet running standalone, and we check
 * the standalone state BEFORE rendering (not just on dismiss) so an installed
 * app never flashes the banner. Dismissal is persisted in localStorage.
 */

/**
 * Installed-state check. `navigator.standalone` (via the shared helper) is the
 * legacy iOS-only flag; iPadOS 17+ reports the installed app through the
 * `display-mode` media query instead, which is also what the manifest's
 * `display: "standalone"` actually drives. Either one means "already installed",
 * and missing that would show install steps inside the installed app.
 */
function runningStandalone(): boolean {
  if (isStandalone()) return true;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

export default function InstallGuide() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already installed as a home-screen app → never show.
    if (runningStandalone()) return;
    const ua = window.navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS reports as Mac with touch support.
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIOS) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* ignore storage failures (private mode) */
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

  if (!show) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-3 rounded-card border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-link print:hidden"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true">
          <ShareIcon />
        </span>
        <div className="flex-1">
          <p className="font-medium">Pasang di layar utama iPad</p>
          {/* Numbered steps, not one sentence: the old copy said "scroll ke
              bawah" without saying WHERE the Share button is on iPad (top
              toolbar, not the bottom bar like iPhone), skipped the confirm tap,
              and never said the app must be opened from the icon afterwards —
              people ended up with a Safari bookmark and thought it failed. */}
          <ol className="mt-1 list-decimal space-y-1 pl-5 leading-relaxed text-muted">
            <li>Buka halaman ini di Safari (browser lain tidak bisa memasang).</li>
            <li>
              Tap tombol Share <ShareIcon /> di toolbar kanan atas.
            </li>
            <li>
              Scroll daftarnya, pilih &ldquo;Add to Home Screen&rdquo; (kalau iPad-nya
              bahasa Indonesia: &ldquo;Tambah ke Layar Utama&rdquo;).
            </li>
            <li>Tap &ldquo;Add&rdquo; di kanan atas untuk mengonfirmasi.</li>
            <li>
              Mulai sekarang buka lewat ikon So-study di layar utama, bukan dari
              Safari — tampilannya penuh tanpa address bar, dan kamu tetap login di
              dalamnya.
            </li>
          </ol>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup panduan instalasi"
          className="tap ml-1 min-h-11 shrink-0 rounded-card px-2 text-muted transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
