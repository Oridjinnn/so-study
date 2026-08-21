"use client";

// Again / Hard / Good / Easy grader — the single confidence-rating pattern for
// every recall surface (ReviewQueue + InterleavedPractice), replacing the two
// different 1–5 scales those panels used to render.
//
// Each button shows the interval the scheduler would actually pick if it were
// pressed (`previewIntervals` from src/lib/scheduler.ts), so the spacing effect
// is visible instead of hidden: pressing "Bagus" pushes the card further out
// than "Sulit", and "Lagi" brings it back today.
//   - Spacing effect / distributed practice: Dunlosky et al. 2013 (high
//     utility), Cepeda et al. 2006.
//   - Four-button grading + desired retention: FSRS / Anki deck options
//     (https://docs.ankiweb.net/deck-options.html#fsrs). "Good" is the
//     sweet spot and is framed here as the default choice.

import { useEffect, useMemo, type KeyboardEvent } from "react";
import { previewIntervals, type SchedulerState } from "@/src/lib/scheduler";

export type ReviewGrade = "again" | "hard" | "good" | "easy";

/**
 * Self-rated confidence (1..5) persisted with the attempt for each grade.
 * `POST /api/attempts` feeds it to `outcomeToGrade(isCorrect, confidence)`, so
 * the mapping must stay monotonic: again < hard < good < easy.
 */
export const GRADE_CONFIDENCE: Record<ReviewGrade, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

/** "Again" is a failed recall; every other grade is a successful one. */
export function gradeRecalled(grade: ReviewGrade): boolean {
  return grade !== "again";
}

interface GradeMeta {
  id: ReviewGrade;
  key: "1" | "2" | "3" | "4";
  label: string;
  hint: string;
}

const GRADES: GradeMeta[] = [
  { id: "again", key: "1", label: "Lagi", hint: "lupa" },
  { id: "hard", key: "2", label: "Sulit", hint: "susah diingat" },
  { id: "good", key: "3", label: "Bagus", hint: "pilihan normal" },
  { id: "easy", key: "4", label: "Mudah", hint: "langsung ingat" },
];

const KEY_TO_GRADE: Record<string, ReviewGrade> = {
  "1": "again",
  "2": "hard",
  "3": "good",
  "4": "easy",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export default function ReviewGrader({
  state = null,
  desiredRetention = 0.9,
  value = null,
  onSelect,
  disabled = false,
  keyboard = false,
  label = "Seberapa baik Anda mengingatnya?",
}: {
  /** Current card state; `null` = a brand-new card (fresh intervals). */
  state?: SchedulerState | null;
  desiredRetention?: number;
  value?: ReviewGrade | null;
  onSelect: (grade: ReviewGrade, confidence: number) => void;
  disabled?: boolean;
  /** Bind 1–4 document-wide. Only enable it for the one active card. */
  keyboard?: boolean;
  label?: string;
}) {
  const preview = useMemo(
    () => previewIntervals(state, desiredRetention),
    [state, desiredRetention],
  );

  // Keyboard 1–4 for the active card. Scoped to plain digit presses outside
  // text fields so typing an answer or a question count never grades a card.
  useEffect(() => {
    if (!keyboard || disabled) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const grade = KEY_TO_GRADE[event.key];
      if (!grade) return;
      event.preventDefault();
      onSelect(grade, GRADE_CONFIDENCE[grade]);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [keyboard, disabled, onSelect]);

  // Same shortcuts while focus is inside this grader, even when the document
  // binding above is off (ReviewQueue renders one grader per due card).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const grade = KEY_TO_GRADE[event.key];
    if (!grade) return;
    event.preventDefault();
    onSelect(grade, GRADE_CONFIDENCE[grade]);
  }

  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label={`${label} (tekan 1–4)`}
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {GRADES.map((g) => {
          const days = preview[g.id];
          const selected = value === g.id;
          const recommended = g.id === "good";
          return (
            <button
              key={g.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onSelect(g.id, GRADE_CONFIDENCE[g.id])}
              title={`${g.label} — ${g.hint} · ulangi ~${days} hari (tombol ${g.key})`}
              className={`tap flex min-h-11 flex-col items-center justify-center rounded-card border px-2 py-1.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50 ${
                selected
                  ? "border-brand-600 bg-brand-600 text-white"
                  : recommended
                    ? "border-brand-500 bg-card text-foreground ring-1 ring-brand-500 hover:bg-brand-500/10"
                    : "border-border bg-card text-foreground hover:bg-brand-500/10"
              }`}
            >
              <span>
                {g.label} <span aria-hidden="true">·</span> {g.key}
              </span>
              <span className={`text-[11px] ${selected ? "text-white/85" : "text-muted"}`}>
                ~{days} hari
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        <strong>Bagus</strong> adalah pilihan normal (titik manis). Angka di tiap tombol adalah
        jarak ulangan berikutnya — makin lama jarak yang masih berhasil diingat, makin kuat
        memorinya (efek spasi).
      </p>
    </div>
  );
}
