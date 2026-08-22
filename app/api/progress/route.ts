import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireUser, notFoundForUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TopicProgress {
  topicId: string;
  title: string;
  hasModule: boolean;
  status: string;
  dueBeforeLecture: string | null;
  dueToday: boolean;
  overdue: boolean;
  attempts: number;
  masteryPct: number;
  nextReview: string | null;
}

interface HeatmapEntry {
  date: string;
  count: number;
}

// 30 days of history including today.
const HEATMAP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// WIB (Asia/Jakarta) is UTC+7.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Jakarta-local YYYY-MM-DD. Uses the student timezone, not server UTC, so
// streak/heatmap boundaries never shift by a day depending on host TZ.
function jakartaDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Instant (UTC) for 00:00 WIB of the Jakarta today.
function startOfTodayJakarta(): Date {
  const [y, m, day] = jakartaDayKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day) - WIB_OFFSET_MS);
}

// Instant (UTC) for the last millisecond of the Jakarta today.
function endOfTodayJakarta(): Date {
  return new Date(startOfTodayJakarta().getTime() + DAY_MS - 1);
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const courseId = req.nextUrl.searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "Query 'courseId' is required." }, { status: 400 });
  }

  // The requested course must be the caller's. This is a CONTRACT CHANGE: an
  // unknown courseId used to return an empty-but-successful dashboard, and now
  // returns 404 — the same answer another student's real course id gets, so the
  // response cannot be used to probe which course ids exist.
  const course = await prisma.course.findFirst({ where: { id: courseId, ownerId }, select: { id: true } });
  if (!course) return notFoundForUser("Mata kuliah");

  const topics = await prisma.topic.findMany({
    where: { courseId, ownerId },
    include: { module: true, attempts: true },
  });

  const end = endOfTodayJakarta();
  const start = startOfTodayJakarta();

  // Per-course due-today counts (Sidebar badge) across every course THIS student
  // owns. Unscoped, this loop leaked the other student's course ids (as keys of
  // `dueTodayByCourse`) and her workload straight into my sidebar.
  const allTopics = await prisma.topic.findMany({
    where: { ownerId },
    select: { courseId: true, dueBeforeLecture: true },
  });
  const dueTodayByCourse: Record<string, number> = {};
  for (const t of allTopics) {
    const due =
      t.dueBeforeLecture != null && t.dueBeforeLecture.getTime() <= end.getTime();
    if (due) {
      dueTodayByCourse[t.courseId] = (dueTodayByCourse[t.courseId] ?? 0) + 1;
    }
  }
  const dueTodayCount = dueTodayByCourse[courseId] ?? 0;

  // Attempt counts per Jakarta day (heatmap + streak), from active-course topics.
  const dayCounts = new Map<string, number>();

  const topicProgress: TopicProgress[] = topics.map((topic) => {
    const dueBeforeLecture = topic.dueBeforeLecture
      ? topic.dueBeforeLecture.toISOString()
      : null;
    const dueToday =
      topic.dueBeforeLecture != null &&
      topic.dueBeforeLecture.getTime() <= end.getTime();

    const attempts = topic.attempts;

    // Mastery: only count attempts with a boolean score (exclude essay
    // attempts written with isCorrect undefined/null).
    const scored = attempts.filter((a) => typeof a.isCorrect === "boolean");
    const correct = scored.filter((a) => a.isCorrect === true).length;
    const masteryPct =
      scored.length > 0 ? Math.round((correct / scored.length) * 100) : 0;

    const scheduled = attempts
      .map((a) => a.scheduledNextAt)
      .filter((d): d is Date => d != null);
    const nextReviewDate =
      scheduled.length > 0
        ? scheduled.reduce((min, d) => (d.getTime() < min.getTime() ? d : min))
        : null;
    const nextReview = nextReviewDate ? nextReviewDate.toISOString() : null;

    // A topic is overdue when its next scheduled review is before today start.
    const overdue =
      nextReviewDate != null && nextReviewDate.getTime() < start.getTime();

    for (const a of attempts) {
      const key = jakartaDayKey(new Date(a.answeredAt));
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }

    return {
      topicId: topic.id,
      title: topic.title,
      hasModule: topic.module != null,
      status: topic.status,
      dueBeforeLecture,
      dueToday,
      overdue,
      attempts: attempts.length,
      masteryPct,
      nextReview,
    };
  });

  // Streak: consecutive days (ending today or yesterday) with >=1 attempt.
  let cursor = dayCounts.has(jakartaDayKey(new Date()))
    ? startOfTodayJakarta()
    : new Date(startOfTodayJakarta().getTime() - DAY_MS);
  let streakDays = 0;
  while (dayCounts.has(jakartaDayKey(cursor))) {
    streakDays += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  // Heatmap: last HEATMAP_DAYS days including today, ascending by date.
  const heatmap: HeatmapEntry[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * DAY_MS);
    const key = jakartaDayKey(d);
    heatmap.push({ date: key, count: dayCounts.get(key) ?? 0 });
  }

  const masteryValues = topicProgress
    .map((t) => ({ pct: t.masteryPct, scored: t.attempts }))
    .filter((t) => t.scored > 0)
    .map((t) => t.pct);
  const avgMastery =
    masteryValues.length > 0
      ? Math.round(masteryValues.reduce((a, b) => a + b, 0) / masteryValues.length)
      : null;

  return NextResponse.json({
    topics: topicProgress,
    dueTodayCount,
    dueTodayByCourse,
    streakDays,
    heatmap,
    avgMastery,
  });
}
