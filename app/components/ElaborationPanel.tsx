"use client";

import { useState } from "react";

// Elaborative interrogation + self-explanation prompts. These nudge the student
// to explain *why* and *how* a concept works rather than merely re-reading,
// which strengthens long-term retention (Chi et al.; Dunlosky et al.).
const ELAB_PROMPTS = [
  "Mengapa pernyataan ini benar?",
  "Bagaimana konsep ini berbeda dari konsep lain yang serupa?",
  "Jelaskan konsep ini dengan kata-kata Anda sendiri seolah mengajar teman.",
];

const SELFEXPLAIN_PROMPTS = [
  "Apa langkah berpikir yang Anda gunakan untuk memahami bagian ini?",
  "Bagian mana yang masih membingungkan, dan mengapa?",
];

type Stored = Record<string, string>;

function storageKey(topicTitle: string): string {
  return `elaboration:${topicTitle}`;
}

function loadReflections(topicTitle: string): Stored {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(topicTitle));
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function saveReflections(topicTitle: string, value: Stored): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(topicTitle), JSON.stringify(value));
}

export default function ElaborationPanel({ topicTitle }: { topicTitle: string }) {
  const [reflections, setReflections] = useState<Stored>(() => loadReflections(topicTitle));

  function update(key: string, value: string) {
    setReflections((prev) => {
      const next = { ...prev, [key]: value };
      saveReflections(topicTitle, next);
      return next;
    });
  }

  const prompts = [
    ...ELAB_PROMPTS.map((text, i) => ({ key: `elab-${i}`, text })),
    ...SELFEXPLAIN_PROMPTS.map((text, i) => ({ key: `self-${i}`, text })),
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-brand-500/40 bg-brand-500/10 px-4 py-3 text-sm text-link">
        <strong>Elaborasi &amp; self-explanation:</strong> jelaskan konsep dengan kata sendiri
        (mengapa benar, bagaimana berbeda, bagaimana mengajarnya). Jawaban tersimpan otomatis di
        perangkat ini.
      </div>

      <section className="rounded-card border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-link">
          Pertanyaan elaborasi
        </h3>
        <p className="mb-3 text-xs text-muted">
          Pertanyaan ini memaksa Anda mengaitkan konsep baru dengan yang sudah diketahui.
        </p>
        <div className="space-y-3">
          {prompts.map(({ key, text }) => (
            <div key={key}>
              <label className="mb-1 block text-sm">{text}</label>
              <textarea
                value={reflections[key] ?? ""}
                onChange={(e) => update(key, e.target.value)}
                rows={2}
                placeholder="Tulis jawaban Anda…"
                className="min-h-11 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-zinc-800"
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
