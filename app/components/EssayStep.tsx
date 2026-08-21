"use client";

// Esai — the second step of the Latihan core loop. Surfaced as its own clearly
// labelled step (previously buried inside the "Latihan" practice sub-tab) so a
// first-time student can find it without hunting through jargon sub-tabs.

import { useEffect, useRef, useState } from "react";
import type { ModuleDetail } from "../lib/types";
import Markdown from "../lib/markdown";
import { INPUT_CLASS, PRIMARY_CLASS } from "./ui";
import { loadDraft, saveDraft as persistDraft } from "../lib/draftStore";

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
  /** Bubbles the essay feedback up to the Nilai step. */
  onFeedback?: (fb: string) => void;
};

export default function EssayStep({
  detail,
  online,
  postJSON,
  recordAttempts,
  onError,
  onStatus,
  onFeedback,
}: Props) {
  const [qText, setQText] = useState(detail.essayPrompt ?? "");
  const [hasEssay, setHasEssay] = useState(Boolean(detail.essayPrompt));
  const [essayBusy, setEssayBusy] = useState(false);
  const [studentAnswer, setStudentAnswer] = useState<string>("");
  const [rubric, setRubric] = useState(detail.essayRubric ?? "");
  const [feedback, setFeedback] = useState("");
  const [grading, setGrading] = useState(false);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    let cancelled = false;
    void loadDraft(detail.topicId).then((text) => {
      if (!cancelled) {
        setStudentAnswer((prev) => (prev === "" ? text : prev));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detail.topicId]);

  function saveDraft(v: string) {
    setStudentAnswer(v);
    void persistDraft(detail.topicId, v);
  }

  async function regenerateEssay() {
    if (!online) {
      onError("Butuh internet untuk membuat ulang pertanyaan esai.");
      return;
    }
    setEssayBusy(true);
    onStatus("Membuat ulang pertanyaan esai…");
    try {
      const data = await postJSON("/api/essay", {
        moduleId: detail.id,
        topicId: detail.topicId,
      });
      if (data.essayPrompt) {
        setQText(data.essayPrompt as string);
        setHasEssay(true);
        onStatus("Pertanyaan esai dibuat.");
      } else {
        onStatus("");
        onError("Gagal membuat pertanyaan esai — coba lagi.");
      }
    } catch (e) {
      onError((e as Error).message);
      onStatus("");
    } finally {
      setEssayBusy(false);
    }
  }

  async function doGrade() {
    if (!studentAnswer.trim()) {
      onError("Tulis jawaban dulu.");
      return;
    }
    if (!online) {
      onError("Penilaian butuh internet. Sambungkan dulu.");
      return;
    }
    setGrading(true);
    onStatus("Menilai esai…");
    try {
      const data = await postJSON("/api/grade", {
        questionText: qText,
        studentAnswer,
        rubric,
        topicId: detail.topicId,
      });
      setFeedback(data.feedback as string);
      onFeedback?.(data.feedback as string);
      onStatus("Umpan balik esai siap.");
      void recordAttempts([
        { questionType: "essay", itemRef: "essay", prompt: qText, response: studentAnswer },
      ]);
    } catch (e) {
      onError((e as Error).message);
      onStatus("");
    } finally {
      setGrading(false);
    }
  }

  return (
    <section
      id="step-esai"
      aria-labelledby="step-esai-title"
      className="rounded-card border border-border bg-card p-5"
    >
      <h3 id="step-esai-title" className="font-semibold">
        2. Esai
      </h3>
      {hasEssay ? (
        <>
          <p className="mt-2 text-xs text-muted">
            Pertanyaan ini disusun dari kerangka 5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) berdasarkan modul ini.
          </p>
          <textarea
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            rows={4}
            placeholder="Pertanyaan esai"
            className={`mt-2 ${INPUT_CLASS}`}
          />
        </>
      ) : (
        <div
          role="alert"
          className="mt-2 rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"
        >
          Gagal membuat pertanyaan esai — coba lagi.
          <button
            type="button"
            onClick={regenerateEssay}
            disabled={essayBusy || !online}
            className={`mt-2 block ${PRIMARY_CLASS}`}
          >
            {essayBusy ? "Membuat…" : "Coba lagi"}
          </button>
        </div>
      )}
      <textarea
        value={studentAnswer}
        onChange={(e) => saveDraft(e.target.value)}
        rows={5}
        placeholder="Jawaban Anda (tersimpan otomatis)"
        className={`mt-2 ${INPUT_CLASS}`}
      />
      <textarea
        value={rubric}
        onChange={(e) => setRubric(e.target.value)}
        rows={2}
        placeholder="Rubrik (opsional)"
        className={`mt-2 ${INPUT_CLASS}`}
      />
      <button
        type="button"
        onClick={doGrade}
        disabled={grading}
        className={`mt-3 ${PRIMARY_CLASS}`}
      >
        {grading ? "Menilai…" : "Nilai esai"}
      </button>
      {feedback && (
        <article className="mt-3 rounded-card border border-border bg-zinc-50 p-4 dark:bg-zinc-800/40">
          <Markdown text={feedback} />
        </article>
      )}
      {feedback && (
        <p className="mt-1 text-xs text-muted">
          Esai dinilai AI memakai rubrik di atas — umpan balik, bukan nilai resmi.
        </p>
      )}
    </section>
  );
}
