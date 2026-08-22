"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
import DataBackup from "./DataBackup";
import AccountBar from "./AccountBar";
import type { CourseSummary } from "../lib/types";

/** localStorage key holding the *explicit* theme choice; absent = follow the OS. */
const THEME_KEY = "theme";

type Theme = "light" | "dark";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    // Safari private mode throws on storage access. Handled, not swallowed: the
    // caller falls back to the OS preference so the toggle still works.
    return null;
  }
}

function systemPrefersDark(): boolean {
  // `matchMedia` is missing in jsdom (and older embedded WebViews), so probe it.
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * `.dark`/`.light` on `<html>` drives both the CSS tokens and every `dark:`
 * utility (see the `@custom-variant dark` in `app/globals.css`).
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

function ThemeToggle() {
  // The stored choice lives in localStorage, which the server render cannot
  // see, so it is re-applied on mount (and after React's dev-mode remount
  // resets the <html> class). With no stored choice we deliberately leave the
  // root element untouched: the `prefers-color-scheme` fallback stays in charge.
  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) applyTheme(stored);
  }, []);

  function toggle() {
    const current: Theme = readStoredTheme() ?? (systemPrefersDark() ? "dark" : "light");
    const next: Theme = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Ganti tema terang/gelap"
      className="tap flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <span aria-hidden="true">🌓</span> Tema
    </button>
  );
}

function NewTopicButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap flex min-h-11 w-full items-center justify-center gap-2 rounded-card bg-brand-600 px-3 py-3 text-sm font-medium text-white transition hover:bg-brand-700 active:scale-[0.99]"
    >
      <span className="text-lg leading-none">+</span> Topik baru
    </button>
  );
}

/** Semester-level action: many courses at once, next to the course list it fills. */
function BatchImportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-border px-3 py-2 text-sm font-medium text-muted transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      Impor semester
    </button>
  );
}

function CourseList({
  courses,
  activeCourseId,
  onSelectCourse,
  dueTodayByCourse,
}: {
  courses: CourseSummary[];
  activeCourseId: string | null;
  onSelectCourse: (id: string) => void;
  dueTodayByCourse?: Record<string, number>;
}) {
  if (courses.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted">
        Belum ada mata kuliah — tambah topik baru di atas untuk mulai belajar.
      </p>
    );
  }
  return (
    <>
      {courses.map((c) => {
        const active = c.id === activeCourseId;
        const total = c.modules.length + c.topics.length;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectCourse(c.id)}
            aria-current={active ? "true" : undefined}
            className={`tap block w-full rounded-card px-3 py-2 text-left transition ${
              active
                ? "bg-brand-500/10 ring-1 ring-brand-500"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
              {dueTodayByCourse && (dueTodayByCourse[c.id] ?? 0) > 0 && (
                <span
                  title={`${dueTodayByCourse[c.id]} jatuh tempo hari ini`}
                  className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-500"
                />
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              {c.modules.length}/{total} siap
            </div>
          </button>
        );
      })}
    </>
  );
}

export default function Sidebar({
  courses,
  activeCourseId,
  onSelectCourse,
  onNew,
  onBatchImport,
  dueTodayByCourse,
}: {
  courses: CourseSummary[];
  activeCourseId: string | null;
  onSelectCourse: (id: string) => void;
  onNew: () => void;
  onBatchImport?: () => void;
  dueTodayByCourse?: Record<string, number>;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Desktop/iPad-landscape rail. Hidden below `md`, where the same nav is
          reachable from the hamburger below. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/70 md:flex">
        <div className="space-y-2 p-3">
          <NewTopicButton onClick={onNew} />
          {onBatchImport && <BatchImportButton onClick={onBatchImport} />}
          <ThemeToggle />
          <DataBackup />
          <AccountBar />
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto px-2 pb-4">
          <CourseList
            courses={courses}
            activeCourseId={activeCourseId}
            onSelectCourse={onSelectCourse}
            dueTodayByCourse={dueTodayByCourse}
          />
        </nav>
      </aside>

      {/* Mobile drawer trigger. Fixed just below the sticky app header (~4rem)
          so it never covers the header's title/status dot. */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
        className="tap fixed top-[4.5rem] left-3 z-30 flex min-h-11 min-w-11 items-center justify-center rounded-card border border-border bg-card text-lg shadow-lg md:hidden"
      >
        <span aria-hidden="true">☰</span>
        <span className="sr-only">Buka daftar mata kuliah</span>
      </button>

      {drawerOpen && (
        <Modal
          open
          title="Mata kuliah"
          onClose={() => setDrawerOpen(false)}
          className="mr-auto max-w-xs"
        >
          <div className="flex max-h-[70vh] flex-col gap-2 p-3">
            <NewTopicButton
              onClick={() => {
                setDrawerOpen(false);
                onNew();
              }}
            />
            {onBatchImport && (
              <BatchImportButton
                onClick={() => {
                  setDrawerOpen(false);
                  onBatchImport();
                }}
              />
            )}
            <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              <CourseList
                courses={courses}
                activeCourseId={activeCourseId}
                onSelectCourse={(id) => {
                  onSelectCourse(id);
                  setDrawerOpen(false);
                }}
                dueTodayByCourse={dueTodayByCourse}
              />
            </nav>
            <ThemeToggle />
            <DataBackup />
            <AccountBar />
          </div>
        </Modal>
      )}
    </>
  );
}
