"use client";

// Pilihan Ganda — the core MCQ step of the Latihan flow. It pairs the on-demand
// generator (Buat soal) with the student's own question bank (the "Bank Soal"
// generation effect), so both live under one plain-language heading instead of
// two jargon sub-tabs.

import { useRef, useState } from "react";
import type { MCQQuestion, ModuleDetail } from "../lib/types";
import { MCQSkeleton } from "./Skeletons";
import MCQOptions from "./MCQOptions";
import QuestionBank from "./QuestionBank";
import { PRIMARY_CLASS } from "./ui";

type Props = {
  detail: ModuleDetail;
  online: boolean;
  postJSON: (url: string, body: unknown) => Promise<Record<string, unknown>>;
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
  onError: (msg: string | null) => void;
  onStatus: (msg: string) => void;
  /** Bubbles the graded score up to the Nilai step. */
  onResult?: (score: string | null, graded: boolean) => void;
};

export default function MCQStep({
  detail,
  online,
  postJSON,
  recordAttempts,
  onError,
  onStatus,
  onResult,
}: Props) {
  const [mcqs, setMcqs] = useState<MCQQuestion[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [mcqScore, setMcqScore] = useState<string | null>(null);
  const [mcqBusy, setMcqBusy] = useState(false);
  const [bankReloadKey, setBankReloadKey] = useState(0);
  // Records which question ids have already been posted as an attempt, so an
  // answered question is graded exactly once (options lock after the first pick).
  const recordedRef = useRef<Set<string>>(new Set());

  async function persistAIQuestions(questions: MCQQuestion[]) {
    const usable = questions.filter(
      (q) => q.options.length >= 2 && q.options.includes(q.answer),
    );
    if (usable.length === 0) return;
    const results = await Promise.allSettled(
      usable.map((q) =>
        postJSON("/api/questions", {
          topicId: detail.topicId,
          moduleId: detail.id,
          stem: q.stem,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation,
          author: "ai",
        }),
      ),
    );
    const saved = results.filter((r) => r.status === "fulfilled").length;
    if (saved > 0) {
      setBankReloadKey((k) => k + 1);
      onStatus(`${saved} soal AI disimpan ke bank soal.`);
    }
  }

  async function doMCQ() {
    if (!online) {
      onError("Membuat soal butuh internet. Sambungkan dulu.");
      return;
    }
    setMcqBusy(true);
    onStatus("Membuat soal…");
    try {
      const data = await postJSON("/api/mcq", { text: detail.contentMarkdown, count: 5 });
      const questions = (data.questions ?? []) as MCQQuestion[];
      setMcqs(questions);
      setPicks({});
      recordedRef.current = new Set();
      setMcqScore(null);
      onResult?.(null, false);
      onStatus(`${questions.length} soal siap dijawab.`);
      void persistAIQuestions(questions);
    } catch (e) {
      onError((e as Error).message);
      onStatus("");
    } finally {
      setMcqBusy(false);
    }
  }

  // Reveal-and-record on first answer: the correct option + explanation appear
  // the moment the student commits a choice, which is the desired feedback
  // timing (immediate, per-question). The choice then locks so they cannot peek
  // and change it.
  function handleChoose(q: MCQQuestion, opt: string) {
    if (picks[q.id] != null) return; // already answered -> locked
    const nextPicks = { ...picks, [q.id]: opt };
    setPicks(nextPicks);
    if (!recordedRef.current.has(q.id)) {
      recordedRef.current.add(q.id);
      const isCorrect = opt === q.answer;
      void recordAttempts([
        { questionType: "mcq", itemRef: q.id, prompt: q.stem, isCorrect },
      ]);
    }
    // Tally from the just-updated picks (the closure `picks` is stale until the
    // next render), so the live score reflects this pick immediately.
    const correct = mcqs.filter((m) => nextPicks[m.id] === m.answer).length;
    const answeredCount = mcqs.filter((m) => nextPicks[m.id] != null).length;
    const score = `${correct}/${answeredCount}`;
    setMcqScore(score);
    onResult?.(score, answeredCount === mcqs.length);
  }

  return (
    <section
      id="step-pilihan-ganda"
      aria-labelledby="step-pilihan-ganda-title"
      className="rounded-card border border-border bg-card p-5"
    >
      <h3 id="step-pilihan-ganda-title" className="font-semibold">
        1. Pilihan ganda
      </h3>
      <p className="mt-1 text-sm text-muted">
        Latihan menjawab (bukan sekadar membaca ulang) adalah cara belajar paling kuat: riset
        menunjukkan mengambil kembali pengetahuan dari memori meningkatkan retensi jangka panjang
        jauh lebih baik daripada membaca ulang atau membuat peta konsep.
      </p>

      <div className="mt-3 mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={doMCQ} disabled={mcqBusy} className={PRIMARY_CLASS}>
          {mcqBusy ? "Membuat…" : "Buat soal"}
        </button>
      </div>

      {mcqBusy && mcqs.length === 0 ? (
        <MCQSkeleton />
      ) : mcqs.length === 0 ? (
        <p className="text-sm text-muted">
          Belum ada soal. Tekan <strong>Buat soal</strong> saat Anda siap diuji — soal dibuat dari isi
          modul ini dan ikut tersimpan ke bank soal.
        </p>
      ) : (
        mcqs.map((q) => {
          const chosen = picks[q.id];
          const answered = chosen != null;
          return (
            <div key={q.id} className="mt-3 rounded-card bg-zinc-50 p-3 dark:bg-zinc-800/40">
              <p className="text-sm font-medium">{q.stem}</p>
              <MCQOptions
                options={q.options}
                chosen={chosen}
                answered={answered}
                answer={q.answer}
                onChoose={(opt) => handleChoose(q, opt)}
                disabled={answered}
                name={q.id}
              />
              {answered && q.explanation && (
                <p className="mt-2 text-xs text-muted">{q.explanation}</p>
              )}
            </div>
          );
        })
      )}

      {mcqs.length > 0 && (
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          {mcqs.every((q) => picks[q.id] != null) ? (
            <span className="font-semibold">Skor akhir: {mcqScore}</span>
          ) : (
            <span className="text-muted">
              Skor sementara: {mcqScore} · {mcqs.filter((q) => picks[q.id] != null).length}/
              {mcqs.length} terjawab
            </span>
          )}
        </p>
      )}

      {mcqs.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Jawaban & penjelasan muncul begitu Anda memilih — dinilai otomatis dengan kunci
          soal (tanpa AI). Opsi terkunci setelah dijawab.
        </p>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <QuestionBank
          topicId={detail.topicId}
          moduleId={detail.id}
          reloadKey={bankReloadKey}
        />
      </div>
    </section>
  );
}
