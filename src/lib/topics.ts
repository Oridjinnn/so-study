import { prisma } from "./prisma";

const DEFAULT_COURSE_ID = "default-course";
const DEFAULT_COURSE_NAME = "Umum";

/**
 * Resolve or create the Course a Topic belongs to. When `courseId` is supplied
 * we use that course (it is normally created during onboarding with its real
 * name). If the course does not yet exist we create it with a SENSIBLE human
 * name — never the raw id/cuid. When no `courseId` is given we fall back to a
 * single shared default course named "Umum".
 */
async function resolveCourse(courseId?: string) {
  if (courseId) {
    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (existing) return existing;
    // Course missing: create it, but never name it after the cuid. A name
    // collision (e.g. with the default "Umum") or other failure falls back to
    // the shared default course rather than throwing mid-synthesis.
    try {
      return await prisma.course.create({ data: { id: courseId, name: DEFAULT_COURSE_NAME } });
    } catch {
      return resolveDefaultCourse();
    }
  }
  return resolveDefaultCourse();
}

async function resolveDefaultCourse() {
  return prisma.course.upsert({
    where: { id: DEFAULT_COURSE_ID },
    update: {},
    create: { id: DEFAULT_COURSE_ID, name: DEFAULT_COURSE_NAME },
  });
}

/**
 * Resolve or create the Topic a module is being built for. If `topicId` is
 * supplied and exists, it wins. Otherwise we look up (or create) a Topic by
 * title under the resolved course. The human-facing title is the canonical key
 * within a course so repeated synthesis on the same topic maps to one row.
 */
export async function ensureTopic(title: string, topicId?: string, courseId?: string) {
  if (topicId) {
    const existing = await prisma.topic.findUnique({ where: { id: topicId } });
    if (existing) return existing;
  }
  const course = await resolveCourse(courseId);
  const existing = await prisma.topic.findFirst({
    where: { title, courseId: course.id },
  });
  if (existing) return existing;
  return prisma.topic.create({
    data: { title, courseId: course.id, orderSource: "custom", status: "papers_fetched" },
  });
}

/**
 * Look up the jurusan (`Course.major`) that should frame retrieval + synthesis
 * for a topic, WITHOUT creating anything. Retrieval needs the major before it
 * decides which papers to fetch, but `ensureTopic` must stay after retrieval —
 * otherwise a failed OpenAlex call would leave an orphan Topic behind.
 *
 * Resolution order: the explicitly-picked course, else the course the existing
 * topic already belongs to. Returns undefined when there is no major to apply
 * (no course, unknown course, or a course created before the field existed), in
 * which case callers fall back to discipline-neutral behaviour.
 */
export async function resolveCourseMajor(args: {
  courseId?: string;
  topicId?: string;
}): Promise<string | undefined> {
  if (args.courseId) {
    const course = await prisma.course.findUnique({
      where: { id: args.courseId },
      select: { major: true },
    });
    if (course?.major) return course.major;
  }
  if (args.topicId) {
    const topic = await prisma.topic.findUnique({
      where: { id: args.topicId },
      select: { course: { select: { major: true } } },
    });
    if (topic?.course.major) return topic.course.major;
  }
  return undefined;
}
