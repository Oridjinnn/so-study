"use client";

// Latihan lanjutan (opsional) — a single collapsed section that holds the
// legitimate-but-advanced features (spaced-repetition Review, interleaved
// practice, elaboration) so they don't compete with the core 6-step flow for a
// first-time student. Collapsed by default; content is unmounted while closed so
// it is neither visible nor focusable until the student expands it.

import { useState } from "react";
import ReviewQueue from "./ReviewQueue";
import InterleavedPractice from "./InterleavedPractice";
import ElaborationPanel from "./ElaborationPanel";

type Props = {
  moduleId: string;
  topicId: string;
  topicTitle: string;
  courseId?: string;
  onGraded: () => void;
};

export default function AdvancedPractice({
  moduleId,
  topicId,
  topicTitle,
  courseId,
  onGraded,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-card border border-border bg-card">
      <h3 className="sr-only">Latihan lanjutan</h3>
      <button
        type="button"
        id="advanced-toggle"
        aria-expanded={open}
        aria-controls="advanced-body"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-card px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span>Latihan lanjutan (opsional)</span>
        <span aria-hidden="true" className="text-muted">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div id="advanced-body" className="space-y-5 border-t border-border p-4">
          <div>
            <h4 className="mb-2 font-semibold">Ulangan terjadwal (spaced repetition)</h4>
            <ReviewQueue moduleId={moduleId} topicId={topicId} onGraded={onGraded} />
          </div>

          <div>
            <h4 className="mb-2 font-semibold">Latihan campuran</h4>
            {courseId ? (
              <InterleavedPractice courseId={courseId} />
            ) : (
              <p className="text-sm text-muted">
                Pilih mata kuliah di daftar untuk melatih soal campuran dari beberapa topik.
              </p>
            )}
          </div>

          <div>
            <h4 className="mb-2 font-semibold">Perdalam pemahaman</h4>
            <ElaborationPanel topicTitle={topicTitle} />
          </div>
        </div>
      )}
    </section>
  );
}
