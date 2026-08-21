"use client";

// Evaluasi diri — merges the two "reflect on how you did" panels (CalibrationPanel
// + MetacogPanel) under one plain-language heading. They keep distinct data
// sources — calibration aggregates persisted attempts (confidence vs correctness),
// metacognition is localStorage self-reflection — so they remain two components
// inside one combined panel rather than being force-merged into a single model.

import type { AssessmentAttempt } from "../lib/types";
import CalibrationPanel from "./CalibrationPanel";
import MetacogPanel from "./MetacogPanel";

type Props = {
  topicTitle: string;
  attempts: AssessmentAttempt[];
  attemptsLoading: boolean;
};

export default function EvaluasiDiriStep({ topicTitle, attempts, attemptsLoading }: Props) {
  return (
    <section
      id="step-evaluasi-diri"
      aria-labelledby="step-evaluasi-diri-title"
      className="space-y-4"
    >
      <div className="rounded-card border border-border bg-card p-5">
        <h3 id="step-evaluasi-diri-title" className="font-semibold">
          3. Evaluasi diri
        </h3>
        <p className="mt-1 text-sm text-muted">
          Renungkan seberapa yakin Anda tadi, lalu cocokkan dengan hasil sebenarnya. Dua cara ini
          membantu mendeteksi ilusi paham sebelum lanjut ke materi berikutnya.
        </p>
      </div>

      <CalibrationPanel attempts={attempts} loading={attemptsLoading} />
      <MetacogPanel topicTitle={topicTitle} />
    </section>
  );
}
