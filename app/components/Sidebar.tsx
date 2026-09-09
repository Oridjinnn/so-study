"use client";

import { useEffect, useState } from "react";
import Modal from "./Modal";
import DataBackup from "./DataBackup";
import AccountBar from "./AccountBar";
import Icon from "./Icon";
import { PRIMARY_CLASS, SECONDARY_CLASS } from "./ui";
import type { CourseSummary } from "../lib/types";

/** localStorage key holding the *explicit* theme choice; absent = follow the OS. */
const THEME_KEY = "theme";

type Theme = "light" | "dark";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

function ThemeToggle() {
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
      className={SECONDARY_CLASS}
    >
      <Icon name="theme" /> Tema
    </button>
  );
}

function NewTopicButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={PRIMARY_CLASS}
    >
      <Icon name="plus" /> Topik baru
    </button>
  );
}

/** Semester-level action: many courses at once, next to the course list it fills. */
function BatchImportButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={SECONDARY_CLASS}>
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
        Belum ada mata kuliah — tambah topik baru untuk mulai belajar.
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
            className={`tap block w-full rounded-card px-3 py-2.5 text-left transition anim-fade-in-up ${
              active
                ? "bg-brand-500/10 ring-1 ring-brand-500"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            }`}
          >
            <div className="flex items-center gap-2">
              {active && (
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-500" />
              )}
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
              {dueTodayByCourse && (dueTodayByCourse[c.id] ?? 0) > 0 && (
                <span
                  title={`${dueTodayByCourse[c.id]} jatuh tempo hari ini`}
                  className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-500"
                />
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-brand-500/70"
                  style={{ width: `${total > 0 ? Math.round((c.modules.length / total) * 100) : 0}%` }}
                />
              </div>
              <span className="text-[11px] text-muted">
                {c.modules.length}/{total}
              </span>
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
  activeCourseName,
}: {
  courses: CourseSummary[];
  activeCourseId: string | null;
  onSelectCourse: (id: string) => void;
  onNew: () => void;
  onBatchImport?: () => void;
  dueTodayByCourse?: Record<string, number>;
  activeCourseName?: string;
}) {
  const [courseDrawerOpen, setCourseDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      {/* Desktop/iPad-landscape rail */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/70 md:flex">
        <div className="space-y-3 p-4">
          <NewTopicButton onClick={onNew} />
          {onBatchImport && <BatchImportButton onClick={onBatchImport} />}
          <ThemeToggle />
          <DataBackup />
          <AccountBar />
        </div>
        <nav className="flex-1 space-y-2.5 overflow-y-auto px-2 pb-4">
          <CourseList
            courses={courses}
            activeCourseId={activeCourseId}
            onSelectCourse={onSelectCourse}
            dueTodayByCourse={dueTodayByCourse}
          />
        </nav>
      </aside>

      {/* Mobile bottom nav bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-white/95 backdrop-blur dark:bg-zinc-900/95 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navigasi utama"
      >
        <button
          type="button"
          onClick={() => setCourseDrawerOpen(true)}
          className="tap flex flex-col items-center gap-0.5 px-3 py-2 text-link"
          aria-label="Daftar mata kuliah"
        >
          <Icon name="book" className="size-5" />
          <span className="text-[10px] font-medium">Mata kuliah</span>
          {activeCourseName && (
            <span className="max-w-[72px] truncate text-[9px] text-muted">{activeCourseName}</span>
          )}
        </button>
        <button
          type="button"
          onClick={onNew}
          className="tap flex flex-col items-center gap-0.5 rounded-card bg-brand-600 px-5 py-2 text-white shadow-sm"
          aria-label="Buat topik baru"
        >
          <Icon name="plus" className="size-5" />
          <span className="text-[10px] font-semibold">+ Topik</span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="tap flex flex-col items-center gap-0.5 px-3 py-2 text-muted"
          aria-label="Pengaturan"
        >
          <Icon name="settings" className="size-5" />
          <span className="text-[10px] font-medium">Settings</span>
        </button>
      </nav>

      {/* Mobile course drawer */}
      {courseDrawerOpen && (
        <Modal
          open
          title="Mata kuliah"
          onClose={() => setCourseDrawerOpen(false)}
          className="mr-auto max-w-xs"
        >
          <div className="flex max-h-[70vh] flex-col gap-3 p-4">
            <NewTopicButton
              onClick={() => {
                setCourseDrawerOpen(false);
                onNew();
              }}
            />
            {onBatchImport && (
              <BatchImportButton
                onClick={() => {
                  setCourseDrawerOpen(false);
                  onBatchImport();
                }}
              />
            )}
            <nav className="min-h-0 flex-1 space-y-2.5 overflow-y-auto">
              <CourseList
                courses={courses}
                activeCourseId={activeCourseId}
                onSelectCourse={(id) => {
                  onSelectCourse(id);
                  setCourseDrawerOpen(false);
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

      {/* Mobile settings sheet */}
      {settingsOpen && (
        <Modal open title="Pengaturan" onClose={() => setSettingsOpen(false)} className="max-w-xs">
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm font-medium text-muted">Tema</p>
            <ThemeToggle />
            <div className="border-t border-border pt-3">
              <DataBackup />
            </div>
            <div className="border-t border-border pt-3">
              <AccountBar />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
