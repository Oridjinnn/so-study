"use client";

import { useMemo, useState } from "react";
import Modal from "./Modal";

/**
 * Batch semester import (ROADMAP Phase 1: "Multi-course batch import").
 *
 * The student types or pastes a whole semester's course list and submits once;
 * the request creates every course in a single call (no N sequential requests).
 * Blank lines are ignored and duplicates are collapsed before sending, so the
 * preview shows exactly what will be created.
 */

/** Split on newlines AND commas — a course list is pasted both ways. */
export function splitCourseNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export default function CourseBatchImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** Fired after a successful import so the caller can refresh its course list. */
  onImported: (count: number) => void;
}) {
  const [text, setText] = useState("");
  const [major, setMajor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(() => splitCourseNames(text), [text]);

  async function submit() {
    if (names.length === 0) {
      setError("Tulis minimal satu nama mata kuliah.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names, major: major.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onImported(typeof data.count === "number" ? data.count : names.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Impor mata kuliah satu semester"
      onClose={onClose}
      labelledById="batch-title"
      className="max-w-lg"
      confirmClose
    >
      <div className="p-5">
        <h2 id="batch-title" className="text-lg font-semibold">
          Impor mata kuliah satu semester
        </h2>
        <p className="mt-1 text-sm text-muted">
          Tempel daftar mata kuliah semester ini sekaligus — satu per baris atau
          dipisah koma.
        </p>

        <label htmlFor="batch-courses" className="mt-4 block text-sm font-medium">
          Daftar mata kuliah
        </label>
        <textarea
          id="batch-courses"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            "Teori Antropologi Kontemporer\nAntropologi Ekologi\nEtnografi dan Metode Lapangan"
          }
          className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800"
        />

        <label htmlFor="batch-major" className="mt-3 block text-sm font-medium">
          Jurusan (opsional, berlaku untuk semua)
        </label>
        <input
          id="batch-major"
          value={major}
          onChange={(e) => setMajor(e.target.value)}
          placeholder="mis. Antropologi"
          className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800"
        />
        <p className="mt-1 text-xs text-muted">
          Jurusan mengarahkan pencarian paper dan sudut pandang modul, jadi
          topik yang sama dibaca lewat lensa disiplinmu.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <p className="mt-3 text-xs text-muted">
          {names.length > 0
            ? `${names.length} mata kuliah akan dibuat: ${names.join(" · ")}`
            : "Belum ada nama yang terbaca."}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="tap min-h-11 rounded-card px-4 py-2 text-sm text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || names.length === 0}
            className="tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Mengimpor…" : `Impor ${names.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </Modal>
  );
}
