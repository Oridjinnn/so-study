import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { notFoundForUser, requireUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Both handlers here write a JOIN row (CourseModule), so they take TWO
// caller-supplied ids: the module in the path and the course in the body. Each
// one is resolved inside the caller's own rows before the link is touched —
// checking only the module would let a guessed courseId file my module under
// someone else's matakuliah (and confirm that their course id exists).

// Link an existing module to a course (matakuliah). A module can belong to many
// courses, so this is an additive, idempotent link — never removes others.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/modules/[id]/courses">) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { id } = await ctx.params;
  let body: { courseId?: string; courseName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // findFirst({ id, ownerId }) instead of findUnique({ id }): another student's
  // module is indistinguishable from a nonexistent one, which is the whole point
  // (src/lib/tenancy.ts).
  const mod = await prisma.module.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!mod) return notFoundForUser("Modul");

  const requestedId = body.courseId?.trim();
  const requestedName = body.courseName?.trim();
  let courseId: string | undefined;
  if (requestedId) {
    // An id off the request body is untrusted input, so it is resolved WITHIN the
    // owner. Previously it went straight into the join upsert, so a foreign id
    // would either link across accounts or raise a foreign-key 500 — both of
    // which answer "is this id real?".
    const course = await prisma.course.findFirst({
      where: { id: requestedId, ownerId },
      select: { id: true },
    });
    if (!course) return notFoundForUser("Matakuliah");
    courseId = course.id;
  } else if (requestedName) {
    // Course.name is no longer globally unique — it is unique PER OWNER
    // (@@unique([ownerId, name])), so the upsert key is the compound one. The old
    // `where: { name }` would have silently ADOPTED an identically-named course
    // belonging to the other student ("Antropologi Ekologi" is not a rare name).
    const course = await prisma.course.upsert({
      where: { ownerId_name: { ownerId, name: requestedName } },
      update: {},
      create: { ownerId, name: requestedName },
    });
    courseId = course.id;
  }
  if (!courseId) {
    return NextResponse.json(
      { error: "Sediakan courseId atau courseName." },
      { status: 400 },
    );
  }

  await prisma.courseModule.upsert({
    where: { courseId_moduleId: { courseId, moduleId: id } },
    update: {},
    create: { courseId, moduleId: id },
  });

  const links = await listLinks(id, ownerId);
  return NextResponse.json({ courses: links });
}

// Unlink a module from one course (matakuliah). This is how the user "changes"
// a module's matakuliah: remove it from the wrong course, then add it to the
// right one via POST. Never deletes the module or other course links.
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/modules/[id]/courses">) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { id } = await ctx.params;
  let body: { courseId?: string; courseName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mod = await prisma.module.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!mod) return notFoundForUser("Modul");

  let courseId = body.courseId?.trim();
  if (!courseId && body.courseName?.trim()) {
    // Per-owner name lookup: findUnique({ name }) does not even compile any more,
    // and resolving a name globally here would have deleted a link on the other
    // student's identically-named course.
    const course = await prisma.course.findFirst({
      where: { ownerId, name: body.courseName.trim() },
      select: { id: true },
    });
    if (course) courseId = course.id;
  }
  if (!courseId) {
    return NextResponse.json(
      { error: "Sediakan courseId atau courseName." },
      { status: 400 },
    );
  }

  // CourseModule carries no owner of its own, so it is scoped THROUGH the
  // relation. A courseId belonging to someone else matches nothing and the
  // delete is a no-op — an unlink stays idempotent (its existing contract) and
  // still says nothing about whether that course exists.
  await prisma.courseModule.deleteMany({
    where: { moduleId: id, courseId, course: { ownerId } },
  });

  const links = await listLinks(id, ownerId);
  return NextResponse.json({ courses: links });
}

/**
 * The course list both handlers echo back. Scoped through `course: { ownerId }`
 * for the same reason the delete is: the join row is only ever reachable via a
 * parent that has an owner, so the parent is where the filter belongs.
 */
async function listLinks(moduleId: string, ownerId: string) {
  const links = await prisma.courseModule.findMany({
    where: { moduleId, course: { ownerId } },
    include: { course: true },
  });
  return links.map((l) => ({ id: l.course.id, name: l.course.name }));
}
