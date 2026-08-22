"use client";

import { useState } from "react";

/**
 * One field, one button. The passphrase identifies the student as well as
 * authenticating them (see app/api/auth/login/route.ts), so there is nothing else
 * to ask for.
 *
 * iPad specifics that are NOT cosmetic:
 *   - `type="password"` + `autoComplete="current-password"` is what makes iOS
 *     offer to save it in Keychain and autofill it later; without it the student
 *     re-types a 12+ character passphrase on a touch keyboard every 90 days.
 *   - `autoCapitalize="none"` / `spellCheck={false}`: iOS otherwise capitalizes
 *     the first letter and "corrects" the rest, producing a wrong passphrase that
 *     looks right.
 *   - `min-h-11` on the input and button keeps both at/above Apple's 44pt touch
 *     target.
 *   - A full page load (`window.location.assign`) rather than a client router
 *     push: the session cookie was just set by the response, and a hard
 *     navigation guarantees the protected page is fetched WITH it.
 */
export default function LoginForm({ next }: { next: string }) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Gagal masuk. Coba lagi.");
        setBusy(false);
        return;
      }
      window.location.assign(next);
    } catch {
      setError("Tidak bisa menghubungi server. Periksa koneksi, lalu coba lagi.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label htmlFor="passphrase" className="block text-sm font-medium">
        Kata sandi
      </label>
      <input
        id="passphrase"
        name="passphrase"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        className="tap min-h-11 w-full rounded-card border border-border bg-card px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-900"
      />
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || passphrase.length === 0}
        className="tap min-h-11 w-full rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
      >
        {busy ? "Memeriksa…" : "Masuk"}
      </button>
      <p className="text-xs text-muted">
        Tidak ada pendaftaran. Akun dibuat manual oleh pemilik aplikasi.
      </p>
    </form>
  );
}
