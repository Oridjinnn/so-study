"use client";

// Prequestions (the "pretesting effect"): before the module reader unlocks, the
// student answers a handful of questions they cannot yet know. Guessing wrong is
// not a penalty — being wrong is what primes attention for the passage that
// follows, so the score is shown but never stored as graded study.
//
// Evidence:
//   - Richland, Kornell & Kao (2009), "Can unsuccessful tests enhance learning?"
//     J. Exp. Psychol. Appl. — unsuccessful retrieval before study still helps.
//   - Pan & Carpenter (2023), Educ. Psychol. Rev. — pretesting review; benefits
//     hold for related and unrelated material when feedback follows.
//
// One gate per topic: the localStorage flag below makes it a warm-up, not a toll
// booth on every visit.

import { useEffect, useState } from "react";
import type { QuestionBankItem } from "../lib/types";
import MCQOptions from "./MCQOptions";

/** How many prequestions to draw from the topic's bank. */
export const PRETEST_COUNT = 5;

export function pretestKey(topicId: string): string {
  return `pretest:${topicId}`;
}

/** Has this topic's pretest already been taken (or skipped) on this device? */
export function hasTakenPretest(topicId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(pretestKey(topicId)) != null;
  } catch {
    // Storage blocked (Safari private mode): do not trap the reader behind a
    // gate we can never remember dismissing.
    return true;
  }
}

function markTaken(topicId: string, outcome: { score: number; total: number } | "skipped"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      pretestKey(topicId),
      JSON.stringify({ at: new Date().toISOString(), outcome }),
    );
  } catch {
    /* handled: the gate simply re-appears next time storage is unavailable */
  }
}

/** Fisher–Yates on a copy; the draw should differ per visit, so Math.random. */
function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function PretestGate({
  topicId,
  onDone,
}: {
  topicId: string;
  /** Called once the student finishes or skips; unlocks the reader. */
  onDone: () => void;
}) {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [graded, setGraded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/questions?topicId=${encodeURIComponent(topicId)}`)
      .then((r) => r.json())
      .then((data: { items?: QuestionBankItem[]; error?: string }) => {
        if (cancelled) return;
        if (!data.items) {
          setError(data.error ?? "Gagal memuat prequestion.");
        } else {
          setItems(shuffle(data.items).slice(0, PRETEST_COUNT));
        }
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  const correct = items.filter((q) => picks[q.id] === q.answer).length;

  function finish(outcome: { score: number; total: number } | "skipped") {
    markTaken(topicId, outcome);
    onDone();
  }

  return (
    <section
      aria-labelledby="pretest-title"
      className="rounded-card border border-border bg-card p-5"
    >
      <h3 id="pretest-title" className="text-lg font-semibold">
        Pra-tes singkat sebelum membaca
      </h3>
      <p className="mt-1 text-sm text-muted">
        Jawab dulu walau belum tahu — menebak <em>salah</em> pun membuat Anda lebih peka pada
        jawabannya saat membaca (Richland dkk. 2009; Pan &amp; Carpenter 2023). Tidak ada nilai
        yang disimpan.
      </p>

      <p role="status" aria-live="polite" className="sr-only">
        {graded ? `Skor pra-tes ${correct} dari ${items.length}.` : ""}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-3 text-sm text-muted">Menyiapkan prequestion…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Belum ada soal untuk topik ini, jadi tidak ada prequestion. Setelah membaca, buat
          beberapa soal sendiri di <strong>Latihan → Pilihan Ganda</strong> supaya pra-tes berikutnya
          bisa dipakai.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {items.map((q, idx) => {
            const chosen = picks[q.id] ?? null;
            return (
              <li key={q.id} className="rounded-card bg-zinc-50 p-3 dark:bg-zinc-800/40">
                <p className="text-sm font-medium">
                  {idx + 1}. {q.stem}
                </p>
                <MCQOptions
                  options={q.options}
                  chosen={chosen}
                  answered={graded}
                  answer={q.answer}
                  onChoose={(opt) => setPicks((p) => ({ ...p, [q.id]: opt }))}
                  disabled={graded}
                  name={`pretest-${q.id}`}
                />
                {graded && q.explanation && (
                  <p className="mt-2 text-xs text-muted">{q.explanation}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {graded && (
        <p className="mt-3 text-sm font-semibold">
          Skor pra-tes: {correct}/{items.length} — sekarang baca modulnya dan perhatikan bagian
          yang tadi Anda tebak salah.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {items.length > 0 && !graded && (
          <button
            type="button"
            onClick={() => setGraded(true)}
            className="tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            Periksa jawaban
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            finish(graded || items.length === 0 ? { score: correct, total: items.length } : "skipped")
          }
          className={`tap min-h-11 rounded-card px-4 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
            graded || items.length === 0
              ? "bg-brand-600 text-white hover:bg-brand-700"
              : "border border-border text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {graded || items.length === 0 ? "Lanjut ke modul" : "Lewati pra-tes"}
        </button>
      </div>
    </section>
  );
}
