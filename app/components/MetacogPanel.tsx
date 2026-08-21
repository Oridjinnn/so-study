"use client";

import { useState } from "react";
import { METACOG_PROMPTS, type MetacogPrompt } from "@/src/lib/metacog";

type Phase = MetacogPrompt["phase"];

const PHASE_META: { id: Phase; label: string; hint: string }[] = [
  { id: "rencana", label: "Rencana", hint: "Sebelum membaca — siapkan diri untuk kuliah" },
  { id: "pantau", label: "Pantau", hint: "Saat membaca — cek pemahaman dengan kata sendiri" },
  { id: "evaluasi", label: "Evaluasi", hint: "Sesudah belajar — ukur kesiapan menjelaskan di kelas" },
];

type Stored = Record<string, string>;

function storageKey(topicTitle: string): string {
  return `metacog:${topicTitle}`;
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

export default function MetacogPanel({ topicTitle }: { topicTitle: string }) {
  const [reflections, setReflections] = useState<Stored>(() => loadReflections(topicTitle));

  function update(id: string, value: string) {
    setReflections((prev) => {
      const next = { ...prev, [id]: value };
      saveReflections(topicTitle, next);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-brand-500/40 bg-brand-500/10 px-4 py-3 text-sm text-link">
        <strong>Head-start:</strong> jawab refleksi ini sebelum, selama, dan setelah mempelajari
        modul agar Anda siap saat kuliah. Jawaban tersimpan otomatis di perangkat ini.
      </div>

      {PHASE_META.map(({ id, label, hint }) => {
        const prompts = METACOG_PROMPTS.filter((p) => p.phase === id);
        return (
          <section
            key={id}
            className="rounded-card border border-border bg-card p-4"
          >
            <h3 className="text-sm font-semibold text-link">{label}</h3>
            <p className="mb-3 text-xs text-muted">{hint}</p>
            <div className="space-y-3">
              {prompts.map((p, idx) => {
                const key = `${id}-${idx}`;
                const val = reflections[key] ?? "";
                return (
                  <div key={key}>
                    <label className="mb-1 block text-sm">
                      {p.text}
                    </label>
                    {id === "evaluasi" ? (
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-label={`${n}`}
                            onClick={() => update(key, String(n))}
                            className={`tap min-h-11 min-w-11 flex-1 rounded-card border text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                              val === String(n)
                                ? "border-indigo-500 bg-indigo-600 text-white"
                                : "border-border bg-card text-muted hover:border-brand-500 dark:bg-zinc-800"
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={val}
                        onChange={(e) => update(key, e.target.value)}
                        rows={2}
                        placeholder="Tulis jawaban Anda…"
                        className="min-h-11 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-zinc-800"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
