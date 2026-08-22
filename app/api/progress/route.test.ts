import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

vi.mock("@/src/lib/prisma", () => {
  const topic = { findMany: vi.fn() };
  const course = { findFirst: vi.fn() };
  return { prisma: { topic, course } };
});

import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";

const topic = prisma.topic as unknown as { findMany: ReturnType<typeof vi.fn> };
const course = prisma.course as unknown as { findFirst: ReturnType<typeof vi.fn> };

async function reqFor(courseId: string, userId?: string) {
  return {
    nextUrl: new URL(`http://x/api/progress?courseId=${courseId}`),
    headers: await authedHeaders(userId),
  } as never;
}

const now = new Date();

const COURSE_TOPICS = [
  {
    id: "t1",
    title: "Habitus",
    status: "ready",
    dueBeforeLecture: null,
    module: { id: "m1" },
    attempts: [
      { isCorrect: true, answeredAt: now, scheduledNextAt: new Date(now.getTime() + 86_400_000) },
      { isCorrect: false, answeredAt: now, scheduledNextAt: new Date(now.getTime() + 86_400_000) },
    ],
  },
];

describe("GET /api/progress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    course.findFirst.mockResolvedValue({ id: "c1" });
  });

  it("401s a request with no session cookie", async () => {
    const res = await GET({
      nextUrl: new URL("http://x/api/progress?courseId=c1"),
      headers: anonymousHeaders(),
    } as never);
    expect(res.status).toBe(401);
    // The dashboard query never ran, so an anonymous probe costs no DB work.
    expect(topic.findMany).not.toHaveBeenCalled();
  });

  it("rejects a missing courseId with 400", async () => {
    const res = await GET({
      nextUrl: new URL("http://x/api/progress"),
      headers: await authedHeaders(),
    } as never);
    expect(res.status).toBe(400);
  });

  it("computes due-today, mastery and streak from attempts", async () => {
    const allTopics = [{ courseId: "c1", dueBeforeLecture: null }];
    // First call: course topics (include module+attempts). Second call: all topics.
    topic.findMany.mockResolvedValueOnce(COURSE_TOPICS).mockResolvedValueOnce(allTopics);

    const res = await GET(await reqFor("c1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { topics: { masteryPct: number }[]; avgMastery: number; streakDays: number };
    // 1 of 2 scored attempts correct → 50% mastery.
    expect(body.topics[0].masteryPct).toBe(50);
    expect(body.avgMastery).toBe(50);
    // One attempt today → streak at least 1.
    expect(body.streakDays).toBeGreaterThanOrEqual(1);
  });

  it("scopes BOTH the course topics and the cross-course badge counts by owner", async () => {
    topic.findMany.mockResolvedValueOnce(COURSE_TOPICS).mockResolvedValueOnce([]);
    await GET(await reqFor("c1"));
    expect(topic.findMany).toHaveBeenNthCalledWith(1, {
      where: { courseId: "c1", ownerId: TEST_USER_ID },
      include: { module: true, attempts: true },
    });
    // The sidebar aggregate is the sneaky one: unscoped it exposed the other
    // student's course ids and workload as `dueTodayByCourse` keys.
    expect(topic.findMany).toHaveBeenNthCalledWith(2, {
      where: { ownerId: TEST_USER_ID },
      select: { courseId: true, dueBeforeLecture: true },
    });
  });

  it("404s another student's courseId without reading her topics", async () => {
    course.findFirst.mockResolvedValue(null);
    const res = await GET(await reqFor("her-course"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Mata kuliah tidak ditemukan." });
    expect(topic.findMany).not.toHaveBeenCalled();
  });

  it("verifies the course through the owner, not by id alone", async () => {
    topic.findMany.mockResolvedValue([]);
    await GET(await reqFor("c1"));
    expect(course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", ownerId: TEST_USER_ID },
      select: { id: true },
    });
  });
});
