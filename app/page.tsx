"use client";

/* eslint-disable react-hooks/set-state-in-effect -- effect-driven data fetching from API */

import { useCallback, useEffect, useState } from "react";
import type {
  CourseSummary,
  ModuleDetail,
  UsageRow,
  CandidatePaper,
  TopicRef,
  ProgressData,
} from "./lib/types";
import Sidebar from "./components/Sidebar";
import Composer, { type ComposerSubmission } from "./components/Composer";
import Workspace from "./components/Workspace";
import UsageModal from "./components/UsageModal";
import PaperReview from "./components/PaperReview";
import RPSReconcilePanel from "./components/RPSReconcilePanel";
import CourseBatchImport from "./components/CourseBatchImport";
import SosoOnboarding from "./components/SosoOnboarding";
import SosoReminder from "./components/SosoReminder";
import InstallGuide from "./components/InstallGuide";
import PushOptIn from "./components/PushOptIn";
import { SynthesisSkeleton } from "./components/Skeletons";
import ErrorBoundary from "./components/ErrorBoundary";
import Modal from "./components/Modal";
import { apiFetch } from "./lib/api";

interface ReviewState {
  topicId: string;
  title: string;
  papers: CandidatePaper[];
  courseId?: string;
  courseName?: string;
  courseMajor?: string;
}

function weekDueLabel(wk?: number | null, due?: string | null): string {
  const parts: string[] = [];
  if (wk != null) parts.push(`Minggu ${wk}`);
  if (due) {
    const d = new Date(due);
    if (!isNaN(d.getTime())) parts.push(`jatuh tempo ${d.toLocaleDateString("id-ID")}`);
  }
  return parts.join(" · ");
}

/**
 * Topics whose order nobody has confirmed against the lecturer's RPS. Shown as
 * an explicit badge rather than left implicit: R1 (order mismatch) is a High/High
 * risk, and a silently-unverified order looks identical to a verified one.
 */
function isUnverifiedOrder(orderSource?: string): boolean {
  return orderSource !== "official_rps";
}

function UnverifiedOrderBadge() {
  return (
    <span
      title="Urutan topik ini belum dicocokkan dengan RPS/urutan dosen"
      className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
    >
      URUTAN BELUM DIVERIFIKASI
    </span>
  );
}

const PRIMARY_CLASS =
  "tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50";
const SECONDARY_CLASS =
  "tap min-h-11 rounded-card border border-border px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800";

