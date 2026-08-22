import { prisma } from "./prisma";

// The catch-all course a topic lands in when the student never picked one.
//
// This used to be a FIXED row id ("default-course"), which was fine for one
// student and is a cross-tenant bug for two: both would resolve to the same row,
// so her ad-hoc topics would appear in my course list. It is now resolved by
// (owner, name), so each student gets their own "Umum".
const DEFAULT_COURSE_NAME = "Umum";

/**
 * Resolve or create the Course a Topic belongs to, ALWAYS within one owner.
 *
 * When `courseId` is supplied we use that course — but only if it belongs to the
 * caller. A course id from someone else's account is treated exactly like an
 * unknown one (fall back to the caller's default course) rather than as an error:
 * a 500 here would abort a synthesis the student already paid a Gemini call for,
 * and confirming that the id exists would leak the other account's contents.
 */
async function resolveCourse(ownerId: string, courseId?: string) {
  if (courseId) {
    const existing = await prisma.course.findFirst({ where: { id: courseId, ownerId } });
    if (existing) return existing;
    // Course missing: create it under this owner, but never name it after the
    // cuid. A name collision (e.g. with the default "Umum") or any other failure
    // falls back to the shared default course rather than throwing mid-synthesis.
    try {
      return await prisma.course.create({
        data: { id: courseId, ownerId, name: DEFAULT_COURSE_NAME },
      });
    } catch {
      return resolveDefaultCourse(ownerId);
    }
  }
  return resolveDefaultCourse(ownerId);
}

async function resolveDefaultCourse(ownerId: string) {
  return prisma.course.upsert({
    // Course names are unique PER OWNER (prisma/schema.prisma @@unique), so this
    // is the compound key Prisma generates for it.
    where: { ownerId_name: { ownerId, name: DEFAULT_COURSE_NAME } },
    update: {},
    create: { ownerId, name: DEFAULT_COURSE_NAME },
  });
}

/**
 * Resolve or create the Topic a module is being built for, scoped to `ownerId`.
 *
 * If `topicId` is supplied and belongs to the caller, it wins. Otherwise we look
 * up (or create) a Topic by title under the resolved course. The human-facing
 * title is the canonical key within a course, so repeated synthesis on the same
 * topic maps to one row — and the lookup is filtered by owner so two students
 * studying "Antropologi Ekologi" get two topics, not a shared one.
 */
export async function ensureTopic(args: {
  ownerId: string;
  title: string;
  topicId?: string;
  courseId?: string;
}) {
  const { ownerId, title, topicId, courseId } = args;
  if (topicId) {
    const existing = await prisma.topic.findFirst({ where: { id: topicId, ownerId } });
    if (existing) return existing;
  }
  const course = await resolveCourse(ownerId, courseId);
  const existing = await prisma.topic.findFirst({
    where: { title, courseId: course.id, ownerId },
  });
  if (existing) return existing;
  return prisma.topic.create({
    data: { title, ownerId, courseId: course.id, orderSource: "custom", status: "papers_fetched" },
  });
}

/**
 * Look up the jurusan (`Course.major`) that should frame retrieval + synthesis
 * for a topic, WITHOUT creating anything. Retrieval needs the major before it
 * decides which papers to fetch, but `ensureTopic` must stay after retrieval —
 * otherwise a failed OpenAlex call would leave an orphan Topic behind.
 *
 * Resolution order: the explicitly-picked course, else the course the existing
 * topic already belongs to. Both lookups are owner-scoped: an id belonging to
 * another student resolves to undefined, never to their major. Returns undefined
 * when there is no major to apply (no course, unknown course, not the caller's
 * course, or a course created before the field existed), in which case callers
 * fall back to discipline-neutral behaviour.
 */
export async function resolveCourseMajor(args: {
  ownerId: string;
  courseId?: string;
  topicId?: string;
}): Promise<string | undefined> {
  if (args.courseId) {
    const course = await prisma.course.findFirst({
      where: { id: args.courseId, ownerId: args.ownerId },
      select: { major: true },
    });
    if (course?.major) return course.major;
  }
  if (args.topicId) {
    const topic = await prisma.topic.findFirst({
      where: { id: args.topicId, ownerId: args.ownerId },
      select: { course: { select: { major: true } } },
    });
    if (topic?.course?.major) return topic.course.major;
  }
  return undefined;
}
