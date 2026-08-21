"use client";

// Calibration: predicted vs actual. Students are systematically overconfident
// about what they have "learned" from reading, and the fix is to confront the
// prediction with the outcome:
//   - Nelson & Dunlosky (1991), Psychol. Sci. 2(4): delayed judgments of
//     learning are far better calibrated than immediate ones.
//   - Metcalfe (2009), Curr. Dir. Psychol. Sci.: metacognitive monitoring drives
//     effective study-time allocation.
//   - Thiede, Anderson & Therriault (2003), J. Educ. Psychol.: better monitoring
//     accuracy -> better regulation of restudy.
//
// The panel is read-only: it aggregates the attempts already persisted for the
// topic (self-rated confidence 1..5 vs `isCorrect`) and shows the gap.

import type { AssessmentAttempt } from "../lib/types";

/** Recent-window size for the desirable-difficulty guardrail. */
export const RECENT_WINDOW = 10;
/** Sustained accuracy below this (%) means the items are too hard right now. */
export const SCAFFOLD_THRESHOLD_PCT = 40;
/** Never scaffold on noise: require at least this many scored attempts. */
export const SCAFFOLD_MIN_ATTEMPTS = 5;

export interface CalibrationStats {
  /** Attempts with a boolean outcome (essay attempts are excluded). */
  scored: number;
  /** Scored attempts that also carry a self-rated confidence. */
  rated: number;
  meanConfidence: number | null;
  /** Confidence 1..5 mapped onto 0..100% predicted recall. */
  predictedPct: number | null;
  /** Accuracy over the rated subset, i.e. the honest counterpart to `predictedPct`. */
  actualPct: number | null;
  /** `predictedPct - actualPct`: positive = overconfident. */
  gapPct: number | null;
  /** Accuracy over all scored attempts for this topic. */
  accuracyPct: number | null;
  recentScored: number;
  recentAccuracyPct: number | null;
  /**
   * Desirable difficulty has a ceiling: sustained failure is not productive
   * struggle, it is a signal to re-scaffold (Bjork & Bjork 2020).
   */
  needsScaffolding: boolean;
}

function pct(part: number, whole: number): number {
  return Math.round((part / whole) * 100);
}

/** Confidence 1..5 -> predicted recall 0..100% (1 = "no idea", 5 = "certain"). */
function confidenceToPct(mean: number): number {
  return Math.round(((mean - 1) / 4) * 100);
}

export function calibrationStats(attempts: AssessmentAttempt[]): CalibrationStats {
  // The attempts API orders by schedule, not by time, so sort explicitly:
  // "recent" must mean recent in wall-clock terms.
  const scored = attempts
    .filter((a) => typeof a.isCorrect === "boolean")
    .slice()
    .sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime());

  const rated = scored.filter((a) => typeof a.confidence === "number");
  const meanConfidence =
    rated.length > 0
      ? rated.reduce((sum, a) => sum + (a.confidence ?? 0), 0) / rated.length
      : null;
  const ratedCorrect = rated.filter((a) => a.isCorrect === true).length;
  const actualPct = rated.length > 0 ? pct(ratedCorrect, rated.length) : null;
  const predictedPct = meanConfidence != null ? confidenceToPct(meanConfidence) : null;

  const correct = scored.filter((a) => a.isCorrect === true).length;
  const accuracyPct = scored.length > 0 ? pct(correct, scored.length) : null;

  const recent = scored.slice(0, RECENT_WINDOW);
  const recentCorrect = recent.filter((a) => a.isCorrect === true).length;
  const recentAccuracyPct = recent.length > 0 ? pct(recentCorrect, recent.length) : null;

  return {
    scored: scored.length,
    rated: rated.length,
    meanConfidence,
    predictedPct,
    actualPct,
    gapPct: predictedPct != null && actualPct != null ? predictedPct - actualPct : null,
    accuracyPct,
    recentScored: recent.length,
    recentAccuracyPct,
    needsScaffolding:
      recent.length >= SCAFFOLD_MIN_ATTEMPTS &&
      recentAccuracyPct != null &&
      recentAccuracyPct < SCAFFOLD_THRESHOLD_PCT,
  };
}

function Bar({ label, value, tone }: { label: string; value: number; tone: "predicted" | "actual" }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted">{value}%</span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${value} persen`}
        className="mt-1 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div
          className={`h-full rounded-full ${tone === "predicted" ? "bg-brand-600" : "bg-emerald-500"}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export default function CalibrationPanel({
  attempts,
  loading = false,
}: {
  attempts: AssessmentAttempt[];
  loading?: boolean;
}) {
  const stats = calibrationStats(attempts);

  const verdict =
    stats.gapPct == null
      ? null
      : stats.gapPct >= 10
        ? "Anda cenderung terlalu percaya diri: rasa yakin lebih tinggi daripada hasil sebenarnya. Uji diri lagi sebelum menyatakan paham."
        : stats.gapPct <= -10
          ? "Anda meremehkan diri sendiri: hasil Anda lebih baik daripada rasa yakin. Percayai proses, lanjutkan ke materi berikut."
          : "Kalibrasi Anda cukup baik: rasa yakin sejalan dengan hasil.";

  return (
    <section
      aria-labelledby="calibration-title"
      className="space-y-3 rounded-card border border-border bg-card p-5"
    >
      <div>
        <h3 id="calibration-title" className="font-semibold">
          Kalibrasi: perkiraan vs kenyataan
        </h3>
        <p className="mt-1 text-sm text-muted">
          Membandingkan rasa yakin Anda (1–5 saat menilai ingatan) dengan jawaban yang benar-benar
          benar. Selisih besar = ilusi paham (Nelson &amp; Dunlosky 1991; Metcalfe 2009).
        </p>
      </div>

      {loading ? (
        <p role="status" className="text-sm text-muted">
          Memuat riwayat latihan…
        </p>
      ) : stats.rated < 3 ? (
        <p className="text-sm text-muted">
          Belum cukup data ({stats.rated} dari 3 latihan bernilai). Kerjakan beberapa soal dan beri
          penilaian ingatan (Lagi/Sulit/Bagus/Mudah) untuk melihat kalibrasi Anda.
        </p>
      ) : (
        <div className="space-y-3">
          <Bar label="Perkiraan (rasa yakin)" value={stats.predictedPct ?? 0} tone="predicted" />
          <Bar label="Kenyataan (jawaban benar)" value={stats.actualPct ?? 0} tone="actual" />
          <p className="text-sm">{verdict}</p>
          <p className="text-xs text-muted">
            Dari {stats.scored} latihan bernilai ({stats.rated} disertai penilaian ingatan) · rata-rata
            rasa yakin {stats.meanConfidence?.toFixed(1)}/5 · akurasi keseluruhan{" "}
            {stats.accuracyPct ?? 0}%
          </p>
        </div>
      )}
    </section>
  );
}