export default function Home() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [progressNonce, setProgressNonce] = useState(0);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [topicToDelete, setTopicToDelete] = useState<TopicRef | null>(null);
  const [rpsOpen, setRpsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const refreshCourses = useCallback(async () => {
    try {
      const res = await apiFetch("/api/courses");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCourses(data.courses ?? []);
      setCoursesLoaded(true);
      setProgressNonce((n) => n + 1);
    } catch (e) {
      setError("Gagal memuat daftar mata kuliah: " + (e as Error).message);
    }
  }, []);

  useEffect(() => {
    refreshCourses();
  }, [refreshCourses]);

  useEffect(() => {
    if (!activeCourseId && courses.length > 0) {
      setActiveCourseId(courses[0].id);
    }
  }, [courses, activeCourseId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!activeCourseId) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/progress?courseId=${encodeURIComponent(activeCourseId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as ProgressData;
        if (!cancelled) setProgress(data);
      } catch {
        /* leave progress unset on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCourseId, progressNonce]);

  const openModule = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    setStatus("Membuka modul…");
    try {
      const res = await apiFetch(`/api/modules/${id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setDetail(d);
      setStatus("Modul terbuka.");
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Resolve the Course a new topic belongs to *before* retrieval, creating it
   * from the typed name when needed. Retrieval persists the Topic, so the id
   * has to exist by then or the topic lands in the shared default course and
   * disappears from the course the student picked.
   *
   * The major travels with the create: retrieval reads it back off the course to
   * bias the OpenAlex query, so a course created without it would retrieve
   * discipline-neutral papers.
   */
  const ensureCourseId = useCallback(
    async (courseId?: string, courseName?: string, major?: string): Promise<string | undefined> => {
      if (courseId && !major) return courseId;
      const name = courseName?.trim();
      if (!courseId && !name) return undefined;
      try {
        // With a courseId and a major we still POST: the endpoint backfills a
        // missing major and is idempotent otherwise.
        const existingName = courseId
          ? courses.find((c) => c.id === courseId)?.name
          : undefined;
        const body = courseId
          ? { name: existingName ?? name, major }
          : { name, major };
        if (!body.name) return courseId;
        const res = await apiFetch("/api/courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        return typeof data.id === "string" ? data.id : courseId;
      } catch (e) {
        // Not fatal: the topic is still created, just under the default course.
        setError(`Mata kuliah "${name ?? ""}" gagal dibuat: ${(e as Error).message}`);
        return courseId;
      }
    },
    [courses],
  );

  const startModule = useCallback(
    async (submission: ComposerSubmission) => {
      const { title, keywords, courseId, courseName, courseMajor, weekNumber, dueBeforeLecture } =
        submission;
      setComposerOpen(false);
      setBusy(true);
      setError(null);
      setStatus("Mencari paper untuk topik ini…");
      try {
        const resolvedCourseId = await ensureCourseId(courseId, courseName, courseMajor);
        const res = await apiFetch("/api/retrieve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            keywords,
            weekNumber,
            dueBeforeLecture,
            courseId: resolvedCourseId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setReview({
          topicId: data.topicId,
          title,
          papers: data.papers,
          courseId: resolvedCourseId,
          courseName,
          courseMajor,
        });
        setStatus(`${data.papers?.length ?? 0} paper kandidat siap ditinjau.`);
      } catch (e) {
        setError((e as Error).message);
        setStatus("");
      } finally {
        setBusy(false);
      }
    },
    [ensureCourseId],
  );

  const confirmApproval = useCallback(
    async (topicId: string, approvedIds: string[]) => {
      setBusy(true);
      setError(null);
      setStatus("Menyimpan persetujuan paper…");
      try {
        const patch = await apiFetch(`/api/papers/${topicId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvedPaperIds: approvedIds }),
        });
        if (!patch.ok) {
          const d = await patch.json().catch(() => ({}));
          throw new Error(d.error ?? `HTTP ${patch.status}`);
        }
        const courseId = await ensureCourseId(
          review?.courseId,
          review?.courseName,
          review?.courseMajor,
        );
        setSynthesizing(true);
        setStatus("Menyusun modul dari paper yang Anda setujui…");
        const res = await apiFetch("/api/synthesize", {
          method: "POST",
          // Asking for SSE is the only difference from before: the route keeps
          // answering plain JSON for any client that does not read streams, so
          // this handler must cope with both shapes.
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ topicId, title: review?.title, courseId }),
        });
        if (!res.ok) {
          const failed = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(failed.error ?? `HTTP ${res.status}`);
        }

        type SynthesisDone = {
          moduleId?: string;
          error?: string;
          text?: string;
          groundingReport?: { ok: boolean; checked: number; flagged: unknown[]; score: number };
          /** Two-tier accuracy summary; the full reports travel with the module. */
          accuracy?: {
            blocked: boolean;
            score: number;
            band: string;
            flagCount: number;
            phantomCitations: number;
            tier2Ran: boolean;
          };
        };
        let data: SynthesisDone | null = null;
        const contentType = res.headers?.get("content-type") ?? "";

        if (contentType.includes("text/event-stream") && res.body) {
          // Progressive read: each `data:` frame extends the draft (so the wait
          // shows real work instead of a mute spinner), and the final
          // `event: done` frame carries the module id + grounding report.
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let draft = "";
          let announced = 0;
          let streamError: string | null = null;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
            let cut = buffer.indexOf("\n\n");
            while (cut !== -1) {
              const frame = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              cut = buffer.indexOf("\n\n");
              let event = "message";
              const payloadLines: string[] = [];
              for (const line of frame.split("\n")) {
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("data:")) payloadLines.push(line.slice(5).replace(/^ /, ""));
              }
              if (payloadLines.length === 0) continue;
              let payload: SynthesisDone;
              try {
                payload = JSON.parse(payloadLines.join("\n")) as SynthesisDone;
              } catch {
                continue; // an unparseable frame is skipped, never fatal
              }
              if (event === "done") {
                data = payload;
              } else if (event === "error") {
                streamError = payload.error ?? "Penyusunan modul gagal di tengah aliran.";
              } else if (typeof payload.text === "string") {
                draft += payload.text;
                // Stepped announcements: a live region updated per token would
                // be unreadable for a screen reader.
                if (draft.length - announced >= 200) {
                  announced = draft.length;
                  setStatus(`Menyusun modul… ${draft.length} karakter tersusun.`);
                }
              }
            }
          }
          if (streamError) throw new Error(streamError);
        } else {
          // Not a stream: the route's JSON fallback, a buffering proxy, or an
          // older server. Same payload, same flow from here on.
          data = (await res.json()) as SynthesisDone;
        }

        setReview(null);
        await refreshCourses();
        if (!data) throw new Error("Respons sintesis tidak lengkap. Coba susun ulang modul.");
        setStatus("Modul selesai disusun.");
        if (data.moduleId) await openModule(data.moduleId);
        // Surface the harness verdict last (openModule overwrites status): a
        // flagged citation is precisely what the student should re-read.
        // Order matters — the Tier 1 hard block is the one thing that changes
        // what the student can do next, so it wins over the advisory numbers.
        const accuracy = data.accuracy;
        const report = data.groundingReport;
        if (accuracy?.blocked) {
          setStatus(
            `Modul selesai tapi DITAHAN: ${accuracy.phantomCitations} sitasi tidak menunjuk paper mana pun. ` +
              "Buka tab Sumber untuk memperbaikinya.",
          );
        } else if (accuracy && accuracy.flagCount > 0) {
          setStatus(
            `Modul selesai — skor keandalan ${Math.round(accuracy.score * 100)}/100, ` +
              `${accuracy.flagCount} klaim ditandai untuk ditinjau${accuracy.tier2Ran ? "" : " (tinjauan AI belum jalan)"}.`,
          );
        } else if (report && !report.ok) {
          setStatus(
            `Modul selesai — ${report.flagged.length} dari ${report.checked} sitasi perlu diperiksa (skor grounding ${report.score}).`,
          );
        }
      } catch (e) {
        setError((e as Error).message);
        setStatus("");
      } finally {
        setBusy(false);
        setSynthesizing(false);
      }
    },
    [refreshCourses, ensureCourseId, review, openModule],
  );

  const handleSelectTopic = useCallback(
    async (t: TopicRef) => {
      setBusy(true);
      setError(null);
      setStatus("Memuat paper kandidat…");
      try {
        const res = await apiFetch(`/api/papers/${t.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setReview({ topicId: t.id, title: t.title, papers: data.papers, courseId: t.courseId });
        setStatus("");
      } catch (e) {
        setError((e as Error).message);
        setStatus("");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // A topic without a module has no "Hapus modul" button anywhere, so it could
  // only ever be abandoned. Deleting it removes the topic and its papers.
  const deleteTopic = useCallback(
    async (t: TopicRef) => {
      setTopicToDelete(null);
      setBusy(true);
      setError(null);
      setStatus(`Menghapus topik ${t.title}…`);
      try {
        const res = await apiFetch(`/api/topics/${t.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setStatus(`Topik "${t.title}" dihapus.`);
        await refreshCourses();
      } catch (e) {
        setError((e as Error).message);
        setStatus("");
      } finally {
        setBusy(false);
      }
    },
    [refreshCourses],
  );

  const openUsage = useCallback(async () => {
    try {
      const res = await apiFetch("/api/usage");
      const data = await res.json();
      setUsage(data.usage ?? []);
      setUsageOpen(true);
    } catch (e) {
      setError("Gagal memuat biaya AI: " + (e as Error).message);
    }
  }, []);

  const handleModuleChanged = useCallback(() => {
    refreshCourses();
  }, [refreshCourses]);

  const handleModuleDeleted = useCallback(() => {
    setDetail(null);
    refreshCourses();
  }, [refreshCourses]);

  const handleOnboarded = useCallback(() => {
    // The wizard created the first courses; hide it immediately (so it can't
    // flash back during the refetch) and pull the fresh course list so the
    // dashboard renders behind it.
    setOnboardingDone(true);
    void refreshCourses();
  }, [refreshCourses]);

  const activeCourse = courses.find((c) => c.id === activeCourseId) ?? null;
  const totalItems = activeCourse ? activeCourse.modules.length + activeCourse.topics.length : 0;

  const readyItems = progress
    ? progress.topics.filter((t) => t.hasModule && t.attempts >= 1).length
    : activeCourse
      ? activeCourse.modules.length
      : 0;
  const pct = totalItems ? Math.round((readyItems / totalItems) * 100) : 0;
  const overdueCount = progress ? progress.topics.filter((t) => t.overdue).length : 0;
  // Topics (with or without a module) still on a self-chosen order.
  const unverifiedOrderCount = activeCourse
    ? activeCourse.modules.filter((m) => isUnverifiedOrder(m.orderSource)).length +
      activeCourse.topics.filter((t) => isUnverifiedOrder(t.orderSource)).length
    : 0;

  const isDueToday = (due?: string | null): boolean => {
    if (!due) return false;
    const d = new Date(due);
    if (isNaN(d.getTime())) return false;
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return d.getTime() <= end.getTime();
  };

  // The progress API computes this across every course (Asia/Jakarta days); the
  // local pass is only the fallback while that request is still in flight.
  const localDueTodayByCourse: Record<string, number> = {};
  for (const c of courses) {
    let n = 0;
    for (const m of c.modules) if (isDueToday(m.dueBeforeLecture)) n += 1;
    for (const t of c.topics) if (isDueToday(t.dueBeforeLecture)) n += 1;
    if (n > 0) localDueTodayByCourse[c.id] = n;
  }
  const dueTodayByCourse = progress?.dueTodayByCourse ?? localDueTodayByCourse;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <InstallGuide />
      {coursesLoaded && courses.length === 0 && !onboardingDone && (
        <SosoOnboarding onFinished={handleOnboarded} />
      )}
      <header
        className="sticky z-40 flex items-center gap-3 border-b border-border bg-white/80 px-4 py-3 backdrop-blur print:hidden dark:bg-zinc-900/70 sm:px-6"
        style={{ top: "env(safe-area-inset-top)" }}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            <h1 className="text-base font-semibold">So-study</h1>
            <span className="sr-only">{online ? "Terhubung" : "Mode offline"}</span>
          </div>
          <p className="text-xs text-muted">Head-start pra-kuliah · baca, tanya, latih</p>
        </div>
        <button type="button" onClick={openUsage} className={SECONDARY_CLASS}>
          Biaya AI
        </button>
        <button type="button" onClick={() => setComposerOpen(true)} className={PRIMARY_CLASS}>
          + Topik
        </button>
      </header>

      {/* No `overflow-hidden` here: on iOS Safari a clipped shell fights the
          dynamic toolbars and the on-screen keyboard, stranding content. */}
      <div className="flex flex-1">
        <Sidebar
          courses={courses}
          activeCourseId={activeCourseId}
          onSelectCourse={(id) => {
            setActiveCourseId(id);
            setDetail(null);
          }}
          onNew={() => setComposerOpen(true)}
          onBatchImport={() => setBatchOpen(true)}
          dueTodayByCourse={dueTodayByCourse}
        />
        <ErrorBoundary>
          <main className="min-w-0 flex-1">
            <SosoReminder progress={progress} />
            <PushOptIn />
            {/* Async progress is announced, never only shown as a spinner. */}
            <p role="status" aria-live="polite" className="sr-only">
              {busy && !status ? "Memuat…" : status}
            </p>

            {error && (
              <div
                role="alert"
                className="m-4 flex items-center justify-between rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Tutup pesan galat"
                  className="tap ml-3 min-h-11 rounded-card px-2 text-red-600 transition hover:text-red-800 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:text-red-300"
                >
                  ✕
                </button>
              </div>
            )}

            {detail ? (
              <div>
                <div className="border-b border-border px-4 py-2 sm:px-6">
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="tap min-h-11 text-sm text-link hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                  >
                    ← Kembali ke {activeCourse?.name ?? "daftar"}
                  </button>
                </div>
                <Workspace
                  key={detail.id}
                  detail={detail}
                  online={online}
                  courseId={activeCourseId ?? undefined}
                  onModuleChanged={handleModuleChanged}
                  onModuleDeleted={handleModuleDeleted}
                />
              </div>
            ) : activeCourse ? (
              <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-bold">{activeCourse.name}</h2>
                  <span className="text-xs text-muted">
                    {readyItems}/{totalItems} topik siap
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {activeCourse.major ? (
                    <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-link">
                      Jurusan: {activeCourse.major}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted">Jurusan belum diisi</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRpsOpen(true)}
                    className="tap min-h-11 rounded-card border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
                  >
                    Cocokkan urutan RPS
                    {unverifiedOrderCount > 0 ? ` (${unverifiedOrderCount} belum)` : ""}
                  </button>
                </div>
                {progress && (
                  <p className="mb-3 text-xs text-muted">
                    {progress.dueTodayCount} jatuh tempo hari ini · streak {progress.streakDays} hari
                    {" · "}
                    rata-rata penguasaan {progress.avgMastery ?? "—"}%
                    {overdueCount > 0 ? ` · ${overdueCount} ulangan terlambat` : ""}
                  </p>
                )}
                <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                {totalItems === 0 && (
                  <div className="rounded-card border border-dashed border-border p-8 text-center">
                    <p className="text-muted">Belum ada topik di mata kuliah ini.</p>
                    <p className="mt-1 px-6 text-xs text-muted">
                      Buat topik untuk menyusun modul dari paper akademik, lalu baca &amp; latih
                      sebelum kuliah.
                    </p>
                    <button
                      type="button"
                      onClick={() => setComposerOpen(true)}
                      className={`mt-3 ${PRIMARY_CLASS}`}
                    >
                      Buat topik pertama
                    </button>
                  </div>
                )}

                <ul className="space-y-2">
                  {activeCourse.modules.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => openModule(m.id)}
                        className="tap flex min-h-11 w-full items-center justify-between gap-3 rounded-card border border-border bg-card px-4 py-3 text-left transition hover:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{m.title}</p>
                          <p className="text-xs text-emerald-700 dark:text-emerald-400">
                            Modul siap · baca &amp; latih
                            {weekDueLabel(m.weekNumber, m.dueBeforeLecture) &&
                              ` · ${weekDueLabel(m.weekNumber, m.dueBeforeLecture)}`}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                          SIAP
                        </span>
                        {isUnverifiedOrder(m.orderSource) && <UnverifiedOrderBadge />}
                      </button>
                    </li>
                  ))}
                  {activeCourse.topics.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-stretch gap-2 rounded-card border border-border bg-card"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectTopic(t)}
                        className="tap flex min-h-11 flex-1 items-center justify-between gap-3 rounded-card px-4 py-3 text-left transition hover:bg-brand-500/5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.title}</p>
                          <p className="text-xs text-muted">
                            Belum ada modul · buat sekarang
                            {weekDueLabel(t.weekNumber, t.dueBeforeLecture) &&
                              ` · ${weekDueLabel(t.weekNumber, t.dueBeforeLecture)}`}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          BARU
                        </span>
                        {isUnverifiedOrder(t.orderSource) && <UnverifiedOrderBadge />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTopicToDelete(t)}
                        aria-label={`Hapus topik ${t.title}`}
                        title="Hapus topik ini"
                        className="tap m-2 min-h-11 min-w-11 rounded-card border border-red-300 px-2 text-sm font-medium text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>

                <p className="mt-6 rounded-card bg-brand-500/10 px-4 py-3 text-xs leading-relaxed text-link">
                  Kunci: datang ke kuliah sudah punya kerangka. Modul ini <strong>bukan</strong>{" "}
                  pengganti kuliah — bacalah sebelum pertemuan agar waktu di kelas dipakai untuk
                  mendalami, bukan mulai dari nol. Latihan menjawab (retrieval practice) adalah cara
                  belajar paling efektif, lebih baik daripada membaca ulang.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-muted">Belum ada mata kuliah.</p>
                <p className="max-w-xs text-xs text-muted">
                  Buat mata kuliah lalu tambahkan topik: susun modul dari paper, baca, lalu latih
                  (retrieval practice) sebelum kuliah dimulai.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setComposerOpen(true)}
                    className={PRIMARY_CLASS}
                  >
                    Buat topik
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchOpen(true)}
                    className={SECONDARY_CLASS}
                  >
                    Impor semester
                  </button>
                </div>
              </div>
            )}
          </main>
        </ErrorBoundary>
      </div>

      {/* Dialogs get their own boundary: a throw inside a modal used to blank the
          whole app because only <main> was guarded. */}
      <ErrorBoundary>
        {composerOpen && (
          <Composer
            courses={courses.map((c) => ({ id: c.id, name: c.name, major: c.major }))}
            defaultCourseId={activeCourseId ?? undefined}
            onCreate={startModule}
            onClose={() => setComposerOpen(false)}
            busy={busy}
          />
        )}
        {review && (
          <PaperReview
            topicId={review.topicId}
            title={review.title}
            papers={review.papers}
            busy={busy}
            onConfirm={confirmApproval}
            onClose={() => setReview(null)}
          />
        )}
        {synthesizing && (
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            <h2 className="mb-3 text-xl font-bold">Menyusun modul…</h2>
            <SynthesisSkeleton />
          </div>
        )}
        {usageOpen && <UsageModal rows={usage} onClose={() => setUsageOpen(false)} />}

        {rpsOpen && activeCourseId && (
          <RPSReconcilePanel
            courseId={activeCourseId}
            onClose={() => setRpsOpen(false)}
            onReconciled={() => {
              // Reconciling rewrites Topic.orderSource, which the dashboard
              // badges read — refetch so they stop claiming "unverified".
              void refreshCourses();
              setStatus("Urutan RPS disimpan.");
            }}
          />
        )}

        {batchOpen && (
          <CourseBatchImport
            onClose={() => setBatchOpen(false)}
            onImported={(count) => {
              setBatchOpen(false);
              setStatus(`${count} mata kuliah dibuat.`);
              void refreshCourses();
            }}
          />
        )}

        {topicToDelete && (
          <Modal
            open
            title="Hapus topik ini?"
            onClose={() => setTopicToDelete(null)}
            className="max-w-sm"
          >
            <div className="space-y-3 px-4 py-4 text-sm">
              <p className="text-muted">
                &ldquo;{topicToDelete.title}&rdquo; belum punya modul. Topik ini beserta daftar paper
                kandidatnya akan dihapus permanen.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setTopicToDelete(null)}
                  className={SECONDARY_CLASS}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => deleteTopic(topicToDelete)}
                  className="tap min-h-11 rounded-card bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                >
                  Hapus topik
                </button>
              </div>
            </div>
          </Modal>
        )}
      </ErrorBoundary>
    </div>
  );
}
