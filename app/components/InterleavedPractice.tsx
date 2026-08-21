"use client";

// Interleaved practice across the whole course: questions from different topics
// are mixed rather than drilled block-by-block, and the order is randomised each
// session. Interleaving is a moderate-utility technique on its own (Dunlosky et
// al. 2013, Table 4) but it is what makes retrieval practice discriminative:
// the student must first work out *which* concept a question is about.
// Randomised order also matches FSRS/Anki guidance against fixed deck order.

import { useEffect, useMemo, useState } from "react";
import type { QuestionBankItem } from "../lib/types";
import MCQOptions from "./MCQOptions";
import ReviewGrader, { GRADE_CONFIDENCE, type ReviewGrade } from "./ReviewGrader";

type Props = {
  courseId: string;
};

type PracticeState = "answering" | "revealed";

// Deterministic-enough shuffle: seeded by courseId + day (+ a reshuffle nonce)
// so a student gets a stable interleaved ordering within a study session but a
// fresh mix later or on demand.
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Mix by concept: shuffle inside every topic, shuffle the topic order, then deal
 * round-robin so consecutive questions come from *different* topics whenever the
 * course has more than one. Never "deck-then-due" and never grouped by topic.
 */
export function interleaveByConcept(
  items: QuestionBankItem[],
  seed: string,
): QuestionBankItem[] {
  const groups = new Map<string, QuestionBankItem[]>();
  for (const item of items) {
    const bucket = groups.get(item.topicId);
    if (bucket) bucket.push(item);
    else groups.set(item.topicId, [item]);
  }
  const buckets = seededShuffle(
    [...groups.values()].map((g) => seededShuffle(g, `${seed}:g`)),
    seed,
  );
  const longest = buckets.reduce((max, b) => Math.max(max, b.length), 0);
  const out: QuestionBankItem[] = [];
  for (let round = 0; round < longest; round++) {
    for (const bucket of buckets) {
      if (round < bucket.length) out.push(bucket[round]);
    }
  }
  return out;
}

type AttemptItem = {
  questionType: "mcq";
  itemRef: string;
  prompt: string;
  isCorrect: boolean;
  confidence: number;
};

// Record a practice attempt. Non-fatal: if the POST fails for any reason the
// practice flow keeps working. We only persist when the question is anchored to
// both a module and a topic (moduleId may be null for legacy bank entries).
async function recordAttempt(
  item: QuestionBankItem,
  isCorrect: boolean,
  confidence: number,
): Promise<void> {
  if (!item.moduleId || !item.topicId) return;
  try {
    await fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId: item.moduleId,
        topicId: item.topicId,
        items: [
          {
            questionType: "mcq",
            itemRef: item.id,
            prompt: item.stem,
            isCorrect,
            confidence,
          },
        ] satisfies AttemptItem[],
      }),
    });
  } catch {
    /* practice still works without persistence */
  }
}

