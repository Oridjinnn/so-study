"use client";

// Prequestions (the "pretesting effect"): before the module reader unlocks, the
// student answers a handful of questions they cannot yet know. Guessing wrong is
// not a penalty — being wrong is what primes attention for the passage that
// follows, so the score is shown but never stored as graded study.
//
// Rendered as a collapsible banner at the top of the Baca tab so the student
// can still see the reader below while answering.

import { useEffect, useState } from "react";
import type { QuestionBankItem } from "../lib/types";
import { apiFetch } from "../lib/api";
import MCQOptions from "./MCQOptions";

export const PRETEST_COUNT = 5;

export function pretestKey(topicId: string): string {
  return `pretest:${topicId}`;
}

export function hasTakenPretest(topicId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(pretestKey(topicId)) != null;
  } catch {
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
    /* handled */
  }
}

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
  onDone: () => void;
}) {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [graded, setGraded] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/questions?topicId=${encodeURIComponent(topicId)}`)
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
    return () => { cancelled = true; };
  }, [topicId]);

  const correct = items.filter((q) => picks[q.id] === q.answer).length;

  function finish(outcome: { score: number; total: number } | "skipped") {
    markTaken(topicId, outcome);
    setOpen(false);
    onDone();
  }

  const hasQuestions = items.length > 0 && !loading && !error;

  return (
    <div className="rounded-card border border-brand-200 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-950/30 print:hidden">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between gap-2 text-left"
        >
          <h3 className="text-sm font-semibold text-link">Pra-tes singkat sebelum membaca</h3>
          <span className="text-xs text-muted">{open ? "Sembunyikan" : "Tampilkan"}</span>
        </button>
        <button
          type="button"
          onClick={() => finish("skipped")}
          className="ml-3 shrink-0 text-xs text-muted underline-offset-2 hover:underline"
        >
          Lewati pra-tes
        </button>
      </div>

      {open && (
        <div className="border-t border-brand-200 px-4 pb-4 pt-3 dark:border-brand-700">
          <p className="text-xs text-muted">
            Menjawab pertanyaan ini sebelum membaca membantu otak memproses informasi lebih baik.
            <span
              title="Richland, Kornell & Kao (2009) J. Exp. Psychol. Appl.; Pan & Carpenter (2023) Educ. Psychol. Rev."
              className="ml-1 cursor-help underline decoration-dotted underline-offset-2"
            >
              ?
            </span>
          </p>

          <p role="status" aria-live="polite" className="sr-only">
            {graded ? `Skor pra-tes ${correct} dari ${items.length}.` : ""}
          </p>

          {error && (
            <div role="alert" className="mt-3 rounded-card border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <p className="mt-3 text-xs text-muted">Menyiapkan prequestion…</p>
          ) : items.length === 0 ? (
            <p className="mt-3 text-xs text-muted">
              Belum ada soal untuk topik ini. Setelah membaca, buat beberapa soal sendiri di{" "}
              <strong>Latihan → Pilihan Ganda</strong>.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {items.map((q, idx) => {
                const chosen = picks[q.id] ?? null;
                return (
                  <li key={q.id} className="rounded-card bg-white/70 p-2.5 dark:bg-zinc-800/40">
                    <p className="text-xs font-medium">{idx + 1}. {q.stem}</p>
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
                      <p className="mt-1.5 text-[11px] text-muted">{q.explanation}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {graded && (
            <p className="mt-2.5 text-xs font-semibold">
              Skor: {correct}/{items.length} — perhatikan bagian yang Anda tebak salah saat membaca.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {hasQuestions && !graded && (
              <button
                type="button"
                onClick={() => setGraded(true)}
                className="tap min-h-10 rounded-card bg-brand-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                Periksa jawaban
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                finish(graded || !hasQuestions ? { score: correct, total: items.length } : "skipped")
              }
              className={`tap min-h-10 rounded-card px-3.5 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                graded || !hasQuestions
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "border border-border text-muted hover:bg-brand-100 dark:hover:bg-brand-900/40"
              }`}
            >
              {graded || !hasQuestions ? "Lanjut ke modul" : "Lewati pra-tes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
