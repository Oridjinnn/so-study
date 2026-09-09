"use client";

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
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [mcqScore, setMcqScore] = useState<string | null>(null);
  const [mcqBusy, setMcqBusy] = useState(false);
  const [bankReloadKey, setBankReloadKey] = useState(0);
  const [questionCount, setQuestionCount] = useState(5);
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
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      onError(`Gagal menyimpan ${failed} soal ke bank soal.`);
    }
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
      const data = await postJSON("/api/mcq", {
        text: detail.contentMarkdown,
        count: questionCount,
      });
      const questions = (data.questions ?? []) as MCQQuestion[];
      const source = (data.generatedBy as string) ?? null;
      setMcqs(questions);
      setPicks({});
      setRevealed({});
      setSkipped({});
      recordedRef.current = new Set();
      setMcqScore(null);
      onResult?.(null, false);
      const sourceLabel = source === "llm" ? "LLM" : "deterministik";
      onStatus(`${questions.length} soal siap dijawab. (sumber: ${sourceLabel})`);
      void persistAIQuestions(questions);
    } catch (e) {
      onError((e as Error).message);
      onStatus("");
    } finally {
      setMcqBusy(false);
    }
  }

  function handleChoose(q: MCQQuestion, opt: string) {
    if (picks[q.id] != null || skipped[q.id]) return;
    setPicks((p) => ({ ...p, [q.id]: opt }));
  }

  function handleCheckAnswer(q: MCQQuestion) {
    if (picks[q.id] == null || revealed[q.id]) return;
    const newRevealed = { ...revealed, [q.id]: true };
    setRevealed(newRevealed);
    if (!recordedRef.current.has(q.id)) {
      recordedRef.current.add(q.id);
      const isCorrect = picks[q.id] === q.answer;
      void recordAttempts([
        { questionType: "mcq", itemRef: q.id, prompt: q.stem, isCorrect },
      ]);
    }
    const revealedQuestions = mcqs.filter((m) => newRevealed[m.id]);
    const correctCount = revealedQuestions.filter(
      (m) => picks[m.id] === m.answer,
    ).length;
    const answeredCount = revealedQuestions.length;
    const allDone = mcqs.every(
      (m) => newRevealed[m.id] || skipped[m.id],
    );
    const score =
      answeredCount > 0 ? `${correctCount}/${answeredCount}` : null;
    setMcqScore(score);
    onResult?.(score, allDone);

    setTimeout(() => {
      const currentIdx = mcqs.findIndex((m) => m.id === q.id);
      const nextQ = mcqs[currentIdx + 1];
      if (nextQ && !revealed[nextQ.id] && !skipped[nextQ.id]) {
        document
          .getElementById(`question-${nextQ.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 1200);
  }

  function handleSkip(q: MCQQuestion) {
    if (picks[q.id] != null || revealed[q.id] || skipped[q.id]) return;
    const newSkipped = { ...skipped, [q.id]: true };
    setSkipped(newSkipped);
    setPicks((p) => {
      const next = { ...p };
      delete next[q.id];
      return next;
    });
    const revealedQuestions = mcqs.filter((m) => revealed[m.id]);
    const correctCount = revealedQuestions.filter(
      (m) => picks[m.id] === m.answer,
    ).length;
    const answeredCount = revealedQuestions.length;
    const allDone = mcqs.every(
      (m) => revealed[m.id] || newSkipped[m.id],
    );
    const score =
      answeredCount > 0 ? `${correctCount}/${answeredCount}` : null;
    setMcqScore(score);
    onResult?.(score, allDone);
  }

  const revealedCount = mcqs.filter((q) => revealed[q.id]).length;
  const skippedCount = mcqs.filter((q) => skipped[q.id]).length;
  const progressPct =
    mcqs.length > 0 ? (revealedCount / mcqs.length) * 100 : 0;
  const allDone =
    mcqs.length > 0 &&
    mcqs.every((q) => revealed[q.id] || skipped[q.id]);

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
        Latihan menjawab (bukan sekadar membaca ulang) adalah cara belajar paling
        kuat: riset menunjukkan mengambil kembali pengetahuan dari memori
        meningkatkan retensi jangka panjang jauh lebih baik daripada membaca ulang
        atau membuat peta konsep.
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={doMCQ}
            disabled={mcqBusy}
            className={PRIMARY_CLASS}
          >
            {mcqBusy ? "Membuat…" : "Buat soal"}
          </button>
          <select
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            className="tap h-11 rounded-card border border-border bg-card px-2 text-center text-sm focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800"
            aria-label="Jumlah soal"
          >
            <option value={3}>3 soal</option>
            <option value={5}>5 soal</option>
            <option value={10}>10 soal</option>
          </select>
        </div>
        {mcqs.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              Skor: {mcqScore ?? "0/0"}
            </span>
            <div
              className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
              role="progressbar"
              aria-valuenow={revealedCount}
              aria-valuemin={0}
              aria-valuemax={mcqs.length}
            >
              <div
                className="h-full bg-brand-600 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-muted">
              {revealedCount}/{mcqs.length}
            </span>
          </div>
        )}
      </div>

      {mcqBusy && mcqs.length === 0 ? (
        <MCQSkeleton count={questionCount} />
      ) : mcqs.length === 0 ? (
        <p className="text-sm text-muted">
          Belum ada soal. Tekan <strong>Buat soal</strong> saat Anda siap diuji —
          soal dibuat dari isi modul ini dan ikut tersimpan ke bank soal.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {mcqs.map((q, idx) => {
            const picked = picks[q.id];
            const isRevealed = revealed[q.id];
            const isSkipped = skipped[q.id];
            const isAnswered = isRevealed || isSkipped;
            return (
              <div
                key={q.id}
                id={`question-${q.id}`}
                className={`rounded-card bg-zinc-50 p-3 dark:bg-zinc-800/40 ${
                  isSkipped ? "opacity-60" : ""
                } ${isRevealed ? "border-l-4 border-l-brand-600" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs text-muted" aria-hidden="true">
                    {isSkipped ? "⏭" : isRevealed ? "✓" : "○"}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      Soal {idx + 1}/{mcqs.length}: {q.stem}
                    </p>
                    <MCQOptions
                      options={q.options}
                      picked={picked}
                      revealed={isRevealed}
                      skipped={isSkipped}
                      answer={q.answer}
                      onChoose={(opt) => handleChoose(q, opt)}
                      disabled={isAnswered}
                      name={q.id}
                    />
                    {!isRevealed && picked && !isSkipped && (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleCheckAnswer(q)}
                          className="tap rounded-card bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                        >
                          Periksa jawaban
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSkip(q)}
                          className="tap rounded-card border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
                        >
                          Tunda
                        </button>
                      </div>
                    )}
                    {isRevealed && q.explanation && (
                      <p className="mt-2 text-xs text-muted">
                        {q.explanation}
                      </p>
                    )}
                    {isSkipped && (
                      <p className="mt-2 text-xs text-muted">
                        Soal ini ditunda.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {allDone && (
        <div className="mt-4 rounded-card border border-border bg-card p-4">
          <p className="text-sm font-semibold">Skor akhir: {mcqScore}</p>
          <p className="mt-1 text-xs text-muted">
            {skippedCount > 0
              ? `${skippedCount} soal ditunda dan tidak memengaruhi skor.`
              : "Semua soal telah dijawab."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPicks({});
                setRevealed({});
                setSkipped({});
                recordedRef.current = new Set();
                setMcqScore(null);
                onResult?.(null, false);
              }}
              className="tap rounded-card border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
            >
              Ulangi soal yang salah
            </button>
            <button
              type="button"
              onClick={doMCQ}
              className="tap rounded-card bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              Buat soal baru
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Lanjut ke Esai</p>
        </div>
      )}

      {mcqs.length > 0 && !allDone && (
        <p role="status" aria-live="polite" className="mt-3 text-sm">
          <span className="text-muted">
            {revealedCount}/{mcqs.length} terjawab{" "}
            {skippedCount > 0 && `· ${skippedCount} ditunda`}
          </span>
        </p>
      )}

      {mcqs.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          Pilih jawaban lalu tekan &quot;Periksa jawaban&quot; untuk melihat
          hasil. Opsi terkunci setelah dijawab.
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
