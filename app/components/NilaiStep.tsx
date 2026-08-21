"use client";

// Nilai / hasil — surfaces the scores directly (the "then scores are visible"
// step from the product spec) instead of burying them inside ReviewQueue. Shows
// the session's MCQ score and essay feedback plus the running accuracy from the
// attempt history. Uses Markdown for the AI essay feedback so it renders like
// the rest of the reader.

import type { AssessmentAttempt } from "../lib/types";
import type { CalibrationStats } from "./CalibrationPanel";
import Markdown from "../lib/markdown";

type Props = {
  mcqScore: string | null;
  mcqGraded: boolean;
  feedback: string;
  attempts: AssessmentAttempt[];
  stats: CalibrationStats;
};

export default function NilaiStep({ mcqScore, mcqGraded, feedback, attempts, stats }: Props) {
  const hasAnything = mcqGraded || feedback.trim().length > 0 || stats.scored > 0;

  return (
    <section
      id="step-nilai"
      aria-labelledby="step-nilai-title"
      className="rounded-card border border-border bg-card p-5"
    >
      <h3 id="step-nilai-title" className="font-semibold">
        4. Nilai &amp; hasil
      </h3>

      {!hasAnything ? (
        <p className="mt-2 text-sm text-muted">
          Belum ada nilai. Kerjakan Pilihan Ganda dan Esai di atas, lalu kembali ke sini untuk
          melihat hasilnya.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {mcqGraded && mcqScore && (
            <div className="rounded-card bg-zinc-50 p-3 dark:bg-zinc-800/40">
              <p className="text-sm font-medium">Pilihan ganda</p>
              <p className="mt-1 font-semibold" role="status" aria-live="polite">
                Skor: {mcqScore}
              </p>
            </div>
          )}

          {feedback.trim().length > 0 && (
            <div>
              <p className="text-sm font-medium">Umpan balik esai</p>
              <article className="mt-1 rounded-card border border-border bg-zinc-50 p-4 reader-prose dark:bg-zinc-800/40">
                <Markdown text={feedback} />
              </article>
            </div>
          )}

          <div className="rounded-card bg-zinc-50 p-3 dark:bg-zinc-800/40">
            <p className="text-sm font-medium">Akurasi latihan</p>
            <p className="mt-1 text-sm">
              {stats.accuracyPct == null
                ? "Belum ada riwayat latihan bernilai."
                : `Akurasi keseluruhan ${stats.accuracyPct}% dari ${stats.scored} latihan.`}
            </p>
            {stats.recentAccuracyPct != null && (
              <p className="mt-1 text-xs text-muted">
                {stats.recentScored} latihan terakhir: {stats.recentAccuracyPct}%
              </p>
            )}
            {attempts.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                Ulasan terjadwal (spaced repetition) ada di bagian “Latihan lanjutan” di bawah.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
