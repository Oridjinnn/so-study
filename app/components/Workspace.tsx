"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AssessmentAttempt, ModuleDetail, VerificationPayload } from "../lib/types";
import { apiFetch } from "../lib/api";
import { withViewTransition } from "../lib/viewTransition";
import { visibleTabIds } from "../lib/study";
import Modal from "./Modal";
import { hasTakenPretest } from "./PretestGate";
import { hasRecall } from "./FreeRecall";
import { calibrationStats } from "./CalibrationPanel";
import ReadStep from "./ReadStep";
import ReliabilityGauge from "./ReliabilityGauge";
import AskStep from "./AskStep";
import PracticeStep from "./PracticeStep";
import { CHIP_CLASS } from "./ui";
import Icon from "./Icon";

const TABS = [
  { id: "read",    label: "Baca",    num: "1", icon: "book" as const },
  { id: "ask",     label: "Tanya",   num: "2", icon: "search" as const },
  { id: "test",    label: "Latihan", num: "3", icon: "check" as const },
  { id: "sources", label: "Sumber",  num: "4", icon: "download" as const },
] as const;

type TabId = (typeof TABS)[number]["id"];

const EXPORT_ITEMS = [
  { label: "Markdown", format: "md" },
  { label: "Anki", format: "anki" },
  { label: "PDF modul", format: "pdf" },
  { label: "PDF lembar kerja", format: "pdf-worksheet" },
] as const;

interface RecentlyDeletedModule {
  id: string;
  topicTitle: string;
  courseId: string;
  detail: ModuleDetail;
}

