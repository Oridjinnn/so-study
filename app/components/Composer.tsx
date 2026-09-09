"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";

const FIELD_CLASS =
  "tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800";

export interface ComposerSubmission {
  title: string;
  keywords: string[];
  courseId?: string;
  courseName?: string;
  courseMajor?: string;
  weekNumber?: number;
  dueBeforeLecture?: string;
}

export default function Composer({
  courses,
  defaultCourseId,
  onCreate,
  onClose,
  busy,
}: {
  courses: { id: string; name: string; major?: string | null }[];
  defaultCourseId?: string;
  onCreate: (submission: ComposerSubmission) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [courseId, setCourseId] = useState(defaultCourseId ?? "");
  const [newCourse, setNewCourse] = useState("");
  const [major, setMajor] = useState("");
  const [weekNumber, setWeekNumber] = useState("");
  const [dueBeforeLecture, setDueBeforeLecture] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<"select" | "create">("select");

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, []);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const creatingCourse = mode === "create" && !!newCourse.trim();
  const showMajorField = creatingCourse || (!!selectedCourse && !selectedCourse.major);

  function submit() {
    const t = title.trim();
    if (!t) return;
    const useNew = newCourse.trim();
    const wk = weekNumber.trim() ? Number(weekNumber) : undefined;
    const due = dueBeforeLecture.trim() ? new Date(dueBeforeLecture).toISOString() : undefined;
    onCreate({
      title: t,
      keywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      courseId: useNew ? undefined : courseId || undefined,
      courseName: useNew ? useNew : undefined,
      courseMajor: showMajorField && major.trim() ? major.trim() : undefined,
      weekNumber: wk,
      dueBeforeLecture: due,
    });
  }

  return (
    <Modal
      open
      title="Buat topik baru"
      onClose={onClose}
      labelledById="composer-title"
      className="max-w-md"
    >
      <div className="p-5">
        <h2 id="composer-title" className="text-lg font-semibold">Buat topik baru</h2>
        <p className="mt-1 text-sm text-muted">
          Sintesis modul dari paper akademik (OpenAlex + Gemini).
        </p>
        <label htmlFor="composer-title-input" className="mt-4 block text-sm font-medium">Topik / judul</label>
        <input
          id="composer-title-input"
          ref={firstInputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Mis. Teori Pertukaran Simbolik"
          className={FIELD_CLASS}
        />
        <label htmlFor="composer-keywords" className="mt-3 block text-sm font-medium">
          Kata kunci (pisahkan dengan koma)
        </label>
        <input
          id="composer-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="poskolonialisme, gender"
          className={FIELD_CLASS}
        />

        <label className="mt-3 block text-sm font-medium">Mata kuliah</label>
        <div className="mt-1 inline-flex rounded-card border border-border p-0.5">
          <button
            type="button"
            onClick={() => { setMode("select"); setNewCourse(""); }}
            className={`tap min-h-9 rounded-card px-3 py-1.5 text-xs font-medium transition ${
              mode === "select"
                ? "bg-brand-600 text-white"
                : "text-muted hover:text-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            Pilih mata kuliah
          </button>
          <button
            type="button"
            onClick={() => { setMode("create"); setCourseId(""); }}
            className={`tap min-h-9 rounded-card px-3 py-1.5 text-xs font-medium transition ${
              mode === "create"
                ? "bg-brand-600 text-white"
                : "text-muted hover:text-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            Buat baru
          </button>
        </div>

        {mode === "select" ? (
          <select
            id="composer-course"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className={`${FIELD_CLASS} mt-1`}
          >
            <option value="">— pilih mata kuliah —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="composer-new-course"
            value={newCourse}
            onChange={(e) => setNewCourse(e.target.value)}
            placeholder="Buat mata kuliah baru (mis. Antropologi Budaya)"
            className={FIELD_CLASS}
          />
        )}

        {showMajorField && (
          <>
            <label htmlFor="composer-major" className="mt-3 block text-sm font-medium">
              Jurusan
            </label>
            <input
              id="composer-major"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="mis. Antropologi"
              className={FIELD_CLASS}
            />
            <p className="mt-1 text-xs text-muted">
              Menentukan arah pencarian paper dan sudut pandang disiplin pada
              modul — bukan sekadar label.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="tap mt-3 flex items-center gap-1 text-xs font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          aria-expanded={moreOpen}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`size-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {moreOpen ? "Sembunyikan opsi" : "Opsi tambahan"}
        </button>

        {moreOpen && (
          <div className="mt-3 space-y-3 anim-slide-in">
            <div>
              <label htmlFor="composer-week" className="block text-sm font-medium">Minggu ke-</label>
              <input
                id="composer-week"
                type="number"
                min={1}
                value={weekNumber}
                onChange={(e) => setWeekNumber(e.target.value)}
                placeholder="mis. 3"
                className={FIELD_CLASS}
              />
            </div>
            <div>
              <label htmlFor="composer-due" className="block text-sm font-medium">Batas sebelum kuliah</label>
              <input
                id="composer-due"
                type="datetime-local"
                value={dueBeforeLecture}
                onChange={(e) => setDueBeforeLecture(e.target.value)}
                className={FIELD_CLASS}
              />
            </div>
          </div>
        )}

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
            disabled={busy || !title.trim()}
            className="tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Menyusun…" : "Buat topik"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
