import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { requireUser } from "@/src/lib/tenancy";
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

const STATUS: Record<string, string> = {
  pending: "pending",
  papers_fetched: "papers_fetched",
  papers_approved: "papers_approved",
  module_generated: "module_generated",
  ready: "ready",
};

async function listCourses(ownerId: string) {
  // FOLD the owner into the read: a course that is not the caller's simply never
  // appears, so the "two students share a course list" bug is structurally
  // impossible rather than a thing the code must remember to check.
  const courses = await prisma.course.findMany({
    where: { ownerId },
    orderBy: { name: "asc" },
    include: {
      modules: {
        include: {
          module: { include: { topic: true } },
        },
      },
      topics: {
        where: { module: null },
        orderBy: { id: "desc" },
      },
    },
  });

  return courses.map((c) => ({
    id: c.id,
    name: c.name,
    major: c.major,
    modules: c.modules
      .map((cm) => ({
        id: cm.module.id,
        title: cm.module.topic.title,
        status: STATUS[cm.module.topic.status] ?? cm.module.topic.status,
        topicId: cm.module.topicId,
        weekNumber: cm.module.topic.weekNumber,
        dueBeforeLecture: cm.module.topic.dueBeforeLecture?.toISOString() ?? null,
        orderSource: cm.module.topic.orderSource,
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    topics: c.topics.map((t) => ({
      id: t.id,
      title: t.title,
      status: STATUS[t.status] ?? t.status,
      courseId: t.courseId,
      weekNumber: t.weekNumber,
      dueBeforeLecture: t.dueBeforeLecture?.toISOString() ?? null,
      orderSource: t.orderSource,
    })),
  }));
}

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const courses = await listCourses(ownerId);
  return NextResponse.json({ courses });
}

/**
 * Normalize a submitted list of course names.
 *
 * Blank entries are dropped rather than rejected: they are the normal artefact
 * of pasting a list (trailing newline, double newline between lines), and
 * failing the whole semester import over one blank line would be hostile. An
 * all-blank submission still fails, in the caller, with a 400.
 *
 * Duplicates are collapsed case-insensitively, keeping the first spelling: the
 * DB unique index is case-sensitive, so without this "Antropologi" and
 * "antropologi" would both be created as separate courses — nearly always a typo
 * rather than an intent.
 */
export function normalizeCourseNames(raw: unknown[]): { names: string[]; duplicates: string[] } {
  const names: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(name);
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return { names, duplicates };
}

/**
 * POST /api/courses
 *
 * Two shapes, one endpoint:
 *
 *   { name: string, major?: string }
 *     Single course, idempotent upsert (the retrieve→synthesize flow calls this
 *     to resolve a typed course name to an id, so it must not fail when the
 *     course already exists). A `major` is filled in when the existing row has
 *     none; an existing major is never silently overwritten.
 *     -> 200 { id, name, major }
 *
 *   { names: string[], major?: string }
 *     Batch semester import: many courses in ONE request (no N client calls).
 *     Blank entries dropped, duplicates collapsed case-insensitively, then all
 *     rows created in a single transaction — all-or-nothing, so a collision
 *     halfway down the list cannot leave half a semester imported.
 *     -> 201 { created: [{id,name,major,topics:[]}], count, duplicates }
 *     -> 400 nothing usable in the list
 *     -> 409 { error, conflicts: string[] } a name already exists
 *     -> 413 list or a name over the guard ceiling
 *
 * Note: courses are created with no Topic rows. A course's "initial topic list"
 * is empty by construction (there are no titles to give them yet); topics are
 * added afterwards through the compose → retrieve flow.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  let body: { name?: string; names?: unknown; major?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const major = typeof body.major === "string" && body.major.trim() ? body.major.trim() : null;

  // ---- Batch path -------------------------------------------------------
  if (Array.isArray(body.names)) {
    const { names, duplicates } = normalizeCourseNames(body.names);
    if (names.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada nama mata kuliah yang bisa dibaca dari daftar." },
        { status: 400 },
      );
    }

    const guardFailure = firstGuardError(
      guardCount("names", "Mata kuliah dalam satu impor", names.length, LIMITS.courseBatchCount),
      ...names.map((n) => guardLength("names", `Nama mata kuliah "${n.slice(0, 40)}"`, n, LIMITS.courseName)),
    );
    if (guardFailure) {
      return NextResponse.json({ error: guardFailure.error }, { status: GUARD_STATUS });
    }

    // Surface collisions as a precise 409 instead of letting the unique index
    // raise a generic 500 the student cannot act on. The collision is PER OWNER:
    // a name my girlfriend already has is not my collision, so we fold ownerId
    // into the lookup and only block a name I already own (see schema
    // @@unique([ownerId, name])). Another student's course stays invisible here.
    const existing = await prisma.course.findMany({
      where: { ownerId, name: { in: names } },
      select: { name: true },
    });
    if (existing.length > 0) {
      const conflicts = existing.map((c) => c.name);
      return NextResponse.json(
        {
          error:
            `Mata kuliah ini sudah ada: ${conflicts.join(", ")}. ` +
            `Hapus dari daftar (atau ganti namanya), lalu impor lagi.`,
          conflicts,
        },
        { status: 409 },
      );
    }

    try {
      const created = await prisma.$transaction(
        names.map((name) =>
          prisma.course.create({
            // Every Course a student creates is stamped with their ownerId — there
            // is no shared course row, so a created course can never leak across
            // accounts.
            data: { name, ownerId, ...(major ? { major } : {}) },
            select: { id: true, name: true, major: true },
          }),
        ),
      );
      return NextResponse.json(
        {
          created: created.map((c) => ({ ...c, topics: [], modules: [] })),
          count: created.length,
          duplicates,
        },
        { status: 201 },
      );
    } catch (e) {
      // Backstop for the race between the pre-check above and the insert: the
      // unique constraint is authoritative, and it still must not read as a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return NextResponse.json(
          {
            error:
              "Salah satu nama mata kuliah sudah ada (dibuat bersamaan). " +
              "Muat ulang daftar mata kuliah, lalu impor sisanya.",
            conflicts: names,
          },
          { status: 409 },
        );
      }
      throw e;
    }
  }

  // ---- Single path (unchanged contract) ---------------------------------
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Field 'name' is required." }, { status: 400 });
  }
  const nameTooLong = guardLength("name", "Nama mata kuliah", name, LIMITS.courseName);
  if (nameTooLong) {
    return NextResponse.json({ error: nameTooLong.error }, { status: GUARD_STATUS });
  }

  // Owner-scoped read: a name my girlfriend owns is not "my" course, so the
  // findUnique-by-name (which was global) is replaced by findFirst-by-name+owner.
  // The upsert keys off the compound (ownerId, name) unique now — that is the row
  // that matters for THIS student, not the global name.
  const existing = await prisma.course.findFirst({ where: { name, ownerId } });
  const course = await prisma.course.upsert({
    where: { ownerId_name: { ownerId, name } },
    // Only backfill a missing major; an existing one is the student's earlier
    // answer and is not overwritten by a later create-if-absent call.
    update: major && !existing?.major ? { major } : {},
    create: { name, ownerId, ...(major ? { major } : {}) },
  });
  return NextResponse.json({ id: course.id, name: course.name, major: course.major });
}