export default function Workspace({
  detail,
  online,
  courseId,
  onModuleChanged,
  onModuleDeleted,
}: {
  detail: ModuleDetail;
  online: boolean;
  courseId?: string;
  onModuleChanged?: () => void;
  onModuleDeleted?: (deletedModule: ModuleDetail) => void;
}) {
  const [tab, setTab] = useState<TabId>("read");

  const changeTab = useCallback((next: TabId) => {
    withViewTransition(() => setTab(next));
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [citeTarget, setCiteTarget] = useState<number | null>(null);
  const sourceRefs = useRef<(HTMLLIElement | null)[]>([]);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  const [moduleCourses, setModuleCourses] = useState(detail.courses);
  const [newCourse, setNewCourse] = useState("");
  const [addingCourse, setAddingCourse] = useState(false);
  const [removingCourseId, setRemovingCourseId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [recentlyDeleted, setRecentlyDeleted] = useState<RecentlyDeletedModule | null>(null);
  const [showUndo, setShowUndo] = useState(false);
  const [undoCountdown, setUndoCountdown] = useState(10);

  const [pretestDone, setPretestDone] = useState(() => hasTakenPretest(detail.topicId));
  const [recallDone, setRecallDone] = useState(() => hasRecall(detail.topicId));
  const [closedBook, setClosedBook] = useState(false);

  const [verification, setVerification] = useState<VerificationPayload | undefined>(
    detail.verification,
  );
  const [content, setContent] = useState(detail.contentMarkdown);

  const blocked = Boolean(verification?.tier1?.blocked);
  const gaugeScore = verification?.gauge ? Math.round(verification.gauge.score * 100) : null;

  const reloadModule = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/modules/${detail.id}`);
      const d = (await res.json().catch(() => ({}))) as Partial<ModuleDetail>;
      if (!res.ok) return;
      if (typeof d.contentMarkdown === "string") setContent(d.contentMarkdown);
      if (d.verification) setVerification(d.verification);
    } catch {
      /* the gauge already carries the fresh report it returned */
    }
  }, [detail.id]);

  const [attempts, setAttempts] = useState<AssessmentAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);

  useEffect(() => {
    if (citeTarget != null && tab === "sources") {
      sourceRefs.current[citeTarget - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [citeTarget, tab]);

  const loadAttempts = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/attempts?moduleId=${encodeURIComponent(detail.id)}&topicId=${encodeURIComponent(detail.topicId)}`,
      );
      const data = (await res.json().catch(() => ({}))) as { attempts?: AssessmentAttempt[] };
      if (res.ok && Array.isArray(data.attempts)) setAttempts(data.attempts);
    } catch {
      /* calibration/guardrail simply stay empty without history */
    } finally {
      setAttemptsLoading(false);
    }
  }, [detail.id, detail.topicId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await loadAttempts();
    })();
    return () => {
      active = false;
    };
  }, [loadAttempts]);

  const stats = calibrationStats(attempts);

  async function recordAttempts(
    items: {
      questionType: "mcq" | "essay";
      itemRef: string;
      prompt: string;
      response?: string;
      isCorrect?: boolean;
      score?: number;
      confidence?: number;
    }[],
  ) {
    try {
      await postJSON("/api/attempts", { moduleId: detail.id, topicId: detail.topicId, items });
      await loadAttempts();
    } catch {
      /* practice still works without persistence */
    }
  }

  async function postJSON(url: string, body: unknown) {
    setError(null);
    const res = await apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  async function delJSON(url: string, body: unknown) {
    setError(null);
    const res = await apiFetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  async function addToCourse() {
    const name = newCourse.trim();
    if (!name) return;
    setAddingCourse(true);
    try {
      const data = await postJSON(`/api/modules/${detail.id}/courses`, { courseName: name });
      setModuleCourses(data.courses ?? []);
      setNewCourse("");
      setStatus(`Modul ditambahkan ke ${name}.`);
      onModuleChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddingCourse(false);
    }
  }

  async function removeFromCourse(courseId: string) {
    setRemovingCourseId(courseId);
    try {
      const data = await delJSON(`/api/modules/${detail.id}/courses`, { courseId });
      setModuleCourses(data.courses ?? []);
      onModuleChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemovingCourseId(null);
    }
  }

  async function deleteModule() {
    setConfirmDelete(false);
    setDeleting(true);
    setRecentlyDeleted({ id: detail.id, topicTitle: detail.topicTitle, courseId: courseId ?? "", detail });
    setShowUndo(true);
    setUndoCountdown(10);
    const countdownInterval = setInterval(() => {
      setUndoCountdown((prev) => {
        if (prev <= 1) { clearInterval(countdownInterval); return 0; }
        return prev - 1;
      });
    }, 1000);
    const cleanup = () => clearInterval(countdownInterval);

    try {
      const data = await delJSON(`/api/modules/${detail.id}`, {});
      if (!data.ok) throw new Error("Gagal menghapus modul.");
      onModuleDeleted?.(detail);
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
      setRecentlyDeleted(null);
      setShowUndo(false);
      cleanup();
    } finally {
      setTimeout(() => {
        setRecentlyDeleted(null);
        setShowUndo(false);
        cleanup();
      }, 10000);
    }
  }

  function undoDeleteModule() {
    if (!recentlyDeleted) return;
    setRecentlyDeleted(null);
    setShowUndo(false);
    setDeleting(false);
    onModuleChanged?.();
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const visible = visibleTabIds(closedBook);
    const idx = visible.indexOf(tab);
    if (idx === -1) return;
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % visible.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + visible.length) % visible.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = visible.length - 1;
    else return;
    e.preventDefault();
    const nextId = visible[next];
    changeTab(nextId);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#tab-${nextId}`)?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {showUndo && recentlyDeleted && (
        <div className="mb-4 flex items-center justify-between rounded-card border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm dark:border-brand-800 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">
            Modul &ldquo;{recentlyDeleted.topicTitle}&rdquo; dihapus — kembalikan dalam {undoCountdown} dtk
          </span>
          <button
            type="button"
            onClick={undoDeleteModule}
            disabled={undoCountdown === 0}
            className="tap inline-flex min-h-11 items-center gap-1.5 rounded-card bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Kembalikan
          </button>
        </div>
      )}

      <header className="mb-4 rounded-card border border-transparent bg-clip-padding bg-card p-[1px]" style={{ backgroundImage: 'linear-gradient(var(--background), var(--background)) padding-box, linear-gradient(135deg, var(--color-brand-500), var(--color-brand-700)) border-box' }}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 flex-1 text-3xl tracking-tight">{detail.topicTitle}</h1>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            aria-label={`Hapus modul ${detail.topicTitle}`}
            title="Hapus modul ini — tindakan ini tidak bisa dibatalkan"
            className="tap shrink-0 flex items-center gap-1.5 rounded-card border border-red-300 px-2.5 text-xs font-medium text-red-600 transition disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none print:hidden hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            <Icon name="trash" className="size-3.5" aria-hidden="true" />
            Hapus
          </button>
        </div>

        {(gaugeScore !== null || blocked) && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => changeTab("sources")}
              className="inline-flex items-center gap-1 rounded-full border border-brand-500/30 px-2.5 py-0.5 text-xs font-semibold print:hidden hover:bg-brand-500/5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              style={{
                color: blocked ? "#dc2626" : gaugeScore !== null ? "var(--color-link)" : "var(--color-muted)",
                backgroundColor: blocked ? "rgba(220,38,38,0.08)" : gaugeScore !== null ? "rgba(168,94,53,0.08)" : "rgba(154,144,128,0.08)",
              }}
              title="Lihat rincian keandalan (Tahap 1 + Tahap 2)"
            >
              <Icon name="check" className="size-3" aria-hidden="true" />
              {blocked
                ? "Keandalan: ditahan"
                : gaugeScore == null
                  ? "Keandalan: belum diperiksa"
                  : `Keandalan: ${gaugeScore}/100`}
            </button>
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {moduleCourses.length === 0 ? (
            <span className="text-sm text-muted">belum masuk mata kuliah</span>
          ) : (
            moduleCourses.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-link"
              >
                {c.name}
                <button
                  type="button"
                  onClick={() => removeFromCourse(c.id)}
                  disabled={removingCourseId === c.id}
                  title="Lepaskan dari mata kuliah ini"
                  className="rounded-full px-1 text-link transition hover:bg-brand-500/20 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  {removingCourseId === c.id ? "…" : "×"}
                </button>
              </span>
            ))
          )}
          <span className="text-xs text-muted">
            · dibuat {new Date(detail.generatedAt).toLocaleString("id-ID")}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="add-course" className="sr-only">
            Tambah ke mata kuliah lain
          </label>
          <input
            id="add-course"
            value={newCourse}
            onChange={(e) => setNewCourse(e.target.value)}
            placeholder="Tambah ke mata kuliah lain…"
            className="tap h-11 w-56 rounded-card border border-border bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-zinc-800"
          />
          <button
            type="button"
            onClick={addToCourse}
            disabled={addingCourse || !newCourse.trim()}
            className={CHIP_CLASS}
          >
            {addingCourse ? "Menyimpan…" : "Tambah"}
          </button>
          <span className="text-xs text-muted ml-auto">Ekspor:</span>
          {online && !blocked ? (
            <>
              {EXPORT_ITEMS.map((item) => (
                <a
                  key={item.format}
                  href={`/api/modules/${detail.id}/export?format=${item.format}`}
                  download
                  title={
                    item.label === "PDF modul"
                      ? "Unduh modul + sumber sebagai PDF (dibuat di server)"
                      : item.label === "PDF lembar kerja"
                        ? "Unduh lembar kerja: pertanyaan esai + rubrik (tanpa isi modul)"
                        : item.label === "Anki"
                          ? "Unduh soal (bank soal Anda, atau soal cloze otomatis) untuk diimpor ke Anki"
                          : "Unduh modul + daftar sumber sebagai Markdown"
                  }
                  className={`${CHIP_CLASS} inline-flex items-center gap-1.5 hover:bg-brand-500/10 hover:text-brand-700 dark:hover:text-brand-300`}
                >
                  <Icon name="download" className="size-3" />
                  {item.label}
                </a>
              ))}
              <ExportDropdown detail={detail} online={online} blocked={blocked} />
            </>
          ) : (
            <>
              {EXPORT_ITEMS.map((item) => (
                <span
                  key={item.format}
                  className={`${CHIP_CLASS} inline-flex cursor-not-allowed items-center gap-1.5 opacity-50`}
                  title={
                    blocked
                      ? "Ekspor ditahan: ada sitasi hantu (Tahap 1 gagal). Perbaiki dulu di tab Sumber."
                      : "Ekspor butuh internet. Sambungkan dulu."
                  }
                  aria-disabled="true"
                >
                  <Icon name="download" className="size-3" />
                  {item.label}
                </span>
              ))}
              <ExportDropdown detail={detail} online={online} blocked={blocked} />
            </>
          )}
        </div>
      </header>

      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Alur belajar modul"
        onKeyDown={onTabKeyDown}
        className="mb-5 flex gap-1 rounded-card bg-zinc-100 p-1 print:hidden dark:bg-zinc-800/60 max-[399px]:snap-x max-[399px]:snap-mandatory max-[399px]:overflow-x-auto max-[399px]:flex-nowrap"
      >
        {visibleTabIds(closedBook).map((id) => {
          const t = TABS.find((x) => x.id === id)!;
          const isActive = tab === t.id;
          const isSources = t.id === "sources";
          const isDimmed = isSources && !blocked;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              onClick={() => changeTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              aria-label={`${t.num} ${t.label}`}
              className={`tap card-lift min-h-11 flex-1 rounded-card px-3 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none max-[399px]:snap-center max-[399px]:flex-col max-[399px]:items-center max-[399px]:gap-0.5 max-[399px]:px-2 ${
                isActive
                  ? "bg-card text-link shadow-sm"
                  : isDimmed
                    ? "text-muted/50"
                    : "text-muted hover:text-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              <span className="sm:hidden">{t.icon && <Icon name={t.icon} className="size-4" aria-hidden="true" />}</span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className={`text-[10px] font-bold ${isDimmed && !isActive ? "opacity-40" : ""}`}>{t.num}</span>
                {t.label}
              </span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {!online && (
        <div className="mb-4 rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 leading-relaxed">
          Mode offline — membaca tetap bisa, tapi Tanya, Latihan, dan ekspor (Markdown / Anki / PDF)
          butuh internet.
        </div>
      )}

      {tab === "read" &&
        (blocked ? (
          <div id="panel-read" role="tabpanel" aria-labelledby="tab-read" className="space-y-3 anim-slide-in">
            <div
              role="alert"
              className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              Isi modul ditahan sampai sitasi hantu diperbaiki. Ini gerbang deterministik Tahap 1
              (bukan penilaian AI): penanda [n] di bawah tidak punya paper yang disetujui.
            </div>
            <ReliabilityGauge
              moduleId={detail.id}
              verification={verification}
              online={online}
              onVerification={setVerification}
              onContentChanged={() => void reloadModule()}
              onError={setError}
            />
          </div>
        ) : (
          <ReadStep
            topicId={detail.topicId}
            moduleId={detail.id}
            contentMarkdown={content}
            pageCount={detail.pageCount}
            pretestDone={pretestDone}
            onPretestDone={() => setPretestDone(true)}
            onCite={(n) => {
              setCiteTarget(n);
              changeTab("sources");
            }}
          />
        ))}

      {tab === "ask" &&
        (blocked ? (
          <div
            id="panel-ask"
            role="tabpanel"
            aria-labelledby="tab-ask"
            className="space-y-3 anim-slide-in"
          >
            <div
              role="alert"
              className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              Tanya ditahan sampai sitasi hantu diperbaiki di tab Sumber (gerbang deterministik
              Tahap 1, bukan penilaian AI).
            </div>
          </div>
        ) : (
          <AskStep
            detail={detail}
            online={online}
            postJSON={postJSON}
            recallDone={recallDone}
            onRecallDone={setRecallDone}
            onError={setError}
            onStatus={setStatus}
          />
        ))}

      {tab === "test" &&
        (blocked ? (
          <div
            id="panel-test"
            role="tabpanel"
            aria-labelledby="tab-test"
            className="space-y-3 anim-slide-in"
          >
            <div
              role="alert"
              className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              Latihan ditahan sampai sitasi hantu diperbaiki di tab Sumber (gerbang deterministik
              Tahap 1, bukan penilaian AI).
            </div>
          </div>
        ) : (
          <PracticeStep
            detail={detail}
            online={online}
            courseId={courseId}
            closedBook={closedBook}
            setClosedBook={setClosedBook}
            stats={stats}
            attempts={attempts}
            attemptsLoading={attemptsLoading}
            recordAttempts={recordAttempts}
            onGraded={() => void loadAttempts()}
            postJSON={postJSON}
            onError={setError}
            onStatus={setStatus}
          />
        ))}

      {tab === "sources" && (
        <section id="panel-sources" role="tabpanel" aria-labelledby="tab-sources" className="space-y-6 anim-slide-in">
          <ReliabilityGauge
            moduleId={detail.id}
            verification={verification}
            online={online}
            onVerification={setVerification}
            onContentChanged={() => void reloadModule()}
            onError={setError}
          />
          <div>
            <h3 className="mb-2 font-semibold">Paper sumber</h3>
            {detail.sourcePapers.length === 0 ? (
              <p className="text-sm text-muted leading-relaxed">Modul ini belum mencatat paper sumber.</p>
            ) : (
              <ul className="space-y-2">
                {detail.sourcePapers.map((p, idx) => {
                  const active = citeTarget === idx + 1;
                  return (
                    <li
                      key={p.id}
                      ref={(el) => {
                        sourceRefs.current[idx] = el;
                      }}
                      className={`rounded-card border bg-card p-3 ${
                        active ? "border-brand-500 ring-2 ring-brand-500" : "border-border"
                      }`}
                    >
                      {active && (
                        <span className="mb-1 inline-block rounded bg-brand-500/15 px-1.5 text-xs font-semibold text-link">
                          Sumber {idx + 1}
                        </span>
                      )}
                      <a
                        href={p.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                      >
                        {p.title}
                      </a>
                      <p className="text-xs text-muted">
                        {p.authors} · {p.year} · {p.citationCount} sitasi
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Versi modul</h3>
            <ul className="space-y-1">
              {detail.versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between rounded-card bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/40"
                >
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-muted">{new Date(v.generatedAt).toLocaleString("id-ID")}</span>
                  <span className="text-muted">{v.changeNote ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {confirmDelete && (
        <Modal
          open
          title="Hapus modul ini?"
          onClose={() => setConfirmDelete(false)}
          className="max-w-sm"
        >
          <div className="space-y-3 px-4 py-4 text-sm">
            <p className="text-muted leading-relaxed">
              Topik, paper, dan seluruh riwayat latihannya ikut terhapus. Tindakan ini tidak bisa
              dibatalkan.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className={CHIP_CLASS}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={deleteModule}
                className="tap min-h-11 rounded-card bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                Hapus modul
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ExportDropdown({
  detail,
  online,
  blocked,
}: {
  detail: ModuleDetail;
  online: boolean;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, []);

  const disabled = !online || blocked;
  const disabledReason = blocked
    ? "Ekspor ditahan: ada sitasi hantu (Tahap 1 gagal). Perbaiki dulu di tab Sumber."
    : "Ekspor butuh internet. Sambungkan dulu.";

  return (
    <div className="relative sm:hidden" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${CHIP_CLASS} inline-flex items-center gap-1 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        title={disabled ? disabledReason : "Pilih format ekspor"}
      >
        <Icon name="download" className="size-3" />
        Ekspor
        <Icon name="chevron-down" className="size-3" />
      </button>
      {open && !disabled && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-card border border-border bg-card shadow-lg"
        >
          {EXPORT_ITEMS.map((item) => (
            <li key={item.format}>
              <a
                href={`/api/modules/${detail.id}/export?format=${item.format}`}
                download
                role="option"
                aria-selected="true"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-link transition hover:bg-brand-500/5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                <Icon name="download" className="size-3.5 shrink-0" />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
