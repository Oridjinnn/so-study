import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireUser } from "@/src/lib/tenancy";
import {
  alignedTopicIds,
  diffTopicOrder,
  parseOfficialOrder,
  sortCustomOrder,
  summarizeDiff,
} from "@/src/lib/rps";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardCount,
  guardLength,
} from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RPS reconciliation for one course (Risk Register R1).
//
//   GET  /api/rps/[courseId]
//     200 { courseId, courseName, hasOfficialOrder, officialOrder[], rows[],
//           summary, reconciledAt|null }
//     404 unknown course
//
//   PUT  /api/rps/[courseId]   body: { officialOrder: string | string[] }
//     200 same shape as GET (recomputed after saving)
//     400 invalid JSON / empty order
//     404 unknown course
//     413 pasted order over the guard ceiling
//
// The diff is always recomputed from live Topic rows, never read from storage,
// so it cannot go stale as topics change. Saving also refreshes
// `Topic.orderSource`: topics the official order confirms become "official_rps",
// everything else returns to "custom" so the "unverified order" badge stays
// truthful when a corrected order is pasted.

async function loadState(courseId: string, ownerId: string) {
  // FOLD the owner into the course read: a course that is not the caller's
  // resolves to null and the whole endpoint 404s, so another student's RPS can
  // never be read or written. We use findFirst (not findUnique) precisely so the
  // owner can be part of the where clause.
  const course = await prisma.course.findFirst({
    where: { id: courseId, ownerId },
    select: { id: true, name: true },
  });
  if (!course) return null;

  const [topics, reconcile] = await Promise.all([
    prisma.topic.findMany({
      // Topics carry ownerId directly, so fold it in here too — every topic we
      // diff and every orderSource we flip belongs to this student.
      where: { courseId, ownerId },
      // cuid is time-prefixed, so ascending id is creation order — the tiebreak
      // `sortCustomOrder` falls back to when a topic has no weekNumber.
      orderBy: { id: "asc" },
      select: { id: true, title: true, weekNumber: true, orderSource: true },
    }),
    prisma.rPSReconcile.findUnique({ where: { courseId } }),
  ]);

  let officialOrder: string[] = [];
  if (reconcile) {
    try {
      const parsed = JSON.parse(reconcile.officialOrder);
      if (Array.isArray(parsed)) {
        officialOrder = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // Degrade to "no official order" rather than failing the whole view: a
      // corrupt row must not make the course unreadable. Re-pasting fixes it.
      officialOrder = [];
    }
  }

  return { course, topics, reconcile, officialOrder };
}

function serialize(state: NonNullable<Awaited<ReturnType<typeof loadState>>>) {
  const { course, topics, reconcile, officialOrder } = state;
  const rows = diffTopicOrder(officialOrder, topics);
  return {
    courseId: course.id,
    courseName: course.name,
    hasOfficialOrder: officialOrder.length > 0,
    officialOrder,
    rows,
    summary: summarizeDiff(rows),
    reconciledAt: reconcile?.updatedAt.toISOString() ?? null,
    unverifiedCount: topics.filter((t) => t.orderSource !== "official_rps").length,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { courseId } = await params;
  const state = await loadState(courseId, ownerId);
  if (!state) {
    return NextResponse.json({ error: "Mata kuliah tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(serialize(state));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  const { courseId } = await params;
  let body: { officialOrder?: string | string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Accept either the raw pasted text or an already-split array.
  const rawText = Array.isArray(body.officialOrder)
    ? body.officialOrder.join("\n")
    : (body.officialOrder ?? "");
  if (typeof rawText !== "string" || !rawText.trim()) {
    return NextResponse.json(
      { error: "Urutan resmi kosong. Tempel daftar topik dari RPS/dosen dulu." },
      { status: 400 },
    );
  }

  const textTooLong = guardLength("officialOrder", "Urutan RPS", rawText, LIMITS.rpsText);
  if (textTooLong) {
    return NextResponse.json({ error: textTooLong.error }, { status: GUARD_STATUS });
  }

  const officialOrder = parseOfficialOrder(rawText);
  if (officialOrder.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada judul topik yang bisa dibaca dari urutan yang ditempel." },
      { status: 400 },
    );
  }
  const tooManyTopics = firstGuardError(
    guardCount("officialOrder", "Topik dalam urutan RPS", officialOrder.length, LIMITS.rpsTopicCount),
  );
  if (tooManyTopics) {
    return NextResponse.json({ error: tooManyTopics.error }, { status: GUARD_STATUS });
  }

  const before = await loadState(courseId, ownerId);
  if (!before) {
    return NextResponse.json({ error: "Mata kuliah tidak ditemukan." }, { status: 404 });
  }

  const rows = diffTopicOrder(officialOrder, before.topics);
  const aligned = alignedTopicIds(rows);
  // Snapshot of what the student had been studying, for audit: the diff itself
  // is recomputed on read, but "what did my order look like when I reconciled"
  // is not otherwise recoverable.
  const customOrder = sortCustomOrder(before.topics).map((t) => t.title);
  const allTopicIds = before.topics.map((t) => t.id);
  const unverified = allTopicIds.filter((id) => !aligned.includes(id));

  await prisma.$transaction([
    prisma.rPSReconcile.upsert({
      where: { courseId },
      update: {
        officialOrder: JSON.stringify(officialOrder),
        customOrder: JSON.stringify(customOrder),
      },
      create: {
        courseId,
        officialOrder: JSON.stringify(officialOrder),
        customOrder: JSON.stringify(customOrder),
      },
    }),
    // These ids came from `before.topics`, which was already owner-scoped, but
    // we add `ownerId` to the write filter too so a stray id can never flip a
    // topic that is not the caller's — defense in depth on a multi-row write.
    prisma.topic.updateMany({
      where: { id: { in: aligned }, ownerId },
      data: { orderSource: "official_rps" },
    }),
    prisma.topic.updateMany({
      where: { id: { in: unverified }, ownerId },
      data: { orderSource: "custom" },
    }),
  ]);

  const after = await loadState(courseId, ownerId);
  if (!after) {
    return NextResponse.json({ error: "Mata kuliah tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json(serialize(after));
}
