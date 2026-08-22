import { describe, expect, it, vi, beforeEach } from "vitest";

// Owner scoping lives in the WHERE clauses, so these tests assert the queries
// themselves: a `findUnique({ where: { id } })` that should have been a
// `findFirst({ where: { id, ownerId } })` is exactly the bug class that let one
// student read another's course.
vi.mock("./prisma", () => {
  const course = { findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn() };
  const topic = { findFirst: vi.fn(), create: vi.fn() };
  return { prisma: { course, topic } };
});

import { ensureTopic, resolveCourseMajor } from "./topics";
import { prisma } from "./prisma";

const course = prisma.course as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const topic = prisma.topic as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const OWNER = "owner-1";

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: `mockResolvedValueOnce` queues survive
  // mockClear, so an unconsumed value from a previous test would be handed to the
  // next one's first call and produce a baffling failure.
  vi.resetAllMocks();
});

describe("ensureTopic", () => {
  it("reuses a topic the caller owns", async () => {
    topic.findFirst.mockResolvedValueOnce({ id: "t1", ownerId: OWNER });
    const result = await ensureTopic({ ownerId: OWNER, title: "Kinship", topicId: "t1" });
    expect(result).toEqual({ id: "t1", ownerId: OWNER });
    expect(topic.findFirst).toHaveBeenCalledWith({ where: { id: "t1", ownerId: OWNER } });
    // Never falls through to creating anything when the row was found.
    expect(topic.create).not.toHaveBeenCalled();
  });

  it("ignores a topicId that belongs to someone else and creates the caller's own", async () => {
    // The other student's topic is invisible to this owner-scoped query...
    topic.findFirst.mockResolvedValueOnce(null); // id+owner lookup
    course.upsert.mockResolvedValueOnce({ id: "c-umum", ownerId: OWNER, name: "Umum" });
    topic.findFirst.mockResolvedValueOnce(null); // title+course+owner lookup
    topic.create.mockResolvedValueOnce({ id: "t-new", ownerId: OWNER });

    const result = await ensureTopic({
      ownerId: OWNER,
      title: "Kinship",
      topicId: "someone-elses-topic",
    });

    expect(result).toEqual({ id: "t-new", ownerId: OWNER });
    // ...and the created row is stamped with the caller's ownerId.
    expect(topic.create).toHaveBeenCalledWith({
      data: {
        title: "Kinship",
        ownerId: OWNER,
        courseId: "c-umum",
        orderSource: "custom",
        status: "papers_fetched",
      },
    });
  });

  it("resolves the default course per owner, not through a shared fixed id", async () => {
    topic.findFirst.mockResolvedValueOnce(null);
    course.upsert.mockResolvedValueOnce({ id: "c-umum", ownerId: OWNER });
    topic.findFirst.mockResolvedValueOnce(null);
    topic.create.mockResolvedValueOnce({ id: "t-new" });

    await ensureTopic({ ownerId: OWNER, title: "Kinship" });

    expect(course.upsert).toHaveBeenCalledWith({
      where: { ownerId_name: { ownerId: OWNER, name: "Umum" } },
      update: {},
      create: { ownerId: OWNER, name: "Umum" },
    });
  });

  it("does not adopt another owner's course when courseId is supplied", async () => {
    course.findFirst.mockResolvedValueOnce(null); // not this owner's course
    course.create.mockResolvedValueOnce({ id: "c-x", ownerId: OWNER });
    topic.findFirst.mockResolvedValueOnce(null);
    topic.create.mockResolvedValueOnce({ id: "t-new" });

    await ensureTopic({ ownerId: OWNER, title: "Kinship", courseId: "c-x" });

    expect(course.findFirst).toHaveBeenCalledWith({ where: { id: "c-x", ownerId: OWNER } });
    expect(course.create).toHaveBeenCalledWith({
      data: { id: "c-x", ownerId: OWNER, name: "Umum" },
    });
  });

  it("falls back to the default course when creating the requested course fails", async () => {
    course.findFirst.mockResolvedValueOnce(null);
    course.create.mockRejectedValueOnce(new Error("unique violation"));
    course.upsert.mockResolvedValueOnce({ id: "c-umum", ownerId: OWNER });
    topic.findFirst.mockResolvedValueOnce(null);
    topic.create.mockResolvedValueOnce({ id: "t-new" });

    const result = await ensureTopic({ ownerId: OWNER, title: "Kinship", courseId: "c-x" });
    expect(result).toEqual({ id: "t-new" });
    expect(course.upsert).toHaveBeenCalled();
  });

  it("looks up an existing topic by title WITHIN the owner", async () => {
    course.upsert.mockResolvedValueOnce({ id: "c-umum" });
    topic.findFirst.mockResolvedValueOnce({ id: "t-existing" });
    const result = await ensureTopic({ ownerId: OWNER, title: "Kinship" });
    expect(result).toEqual({ id: "t-existing" });
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { title: "Kinship", courseId: "c-umum", ownerId: OWNER },
    });
    expect(topic.create).not.toHaveBeenCalled();
  });
});

describe("resolveCourseMajor", () => {
  it("reads the major from the caller's course", async () => {
    course.findFirst.mockResolvedValueOnce({ major: "Antropologi" });
    await expect(resolveCourseMajor({ ownerId: OWNER, courseId: "c1" })).resolves.toBe(
      "Antropologi",
    );
    expect(course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", ownerId: OWNER },
      select: { major: true },
    });
  });

  it("returns undefined for another owner's course instead of leaking its major", async () => {
    course.findFirst.mockResolvedValueOnce(null);
    await expect(resolveCourseMajor({ ownerId: OWNER, courseId: "c-theirs" })).resolves.toBeUndefined();
  });

  it("falls back to the topic's course, still owner-scoped", async () => {
    topic.findFirst.mockResolvedValueOnce({ course: { major: "Sosiologi" } });
    await expect(resolveCourseMajor({ ownerId: OWNER, topicId: "t1" })).resolves.toBe("Sosiologi");
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: OWNER },
      select: { course: { select: { major: true } } },
    });
  });

  it("returns undefined when there is nothing to resolve", async () => {
    await expect(resolveCourseMajor({ ownerId: OWNER })).resolves.toBeUndefined();
  });
});
