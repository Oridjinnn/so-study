"use client";

// PracticeStep — the "Latihan" tab, now a single linear core loop instead of a
// nested 6-destination sub-tab list. The primary content (Pilihan Ganda → Esai →
// Evaluasi diri → Nilai) is always visible, and the advanced/optional features
// live in a collapsed accordion below (AdvancedPractice) so they don't compete
// with the flow a first-time student needs to find first.

import { useState } from "react";
import type { AssessmentAttempt, ModuleDetail } from "../lib/types";
import type { CalibrationStats } from "./CalibrationPanel";
import MCQStep from "./MCQStep";
import EssayStep from "./EssayStep";
import EvaluasiDiriStep from "./EvaluasiDiriStep";
import NilaiStep from "./NilaiStep";
import AdvancedPractice from "./AdvancedPractice";

type Props = {
  detail: ModuleDetail;
  online: boolean;
  courseId?: string;
  closedBook: boolean;
  setClosedBook: (v: boolean) => void;
  stats: CalibrationStats;
  attempts: AssessmentAttempt[];
  attemptsLoading: boolean;
  recordAttempts: (
    items: {
      questionType: "mcq" | "essay";
      itemRef: string;
      prompt: string;
      response?: string;
      isCorrect?: boolean;
      score?: number;
      confidence?: number;
    }[],
  ) => Promise<void>;
  onGraded: () => void;
  postJSON: (url: string, body: unknown) => Promise<Record<string, unknown>>;
  onError: (msg: string | null) => void;
  onStatus: (msg: string) => void;
};

export default function PracticeStep({
  detail,
  online,
  courseId,
  closedBook,
  setClosedBook,
  stats,
  attempts,
  attemptsLoading,
  recordAttempts,
  onGraded,
  postJSON,
  onError,
  onStatus,
}: Props) {
  const [mcqScore, setMcqScore] = useState<string | null>(null);
  const [mcqGraded, setMcqGraded] = useState(false);
  const [feedback, setFeedback] = useState("");

  return (
    <section id="panel-test" role="tabpanel" aria-labelledby="tab-test" className="space-y-5">
      <label className="flex items-center gap-2 rounded-card bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <input
          type="checkbox"
          checked={closedBook}
          onChange={(e) => setClosedBook(e.target.checked)}
          className="h-4 w-4 accent-amber-600"
        />
        <span>
          <strong>Mode tertutup</strong> — semua bahan rujukan disembunyikan saat menjawab (Baca,
          Tanya, &amp; Sumber tidak bisa dibuka). Retrieval practice dari memori adalah cara belajar
          paling efektif (Agarwal dkk.). Jangan buka tab lain sampai selesai.
        </span>
      </label>

      {/* Desirable difficulty has a ceiling: sustained failure is a signal to
          re-scaffold, not to push harder items (Bjork & Bjork 2020). */}
      {stats.needsScaffolding && (
        <div
          role="status"
          className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <strong>Terlalu sulit sekarang.</strong> Akurasi {stats.recentAccuracyPct}% dari{" "}
          {stats.recentScored} latihan terakhir. Coba baca ulang bagian yang paling sering salah,
          lalu buat 2–3 kartu sendiri di <strong>Pilihan Ganda</strong> (bank soal) dengan
          kata-kata Anda sebelum lanjut ke soal yang lebih berat.
        </div>
      )}

      <MCQStep
        detail={detail}
        online={online}
        postJSON={postJSON}
        recordAttempts={recordAttempts}
        onError={onError}
        onStatus={onStatus}
        onResult={(score, graded) => {
          setMcqScore(score);
          setMcqGraded(graded);
        }}
      />

      <EssayStep
        detail={detail}
        online={online}
        postJSON={postJSON}
        recordAttempts={recordAttempts}
        onError={onError}
        onStatus={onStatus}
        onFeedback={setFeedback}
      />

      <EvaluasiDiriStep
        topicTitle={detail.topicTitle}
        attempts={attempts}
        attemptsLoading={attemptsLoading}
      />

      <NilaiStep
        mcqScore={mcqScore}
        mcqGraded={mcqGraded}
        feedback={feedback}
        attempts={attempts}
        stats={stats}
      />

      <AdvancedPractice
        moduleId={detail.id}
        topicId={detail.topicId}
        topicTitle={detail.topicTitle}
        courseId={courseId}
        onGraded={onGraded}
      />
    </section>
  );
}
