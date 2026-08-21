"use client";

// Free recall ("brain dump") before the Q&A tab opens: write down everything you
// remember from the module *from memory*, then ask your questions. Retrieval
// practice — even plain free recall on a blank page — beats re-reading and
// concept mapping for long-term learning:
//   - Karpicke & Blunt (2011), Science 331(6018): 772–775, "Retrieval practice
//     produces more learning than elaborative studying with concept mapping."
//
// The dump is the student's own note, so it is stored locally per topic and
// never graded or sent to the model.

import { useState } from "react";

/** Minimum characters before the gate opens — long enough to force real recall. */
export const MIN_RECALL_CHARS = 80;

export function recallKey(topicId: string): string {
  return `recall:${topicId}`;
}

export function loadRecall(topicId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(recallKey(topicId)) ?? "";
  } catch {
    // Storage blocked: the gate cannot be remembered, so treat it as unmet and
    // let the student re-dump (the text still lives in component state).
    return "";
  }
}

export function hasRecall(topicId: string): boolean {
  return loadRecall(topicId).trim().length >= MIN_RECALL_CHARS;
}

function saveRecall(topicId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(recallKey(topicId), value);
  } catch {
    /* handled: draft stays in component state for this session */
  }
}

export default function FreeRecall({
  topicId,
  topicTitle,
  onDone,
}: {
  topicId: string;
  topicTitle: string;
  /** Called when the dump is long enough and the student continues. */
  onDone: () => void;
}) {
  const [text, setText] = useState<string>(() => loadRecall(topicId));

  const chars = text.trim().length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const ready = chars >= MIN_RECALL_CHARS;

  function update(value: string) {
    setText(value);
    saveRecall(topicId, value);
  }

  return (
    <section
      aria-labelledby="recall-title"
      className="space-y-3 rounded-card border border-border bg-card p-5"
    >
      <div>
        <h3 id="recall-title" className="text-lg font-semibold">
          Tulis dulu yang Anda ingat
        </h3>
        <p className="mt-1 text-sm text-muted">
          Sebelum bertanya, tuliskan tanpa melihat modul: apa saja yang Anda ingat tentang{" "}
          <strong>{topicTitle}</strong>. Menarik kembali dari memori (walau tidak lengkap) jauh
          lebih efektif daripada membaca ulang (Karpicke &amp; Blunt 2011). Catatan ini hanya
          tersimpan di perangkat Anda dan tidak dinilai.
        </p>
      </div>

      <label htmlFor="free-recall" className="sr-only">
        Tulis semua yang Anda ingat
      </label>
      <textarea
        id="free-recall"
        value={text}
        onChange={(e) => update(e.target.value)}
        rows={8}
        placeholder="Tulis semua yang Anda ingat — poin acak pun boleh…"
        className="w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-zinc-800"
      />

      <p role="status" aria-live="polite" className="text-xs text-muted">
        {words} kata · {chars}/{MIN_RECALL_CHARS} karakter
        {ready ? " · cukup, silakan lanjut" : " — teruskan sedikit lagi"}
      </p>

      <button
        type="button"
        onClick={onDone}
        disabled={!ready}
        className="tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
      >
        Simpan &amp; buka Tanya
      </button>
    </section>
  );
}
