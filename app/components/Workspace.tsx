"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AssessmentAttempt, ModuleDetail, VerificationPayload } from "../lib/types";
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

const TABS = [
  { id: "read", label: "Baca" },
  { id: "ask", label: "Tanya" },
  { id: "test", label: "Latihan" },
  { id: "sources", label: "Sumber" },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
  onModuleDeleted?: () => void;
}) {
  const [tab, setTab] = useState<TabId>("read");
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

  const [pretestDone, setPretestDone] = useState(() => hasTakenPretest(detail.topicId));
  const [recallDone, setRecallDone] = useState(() => hasRecall(detail.topicId));

  const [closedBook, setClosedBook] = useState(false);

  // Accuracy verification for THIS module (Tier 1 gate + Tier 2 advisory flags).
  // Held in state, not read straight from the prop, because the gauge can refresh
  // it (a Tier 1 re-check, a Tier 2 review, a targeted repair) and the reader must
  // react to the result in the same session — a module unblocked by a repair
  // should become readable without a page reload.
  const [verification, setVerification] = useState<VerificationPayload | undefined>(
    detail.verification,
  );
  const [content, setContent] = useState(detail.contentMarkdown);
  // Tier 1 FAIL = a phantom citation. Deterministic, not a judgement call, so it
  // is a HARD gate: the module body is not shown and exports are withheld until
  // it is fixed. Tier 2 flags never reach this variable — an AI critic does not
  // get to withhold the student's module.
  const blocked = Boolean(verification?.tier1?.blocked);
  const gaugeScore = verification?.gauge ? Math.round(verification.gauge.score * 100) : null;

  // After a repair the server holds new markdown + fresh reports; re-read the
  // module so the reader shows the repaired text (the parent keeps its own copy
  // of the detail for the sidebar, which does not change here).
  const reloadModule = useCallback(async () => {
    try {
      const res = await fetch(`/api/modules/${detail.id}`);
      const d = (await res.json().catch(() => ({}))) as Partial<ModuleDetail>;
      if (!res.ok) return;
      if (typeof d.contentMarkdown === "string") setContent(d.contentMarkdown);
      if (d.verification) setVerification(d.verification);
    } catch {
      /* the gauge already carries the fresh report it returned */
    }
  }, [detail.id]);

  // Attempt history for this module: feeds the calibration panel, the Nilai step
  // and the desirable-difficulty guardrail. Optional data — a failure only hides them.
  const [attempts, setAttempts] = useState<AssessmentAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);

  useEffect(() => {
    if (citeTarget != null && tab === "sources") {
      sourceRefs.current[citeTarget - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [citeTarget, tab]);

  const loadAttempts = useCallback(async () => {
    try {
      const res = await fetch(
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
    const res = await fetch(url, {
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
    const res = await fetch(url, {
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
    try {
      const data = await delJSON(`/api/modules/${detail.id}`, {});
      if (!data.ok) throw new Error("Gagal menghapus modul.");
      onModuleDeleted?.();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
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
    setTab(nextId);
    tablistRef.current?.querySelector<HTMLButtonElement>(`#tab-${nextId}`)?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold">{detail.topicTitle}</h1>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="tap shrink-0 rounded-card border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 transition disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none print:hidden hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            {deleting ? "Menghapus…" : "Hapus modul"}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
          {/* Score chip: a summary that always links to the full breakdown — the
              number is never the whole story, so tapping it opens the panel that
              explains it. */}
          <button
            type="button"
            onClick={() => setTab("sources")}
            className={`rounded-full px-2 py-0.5 text-xs font-semibold print:hidden ${
              blocked
                ? "bg-red-500/15 text-red-700 dark:text-red-300"
                : gaugeScore == null
                  ? "bg-zinc-500/15 text-muted"
                  : "bg-brand-500/15 text-link"
            }`}
            title="Lihat rincian keandalan (Tahap 1 + Tahap 2)"
          >
            {blocked
              ? "Keandalan: ditahan"
              : gaugeScore == null
                ? "Keandalan: belum diperiksa"
                : `Keandalan: ${gaugeScore}/100`}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
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
        </div>

        <div
          className="mt-2 flex flex-wrap items-center gap-2 print:hidden"
          aria-label="Ekspor modul"
        >
          <span className="text-xs text-muted">Ekspor:</span>
          {online && !blocked ? (
            <>
              <a
                href={`/api/modules/${detail.id}/export?format=md`}
                download
                title="Unduh modul + daftar sumber sebagai Markdown"
                className={`${CHIP_CLASS} inline-flex items-center`}
              >
                Markdown
              </a>
              <a
                href={`/api/modules/${detail.id}/export?format=anki`}
                download
                title="Unduh soal (bank soal Anda, atau soal cloze otomatis) untuk diimpor ke Anki"
                className={`${CHIP_CLASS} inline-flex items-center`}
              >
                Anki
              </a>
              <a
                href={`/api/modules/${detail.id}/export?format=pdf`}
                download
                title="Unduh modul sebagai PDF (dibuat di server)"
                className={`${CHIP_CLASS} inline-flex items-center`}
              >
                PDF
              </a>
            </>
          ) : (
            <>
              <span
                className={`${CHIP_CLASS} inline-flex cursor-not-allowed items-center opacity-50`}
                title={
                  blocked
                    ? "Ekspor ditahan: ada sitasi hantu (Tahap 1 gagal). Perbaiki dulu di tab Sumber."
                    : "Ekspor butuh internet. Sambungkan dulu."
                }
                aria-disabled="true"
              >
                Markdown
              </span>
              <span
                className={`${CHIP_CLASS} inline-flex cursor-not-allowed items-center opacity-50`}
                title={
                  blocked
                    ? "Ekspor ditahan: ada sitasi hantu (Tahap 1 gagal). Perbaiki dulu di tab Sumber."
                    : "Ekspor butuh internet. Sambungkan dulu."
                }
                aria-disabled="true"
              >
                Anki
              </span>
              <span
                className={`${CHIP_CLASS} inline-flex cursor-not-allowed items-center opacity-50`}
                title={
                  blocked
                    ? "Ekspor ditahan: ada sitasi hantu (Tahap 1 gagal). Perbaiki dulu di tab Sumber."
                    : "Ekspor butuh internet. Sambungkan dulu."
                }
                aria-disabled="true"
              >
                PDF
              </span>
            </>
          )}
        </div>
      </header>

      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Alur belajar modul"
        onKeyDown={onTabKeyDown}
        className="mb-5 flex gap-1 rounded-card bg-zinc-100 p-1 print:hidden dark:bg-zinc-800/60"
      >
        {visibleTabIds(closedBook).map((id) => {
          const t = TABS.find((x) => x.id === id)!;
          return (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              type="button"
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={`tap min-h-11 flex-1 rounded-card px-3 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                tab === t.id
                  ? "bg-card text-link shadow-sm"
                  : "text-muted hover:text-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
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
        <div className="mb-4 rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Mode offline — membaca tetap bisa, tapi Tanya, Latihan, dan ekspor (Markdown / Anki / PDF)
          butuh internet.
        </div>
      )}

      {tab === "read" &&
        (blocked ? (
          // HARD GATE (Tier 1): a phantom citation is unambiguously wrong, so the
          // module body is withheld rather than flagged. The panel shows exactly
          // which sentences are at fault and offers the targeted fix.
          <div id="panel-read" role="tabpanel" aria-labelledby="tab-read" className="space-y-3">
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
              setTab("sources");
            }}
          />
        ))}

      {tab === "ask" && (
        <AskStep
          detail={detail}
          online={online}
          postJSON={postJSON}
          recallDone={recallDone}
          onRecallDone={setRecallDone}
          onError={setError}
          onStatus={setStatus}
        />
      )}

      {tab === "test" && (
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
      )}

      {tab === "sources" && (
        <section id="panel-sources" role="tabpanel" aria-labelledby="tab-sources" className="space-y-6">
          {/* Grounding lives with the sources: the gauge is a statement about how
              well the module is wired to the papers listed right below it. */}
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
              <p className="text-sm text-muted">Modul ini belum mencatat paper sumber.</p>
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
            <p className="text-muted">
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
