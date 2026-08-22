"use client";

// Due-review queue for one module: the cards whose scheduled next review has
// arrived (spaced repetition). Grading is the shared Again/Hard/Good/Easy pattern
// (`ReviewGrader`), which also previews the interval each button would produce.
//
// Correctness invariant: the attempt written here describes THIS review, not the
// previous one. The panel used to forward the stored `item.isCorrect` from the
// old attempt, so a card first missed months ago stayed "wrong" forever and the
// scheduler could never grow its interval. Now "Lagi" means failed recall and
// Sulit/Bagus/Mudah mean successful recall, exactly like FSRS/Anki.

import { useCallback, useEffect, useState } from "react";
import type { AssessmentAttempt } from "@/app/lib/types";
import type { SchedulerState } from "@/src/lib/scheduler";
import { apiFetch } from "@/app/lib/api";
import ReviewGrader, { GRADE_CONFIDENCE, gradeRecalled, type ReviewGrade } from "./ReviewGrader";

type Item = AssessmentAttempt;

/** The card's current scheduler state, used for the interval preview. */
function schedulerStateOf(item: Item): SchedulerState {
  return {
    intervalDays: item.intervalDays,
    repetitions: item.repetitions,
    easeFactor: item.easeFactor,
    stability: item.stability,
    difficulty: item.difficulty,
  };
}

export default function ReviewQueue({
  moduleId,
  topicId,
  onGraded,
}: {
  moduleId: string;
  topicId: string;
  /** Notifies the parent that a new attempt was persisted (progress/calibration). */
  onGraded?: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [grades, setGrades] = useState<Record<string, ReviewGrade>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/attempts?due=1&moduleId=${encodeURIComponent(moduleId)}&topicId=${encodeURIComponent(topicId)}`,
      );
      const data = (await res.json().catch(() => ({}))) as { attempts?: Item[] };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      setItems(data.attempts ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [moduleId, topicId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function markReviewed(item: Item) {
    const grade = grades[item.id];
    if (grade == null) {
      setError("Nilai ingatan Anda dulu (Lagi / Sulit / Bagus / Mudah).");
      return;
    }
    setPending(item.id);
    setError(null);
    setStatus("Menyimpan ulangan…");
    try {
      const res = await apiFetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleId,
          topicId,
          items: [
            {
              questionType: item.questionType,
              itemRef: item.itemRef,
              prompt: item.prompt,
              // THIS review's outcome, not the previous attempt's.
              isCorrect: gradeRecalled(grade),
              confidence: GRADE_CONFIDENCE[grade],
            },
          ],
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setStatus("Ulangan tersimpan; jadwal berikutnya diperbarui.");
      setGrades((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      onGraded?.();
      await load();
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div role="status" className="rounded-card border border-border bg-card p-5 text-sm text-muted">
        Memuat antrean latihan…
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Antrean ulangan (spaced repetition)</h3>
        <p className="mt-1 text-sm text-muted">
          Ingat kembali jawabannya dulu, lalu nilai seberapa mudah tadi. Jarak ulangan berikutnya
          mengikuti penilaian Anda.
        </p>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}
      {items.length === 0 ? (
        <p className="rounded-card border border-border bg-card p-5 text-sm text-muted">
          Tidak ada latihan jatuh tempo
        </p>
      ) : (
        items.map((item, idx) => (
          <div key={item.id} className="rounded-card border border-border bg-card p-5">
            <p className="text-sm font-medium">{item.prompt}</p>
            {item.response && (
              <p className="mt-1 text-xs text-muted">Jawaban terakhir: {item.response}</p>
            )}
            <p className="mt-1 text-xs text-muted">
              Jadwal berikutnya:{" "}
              {item.scheduledNextAt
                ? new Date(item.scheduledNextAt).toLocaleString("id-ID")
                : "segera"}
            </p>
            <div className="mt-3">
              <ReviewGrader
                state={schedulerStateOf(item)}
                value={grades[item.id] ?? null}
                /* Only the first due card owns the 1–4 shortcuts, so the keys can
                   never grade two cards at once. */
                keyboard={idx === 0}
                disabled={pending === item.id}
                onSelect={(g) => setGrades((prev) => ({ ...prev, [item.id]: g }))}
              />
            </div>
            <button
              type="button"
              disabled={pending === item.id || grades[item.id] == null}
              onClick={() => markReviewed(item)}
              className="tap mt-3 min-h-11 rounded-card bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
            >
              {pending === item.id ? "Menyimpan…" : "Tandai sudah dipraktik"}
            </button>
          </div>
        ))
      )}
    </section>
  );
}