export default function InterleavedPractice({ courseId }: Props) {
  const [all, setAll] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [state, setState] = useState<PracticeState>("answering");
  const [grade, setGrade] = useState<ReviewGrade | null>(null);
  const [graded, setGraded] = useState<(ReviewGrade | null)[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [seedNonce, setSeedNonce] = useState(0);
  const [count, setCount] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/questions?courseId=${encodeURIComponent(courseId)}`)
      .then((r) => r.json())
      .then((data: { items?: QuestionBankItem[]; error?: string }) => {
        if (cancelled) return;
        if (!data.items) {
          setError(data.error ?? "Gagal memuat soal.");
          setLoading(false);
          return;
        }
        setAll(data.items);
        setIdx(0);
        setPicked(null);
        setState("answering");
        setGrade(null);
        setGraded([]);
        setCorrectCount(0);
        setSeedNonce(0);
        setCount(data.items.length);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const order = useMemo(() => {
    const day = new Date().toISOString().slice(0, 10);
    return interleaveByConcept(all, `${courseId}:${day}:${seedNonce}`);
  }, [all, courseId, seedNonce]);

  const practice = useMemo(
    () => (count <= 0 ? order : order.slice(0, Math.min(count, order.length))),
    [order, count],
  );

  const totalAll = all.length;
  const total = practice.length;
  const topicsMixed = new Set(practice.map((q) => q.topicId)).size;

  function restart() {
    setIdx(0);
    setPicked(null);
    setState("answering");
    setGrade(null);
    setGraded([]);
    setCorrectCount(0);
  }

  function handleCount(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    const clamped = Number.isFinite(v) ? Math.max(1, Math.min(v, totalAll)) : totalAll;
    setCount(clamped);
    restart();
  }

  function reshuffle() {
    setSeedNonce((n) => n + 1);
    restart();
  }

  if (loading) {
    return (
      <p role="status" className="text-sm text-muted">
        Menyiapkan latihan terinterleave…
      </p>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
      >
        {error}
      </div>
    );
  }
  if (total === 0) {
    return (
      <p className="text-sm text-muted">
        Belum ada soal di mata kuliah ini. Tambah soal via bank soal tiap topik untuk memulai
        latihan terinterleave.
      </p>
    );
  }

  // The finished guard MUST come before reading `practice[idx]`: after the last
  // item `idx === total`, and reading first is what used to crash the panel.
  if (idx >= total) {
    const gradedCount = graded.filter((g): g is ReviewGrade => g != null).length;
    return (
      <div className="rounded-card border border-border bg-card p-5 text-center">
        <h3 className="text-lg font-semibold">Selesai!</h3>
        <p role="status" className="mt-1 text-sm text-muted">
          {total} soal terinterleave sudah dipraktikkan dari {topicsMixed} topik · {correctCount}/
          {total} benar · {gradedCount} sudah Anda nilai ingatannya.
        </p>
        <button
          type="button"
          onClick={restart}
          className="tap mt-4 min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        >
          Ulangi latihan
        </button>
      </div>
    );
  }

  const current = practice[idx];
  const isCorrect = picked === current.answer;

  function choose(opt: string) {
    if (state === "revealed") return;
    setPicked(opt);
  }

  function reveal() {
    if (picked == null) return;
    setState("revealed");
  }

  async function advance() {
    if (picked == null || grade == null || saving) return;
    setSaving(true);
    // Correctness comes from the deterministic MCQ answer; the grade only
    // supplies the self-rated confidence the scheduler blends in.
    const correct = picked === current.answer;
    try {
      await recordAttempt(current, correct, GRADE_CONFIDENCE[grade]);
    } finally {
      setSaving(false);
    }
    if (correct) setCorrectCount((c) => c + 1);
    setIdx((i) => i + 1);
    setPicked(null);
    setState("answering");
    setGrade(null);
  }

  return (
    <section className="rounded-card border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Latihan terinterleave</h3>
        <span className="text-xs text-muted">
          {idx + 1} / {total}
        </span>
      </div>

      <p className="mb-3 text-xs text-muted">
        Soal diacak dan dicampur dari {topicsMixed} topik mata kuliah ini — Anda harus menebak
        dulu <em>konsep mana</em> yang dipakai, bukan mengulang satu topik berurutan.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label htmlFor="ip-count" className="flex items-center gap-2 text-xs text-muted">
          Jumlah soal
          <input
            id="ip-count"
            type="number"
            min={1}
            max={totalAll}
            value={count || ""}
            onChange={handleCount}
            className="tap h-11 w-16 rounded-card border border-border bg-card px-2 text-center text-sm focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800"
          />
        </label>
        <button
          type="button"
          onClick={reshuffle}
          className="tap min-h-11 rounded-card border border-border bg-card px-3 text-sm font-medium text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
        >
          Acak ulang
        </button>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-brand-600 transition-all"
          style={{ width: `${((idx + 1) / total) * 100}%` }}
        />
      </div>

      <p className="text-sm font-medium">{current.stem}</p>
      <MCQOptions
        options={current.options}
        chosen={picked}
        answered={state === "revealed"}
        answer={current.answer}
        onChoose={choose}
        disabled={state === "revealed"}
        name={current.id}
      />

      {state === "answering" ? (
        <button
          type="button"
          onClick={reveal}
          disabled={picked == null}
          className="tap mt-4 min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
        >
          Periksa jawaban
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <p
            role="status"
            aria-live="polite"
            className={`text-sm font-semibold ${
              isCorrect ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {isCorrect ? "Benar!" : "Belum tepat."} Jawaban: {current.answer}
          </p>
          {current.explanation && <p className="text-xs text-muted">{current.explanation}</p>}

          <ReviewGrader
            value={grade}
            keyboard
            onSelect={(g) => setGrade(g)}
            label="Seberapa baik Anda mengingat soal ini?"
          />

          <button
            type="button"
            onClick={advance}
            disabled={grade == null || saving}
            className="tap min-h-11 rounded-card bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
          >
            {saving ? "Menyimpan…" : idx + 1 >= total ? "Selesai" : "Soal berikutnya"}
          </button>
          {grade == null && (
            <p className="text-xs text-muted">Nilai ingatan Anda dulu (tombol 1–4).</p>
          )}
        </div>
      )}
    </section>
  );
}
