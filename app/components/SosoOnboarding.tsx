"use client";

import { useState } from "react";
import { withViewTransition } from "../lib/viewTransition";
import { splitCourseNames } from "./CourseBatchImport";
import { apiFetch } from "../lib/api";

const PROFILE_KEY = "soso.profile";

type SosoProfile = { name?: string; university?: string };

function readProfile(): SosoProfile {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") as SosoProfile;
  } catch {
    return {};
  }
}

function writeProfile(patch: Partial<SosoProfile>) {
  const next = { ...readProfile(), ...patch };
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — non-fatal, the greeting just won't persist */
  }
}

/**
 * First-run onboarding wizard ("Soso"). Replaces the old empty-state landing.
 *
 * Screen 0 — ask the student's name (OPTIONAL). Personalization-only metadata,
 *   stored client-side on the same `soso.profile` object as `university`.
 * Screen 1 — Soso intro (personalized with the name when present) + an OPTIONAL
 *   university field. Both values are personalization-only: stored client-side,
 *   never used to fetch or look anything up. No DB table (per the rule about not
 *   inventing one when settings already live client-side). The university field
 *   is deliberately cosmetic — no scraper/lookup is attached to it (see
 *   CHANGELOG decision log).
 * Screen 2 — batch course entry. Reuses the existing POST /api/courses batch
 *   path (no parallel create logic) and the shared `major` the rest of the app
 *   relies on for retrieval/synthesis quality.
 * Screen 3 — there is none. On submit the courses exist and the parent routes
 *   straight into the normal dashboard.
 *
 * Visibility is decided by the parent on course count (zero courses == first
 * run), not a flag, so returning users never get re-onboarded.
 */
export default function SosoOnboarding({ onFinished }: { onFinished: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  /**
   * Screen changes cross-fade natively where supported (see
   * app/lib/viewTransition.ts) and swap instantly elsewhere — the wizard is the
   * first thing a new student sees, so it should not feel like a page reload.
   */
  const goToStep = (next: 0 | 1 | 2) => withViewTransition(() => setStep(next));
  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [coursesText, setCoursesText] = useState("");
  const [major, setMajor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const uni = university.trim();
  const names = splitCourseNames(coursesText);

  function goToUniversity() {
    if (trimmedName) writeProfile({ name: trimmedName });
    setError(null);
    goToStep(1);
  }

  function goToCourses() {
    if (uni) writeProfile({ university: uni });
    setError(null);
    goToStep(2);
  }

  async function submit() {
    if (names.length === 0) {
      setError("Tulis minimal satu nama mata kuliah.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, major: major.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onFinished();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center px-5 py-10">
        <div key={step} className="soso-fade">
          {step === 0 ? (
            <section aria-labelledby="soso-name">
              <h1 id="soso-name" className="text-3xl font-bold tracking-tight">
                Siapa namamu?
              </h1>
              <p className="mt-3 text-base leading-relaxed text-muted">
                Biar Soso bisa panggil kamu dengan namamu!
              </p>

              <label htmlFor="soso-name-input" className="mt-8 block text-sm font-medium">
                Nama kamu <span className="font-normal text-muted">(opsional)</span>
              </label>
              <input
                id="soso-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mis. Budi"
                className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />

              <button
                type="button"
                onClick={goToUniversity}
                className="tap mt-6 min-h-11 rounded-card bg-brand-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                Lanjut
              </button>
            </section>
          ) : step === 1 ? (
            <section aria-labelledby="soso-welcome">
              <h1 id="soso-welcome" className="text-3xl font-bold tracking-tight">
                {trimmedName ? `Halo ${trimmedName}, aku Soso!` : "Halo, aku Soso!"}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-muted">
                Senang kenal! Aku bantu kamu dapat kerangka materi sebelum kuliah mulai — head-start,{" "}
                <strong>bukan</strong> pengganti kuliah. Datang ke kelas sudah punya kerangka,
                jadi waktunya dipakai untuk mendalami, bukan mulai dari nol. Kita belajar bareng-bareng, ya!
              </p>

              <label htmlFor="soso-university" className="mt-8 block text-sm font-medium">
                Nama universitas <span className="font-normal text-muted">(opsional)</span>
              </label>
              <input
                id="soso-university"
                value={university}
                onChange={(e) => setUniversity(e.target.value)}
                placeholder="mis. Universitas Gadjah Mada"
                className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
              <p className="mt-1 text-xs text-muted">
                Cuma buat sapaan, bukan buat ambil RPS otomatis — itu nanti kamu masukkan
                sendiri per mata kuliah.
              </p>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    goToStep(0);
                  }}
                  className="tap min-h-11 rounded-card px-4 py-2 text-sm text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
                >
                  ← Kembali
                </button>
                <button
                  type="button"
                  onClick={goToCourses}
                  className="tap flex-1 rounded-card bg-brand-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  Lanjut
                </button>
              </div>
            </section>
          ) : (
            <section aria-labelledby="soso-courses">
                <h1 id="soso-courses" className="text-2xl font-bold tracking-tight">
                {uni ? `Siap, ${uni}! ` : ""}
                Masukkan mata kuliah kamu di semester ini, yuk!
              </h1>
              <p className="mt-2 text-sm text-muted">
                Tempel daftar mata kuliah semester ini sekaligus — satu per baris atau
                dipisah koma.
              </p>

              <label htmlFor="soso-courses-input" className="mt-5 block text-sm font-medium">
                Daftar mata kuliah
              </label>
              <textarea
                id="soso-courses-input"
                value={coursesText}
                onChange={(e) => setCoursesText(e.target.value)}
                rows={8}
                placeholder={
                  "Teori Antropologi Kontemporer\nAntropologi Ekologi\nEtnografi dan Metode Lapangan"
                }
                className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />

              <label htmlFor="soso-major" className="mt-3 block text-sm font-medium">
                Jurusan <span className="font-normal text-muted">(opsional, berlaku untuk semua)</span>
              </label>
              <input
                id="soso-major"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                placeholder="mis. Antropologi"
                className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
              <p className="mt-1 text-xs text-muted">
                Jurusan mengarahkan pencarian paper dan sudut pandang modul.
              </p>

              {error && (
                <p
                  role="alert"
                  className="mt-3 rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                >
                  {error}
                </p>
              )}

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    goToStep(1);
                  }}
                  className="tap min-h-11 rounded-card px-4 py-2 text-sm text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
                >
                  ← Kembali
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || names.length === 0}
                  className="tap min-h-11 flex-1 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
                >
                  {busy ? "Membuat mata kuliah…" : "Buat mata kuliah"}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
