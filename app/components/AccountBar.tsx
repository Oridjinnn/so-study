"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { SECONDARY_CLASS } from "./ui";

// Who is signed in. Rendered from a CLIENT fetch of `/api/auth/session` — NOT
// from server props — because the service worker caches ONE app shell shared by
// both students; baking one student's name into the HTML would mislabel the
// other's shell. See `public/sw.js`.
type SessionUser = { id: string; name: string; displayName: string };

export default function AccountBar() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // apiFetch owns 401 handling: if the session cookie is gone it redirects to
    // /login for us, so a rejected promise here is already "handled".
    apiFetch("/api/auth/session")
      .then((res) => (res.ok ? (res.json() as Promise<{ user?: SessionUser }>) : null))
      .then((data) => {
        if (!cancelled && data?.user) setUser(data.user);
      })
      .catch(() => {
        /* 401 → redirect already in flight; nothing else to do */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* logout clears the cookie server-side; a 401 here just means already out */
    } finally {
      // Hard navigation (not client routing): the service worker caches ONE app
      // shell shared by both students, so we must reload from the proxy's auth
      // gate rather than soft-route into a possibly-stale shell.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard nav to re-run proxy auth gate
      window.location.assign("/login");
    }
  }

  if (!user) {
    // Render nothing meaningful until the session resolves, but keep the row
    // height so the layout doesn't shift under the user once it loads.
    return <div className="min-h-11" aria-hidden="true" />;
  }

  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <span className="min-w-0 truncate text-sm text-muted" title={user.displayName}>
        {user.displayName}
      </span>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        title="Keluar dari akun ini"
        className={`${SECONDARY_CLASS} shrink-0`}
      >
        Keluar
      </button>
    </div>
  );
}
