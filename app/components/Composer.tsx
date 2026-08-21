"use client";

import { useState } from "react";
import Modal from "./Modal";

/** Shared field chrome: `tap` lifts every control to 44px on touch pointers. */
const FIELD_CLASS =
  "tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800";

/**
 * What the composer submits. An object rather than positional arguments: this
 * form grew to seven fields, and `onCreate(t, k, undefined, undefined, wk, due)`
 * call sites made it easy to slide a value into the wrong slot.
 */
export interface ComposerSubmission {
  title: string;
  keywords: string[];
  courseId?: string;
  courseName?: string;
  /** Jurusan for the course being created (or backfilled if it has none). */
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

  const selectedCourse = courses.find((c) => c.id === courseId);
  const creatingCourse = !!newCourse.trim();
  // Only ask for a jurusan when it would actually be used: creating a course, or
  // the picked course has none yet. Re-asking for a course that already has one
  // would imply it can be changed here, which the API deliberately refuses.
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
        <label className="mt-4 block text-sm font-medium">Topik / judul</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Mis. Teori Pertukaran Simbolik"
          className={FIELD_CLASS}
        />
        <label className="mt-3 block text-sm font-medium">
          Kata kunci (pisahkan dengan koma)
        </label>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="poskolonialisme, gender"
          className={FIELD_CLASS}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Minggu ke-</label>
            <input
              type="number"
              min={1}
              value={weekNumber}
              onChange={(e) => setWeekNumber(e.target.value)}
              placeholder="mis. 3"
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Batas sebelum kuliah</label>
            <input
              type="datetime-local"
              value={dueBeforeLecture}
              onChange={(e) => setDueBeforeLecture(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
        </div>
        <label className="mt-3 block text-sm font-medium">Mata kuliah</label>
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          disabled={!!newCourse.trim()}
          className={FIELD_CLASS}
        >
          <option value="">— pilih mata kuliah —</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-center text-xs text-muted">— atau —</p>
        <input
          value={newCourse}
          onChange={(e) => setNewCourse(e.target.value)}
          placeholder="Buat mata kuliah baru (mis. Antropologi Budaya)"
          className={FIELD_CLASS}
        />
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
        {/* gap-2 keeps ≥8px between the two tappables (WCAG 2.2 target spacing). */}
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
            {busy ? "Menyusun…" : "Sintesis"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
